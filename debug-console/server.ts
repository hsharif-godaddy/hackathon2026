import https from 'node:https';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer, type Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import next from 'next';

// Patch globalThis.fetch FIRST, before any module that might capture a
// reference to the unpatched fetch (Next.js, undici, gd-auth-client, etc.).
// No-op unless DEBUG_FETCH=1 is set.
import { installDevFetchInstrumentation } from './src/lib/dev-fetch-instrumentation';
installDevFetchInstrumentation();

import { logger } from './src/lib/logger';
import { ensureDevCerts } from './src/lib/dev-certs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dev = process.env.NODE_ENV !== 'production';
const isTest = process.env.NODE_ENV === 'test';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '443', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
    const keyPath = process.env.SERVER_KEY_PATH || join(__dirname, 'certs', 'server.key');
    const certPath = process.env.SERVER_CERT_PATH || join(__dirname, 'certs', 'server.crt');

    // In local dev, self-generate a self-signed cert on first run so developers
    // don't have to run the README's openssl command by hand. Gated to dev:
    // deployed environments (NODE_ENV=production) provide real certs, and test
    // runs fall back to plain HTTP below. A generation failure is non-fatal —
    // the read below then hits the existing "missing cert" handling.
    if (dev && !isTest) {
        ensureDevCerts(keyPath, certPath);
    }

    let server: HttpsServer | HttpServer;

    let key: Buffer | null = null;
    let cert: Buffer | null = null;
    let readError: Error | null = null;
    try {
        key = readFileSync(keyPath);
        cert = readFileSync(certPath);
    } catch (error) {
        readError = error as Error;
    }

    if (key && cert) {
        server = https.createServer({ key, cert }, (req, res) => handle(req, res));
        server.listen(port, hostname, () => {
            logger.info('server.listening', { protocol: 'https', hostname, port });
        });
    } else if (isTest) {
        logger.warn('server.ssl.missing.fallback_http', {
            keyPath,
            certPath,
            error: readError?.message,
        });
        server = createServer((req, res) => handle(req, res));
        server.listen(port, hostname, () => {
            logger.info('server.listening', { protocol: 'http', hostname, port });
        });
    } else {
        // SSO requires HTTPS; refuse to silently downgrade in dev/prod.
        logger.fatal('server.ssl.missing', {
            keyPath,
            certPath,
            error: readError?.message,
            hint: 'Generate self-signed certs (see debug-console/README.md) or set SERVER_KEY_PATH/SERVER_CERT_PATH.',
        });
        process.exit(1);
    }

    const gracefulShutdown = (signal: string) => {
        logger.info('server.shutdown', { signal });
        server.close(() => {
            logger.info('server.shutdown.complete');
            process.exit(0);
        });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}).catch((error: Error) => {
    logger.fatal('server.startup.failed', {}, { error });
    process.exit(1);
});
