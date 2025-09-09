// Initialize Elastic APM first - must be before any other imports
const isApmEnabled = !!(process.env.ELASTIC_APM_SECRET_TOKEN && process.env.ELASTIC_APM_SERVER_URL);

if (isApmEnabled) {
  console.log('🔍 Elastic APM enabled - Performance monitoring active');
  console.log(`📊 APM Server: ${process.env.ELASTIC_APM_SERVER_URL}`);
  console.log(`🏷️  Environment: ${process.env.NODE_ENV || 'development'}`);
} else {
  console.log('⚠️  Elastic APM disabled - Missing ELASTIC_APM_SECRET_TOKEN or ELASTIC_APM_SERVER_URL');
}

const apm = require('elastic-apm-node').start({
  serviceName: 'airo-app-builder',
  secretToken: process.env.ELASTIC_APM_SECRET_TOKEN,
  serverUrl: process.env.ELASTIC_APM_SERVER_URL,
  environment: process.env.NODE_ENV || 'development',
  active: isApmEnabled,
  // Next.js specific configuration
  usePathAsTransactionName: true,
  transactionSampleRate: 1.0,
  captureBody: 'errors',
  captureHeaders: true,
  // Ignore static assets
  ignoreUrls: [
    '/favicon.ico',
    '/_next/static/*',
    '/static/*',
    '*.css',
    '*.js',
    '*.map',
    '*.svg',
    '*.png',
    '*.jpg',
    '*.jpeg',
    '*.gif',
    '*.ico'
  ]
});

import https from 'https';
import fs from 'fs';
import next from 'next';
import { IncomingMessage, ServerResponse } from 'http';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const httpsPort = process.env.HTTPS_PORT || 3443;

app.prepare().then(() => {
  // HTTPS Server with self-signed certificates
  if (process.env.SSL_CERT_PATH && process.env.SSL_KEY_PATH) {
    try {
      const httpsOptions = {
        key: fs.readFileSync(process.env.SSL_KEY_PATH),
        cert: fs.readFileSync(process.env.SSL_CERT_PATH),
      };

      https.createServer(httpsOptions, (req: IncomingMessage, res: ServerResponse) => {
        // Set APM transaction name for better route visibility
        if (isApmEnabled && req.url) {
          const cleanUrl = req.url.split('?')[0]; // Remove query parameters
          if (!cleanUrl.startsWith('/_next/') && !cleanUrl.includes('.')) {
            // Set transaction name for actual pages, not static assets
            const transactionName = `${req.method} ${cleanUrl}`;
            if (typeof apm.setTransactionName === 'function') {
              apm.setTransactionName(transactionName);
            }
          }
        }
        return handle(req, res);
      }).listen(httpsPort, (err?: Error) => {
        if (err) throw err;
        console.log(`🔒 HTTPS Server ready on port ${httpsPort}`);
      });
    } catch (error) {
      console.error('Failed to start HTTPS server:', (error as Error).message);
      console.log('Starting HTTP server only...');
    }
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully');
  process.exit(0);
});
