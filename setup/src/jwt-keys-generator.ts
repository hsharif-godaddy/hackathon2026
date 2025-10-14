import chalk from 'chalk';
import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'path';

/**
 * JWT Keys Generator
 * Generates RSA key pairs for JWT authentication and adds them to .env files
 */
export class JWTKeysGenerator {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Generate JWT keys and add to both app and agents .env files
   */
  async generateAndConfigureKeys(): Promise<boolean> {
    try {
      console.log(chalk.cyan('🔐 Generating JWT Keys'));
      console.log('');

      // Run the key generation script
      console.log(chalk.blue('⚙️  Running key generation script...'));
      const { stdout } = await execa('node', ['scripts/generate-jwt-keys.js'], {
        cwd: this.projectRoot
      });

      // Parse the output to extract keys
      const keys = this.parseKeysFromOutput(stdout);

      if (!keys.privateKey || !keys.publicKey) {
        throw new Error('Failed to extract keys from generation script output');
      }

      console.log(chalk.green('✅ JWT keys generated successfully'));
      console.log('');

      // Add keys to app/.env
      await this.addKeysToEnvFile(
        path.join(this.projectRoot, 'app', '.env'),
        keys,
        'app'
      );

      // Add keys to agents/.env (only public key needed)
      await this.addKeysToEnvFile(
        path.join(this.projectRoot, 'agents', '.env'),
        { publicKey: keys.publicKey },
        'agents'
      );

      console.log('');
      console.log(chalk.green('✅ JWT keys configured in both app and agents .env files'));
      
      return true;
    } catch (error) {
      console.log(chalk.red('❌ Failed to generate JWT keys:'), error);
      return false;
    }
  }

  /**
   * Parse JWT keys from script output
   */
  private parseKeysFromOutput(output: string): { privateKey?: string; publicKey?: string } {
    const keys: { privateKey?: string; publicKey?: string } = {};

    // Extract JWT_PRIVATE_KEY
    const privateKeyMatch = output.match(/JWT_PRIVATE_KEY="([^"]+)"/);
    if (privateKeyMatch) {
      keys.privateKey = privateKeyMatch[1];
    }

    // Extract JWT_PUBLIC_KEY
    const publicKeyMatch = output.match(/JWT_PUBLIC_KEY="([^"]+)"/);
    if (publicKeyMatch) {
      keys.publicKey = publicKeyMatch[1];
    }

    return keys;
  }

  /**
   * Add or update JWT keys in .env file
   */
  private async addKeysToEnvFile(
    envPath: string,
    keys: { privateKey?: string; publicKey?: string },
    serviceName: string
  ): Promise<void> {
    console.log(chalk.blue(`📝 Updating ${serviceName}/.env...`));

    // Read existing .env file or create empty content
    let envContent = '';
    if (await fs.pathExists(envPath)) {
      envContent = await fs.readFile(envPath, 'utf-8');
    } else {
      console.log(chalk.yellow(`  ⚠️  ${serviceName}/.env doesn't exist, creating it...`));
      await fs.ensureFile(envPath);
    }

    // Remove existing JWT key lines
    envContent = envContent
      .split('\n')
      .filter(line => !line.startsWith('JWT_PRIVATE_KEY=') && !line.startsWith('JWT_PUBLIC_KEY='))
      .join('\n');

    // Prepare new JWT key lines
    const jwtSection = [];
    
    if (!envContent.includes('# JWT Keys for Agent Authentication')) {
      jwtSection.push('');
      jwtSection.push('# JWT Keys for Agent Authentication (auto-generated)');
    }

    if (keys.privateKey) {
      jwtSection.push(`JWT_PRIVATE_KEY="${keys.privateKey}"`);
    }

    if (keys.publicKey) {
      jwtSection.push(`JWT_PUBLIC_KEY="${keys.publicKey}"`);
    }

    // Append JWT keys to the end of the file
    const updatedContent = envContent.trim() + '\n' + jwtSection.join('\n') + '\n';

    // Write updated content
    await fs.writeFile(envPath, updatedContent);

    console.log(chalk.green(`  ✅ ${serviceName}/.env updated with JWT keys`));
  }

  /**
   * Check if JWT keys are already configured
   */
  async checkKeysConfigured(): Promise<{ app: boolean; agents: boolean }> {
    const appEnvPath = path.join(this.projectRoot, 'app', '.env');
    const agentsEnvPath = path.join(this.projectRoot, 'agents', '.env');

    const result = {
      app: false,
      agents: false
    };

    // Check app/.env
    if (await fs.pathExists(appEnvPath)) {
      const appContent = await fs.readFile(appEnvPath, 'utf-8');
      result.app = appContent.includes('JWT_PRIVATE_KEY=') && appContent.includes('JWT_PUBLIC_KEY=');
    }

    // Check agents/.env
    if (await fs.pathExists(agentsEnvPath)) {
      const agentsContent = await fs.readFile(agentsEnvPath, 'utf-8');
      result.agents = agentsContent.includes('JWT_PUBLIC_KEY=');
    }

    return result;
  }

  /**
   * Display current JWT configuration status
   */
  async displayStatus(): Promise<void> {
    const status = await this.checkKeysConfigured();

    console.log(chalk.blue('🔐 JWT Authentication:'));
    
    if (status.app) {
      console.log(chalk.green('  ✅ app/.env has JWT keys configured'));
    } else {
      console.log(chalk.yellow('  ⚠️  app/.env missing JWT keys'));
    }

    if (status.agents) {
      console.log(chalk.green('  ✅ agents/.env has JWT public key configured'));
    } else {
      console.log(chalk.yellow('  ⚠️  agents/.env missing JWT public key'));
    }
  }
}

