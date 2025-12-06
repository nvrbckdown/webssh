# WebSSH Client

A simple, secure web-based SSH client built with Node.js, xterm.js, and ssh2.

## Features

- **Password and Private Key authentication**
- **Real-time terminal** with xterm.js (256-color support)
- **Terminal resizing** support
- **Rate limiting** to prevent abuse
- **Security headers** via Helmet
- **Clean session management** with proper cleanup

## Quick Start

```bash
# Install dependencies
npm install

# Start server (binds to localhost by default)
npm start

# Access at http://127.0.0.1:3000
```

## Security Considerations

⚠️ **IMPORTANT**: This is a tool for internal/development use. For production deployment:

### 1. Always Use HTTPS

Never expose this service over plain HTTP. Use a reverse proxy:

**Nginx example:**
```nginx
server {
    listen 443 ssl http2;
    server_name ssh.yourdomain.com;

    ssl_certificate /etc/ssl/certs/your-cert.pem;
    ssl_certificate_key /etc/ssl/private/your-key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

### 2. Add Authentication

For multi-user environments, add authentication middleware:

```javascript
// Example: Basic Auth middleware
const basicAuth = require('express-basic-auth');

app.use(basicAuth({
  users: { 'admin': 'supersecretpassword' },
  challenge: true,
  realm: 'WebSSH'
}));
```

Better options:
- OAuth2/OIDC (Keycloak, Auth0)
- LDAP integration
- Client certificates

### 3. Network Restrictions

- Bind to localhost and use a reverse proxy
- Use firewall rules to restrict access
- Consider VPN-only access

### 4. Additional Hardening

```javascript
// Add to server.js for production

// Stricter rate limiting
const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many connection attempts'
});
app.use('/api/', strictLimiter);

// Session timeout
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
// Implement automatic disconnect for idle sessions
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `HOST` | 127.0.0.1 | Bind address |

## Docker Deployment

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
USER node
CMD ["node", "server.js"]
```

```bash
docker build -t webssh .
docker run -d -p 127.0.0.1:3000:3000 --name webssh webssh
```

## Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: webssh
spec:
  replicas: 1
  selector:
    matchLabels:
      app: webssh
  template:
    metadata:
      labels:
        app: webssh
    spec:
      containers:
      - name: webssh
        image: webssh:latest
        ports:
        - containerPort: 3000
        resources:
          limits:
            memory: "256Mi"
            cpu: "200m"
        securityContext:
          runAsNonRoot: true
          readOnlyRootFilesystem: true
---
apiVersion: v1
kind: Service
metadata:
  name: webssh
spec:
  selector:
    app: webssh
  ports:
  - port: 3000
    targetPort: 3000
  type: ClusterIP
```

## Architecture

```
┌─────────────────┐     WebSocket      ┌─────────────────┐
│    Browser      │ ◄────────────────► │   Node.js       │
│   (xterm.js)    │                    │   Server        │
└─────────────────┘                    └────────┬────────┘
                                                │
                                           SSH  │
                                                │
                                       ┌────────▼────────┐
                                       │  Remote Host    │
                                       │  (sshd)         │
                                       └─────────────────┘
```

## License

MIT
