import { readFileSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Express } from 'express';

import { Logger } from '../logging/index.js';

const logger = Logger.create({ component: 'airo-agents-server-factory' });

const CERT_BASENAME = '_.gasket.dev-godaddy.com';

export interface CreatedServer {
  server: Server;
  secure: boolean;
}

/**
 * Local dev serves agents over HTTPS on the same Gasket domain as the builder app
 * so browsers (notably Safari) don't block the cross-site / mixed-content connection.
 * Production terminates TLS at the edge, so agents stays plain HTTP there.
 *
 * Gated on the broad `local` prefix (local.dev, local.test, local.prod) to match the
 * convention in scripts/load-env.js and agents/load-env.cjs. Every local caller
 * (dev-runner, control plane, compose) dials the HTTPS agents URL unconditionally, so
 * all `local.*` modes must serve TLS or the handshake fails. Production GASKET_ENV
 * never starts with `local`, so prod stays plain HTTP.
 */
function tlsEnabled(): boolean {
  if (process.env.AGENTS_TLS_CERT && process.env.AGENTS_TLS_KEY) {
    return true;
  }
  return (process.env.GASKET_ENV || '').startsWith('local');
}

function defaultCertDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // server-factory lives at agents/{src,dist}/server — three levels below the repo root.
  const repoRoot = path.resolve(here, '../../../');
  return path.join(repoRoot, 'app/node_modules/@godaddy/gasket-plugin-dev-certs/certs');
}

/**
 * Node/Go clients (control plane, dev-runner) build a trust path to the GoDaddy root,
 * which requires the intermediate to be presented alongside the leaf. Browsers tolerate
 * a leaf-only cert, but strict TLS clients do not, so the chain is concatenated here.
 */
function loadTlsOptions(): { key: Buffer; cert: Buffer } | null {
  const certDir = defaultCertDir();
  const keyPath = process.env.AGENTS_TLS_KEY || path.join(certDir, `${CERT_BASENAME}.key`);
  const certPath = process.env.AGENTS_TLS_CERT || path.join(certDir, `${CERT_BASENAME}.crt`);
  const chainPath = process.env.AGENTS_TLS_CHAIN || path.join(certDir, `${CERT_BASENAME}_intermediate_chain.crt`);

  try {
    const key = readFileSync(keyPath);
    const leaf = readFileSync(certPath);
    let cert = leaf;
    try {
      cert = Buffer.concat([leaf, Buffer.from('\n'), readFileSync(chainPath)]);
    } catch {
      logger.warn('server.tls.chain.missing', { chainPath });
    }
    return { key, cert };
  } catch (error) {
    logger.warn('server.tls.cert.load_failure', {
      keyPath,
      certPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Create the HTTP(S) server backing Express, Socket.IO, and SSE. Returns an HTTPS
 * server in local dev (when certs resolve) and a plain HTTP server otherwise.
 */
export function create(app: Express): CreatedServer {
  if (tlsEnabled()) {
    const tls = loadTlsOptions();
    if (tls) {
      logger.info('server.tls.enabled', { domain: 'local.gasket.dev-godaddy.com' });
      return { server: createHttpsServer(tls, app), secure: true };
    }
    logger.warn('server.tls.fallback_http', {
      reason: 'TLS requested but certs unavailable; serving plain HTTP',
    });
  }
  return { server: createHttpServer(app), secure: false };
}
