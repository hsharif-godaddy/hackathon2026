/**
 * Startup Configuration Logger
 * Logs all service configurations once at application startup
 */

import { getSsoHostSync } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';

let hasInitialized = false;

export function logStartupConfiguration() {
  if (hasInitialized) return;
  hasInitialized = true;

  logger.info('startup.config.begin', {
    message: '🚀 Airo Builder - Service Configuration'
  });

  // Control Plane Configuration
  logger.info('startup.config.controlPlane', {
    message: '🔧 Control Plane Configuration',
    environment: process.env.NODE_ENV,
    mgmtAiroBaseUrl: process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net',
  });

  // GdAuth Service Configuration
  const ssoHost = getSsoHostSync();
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
      appsDirectory: process.env.APPS_BASE_DIR || '/tmp/airo-app-builder',
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
