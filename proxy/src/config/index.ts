// Configuration management with validation
import path from 'path';
import { AppConfig, LogLevel, EnvironmentVariables } from '../types';

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
  
  sso: {
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
  
  return true;
}

export { config, validateConfig };
