import cors from 'cors';
import type { CorsOptions } from 'cors';

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // No origin header means not a browser request (server-to-server, curl, etc.)
    // Allow these requests without CORS checks
    if (!origin) {
      callback(null, true);
      return;
    }
    
    const isDevelopment = process.env.NODE_ENV === 'development';
    let allowedOrigins: string[] = [];
    
    if (process.env.ALLOWED_ORIGINS) {
      allowedOrigins = process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
    } else if (isDevelopment) {
      allowedOrigins = [
        'https://local.gasket.dev-godaddy.com:8443',
        'https://local.gasket.dev-godaddy.com',
        'https://airo-builder.test-godaddy.com:8443',
        'https://airo-builder.test-godaddy.com',
        'https://airo-builder.godaddy.com:8443',
        'https://airo-builder.godaddy.com',
        'https://airo-builder.dev-godaddy.com'
      ];
    }
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // Reject the origin by passing false (not an Error)
      // This prevents CORS headers from being set, causing browser to block the response
      callback(null, false);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'User-Agent', 'Accept'],
  credentials: true,
  maxAge: 86400,
  preflightContinue: false,
  optionsSuccessStatus: 204
};

export const corsMiddleware = cors(corsOptions);
