/**
 * Startup Configuration Logger
 * Logs all service configurations once at application startup
 */

import { logger } from '@/lib/request-context';

let hasInitialized = false;

export function logStartupConfiguration() {
  if (hasInitialized) return;
  hasInitialized = true;

  logger.info('startup.config.begin', {
    message: '🚀 Airo Builder - Service Configuration'
  });

  // Database Configuration
  const hasDatabaseUrl = !!process.env.DATABASE_URL?.startsWith('mysql://');
  const hasMySqlCredentials = !!process.env.MYSQL_DB_USERNAME && !!process.env.MYSQL_DB_PASSWORD &&
  !!process.env.MYSQL_DB_PATH && !!process.env.MYSQL_DB_PORT && !!process.env.MYSQL_DB_NAME;

  logger.info('startup.config.database', {
    message: '🔧 Database Configuration',
    environment: process.env.NODE_ENV,
    databaseType: 'MySQL (with SQLite-syntax conversion)',
    hasDatabaseUrl,
    hasMySqlCredentials,
    ...(hasDatabaseUrl ? { viaUrl: 'configured' } : {}),
    ...(hasMySqlCredentials ? {
      host: process.env.MYSQL_DB_PATH || 'default',
      port: process.env.MYSQL_DB_PORT || '3306',
      database: process.env.MYSQL_DB_NAME || 'airo_builder'
    } : {}),
    ...(!hasDatabaseUrl && !hasMySqlCredentials ? { warning: 'No MySQL configuration found' } : {})
  });

  // GdAuth Service Configuration
  const ssoHost = process.env.SSO_HOST || 'sso.test-godaddy.com';
  logger.info('startup.config.gdauth', {
    message: '🔐 GdAuth Service Configuration',
    ssoHost,
    certificatePath: 'certs/sso.crt'
  });

  // Deployment Configuration
  const deploymentMode = process.env.DEPLOYMENT_MODE ||
    (process.env.NODE_ENV === 'production' ? 'production' : 'docker');

  logger.info('startup.config.deployment', {
    message: '🚀 Deployment Configuration',
    mode: deploymentMode,
    ...(["development", "docker"].includes(deploymentMode) ? {
      agentsServiceUrl: process.env.AGENTS_SERVICE_URL || 'http://localhost:4000',
      appsDirectory: process.env.APPS_BASE_DIR || '/tmp/apps',
      templateDirectory: process.env.APP_TEMPLATE_DIR || 'app-templates/v8'
    } : {})
  });

  // Authentication Configuration
  const mockLoginEnabled = process.env.NEXT_PUBLIC_MOCK_LOGIN === 'true' ||
                           process.env.NODE_ENV === 'development';
  const authDisabled = process.env.DISABLE_AUTH === 'true';

  logger.info('startup.config.authentication', {
    message: '🔑 Authentication Configuration',
    mockLoginEnabled,
    authDisabled,
    ssoLoginUrl: process.env.SSO_LOGIN_URL || 'default',
    ssoLogoutUrl: process.env.SSO_LOGOUT_URL || 'default'
  });

  logger.info('startup.config.complete', {
    message: 'Startup configuration logging complete'
  });
}

// Export a function that can be called to ensure initialization
export function ensureStartupConfigLogged() {
  logStartupConfiguration();
}
