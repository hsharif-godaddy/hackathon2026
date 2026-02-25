#!/usr/bin/env node

/**
 * Coming Soon Server
 *
 * A simple HTTP server that displays a "Coming Soon" page.
 * Used by the publish supervisor before the first app publish.
 *
 * Environment Variables:
 * - PORT: The port to listen on (default: 8081)
 * - SERVER_PORT: Alternative port variable (for compatibility)
 */

const http = require('node:http');

const PORT = process.env.PORT || process.env.SERVER_PORT || 8081;
const HOST = '0.0.0.0';

const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="robots" content="noindex, nofollow">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Coming Soon</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    html, body {
      height: 100%;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f0f0f0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    h1 {
      color: #333;
      font-size: 2.5rem;
      margin-bottom: 1rem;
    }
    p {
      color: #666;
      font-size: 1.125rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Coming Soon!</h1>
    <p>Your application is being prepared. Please check back soon.</p>
  </div>
</body>
</html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(PORT, HOST, () => {
  console.log(`[INFO] Coming Soon server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[INFO] SIGTERM received, closing server...');
  server.close(() => {
    console.log('[INFO] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[INFO] SIGINT received, closing server...');
  server.close(() => {
    console.log('[INFO] Server closed');
    process.exit(0);
  });
});
