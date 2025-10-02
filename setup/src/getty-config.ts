import { execa } from 'execa';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { AWSSSoSetup } from './aws-sso.js';

interface GettyConfig {
  proxyUrl: string;
  secretPath: string;
  region: string;
}

export class GettyConfigSetup {
  private config: GettyConfig = {
    proxyUrl: 'https://airobuilde-proxy-dev-private-ecs.airobuilde-dev-private.prod.onkatana.net',
    secretPath: '/Katana/Secrets/airobuilde/app/dev-private-ecs/GETTY_TOKEN',
    region: 'us-west-2'
  };

  private ssoSetup = new AWSSSoSetup();

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

  async setupAWSCredentials(): Promise<string | null> {
    console.log(chalk.blue('🔧 Setting up AWS credentials for Getty token access...'));
    console.log('');
    console.log('To access the Getty token from AWS Secrets Manager, you need:');
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

  async fetchGettyToken(awsProfile?: string): Promise<string | null> {
    console.log(chalk.blue('🔐 Fetching Getty token from AWS Secrets Manager...'));

    try {
      console.log(chalk.gray(`   Running: aws secretsmanager get-secret-value --secret-id "${this.config.secretPath}" --region ${this.config.region}`));
      
      const args = [
        'secretsmanager', 'get-secret-value',
        '--secret-id', this.config.secretPath,
        '--region', this.config.region,
        '--query', 'SecretString',
        '--output', 'text'
      ];
      
      if (awsProfile) {
        args.push('--profile', awsProfile);
      }
      
      const { stdout: token } = await execa('aws', args);

      if (token && token.trim() !== 'null' && !token.startsWith('An error occurred')) {
        console.log(chalk.green('✅ Getty token retrieved successfully'));
        console.log(chalk.gray(`   Token: ${token.substring(0, 20)}...`));
        return token.trim();
      } else {
        throw new Error('Invalid token received from Secrets Manager');
      }

    } catch (error: any) {
      console.log(chalk.red('❌ Failed to fetch Getty token:'));
      
      if (error.message?.includes('UnauthorizedOperation') || error.message?.includes('AccessDenied')) {
        console.log(chalk.yellow('   • Check your AWS permissions'));
        console.log(chalk.yellow('   • Ensure you have access to the secrets manager'));
        console.log(chalk.yellow('   • Verify the AWS profile has PowerUser role'));
      } else if (error.message?.includes('ResourceNotFoundException')) {
        console.log(chalk.yellow(`   • Secret not found at path: ${this.config.secretPath}`));
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

  async generateGettyEnvConfig(token: string): Promise<string> {
    const envConfig = `
# Getty Images Configuration
GETTY_API_URL=${this.config.proxyUrl}/img/search
GETTY_TOKEN=${token}
IMAGE_SEARCH_DRIVER=getty`;

    return envConfig;
  }

  async setup(): Promise<{ success: boolean; envConfig?: string }> {
    console.log(chalk.cyan.bold('🖼️  Getty Images Proxy Setup'));
    console.log(chalk.gray('============================'));
    console.log('');

    console.log('This will configure access to the Getty Images proxy running in AWS.');
    console.log(`Proxy URL: ${this.config.proxyUrl}`);
    console.log(`Token source: AWS Secrets Manager (${this.config.secretPath})`);
    console.log('');

    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: 'Continue with Getty configuration?',
        default: true
      }
    ]);

    if (!proceed) {
      console.log(chalk.yellow('Getty configuration cancelled.'));
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
        console.log('3. Fetch the Getty token manually:');
        console.log(chalk.gray(`   aws secretsmanager get-secret-value --secret-id "${this.config.secretPath}" --region ${this.config.region} --query "SecretString" --output text`));
        console.log('4. Add to your agents/.env:');
        console.log(chalk.gray(`   GETTY_API_URL=${this.config.proxyUrl}/img/search`));
        console.log(chalk.gray('   GETTY_TOKEN=<your-token>'));
        console.log(chalk.gray('   IMAGE_SEARCH_DRIVER=getty'));
        return { success: false };
      }
    }

    // Step 3: Fetch Getty token
    const gettyToken = await this.fetchGettyToken(awsProfile);
    
    if (!gettyToken) {
      console.log(chalk.red('❌ Could not retrieve Getty token'));
      console.log('');
      console.log(chalk.yellow('You can try manual setup:'));
      console.log('1. Ensure your AWS credentials are valid');
      console.log('2. Try refreshing SSO login:');
      console.log(chalk.gray(`   aws sso login --profile ${awsProfile}`));
      console.log('3. Then fetch the token manually:');
      console.log(chalk.gray(`   aws secretsmanager get-secret-value --secret-id "${this.config.secretPath}" --region ${this.config.region} --query "SecretString" --output text --profile ${awsProfile}`));
      return { success: false };
    }

    // Step 4: Generate environment configuration
    const envConfig = await this.generateGettyEnvConfig(gettyToken);

    console.log('');
    console.log(chalk.green.bold('🎉 Getty configuration complete!'));
    console.log('');
    console.log('Configuration to add to agents/.env:');
    console.log(chalk.gray(envConfig.trim()));
    console.log('');

    return { success: true, envConfig };
  }

  async quickCheck(): Promise<boolean> {
    console.log(chalk.blue('🔍 Quick Getty configuration check...'));

    const awsProfile = await this.checkAWSCredentials();
    if (!awsProfile) {
      console.log(chalk.yellow('⚠️  No AWS credentials found for Getty token access'));
      return false;
    }

    const token = await this.fetchGettyToken(awsProfile);
    if (!token) {
      console.log(chalk.yellow('⚠️  Could not access Getty token'));
      return false;
    }

    console.log(chalk.green('✅ Getty configuration is accessible'));
    return true;
  }
}