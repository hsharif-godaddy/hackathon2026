import express, { Application } from 'express';
import https from 'https';
import fs from 'fs';
import helmet from 'helmet';

import { config, validateConfig } from './config';
import logger from './utils/logger';
import routes from './routes';

// Validate configuration on startup
try {
  validateConfig();
  logger.info('Configuration validated successfully');
} catch (error) {
  logger.error('Configuration validation failed', { error: (error as Error).message });
  process.exit(1);
}

// Verify SSL certificates exist
if (!fs.existsSync(config.server.ssl.keyPath) || !fs.existsSync(config.server.ssl.certPath)) {
  logger.error('SSL certificates not found', {
    keyPath: config.server.ssl.keyPath,
    certPath: config.server.ssl.certPath
  });
  process.exit(1);
}

// Verify Getty certificates exist
if (!fs.existsSync(config.getty.certs.certPath) || !fs.existsSync(config.getty.certs.keyPath)) {
  logger.error('Getty client certificates not found. Run setup-certs.sh first.');
  process.exit(1);
}

const app: Application = express();

// Security middleware with default settings
app.use(helmet());

// Basic middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Trust proxy for accurate IP addresses
app.set('trust proxy', true);

// Request logging middleware
app.use(logger.middleware());

// Routes
app.use('/', routes);

// Global error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const requestId = (req as any).id ? String((req as any).id) : 'unknown';

  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    requestId,
    method: req.method,
    path: req.path
  });

  res.status(500).json({
    error: {
      message: 'Internal Server Error',
      type: 'internal_error',
      requestId
    }
  });
});

// SSL options
const sslOptions = {
  key: fs.readFileSync(config.server.ssl.keyPath),
  cert: fs.readFileSync(config.server.ssl.certPath)
};

// Start HTTPS server
const server = https.createServer(sslOptions, app);

server.listen(config.server.port, config.server.host, () => {
  logger.info('Airo Builder Proxy started', {
    port: config.server.port,
    host: config.server.host,
    environment: process.env.NODE_ENV ?? 'development',
    version: process.env.npm_package_version ?? '2.0.0',
    gettyUpstream: config.getty.upstream,
    ssoEndpoint: config.sso.endpoint
  });
});

// Graceful shutdown
const gracefulShutdown = (signal: string): void => {
  logger.info(`Received ${signal}, shutting down gracefully`);

  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err: Error) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  logger.error('Unhandled rejection', { reason, promise: promise.toString() });
  process.exit(1);
});

export { app, server };
