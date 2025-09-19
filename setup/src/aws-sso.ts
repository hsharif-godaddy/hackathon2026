import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';

const execAsync = promisify(exec);

interface SSOConfig {
  startUrl: string;
  region: string;
  sessionName: string;
  accountId: string;
  roleName: string;
  awsRegion: string;
  profileName: string;
}

export class AWSSSoSetup {
  private config: SSOConfig = {
    startUrl: 'https://d-9267a7c4d5.awsapps.com/start/#',
    region: 'us-west-2',
    sessionName: 'airo-sso',
    accountId: '694282668781',
    roleName: 'PowerUser',
    awsRegion: 'us-west-2',
    profileName: 'airobuild-dev-private-sso'
  };

  private awsConfigPath = path.join(os.homedir(), '.aws', 'config');

  async checkPrerequisites(): Promise<boolean> {
    console.log(chalk.blue('🔍 Checking AWS CLI prerequisites...'));

    try {
      // Check if AWS CLI exists
      await execAsync('aws --version');
    } catch (error) {
      console.log(chalk.red('❌ AWS CLI not found'));
      console.log('Please install AWS CLI v2: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html');
      return false;
    }

    try {
      // Check AWS CLI version (SSO requires v2)
      const { stdout } = await execAsync('aws --version');
      const version = stdout.match(/aws-cli\/(\d+\.\d+\.\d+)/)?.[1];
      
      if (version) {
        const majorVersion = parseInt(version.split('.')[0]);
        if (majorVersion < 2) {
          console.log(chalk.red('❌ AWS CLI v2 required for SSO support'));
          console.log(`Current version: ${version}`);
          console.log('Please upgrade to AWS CLI v2');
          return false;
        }
        console.log(chalk.green(`✅ AWS CLI v${version} found`));
      }
    } catch (error) {
      console.log(chalk.yellow('⚠️  Could not determine AWS CLI version'));
    }

    return true;
  }

  async setupSSOSession(): Promise<boolean> {
    console.log(chalk.blue(`🔧 Setting up SSO session: ${this.config.sessionName}`));

    try {
      // Ensure ~/.aws directory exists
      await fs.ensureDir(path.dirname(this.awsConfigPath));

      // Check if SSO session already exists
      if (await fs.pathExists(this.awsConfigPath)) {
        const configContent = await fs.readFile(this.awsConfigPath, 'utf-8');
        if (configContent.includes(`[sso-session ${this.config.sessionName}]`)) {
          console.log(chalk.green(`✅ SSO session '${this.config.sessionName}' already configured`));
          return true;
        }
      }

      // Add SSO session to config file
      const ssoSessionConfig = `
[sso-session ${this.config.sessionName}]
sso_start_url = ${this.config.startUrl}
sso_region = ${this.config.region}
sso_registration_scopes = sso:account:access
`;

      await fs.appendFile(this.awsConfigPath, ssoSessionConfig);
      console.log(chalk.green('✅ SSO session configured in ~/.aws/config'));
      return true;

    } catch (error) {
      console.log(chalk.red('❌ Failed to setup SSO session:'), error);
      return false;
    }
  }

  async setupSSOProfile(): Promise<boolean> {
    console.log(chalk.blue(`🔧 Setting up SSO profile: ${this.config.profileName}`));

    try {
      // Check if profile already exists
      const { stdout: profiles } = await execAsync('aws configure list-profiles');
      if (profiles.includes(this.config.profileName)) {
        console.log(chalk.yellow(`⚠️  Profile '${this.config.profileName}' already exists`));
        
        const { overwrite } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'overwrite',
            message: 'Do you want to overwrite it?',
            default: false
          }
        ]);

