import { execa } from 'execa';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';

interface SSOProfileConfig {
  accountId: string;
  roleName: string;
  profileName: string;
}

interface SSOConfig {
  startUrl: string;
  region: string;
  sessionName: string;
  awsRegion: string;
  profiles: SSOProfileConfig[];
}

export class AWSSSoSetup {
  private config: SSOConfig = {
    startUrl: 'https://d-9267a7c4d5.awsapps.com/start/#',
    region: 'us-west-2',
    sessionName: 'airo-sso',
    awsRegion: 'us-west-2',
    profiles: [
      {
        accountId: '694282668781',
        roleName: 'PowerUser',
        profileName: 'airobuild-dev-private-sso',
      },
      {
        accountId: '644094189644',
        roleName: 'Ops',
        profileName: 'airobuild-prod-sso',
      },
    ],
  };

  private awsConfigPath = path.join(os.homedir(), '.aws', 'config');

  async checkPrerequisites(): Promise<boolean> {
    console.log(chalk.blue('🔍 Checking AWS CLI prerequisites...'));

    try {
      // Check if AWS CLI exists
      await execa('aws', ['--version']);
    } catch (error) {
      console.log(chalk.red('❌ AWS CLI not found'));
      console.log('\n  macOS:  brew install awscli');
      console.log('  Other:  https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html');
      return false;
    }

    try {
      // Check AWS CLI version (SSO requires v2)
      const { stdout } = await execa('aws', ['--version']);
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

  private async setupSingleProfile(profile: SSOProfileConfig): Promise<boolean> {
    console.log(chalk.blue(`🔧 Setting up SSO profile: ${profile.profileName}`));

    try {
      // Check if profile already exists
      const { stdout: profiles } = await execa('aws', ['configure', 'list-profiles']);
      if (profiles.includes(profile.profileName)) {
        console.log(chalk.yellow(`⚠️  Profile '${profile.profileName}' already exists`));

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
      await execa('aws', ['configure', 'set', 'sso_session', this.config.sessionName, '--profile', profile.profileName]);
      await execa('aws', ['configure', 'set', 'sso_account_id', profile.accountId, '--profile', profile.profileName]);
      await execa('aws', ['configure', 'set', 'sso_role_name', profile.roleName, '--profile', profile.profileName]);
      await execa('aws', ['configure', 'set', 'region', this.config.awsRegion, '--profile', profile.profileName]);
      await execa('aws', ['configure', 'set', 'output', 'json', '--profile', profile.profileName]);

      console.log(chalk.green(`✅ Profile '${profile.profileName}' configured`));
      console.log('');
      console.log('Profile details:');
      console.log(`  Account ID: ${profile.accountId}`);
      console.log(`  Role Name: ${profile.roleName}`);
      console.log(`  Region: ${this.config.awsRegion}`);
      console.log(`  SSO Start URL: ${this.config.startUrl}`);

      return true;

    } catch (error) {
      console.log(chalk.red(`❌ Failed to setup SSO profile '${profile.profileName}':`), error);
      return false;
    }
  }

  async setupSSOProfiles(): Promise<boolean> {
    let anySucceeded = false;
    for (const profile of this.config.profiles) {
      if (await this.setupSingleProfile(profile)) {
        anySucceeded = true;
      } else {
        console.log(chalk.yellow(`⚠️  Skipping profile '${profile.profileName}' - you may not have access to this account`));
      }
    }
    return anySucceeded;
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

    // Login once using the first profile - the SSO session is shared
    const loginProfile = this.config.profiles[0].profileName;

    try {
      await execa('aws', ['sso', 'login', '--profile', loginProfile]);

      console.log(chalk.green('✅ SSO login successful'));

      // Test credentials for each profile
      for (const profile of this.config.profiles) {
        console.log(chalk.blue(`🧪 Testing credentials for ${profile.profileName}...`));
        try {
          const { stdout: identity } = await execa('aws', [
            'sts', 'get-caller-identity',
            '--profile', profile.profileName,
            '--query', 'Arn',
            '--output', 'text'
          ]);
          console.log(chalk.green(`✅ ${profile.profileName} working`));
          console.log(`   Identity: ${identity.trim()}`);
        } catch {
          console.log(chalk.yellow(`⚠️  ${profile.profileName} not accessible (you may not have access to this account)`));
        }
      }

      return true;

    } catch (error) {
      console.log(chalk.red('❌ SSO login failed:'), error);
      return false;
    }
  }

  async checkSSOConfig(): Promise<boolean> {
    console.log(chalk.blue('🔍 Checking SSO configuration...'));

    let allGood = true;

    try {
      const { stdout: existingProfiles } = await execa('aws', ['configure', 'list-profiles']);

      for (const profile of this.config.profiles) {
        if (!existingProfiles.includes(profile.profileName)) {
          console.log(chalk.red(`❌ Profile '${profile.profileName}' not found`));
          allGood = false;
          continue;
        }

        console.log(chalk.green(`✅ Profile '${profile.profileName}' exists`));

        // Check profile configuration
        const configCommands: Array<[string, string[]]> = [
          ['SSO Session', ['configure', 'get', 'sso_session', '--profile', profile.profileName]],
          ['Account ID', ['configure', 'get', 'sso_account_id', '--profile', profile.profileName]],
          ['Role Name', ['configure', 'get', 'sso_role_name', '--profile', profile.profileName]],
          ['Region', ['configure', 'get', 'region', '--profile', profile.profileName]]
        ];

        console.log('');
        console.log(`Profile configuration (${profile.profileName}):`);

        for (const [label, args] of configCommands) {
          try {
            const { stdout } = await execa('aws', args);
            console.log(`  ${label}: ${stdout.trim() || 'Not set'}`);
          } catch {
            console.log(`  ${label}: Not set`);
          }
        }

        // Check if logged in
        try {
          const { stdout: identity } = await execa('aws', [
            'sts', 'get-caller-identity',
            '--profile', profile.profileName,
            '--query', 'Arn',
            '--output', 'text'
          ]);
          console.log(`  Status: ✅ Logged in`);
          console.log(`  Identity: ${identity.trim()}`);
        } catch {
          console.log(`  Status: ❌ Not logged in or expired`);
          console.log(`  Run: aws sso login --profile ${profile.profileName}`);
          allGood = false;
        }
      }

      return allGood;

    } catch (error) {
      console.log(chalk.red('❌ Error checking SSO configuration:'), error);
      return false;
    }
  }

  // Returns the dev profile for backward compatibility with callers in
  // env-generator.ts, getty-config.ts, commerce-config.ts, cert-config.ts
  async getProfile(): Promise<string> {
    return this.config.profiles[0].profileName;
  }

  async setup(): Promise<boolean> {
    console.log(chalk.cyan.bold('🚀 AWS SSO Setup for AIRO Development'));
    console.log(chalk.gray('====================================='));
    console.log('');

    // Check prerequisites
    if (!(await this.checkPrerequisites())) {
      return false;
    }

    // Setup SSO session (shared across all profiles)
    if (!(await this.setupSSOSession())) {
      return false;
    }

    // Setup all SSO profiles
    if (!(await this.setupSSOProfiles())) {
      return false;
    }

    // Perform SSO login
    if (!(await this.performSSOLogin())) {
      return false;
    }

    console.log('');
    console.log(chalk.green.bold('🎉 AWS SSO setup complete!'));
    console.log('');
    console.log('Configured profiles:');
    for (const profile of this.config.profiles) {
      console.log(chalk.gray(`  ${profile.profileName} (${profile.accountId}, ${profile.roleName})`));
    }
    console.log('');
    console.log('To use a profile:');
    console.log(chalk.gray(`  export AWS_PROFILE=airobuild-dev-private-sso`));
    console.log(chalk.gray('  aws sts get-caller-identity'));
    console.log('');
    console.log('To refresh credentials when they expire:');
    console.log(chalk.gray(`  aws sso login --profile airobuild-dev-private-sso`));
    console.log('');
    console.log('Note: SSO sessions typically last 8-12 hours');

    return true;
  }
}
