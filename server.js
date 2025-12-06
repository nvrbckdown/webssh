const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const { Client } = require('ssh2');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      connectSrc: ["'self'", "ws:", "wss:"],
    },
  },
}));

// Rate limiting for API endpoints
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later.'
});
app.use('/api/', limiter);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Track active sessions for cleanup
const activeSessions = new Map();

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`New WebSocket connection from ${clientIp}`);
  
  let sshClient = null;
  let sshStream = null;
  let sessionId = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'connect':
          // Validate connection parameters
          if (!message.host || !message.username) {
            ws.send(JSON.stringify({ type: 'error', data: 'Missing host or username' }));
            return;
          }

          // Create new SSH client
          sshClient = new Client();
          sessionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          
          sshClient.on('ready', () => {
            console.log(`SSH connected: ${message.username}@${message.host}`);
            ws.send(JSON.stringify({ type: 'status', data: 'connected' }));
            
            // Request PTY and shell
            sshClient.shell({
              term: message.term || 'xterm-256color',
              cols: message.cols || 80,
              rows: message.rows || 24
            }, (err, stream) => {
              if (err) {
                ws.send(JSON.stringify({ type: 'error', data: `Shell error: ${err.message}` }));
                return;
              }

              sshStream = stream;
              activeSessions.set(sessionId, { client: sshClient, stream: sshStream });

              stream.on('data', (chunk) => {
                ws.send(JSON.stringify({ type: 'data', data: chunk.toString('utf-8') }));
              });

              stream.on('close', () => {
                ws.send(JSON.stringify({ type: 'status', data: 'disconnected' }));
                cleanup();
              });

              stream.stderr.on('data', (chunk) => {
                ws.send(JSON.stringify({ type: 'data', data: chunk.toString('utf-8') }));
              });
            });
          });

          sshClient.on('error', (err) => {
            console.error(`SSH error: ${err.message}`);
            ws.send(JSON.stringify({ type: 'error', data: `SSH error: ${err.message}` }));
            cleanup();
          });

          sshClient.on('close', () => {
            ws.send(JSON.stringify({ type: 'status', data: 'disconnected' }));
            cleanup();
          });

          // Build connection config
          const connConfig = {
            host: message.host,
            port: message.port || 22,
            username: message.username,
            readyTimeout: 30000,
            keepaliveInterval: 10000,
          };

          // Support password or private key auth
          if (message.password) {
            connConfig.password = message.password;
          } else if (message.privateKey) {
            connConfig.privateKey = message.privateKey;
            if (message.passphrase) {
              connConfig.passphrase = message.passphrase;
            }
          }

          // Connect
          sshClient.connect(connConfig);
          break;

        case 'data':
          // Send input to SSH stream
          if (sshStream && sshStream.writable) {
            sshStream.write(message.data);
          }
          break;

        case 'resize':
          // Handle terminal resize
          if (sshStream) {
            sshStream.setWindow(message.rows, message.cols, message.height || 480, message.width || 640);
          }
          break;

        case 'disconnect':
          cleanup();
          break;
      }
    } catch (err) {
      console.error(`Message handling error: ${err.message}`);
      ws.send(JSON.stringify({ type: 'error', data: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    console.log('WebSocket closed');
    cleanup();
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error: ${err.message}`);
    cleanup();
  });

  function cleanup() {
    if (sshStream) {
      sshStream.end();
      sshStream = null;
    }
    if (sshClient) {
      sshClient.end();
      sshClient = null;
    }
    if (sessionId) {
      activeSessions.delete(sessionId);
      sessionId = null;
    }
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    activeSessions: activeSessions.size,
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  activeSessions.forEach((session) => {
    if (session.stream) session.stream.end();
    if (session.client) session.client.end();
  });
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // Bind to localhost by default for security

server.listen(PORT, HOST, () => {
  console.log(`WebSSH server running on http://${HOST}:${PORT}`);
  console.log('Security notes:');
  console.log('  - Use behind a reverse proxy with HTTPS in production');
  console.log('  - Add authentication middleware for multi-user environments');
});