        if (!overwrite) {
          console.log('Skipping profile setup');
          return true;
        }
      }

      // Configure the profile using AWS CLI commands
      const commands = [
        `aws configure set sso_session "${this.config.sessionName}" --profile "${this.config.profileName}"`,
        `aws configure set sso_account_id "${this.config.accountId}" --profile "${this.config.profileName}"`,
        `aws configure set sso_role_name "${this.config.roleName}" --profile "${this.config.profileName}"`,
        `aws configure set region "${this.config.awsRegion}" --profile "${this.config.profileName}"`,
        `aws configure set output "json" --profile "${this.config.profileName}"`
      ];

      for (const command of commands) {
        await execAsync(command);
      }

      console.log(chalk.green(`✅ Profile '${this.config.profileName}' configured`));
      console.log('');
      console.log('Profile details:');
      console.log(`  Account ID: ${this.config.accountId}`);
      console.log(`  Role Name: ${this.config.roleName}`);
      console.log(`  Region: ${this.config.awsRegion}`);
      console.log(`  SSO Start URL: ${this.config.startUrl}`);

      return true;

    } catch (error) {
      console.log(chalk.red('❌ Failed to setup SSO profile:'), error);
      return false;
    }
  }

  async performSSOLogin(): Promise<boolean> {
    console.log(chalk.blue('🔐 Performing SSO login...'));
    console.log('');
    console.log('This will open your browser for AWS SSO authentication.');
    console.log('Please complete the login process in your browser.');
    console.log('');

    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: 'Press Enter to continue...',
        default: true
      }
    ]);

    if (!proceed) {
      return false;
    }

    try {
      await execAsync(`aws sso login --profile "${this.config.profileName}"`);

      console.log(chalk.green('✅ SSO login successful'));

      // Test the credentials
      console.log(chalk.blue('🧪 Testing credentials...'));
      const { stdout: identity } = await execAsync(
        `aws sts get-caller-identity --profile "${this.config.profileName}" --query "Arn" --output text`
      );

      console.log(chalk.green('✅ Credentials working'));
      console.log(`   Identity: ${identity.trim()}`);

      return true;

    } catch (error) {
      console.log(chalk.red('❌ SSO login failed:'), error);
      return false;
    }
  }

  async checkSSOConfig(): Promise<boolean> {
    console.log(chalk.blue('🔍 Checking SSO configuration...'));

    try {
      const { stdout: profiles } = await execAsync('aws configure list-profiles');
      
      if (!profiles.includes(this.config.profileName)) {
        console.log(chalk.red(`❌ Profile '${this.config.profileName}' not found`));
        return false;
      }

      console.log(chalk.green(`✅ Profile '${this.config.profileName}' exists`));

      // Check profile configuration
      const configCommands = [
        ['SSO Session', `aws configure get sso_session --profile "${this.config.profileName}"`],
        ['Account ID', `aws configure get sso_account_id --profile "${this.config.profileName}"`],
        ['Role Name', `aws configure get sso_role_name --profile "${this.config.profileName}"`],
        ['Region', `aws configure get region --profile "${this.config.profileName}"`]
      ];

      console.log('');
      console.log('Profile configuration:');
      
      for (const [label, command] of configCommands) {
        try {
          const { stdout } = await execAsync(command);
          console.log(`  ${label}: ${stdout.trim() || 'Not set'}`);
        } catch {
          console.log(`  ${label}: Not set`);
        }
      }

      // Check if logged in
      try {
        const { stdout: identity } = await execAsync(
          `aws sts get-caller-identity --profile "${this.config.profileName}" --query "Arn" --output text`
        );
        console.log(`  Status: ✅ Logged in`);
        console.log(`  Identity: ${identity.trim()}`);
        return true;
      } catch {
        console.log(`  Status: ❌ Not logged in or expired`);
        console.log(`  Run: aws sso login --profile ${this.config.profileName}`);
        return false;
      }

    } catch (error) {
      console.log(chalk.red('❌ Error checking SSO configuration:'), error);
      return false;
    }
  }

  async getProfile(): Promise<string> {
    return this.config.profileName;
  }

  async setup(): Promise<boolean> {
    console.log(chalk.cyan.bold('🚀 AWS SSO Setup for AIRO Development'));
    console.log(chalk.gray('====================================='));
    console.log('');

    // Check prerequisites
    if (!(await this.checkPrerequisites())) {
      return false;
    }

    // Setup SSO session
    if (!(await this.setupSSOSession())) {
      return false;
    }

    // Setup SSO profile
    if (!(await this.setupSSOProfile())) {
      return false;
    }

    // Perform SSO login
    if (!(await this.performSSOLogin())) {
      return false;
    }

    console.log('');
    console.log(chalk.green.bold('🎉 AWS SSO setup complete!'));
    console.log('');
    console.log('To use this profile:');
    console.log(chalk.gray(`  export AWS_PROFILE=${this.config.profileName}`));
    console.log(chalk.gray('  aws sts get-caller-identity'));
    console.log('');
    console.log('To refresh credentials when they expire:');
    console.log(chalk.gray(`  aws sso login --profile ${this.config.profileName}`));
    console.log('');
    console.log('Note: SSO sessions typically last 8-12 hours');

    return true;
  }
}