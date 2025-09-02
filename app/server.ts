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
