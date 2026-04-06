#!/usr/bin/env node

/**
 * Status Page Server
 *
 * A simple HTTP server that displays a status page. Supports multiple modes:
 * - Coming Soon (default): shown before the first app publish
 * - Suspended: shown when SUSPENDED=true, indicating the site is not available
 * - Custom: any title/message can be overridden via environment variables
 *
 * Environment Variables:
 * - PORT: The port to listen on (default: 8081)
 * - SERVER_PORT: Alternative port variable (for compatibility)
 * - SUSPENDED: Set to "true" to show a suspended site message (injected by the
 *   publish workload). Do not enable for subscription NON_PAYMENT suspension:
 *   that path is part of normal downgrade-to-free; customers should not see
 *   this branded suspension page for NON_PAYMENT. Use for compliance/legal/
 *   policy/fraud/overage suspensions only (platform must pass reason-aware flags).
 * - STATUS_PAGE_TITLE: Custom title override (used in both <title> and <h1>)
 * - STATUS_PAGE_MESSAGE: Custom message override
 */

const http = require('node:http');

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PORT = process.env.PORT || process.env.SERVER_PORT || 8081;
const HOST = '0.0.0.0';

const suspended = process.env.SUSPENDED === 'true';

const defaultTitle = suspended ? 'Site Suspended' : 'Coming Soon!';
const defaultMessage = suspended
  ? 'Access to this site is not currently available, please contact support if you are the owner of this site.'
  : 'Your application is being prepared. Please check back soon.';

const title = escapeHtml(process.env.STATUS_PAGE_TITLE || defaultTitle);
const message = escapeHtml(process.env.STATUS_PAGE_MESSAGE || defaultMessage);

const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="robots" content="noindex, nofollow">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
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
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;

const server = http.createServer(function handle(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(PORT, HOST, function listen() {
  const customized = process.env.STATUS_PAGE_TITLE || process.env.STATUS_PAGE_MESSAGE ? ', customized' : '';
  console.log(`[INFO] Status page server running on http://${HOST}:${PORT} (mode: ${suspended ? 'suspended' : 'coming-soon'}${customized})`);
});

process.on('SIGTERM', function shutdown() {
  console.log('[INFO] SIGTERM received, closing server...');
  server.close(function closed() {
    console.log('[INFO] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', function shutdown() {
  console.log('[INFO] SIGINT received, closing server...');
  server.close(function closed() {
    console.log('[INFO] Server closed');
    process.exit(0);
  });
});
