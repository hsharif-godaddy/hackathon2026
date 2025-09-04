const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 8888;
const API_SECRET = process.env.API_SECRET;
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || 'caas-gocode-prod.caas-prod.prod.onkatana.net';
const UPSTREAM_PORT = process.env.UPSTREAM_PORT || '443';
const UPSTREAM_PROTOCOL = process.env.UPSTREAM_PROTOCOL || 'https';

// Middleware
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Authentication middleware for /v1/ routes
const validateGdToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({
      error: {
        message: "Invalid or missing authorization token",
        type: "invalid_request_error"
      }
    });
  }

  // Check if the token matches the gd-* format
  const tokenMatch = authHeader.match(/^Bearer\s+(gd-.+)$/);
  
  if (!tokenMatch) {
    return res.status(401).json({
      error: {
        message: "Invalid or missing authorization token",
        type: "invalid_request_error"
      }
    });
  }

  // Token is valid, continue to proxy
  next();
};

// Proxy configuration for /v1/ routes
const proxyOptions = {
  logger: console,
  target: `${UPSTREAM_PROTOCOL}://${UPSTREAM_HOST}:${UPSTREAM_PORT}`,
  changeOrigin: true,
  secure: false, // Allow self-signed certificates
  ws: true, // Enable WebSocket proxying
  timeout: 60000, // 60 second timeout
  proxyTimeout: 60000,
  headers: {
    'Authorization': `Bearer ${API_SECRET}`
  },
  onProxyReq: (proxyReq, req, res) => {
    proxyReq.setHeader('Host', UPSTREAM_HOST);
  }
};

// Apply authentication middleware and proxy for /v1/ routes  
app.use('/v1', validateGdToken, createProxyMiddleware({
  ...proxyOptions,
  pathRewrite: function (path, req) {
    // Preserve the full /v1 path by prepending it back
    return '/v1' + path;
  }
}));

// Reject all other requests
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: "Not Found",
      type: "not_found_error"
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  res.status(500).json({
    error: {
      message: "Internal Server Error",
      type: "internal_error"
    }
  });
});

// SSL options
const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, 'ssl', 'server.key')),
  cert: fs.readFileSync(path.join(__dirname, 'ssl', 'server.crt'))
};

// Start HTTPS server
const server = https.createServer(sslOptions, app);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${new Date().toISOString()}] Airo Proxy Server started on HTTPS port ${PORT}`);
  console.log(`[${new Date().toISOString()}] Upstream: ${UPSTREAM_PROTOCOL}://${UPSTREAM_HOST}:${UPSTREAM_PORT}`);
  console.log(`[${new Date().toISOString()}] API Secret: ${API_SECRET ? '***configured***' : 'NOT SET'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log(`[${new Date().toISOString()}] Received SIGTERM, shutting down gracefully`);
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log(`[${new Date().toISOString()}] Received SIGINT, shutting down gracefully`);
  server.close(() => {
    process.exit(0);
  });
});
