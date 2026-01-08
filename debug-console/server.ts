import https from 'node:https';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer, type Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import next from 'next';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '8443', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
    const keyPath = process.env.SERVER_KEY_PATH || join(__dirname, 'certs', 'server.key');
    const certPath = process.env.SERVER_CERT_PATH || join(__dirname, 'certs', 'server.crt');

    let server: HttpsServer | HttpServer;

    try {
        const key = readFileSync(keyPath);
        const cert = readFileSync(certPath);

        const sslOptions = {
            key,
            cert
        };

        server = https.createServer(sslOptions, (req, res) => {
            handle(req, res);
        });

        server.listen(port, hostname, () => {
            console.log(`> Ready on https://${hostname}:${port}`);
        });
    } catch (error) {
        console.warn(`SSL certificates not found at ${keyPath} and/or ${certPath}, falling back to HTTP`);
        console.warn('Error:', (error as Error).message);

        server = createServer((req, res) => {
            handle(req, res);
        });

        server.listen(port, hostname, () => {
            console.log(`> Ready on http://${hostname}:${port}`);
        });
    }

    const gracefulShutdown = (signal: string) => {
        console.log(`Received ${signal}, shutting down gracefully`);
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
});
