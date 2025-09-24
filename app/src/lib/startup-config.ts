/**
 * Startup Configuration Logger
 * Logs all service configurations once at application startup
 */

let hasInitialized = false;

export function logStartupConfiguration() {
  if (hasInitialized) return;
  hasInitialized = true;

  // Use console.log for startup config to avoid logger initialization issues
  console.log('🚀 Airo App Builder - Service Configuration');
  console.log('================================================');

  // Database Configuration
  const hasDatabaseUrl = !!process.env.DATABASE_URL?.startsWith('mysql://');
  const hasMySqlCredentials = !!process.env.MYSQL_DB_USERNAME && !!process.env.MYSQL_DB_PASSWORD &&
  !!process.env.MYSQL_DB_PATH && !!process.env.MYSQL_DB_PORT && !!process.env.MYSQL_DB_NAME;

  console.log('🔧 Database Configuration:');
  console.log(`   Environment: ${process.env.NODE_ENV}`);
  console.log(`   Database Type: MySQL (with SQLite-syntax conversion)`);
  if (hasDatabaseUrl) {
    console.log(`   MySQL via DATABASE_URL: configured`);
  } else if (hasMySqlCredentials) {
    console.log(`   MySQL Host: ${process.env.MYSQL_DB_PATH || 'default'}`);
    console.log(`   MySQL Port: ${process.env.MYSQL_DB_PORT || '3306'}`);
    console.log(`   MySQL Database: ${process.env.MYSQL_DB_NAME || 'airo_builder'}`);
  } else {
    console.log(`   ⚠️  No MySQL configuration found`);
  }

  // SQS Nomad Service Configuration
  const region = process.env.AWS_REGION_NOMAD || 'eu-central-1';
  const accountId = process.env.AWS_ACCOUNT_ID_NOMAD || '418549769352';
  const targetRoleArn = `arn:aws:iam::${accountId}:role/pioneerc1-custom-cross-account-airo-builder-sqs`;
  const queueUrl = `https://${region}.queue.amazonaws.com/${accountId}/c4-dev-sxb1-eu-central-1_nomadJobsQueue`;

  console.log('🔗 SQS Nomad Service Configuration:');
  console.log(`   Region: ${region}`);
  console.log(`   Account ID: ${accountId}`);
  console.log(`   Target Role: ${targetRoleArn}`);
  console.log(`   Queue URL: ${queueUrl}`);

  // GdAuth Service Configuration
  const ssoHost = 'sso.test-godaddy.com';
  console.log('🔐 GdAuth Service Configuration:');
  console.log(`   SSO Host: ${ssoHost}`);
  console.log(`   Certificate Path: certs/sso.crt`);

  // Deployment Configuration
  const localEnvMode = process.env.LOCAL_ENVIRONMENT_MODE?.toLowerCase() || 'auto';
  const deploymentMode = process.env.DEPLOYMENT_MODE ||
    (process.env.NODE_ENV === 'production' ? 'production' : 'development');

  console.log('🚀 Deployment Configuration:');
  console.log(`   Mode: ${deploymentMode}`);
  console.log(`   Local Environment Mode: ${localEnvMode}`);

  if (deploymentMode === 'development') {
    console.log(`   Agents Service URL: ${process.env.AGENTS_SERVICE_URL || 'http://localhost:4000'}`);
    console.log(`   Apps Directory: ${process.env.LOCAL_APPS_DIR || '/tmp/apps'}`);
    console.log(`   Template Directory: ${process.env.APP_TEMPLATE_DIR || 'app-templates/v8'}`);
  }

  // Authentication Configuration
  const mockLoginEnabled = process.env.NEXT_PUBLIC_MOCK_LOGIN === 'true' ||
                           process.env.NODE_ENV === 'development';
  const authDisabled = process.env.DISABLE_AUTH === 'true';

  console.log('🔑 Authentication Configuration:');
  console.log(`   Mock Login Enabled: ${mockLoginEnabled}`);
  console.log(`   Auth Disabled: ${authDisabled}`);

  console.log('================================================');
}

// Export a function that can be called to ensure initialization
export function ensureStartupConfigLogged() {
  logStartupConfiguration();
}
