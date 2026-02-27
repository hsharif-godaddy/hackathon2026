import { execa } from 'execa';
import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';

interface KnowBConfig {
  apiUrl: string;
}

export class KnowBConfigSetup {
  private config: KnowBConfig = {
    apiUrl: 'https://knowb.api.int.test-godaddy.com'
  };

  async checkSsoJwtBinary(): Promise<boolean> {
    try {
      await execa('ssojwt', ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async generateSsoJwtToken(): Promise<string | null> {
    console.log(chalk.blue('🔄 Generating SSO JWT token for test environment...'));

    try {
      const { stdout: token } = await execa('ssojwt', ['-e', 'test']);
      const trimmedToken = token.trim();

      if (trimmedToken) {
        console.log(chalk.green('✅ SSO JWT token generated successfully'));
        console.log(chalk.gray(`   Token: ${trimmedToken.substring(0, 20)}...`));
        return trimmedToken;
      }

      throw new Error('Empty token received');
    } catch (error: any) {
      console.log(chalk.red('❌ Failed to generate SSO JWT token'));
      console.log(chalk.gray(`   Error: ${error.message}`));
      return null;
    }
  }

  async generateKnowBEnvConfig(token: string): Promise<string> {
    const envConfig = `
# KnowB Knowledge Base Configuration
# Used for RAG (Retrieval-Augmented Generation) searches
# CLI tool available: pnpm --filter @airo/agents tsx scripts/knowb-cli.ts
SSO_JWT=${token}
GODADDY_API_BASE_URL=${this.config.apiUrl}`;

    return envConfig;
  }

  async setup(yesToAll: boolean = false): Promise<{ success: boolean; envConfig?: string; token?: string }> {
    console.log(chalk.cyan.bold('📚 KnowB Knowledge Base Setup'));
    console.log(chalk.gray('=============================='));
    console.log('');

    console.log('KnowB enables RAG (Retrieval-Augmented Generation) for design style searches.');
    console.log(`API URL: ${this.config.apiUrl}`);
    console.log('Authentication: SSO JWT token');
    console.log('');
    console.log(chalk.gray('Requires ssojwt binary: https://github.com/gdcorp-engineering/ssojwt'));
    console.log(chalk.gray('CLI tool available after setup: pnpm --filter @airo/agents tsx scripts/knowb-cli.ts'));
    console.log('');

    if (yesToAll) {
      console.log(chalk.gray('Automated mode: skipping KnowB configuration'));
      return { success: false };
    }

    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: 'Continue with KnowB configuration?',
        default: true
      }
    ]);

    if (!proceed) {
      console.log(chalk.yellow('KnowB configuration cancelled.'));
      return { success: false };
    }

    // Check if ssojwt binary is available
    const hasSsoJwtBinary = await this.checkSsoJwtBinary();

    let token: string | null = null;

    if (hasSsoJwtBinary) {
      console.log(chalk.green('✅ ssojwt binary found'));
      console.log('');

      const { method } = await inquirer.prompt([
        {
          type: 'list',
          name: 'method',
          message: 'How would you like to configure KnowB authentication?',
          choices: [
            { name: 'Generate SSO JWT token automatically (recommended)', value: 'generate' },
            { name: 'Enter SSO JWT token manually', value: 'manual' }
          ],
          default: 'generate'
        }
      ]);

      if (method === 'generate') {
        token = await this.generateSsoJwtToken();
      } else {
        const { manualToken } = await inquirer.prompt([
          {
            type: 'password',
            name: 'manualToken',
            message: 'Enter your SSO JWT token:',
            validate: (input) => input.length > 0 || 'SSO JWT Token is required'
          }
        ]);
        token = manualToken;
        console.log(chalk.green('✅ SSO JWT token configured'));
      }
    } else {
      console.log(chalk.yellow('⚠️  ssojwt binary not found'));
      console.log(chalk.blue('📦 Install from: https://github.com/gdcorp-engineering/ssojwt'));
      console.log('');

      const { hasToken } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'hasToken',
          message: 'Do you have an SSO JWT token to enter manually?',
          default: false
        }
      ]);

      if (hasToken) {
        const { manualToken } = await inquirer.prompt([
          {
            type: 'password',
            name: 'manualToken',
            message: 'Enter your SSO JWT token:',
            validate: (input) => input.length > 0 || 'SSO JWT Token is required'
          }
        ]);
        token = manualToken;
        console.log(chalk.green('✅ SSO JWT token configured'));
      } else {
        console.log(chalk.yellow('KnowB configuration skipped - no token available.'));
        console.log('');
        console.log(chalk.yellow('Manual setup instructions:'));
        console.log('1. Install ssojwt from https://github.com/gdcorp-engineering/ssojwt');
        console.log('2. Run: ssojwt');
        console.log('3. Add to your agents/.env:');
        console.log(chalk.gray(`   SSO_JWT=<your-token>`));
        console.log(chalk.gray(`   GODADDY_API_BASE_URL=${this.config.apiUrl}`));
        return { success: false };
      }
    }

    if (!token) {
      console.log(chalk.red('❌ Could not obtain SSO JWT token'));
      return { success: false };
    }

    // Generate environment configuration
    const envConfig = await this.generateKnowBEnvConfig(token);

    console.log('');
    console.log(chalk.green.bold('🎉 KnowB configuration complete!'));
    console.log('');
    console.log('Configuration to add to agents/.env:');
    console.log(chalk.gray(envConfig.trim()));
    console.log('');

    return { success: true, envConfig, token };
  }

  async quickCheck(): Promise<boolean> {
    console.log(chalk.blue('🔍 Quick KnowB configuration check...'));

    // Check if ssojwt binary is available
    const hasSsoJwtBinary = await this.checkSsoJwtBinary();

    if (!hasSsoJwtBinary) {
      console.log(chalk.yellow('⚠️  ssojwt binary not installed'));
      console.log(chalk.gray('   Install from: https://github.com/gdcorp-engineering/ssojwt'));
      return false;
    }

    // Try to generate a token to verify it works
    try {
      const { stdout: token } = await execa('ssojwt', ['-e', 'test']);
      if (token && token.trim()) {
        console.log(chalk.green('✅ KnowB authentication is available (ssojwt works)'));
        return true;
      }
    } catch {
      console.log(chalk.yellow('⚠️  ssojwt failed to generate token'));
      return false;
    }

    return false;
  }

  async updateAgentsEnv(projectRoot: string, token: string): Promise<boolean> {
    const agentsEnvPath = path.join(projectRoot, 'agents', '.env');

    if (!await fs.pathExists(agentsEnvPath)) {
      console.log(chalk.red('❌ agents/.env file not found'));
      console.log(chalk.yellow('Run "Configure Agents Environment" first'));
      return false;
    }

    try {
      let envContent = await fs.readFile(agentsEnvPath, 'utf-8');

      // Check if SSO_JWT is already configured
      const ssoJwtMatch = envContent.match(/^SSO_JWT=(.*)$/m);

      if (ssoJwtMatch) {
        // Update existing SSO_JWT
        const existingToken = ssoJwtMatch[1];
        if (existingToken && !existingToken.includes('<') && existingToken !== '') {
          const { overwrite } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'overwrite',
              message: 'SSO_JWT is already configured. Overwrite it?',
              default: false
            }
          ]);

          if (!overwrite) {
            console.log(chalk.yellow('⏭  Keeping existing SSO_JWT configuration'));
            return true;
          }
        }

        envContent = envContent.replace(/^SSO_JWT=.*$/m, `SSO_JWT=${token}`);
      } else {
        // Check for commented SSO_JWT and uncomment it
        const commentedMatch = envContent.match(/^# SSO_JWT=.*$/m);
        if (commentedMatch) {
          envContent = envContent.replace(/^# SSO_JWT=.*$/m, `SSO_JWT=${token}`);
        } else {
          // Add new SSO_JWT configuration
          const envConfig = await this.generateKnowBEnvConfig(token);
          envContent += '\n' + envConfig;
        }
      }

      // Ensure GODADDY_API_BASE_URL is set for KnowB
      if (!envContent.includes('GODADDY_API_BASE_URL=') || envContent.match(/^# GODADDY_API_BASE_URL=/m)) {
        // Uncomment or add GODADDY_API_BASE_URL
        if (envContent.match(/^# GODADDY_API_BASE_URL=/m)) {
          envContent = envContent.replace(
            /^# GODADDY_API_BASE_URL=.*$/m,
            `GODADDY_API_BASE_URL=${this.config.apiUrl}`
          );
        }
      }

      await fs.writeFile(agentsEnvPath, envContent);
      console.log(chalk.green('✅ Updated agents/.env with KnowB configuration'));
      return true;
    } catch (error: any) {
      console.log(chalk.red('❌ Failed to update agents/.env'));
      console.log(chalk.gray(`   Error: ${error.message}`));
      return false;
    }
  }
}
