// Configuration management with validation
// Note: Cannot use logger here - circular dependency (logger imports config for log level)
import { AppConfig, LogLevel, EnvironmentVariables } from '../types';
import path from 'path';

const env = process.env as EnvironmentVariables;

// Detect environment from ENVIRONMENT variable (returns 'test' or 'prod')
const environment = env.ENVIRONMENT ?? 'test'; // Default to test for safety
const isProduction = environment === 'prod';

// SSO configuration based on environment
const getDefaultSsoHost = (): string => {
  return isProduction ? 'sso.godaddy.com' : 'sso.test-godaddy.com';
};

const getDefaultSsoEndpoint = (): string => {
  return `https://${getDefaultSsoHost()}/v1/secure/api/token`;
};

// KnowB upstream based on environment
const getDefaultKnowBUpstream = (): string => {
  return isProduction 
    ? 'https://knowb.api.int.godaddy.com'
    : 'https://knowb.api.int.test-godaddy.com';
};

// WebScraper upstream based on environment
const getDefaultWebScraperUpstream = (): string => {
  return isProduction
    ? 'https://web-scraper.api.int.gdcorp.tools'
    : 'https://web-scraper.api.int.test-gdcorp.tools';
};

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
    appKey: env.GETTY_APP_KEY ?? 'airo-app-builder',
    userAgent: env.USER_AGENT ?? 'airo-proxy/2.0',
    certs: {
      certPath: path.join(__dirname, '../../certs/getty-client.crt'),
      keyPath: path.join(__dirname, '../../certs/getty-client.key')
    }
  },

  webScraper: {
    upstream: env.WEB_SCRAPER_UPSTREAM ?? getDefaultWebScraperUpstream(),
    appKey: env.WEB_SCRAPER_APP_KEY ?? 'airo-app-builder',
    userAgent: env.USER_AGENT ?? 'airo-proxy/2.0'
  },

  knowb: {
    upstream: env.KNOWB_UPSTREAM ?? getDefaultKnowBUpstream(),
    defaultKbNodeIds: ['/airo_info'],
    defaultMaxResults: 5,
    defaultScoreThreshold: 0.35
  },

  sso: {
    host: getDefaultSsoHost(),
    endpoint: getDefaultSsoEndpoint(),
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
  console.log('[CONFIG] Environment:', {
    ENVIRONMENT: env.ENVIRONMENT ?? '(not set, defaulting to test)',
    detectedEnv: isProduction ? 'production' : 'test'
  });
  console.log('[CONFIG] SSO:', {
    host: config.sso.host,
    endpoint: config.sso.endpoint
  });
  console.log('[CONFIG] KnowB:', {
    upstream: config.knowb.upstream,
    source: env.KNOWB_UPSTREAM ? 'env variable' : `auto-detected (${environment})`
  });
  console.log('[CONFIG] WebScraper:', {
    upstream: config.webScraper.upstream,
    source: env.WEB_SCRAPER_UPSTREAM ? 'env variable' : `auto-detected (${environment})`
  });
  console.log('[CONFIG] ===========================================');

  return true;
}

export { config, validateConfig };
