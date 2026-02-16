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
    <title>Coming Soon</title>
    <style>
        body {
            font-family: sans-serif;
            text-align: center;
            padding: 50px;
            background: #f0f0f0;
        }
        h1 {
            color: #333;
        }
        p {
            color: #666;
        }
    </style>
</head>
<body>
    <h1>Coming Soon!</h1>
    <p>Your application is being prepared. Please check back soon.</p>
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
