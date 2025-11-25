import { execa } from 'execa';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { AWSSSoSetup } from './aws-sso.js';

interface CertConfig {
  region: string;
  secrets: {
    graphqlCert: string;
    graphqlKey: string;
    testpilotCert: string;
    testpilotKey: string;
  };
}

/**
 * Certificate configuration setup helper
 *
 * Retrieves GraphQL and TestPilot client certificates from AWS Secrets Manager
 * and configures them in the app/.env file for S2S authentication.
 */
export class CertConfigSetup {
  private config: CertConfig = {
    region: 'us-west-2',
    secrets: {
      graphqlCert: '/Katana/Secrets/airobuilde/app/test/GRAPHQL_CLIENT_CERT',
      graphqlKey: '/Katana/Secrets/airobuilde/app/test/GRAPHQL_CLIENT_KEY',
      testpilotCert: '/Katana/Secrets/airobuilde/app/test/TESTPILOT_CLIENT_CERT',
      testpilotKey: '/Katana/Secrets/airobuilde/app/test/TESTPILOT_CLIENT_KEY'
    }
  };

  private ssoSetup = new AWSSSoSetup();

  /**
   * Check AWS credentials for accessing Secrets Manager
   *
   * @returns AWS profile name if credentials are available, null otherwise
   */
  async checkAWSCredentials(): Promise<string | null> {
    console.log(chalk.blue('🔍 Checking AWS credentials...'));

    // First, try the profile that our setup tool would create
    const setupToolProfile = await this.ssoSetup.getProfile();

    try {
      // Try the setup tool profile first
      const { stdout: identity } = await execa('aws', [
        'sts', 'get-caller-identity',
        '--profile', setupToolProfile,
        '--query', 'Arn',
        '--output', 'text'
      ]);

      console.log(chalk.green(`✅ AWS credentials found using profile: ${setupToolProfile}`));
      console.log(chalk.gray(`   Identity: ${identity.trim()}`));
      return setupToolProfile;

    } catch (setupProfileError) {
      console.log(chalk.yellow(`⚠️  Setup tool profile (${setupToolProfile}) credentials not available or expired`));

      // Fall back to checking current/default credentials
      try {
        const { stdout: identity } = await execa('aws', [
          'sts', 'get-caller-identity',
          '--query', 'Arn',
          '--output', 'text'
        ]);

        console.log(chalk.green('✅ AWS credentials found using current/default profile'));
        console.log(chalk.gray(`   Identity: ${identity.trim()}`));

        // Get the current profile being used
        const profile = process.env.AWS_PROFILE || 'default';
        return profile;

      } catch (defaultError) {
        console.log(chalk.yellow('⚠️  No valid AWS credentials found'));
        return null;
      }
    }
  }

