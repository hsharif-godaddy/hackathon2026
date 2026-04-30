import cors from 'cors';
import type { CorsOptions } from 'cors';
import type { RequestHandler } from 'express';

/**
 * Allowed origins set, computed once at module load.
 * Derived from ALLOWED_ORIGINS env var or static dev defaults.
 */
const allowedOriginsSet: Set<string> = (() => {
  if (process.env.ALLOWED_ORIGINS) {
    return new Set(process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()));
  }

  if (process.env.NODE_ENV === 'development') {
    return new Set([
      'http://localhost:3000',
      'https://localhost:3000',
      'https://local.gasket.dev-godaddy.com:8443',
      'https://local.gasket.dev-godaddy.com',
      'https://airo-builder.test-godaddy.com:8443',
      'https://airo-builder.test-godaddy.com',
      'https://airo-builder.godaddy.com:8443',
      'https://airo-builder.godaddy.com',
      'https://airo-builder.dev-godaddy.com:8443',
      'https://airo-builder.dev-godaddy.com',
      'https://host.pcx.dev-godaddy.com',
      'https://host.pcx.test-godaddy.com',
      'https://host.pcx.godaddy.com',
      'https://host.local.pcx.dev-godaddy.com:444',
      'https://host.local.pcx.test-godaddy.com:444',
      'https://host.local.pcx.godaddy.com:444'
    ]);
  }

  return new Set<string>();
})();

/**
 * Check if an origin is in the allowed origins set.
 * Shared by CORS config and Timing-Allow-Origin middleware. O(1) lookup.
 */
export function isAllowedOrigin(origin: string): boolean {
  return allowedOriginsSet.has(origin);
}

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // No origin header means not a browser request (server-to-server, curl, etc.)
    // Allow these requests without CORS checks
    if (!origin) {
      callback(null, true);
      return;
    }

    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      // Reject the origin by passing false (not an Error)
      // This prevents CORS headers from being set, causing browser to block the response
      callback(null, false);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'User-Agent', 'Accept', 'X-Connection-Id', 'Last-Event-ID'],
  credentials: true,
  maxAge: 86400,
  preflightContinue: false,
  optionsSuccessStatus: 204
};

export const corsMiddleware = cors(corsOptions);

/**
 * Timing-Allow-Origin middleware — enables Resource Timing API for cross-origin requests.
 * When the browser sees this header, it exposes detailed timing (DNS, TCP, TLS, etc.)
 * for cross-origin resources via the Performance API.
 *
 * Not gated behind CONNECTION_DIAGNOSTICS_ENABLED — zero logging overhead, harmless to leave on.
 */
export const timingAllowOriginMiddleware: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Timing-Allow-Origin', origin);
  }
  next();
};
