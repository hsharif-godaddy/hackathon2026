// Configuration management with validation
// Note: Cannot use logger here - circular dependency (logger imports config for log level)
import { AppConfig, LogLevel, EnvironmentVariables } from '../types';
import path from 'path';

const env = process.env as EnvironmentVariables;

const config: AppConfig = {
  server: {
    port: parseInt(env.PORT ?? '8888'),
    host: '0.0.0.0',
    ssl: {
      keyPath: path.join(__dirname, '../../ssl/server.key'),
      certPath: path.join(__dirname, '../../ssl/server.crt')
    }
  },

  getty: {
    upstream: env.GETTY_IMAGES_UPSTREAM ?? 'https://getty-images-proxy.api.godaddy.com',
    appKey: env.GETTY_APP_KEY ?? 'hosting-dev',
    userAgent: env.USER_AGENT ?? 'airo-proxy/2.0',
    certs: {
      certPath: path.join(__dirname, '../../certs/getty-client.crt'),
      keyPath: path.join(__dirname, '../../certs/getty-client.key')
    }
  },

  webScraper: {
    upstream: env.WEB_SCRAPER_UPSTREAM ?? 'https://web-scraper.api.int.gdcorp.tools',
    appKey: env.WEB_SCRAPER_APP_KEY ?? 'airo-app-builder',
    userAgent: env.USER_AGENT ?? 'airo-proxy/2.0'
  },

  knowb: {
    // Use test environment which has /airo_sys registered
    upstream: env.KNOWB_UPSTREAM ?? 'https://knowb.api.int.test-godaddy.com',
    defaultKbNodeIds: ['/airo_info'],
    defaultMaxResults: 5,
    defaultScoreThreshold: 0.35
  },

  sso: {
    host: env.SSO_HOST ?? 'sso.godaddy.com',
    endpoint: env.SSO_ENDPOINT ?? 'https://sso.godaddy.com/v1/secure/api/token',
    realm: env.SSO_REALM ?? 'cert',
    timeout: parseInt(env.SSO_TIMEOUT ?? '10000'),
    tokenExpiry: parseInt(env.TOKEN_EXPIRY ?? '3000') // seconds
  },

  auth: {
    validTokens: env.VALID_TOKENS ? env.VALID_TOKENS.split(',').map(token => token.trim()) : []
  },

  logging: {
    level: (env.LOG_LEVEL as LogLevel) ?? 'info',
    format: env.LOG_FORMAT ?? 'json'
  }
};

// Validation function
function validateConfig(): boolean {
  const required: (keyof EnvironmentVariables)[] = [
    'GETTY_IMAGES_UPSTREAM',
    'SSO_ENDPOINT'
  ];

  const missing = required.filter(key => !env[key]);

  if (missing.length > 0) {
    // Console acceptable here: config validates before logger is initialized (circular dep)
    console.warn(`[CONFIG] Missing optional environment variables: ${missing.join(', ')}`);
  }

  // Validate numeric values
  if (isNaN(config.server.port) || config.server.port < 1 || config.server.port > 65535) {
    throw new Error('Invalid PORT: must be a number between 1-65535');
  }

  // Validate log level
  const validLogLevels: LogLevel[] = ['error', 'warn', 'info', 'debug'];
  if (!validLogLevels.includes(config.logging.level)) {
    throw new Error(`Invalid LOG_LEVEL: must be one of ${validLogLevels.join(', ')}`);
  }

  // Console acceptable here: config validates before logger is initialized (circular dep)
  console.log('[CONFIG] ========== PROXY CONFIGURATION ==========');
  console.log('[CONFIG] SSO configuration:', {
    host: config.sso.host,
    endpoint: config.sso.endpoint,
    realm: config.sso.realm,
    tokenExpiry: config.sso.tokenExpiry,
    envSSO_HOST: env.SSO_HOST || '(not set, using default: sso.test-godaddy.com)'
  });
  console.log('[CONFIG] KnowB configuration:', {
    upstream: config.knowb.upstream,
    defaultKbNodeIds: config.knowb.defaultKbNodeIds,
    envKNOWB_UPSTREAM: env.KNOWB_UPSTREAM || '(not set, using default)'
  });
  console.log('[CONFIG] Getty certs:', {
    certPath: config.getty.certs.certPath,
    keyPath: config.getty.certs.keyPath
  });
  console.log('[CONFIG] ===========================================');

  return true;
}

export { config, validateConfig };