  /**
   * Set up AWS credentials if needed
   *
   * @returns AWS profile name if setup successful, null otherwise
   */
  async setupAWSCredentials(): Promise<string | null> {
    console.log(chalk.blue('🔧 Setting up AWS credentials for certificate access...'));
    console.log('');
    console.log('To access certificates from AWS Secrets Manager, you need:');
    console.log('• AWS SSO access to account 694282668781');
    console.log('• PowerUser role permissions');
    console.log('• Access to us-west-2 region');
    console.log('');

    const { setupSSO } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'setupSSO',
        message: 'Set up AWS SSO credentials now?',
        default: true
      }
    ]);

    if (!setupSSO) {
      console.log(chalk.yellow('Skipping AWS SSO setup. You can set up credentials manually later.'));
      return null;
    }

    const success = await this.ssoSetup.setup();
    if (success) {
      return await this.ssoSetup.getProfile();
    }

    return null;
  }

  /**
   * Fetch a certificate from AWS Secrets Manager
   *
   * @param secretPath - Path to the secret in Secrets Manager
   * @param awsProfile - AWS profile to use for authentication
   * @returns Certificate content or null if failed
   */
  async fetchCertificate(secretPath: string, awsProfile?: string): Promise<string | null> {
    try {
      const args = [
        'secretsmanager', 'get-secret-value',
        '--secret-id', secretPath,
        '--region', this.config.region,
        '--query', 'SecretString',
        '--output', 'text'
      ];

      if (awsProfile) {
        args.push('--profile', awsProfile);
      }

      const { stdout: certificate } = await execa('aws', args);

      if (certificate && certificate.trim() !== 'null' && !certificate.startsWith('An error occurred')) {
        return certificate.trim();
      } else {
        throw new Error('Invalid certificate received from Secrets Manager');
      }

    } catch (error: any) {
      console.log(chalk.red(`❌ Failed to fetch certificate from ${secretPath}:`));

      if (error.message?.includes('UnauthorizedOperation') || error.message?.includes('AccessDenied')) {
        console.log(chalk.yellow('   • Check your AWS permissions'));
        console.log(chalk.yellow('   • Ensure you have access to the secrets manager'));
        console.log(chalk.yellow('   • Verify the AWS profile has PowerUser role'));
      } else if (error.message?.includes('ResourceNotFoundException')) {
        console.log(chalk.yellow(`   • Secret not found at path: ${secretPath}`));
        console.log(chalk.yellow('   • Check the secret path is correct'));
      } else if (error.message?.includes('ExpiredToken') || error.message?.includes('InvalidUserID.NotFound')) {
        console.log(chalk.yellow('   • AWS credentials expired or invalid'));
        console.log(chalk.yellow('   • Try running: aws sso login --profile your-profile'));
      } else {
        console.log(chalk.gray(`   Error: ${error.message}`));
      }

      return null;
    }
  }

  /**
   * Fetch all required certificates from AWS Secrets Manager
   *
   * @param awsProfile - AWS profile to use for authentication
   * @returns Object containing all certificates or null if any failed
   */
  async fetchAllCertificates(awsProfile?: string): Promise<{
    graphqlCert: string;
    graphqlKey: string;
    testpilotCert: string;
    testpilotKey: string;
  } | null> {
    console.log(chalk.blue('🔐 Fetching certificates from AWS Secrets Manager...'));

    const certificates = {
      graphqlCert: '',
      graphqlKey: '',
      testpilotCert: '',
      testpilotKey: ''
    };

    // Fetch GraphQL certificates
    console.log(chalk.gray('   Fetching GraphQL client certificate...'));
    certificates.graphqlCert = await this.fetchCertificate(this.config.secrets.graphqlCert, awsProfile) || '';

    if (!certificates.graphqlCert) {
      console.log(chalk.red('❌ Failed to fetch GraphQL client certificate'));
      return null;
    }
    console.log(chalk.green('   ✅ GraphQL client certificate retrieved'));

    console.log(chalk.gray('   Fetching GraphQL client key...'));
    certificates.graphqlKey = await this.fetchCertificate(this.config.secrets.graphqlKey, awsProfile) || '';

    if (!certificates.graphqlKey) {
      console.log(chalk.red('❌ Failed to fetch GraphQL client key'));
      return null;
    }
    console.log(chalk.green('   ✅ GraphQL client key retrieved'));

    // Fetch TestPilot certificates
    console.log(chalk.gray('   Fetching TestPilot client certificate...'));
    certificates.testpilotCert = await this.fetchCertificate(this.config.secrets.testpilotCert, awsProfile) || '';

    if (!certificates.testpilotCert) {
      console.log(chalk.red('❌ Failed to fetch TestPilot client certificate'));
      return null;
    }
    console.log(chalk.green('   ✅ TestPilot client certificate retrieved'));

    console.log(chalk.gray('   Fetching TestPilot client key...'));
    certificates.testpilotKey = await this.fetchCertificate(this.config.secrets.testpilotKey, awsProfile) || '';

    if (!certificates.testpilotKey) {
      console.log(chalk.red('❌ Failed to fetch TestPilot client key'));
      return null;
    }
    console.log(chalk.green('   ✅ TestPilot client key retrieved'));

    console.log(chalk.green('✅ All certificates retrieved successfully'));
    return certificates;
  }

  /**
   * Generate environment configuration for certificates
   *
   * @param certificates - Object containing all certificate content
   * @returns Environment configuration string
   */
  async generateCertEnvConfig(certificates: {
    graphqlCert: string;
    graphqlKey: string;
    testpilotCert: string;
    testpilotKey: string;
  }): Promise<string> {
    // Escape newlines for environment variables
    const escapeForEnv = (cert: string): string => {
      return cert.replace(/\n/g, '\\n');
    };

    const envConfig = `
# GraphQL S2S Authentication (Certificate-based)
GRAPHQL_CLIENT_CERT="${escapeForEnv(certificates.graphqlCert)}"
GRAPHQL_CLIENT_KEY="${escapeForEnv(certificates.graphqlKey)}"

# TestPilot S2S Authentication (Certificate-based)
TESTPILOT_CLIENT_CERT="${escapeForEnv(certificates.testpilotCert)}"
TESTPILOT_CLIENT_KEY="${escapeForEnv(certificates.testpilotKey)}"`;

    return envConfig;
  }

  /**
   * Main setup method for certificate configuration
   *
   * @returns Setup result with success status and optional env config
   */
  async setup(): Promise<{ success: boolean; envConfig?: string }> {
    console.log(chalk.cyan.bold('🔐 Client Certificate Setup'));
    console.log(chalk.gray('============================'));
    console.log('');

    console.log('This will configure client certificates for S2S authentication:');
    console.log('• GraphQL API (Product Graph) certificates');
    console.log('• TestPilot AI API certificates');
    console.log(`Certificate source: AWS Secrets Manager (${this.config.region})`);
    console.log('');

    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: 'Continue with certificate configuration?',
        default: true
      }
    ]);

    if (!proceed) {
      console.log(chalk.yellow('Certificate configuration cancelled.'));
      return { success: false };
    }

    // Step 1: Check AWS credentials
    let awsProfile = await this.checkAWSCredentials();

    // Step 2: Set up AWS credentials if needed
    if (!awsProfile) {
      awsProfile = await this.setupAWSCredentials();

      if (!awsProfile) {
        console.log(chalk.red('❌ Cannot proceed without AWS credentials'));
        console.log('');
        console.log(chalk.yellow('Manual setup instructions:'));
        console.log('1. Set up AWS credentials with access to account 694282668781');
        console.log('2. Ensure you have PowerUser role permissions');
        console.log('3. Fetch the certificates manually:');
        console.log(chalk.gray(`   aws secretsmanager get-secret-value --secret-id "${this.config.secrets.graphqlCert}" --region ${this.config.region} --query "SecretString" --output text`));
        console.log(chalk.gray(`   aws secretsmanager get-secret-value --secret-id "${this.config.secrets.graphqlKey}" --region ${this.config.region} --query "SecretString" --output text`));
        console.log(chalk.gray(`   aws secretsmanager get-secret-value --secret-id "${this.config.secrets.testpilotCert}" --region ${this.config.region} --query "SecretString" --output text`));
        console.log(chalk.gray(`   aws secretsmanager get-secret-value --secret-id "${this.config.secrets.testpilotKey}" --region ${this.config.region} --query "SecretString" --output text`));
        console.log('4. Add to your app/.env file');
        return { success: false };
      }
    }

    // Step 3: Fetch all certificates
    const certificates = await this.fetchAllCertificates(awsProfile);

    if (!certificates) {
      console.log(chalk.red('❌ Could not retrieve all required certificates'));
      console.log('');
      console.log(chalk.yellow('You can try manual setup:'));
      console.log('1. Ensure your AWS credentials are valid');
      console.log('2. Try refreshing SSO login:');
      console.log(chalk.gray(`   aws sso login --profile ${awsProfile}`));
      console.log('3. Then fetch the certificates manually using the commands above');
      return { success: false };
    }

    // Step 4: Generate environment configuration
    const envConfig = await this.generateCertEnvConfig(certificates);

    console.log('');
    console.log(chalk.green.bold('🎉 Certificate configuration complete!'));
    console.log('');
    console.log('Configuration to add to app/.env:');
    console.log(chalk.gray(envConfig.trim()));
    console.log('');

    return { success: true, envConfig };
  }

  /**
   * Quick check to verify certificate access
   *
   * @returns True if certificates are accessible, false otherwise
   */
  async quickCheck(): Promise<boolean> {
    console.log(chalk.blue('🔍 Quick certificate configuration check...'));

    const awsProfile = await this.checkAWSCredentials();
    if (!awsProfile) {
      console.log(chalk.yellow('⚠️  No AWS credentials found for certificate access'));
      return false;
    }

    // Test access to one certificate to verify permissions
    const testCert = await this.fetchCertificate(this.config.secrets.graphqlCert, awsProfile);
    if (!testCert) {
      console.log(chalk.yellow('⚠️  Could not access certificates'));
      return false;
    }

    console.log(chalk.green('✅ Certificate configuration is accessible'));
    return true;
  }
}
