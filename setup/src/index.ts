#!/usr/bin/env node

import chalk from 'chalk';
import inquirer from 'inquirer';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { DependencyChecker } from './deps-checker.js';
import { EnvGenerator } from './env-generator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

function printHeader() {
  console.clear();
  console.log(chalk.cyan.bold('🚀 Airo App Builder Advanced Setup'));
  console.log(chalk.gray('====================================='));
  console.log('');
}

function printSeparator() {
  console.log(chalk.gray('\n─────────────────────────────────────\n'));
}

async function main() {
  try {
    printHeader();
    
    console.log(chalk.yellow('This utility will:'));
    console.log('• Check Docker and Docker Compose installation');
    console.log('• Verify Docker daemon is running');
    console.log('• Configure app/.env file with AI and database settings');
    console.log('• Configure agents/.env file with AI and MySQL settings');
    console.log('• Generate SSO JWT tokens automatically if available');
    console.log('');

    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: 'Continue with advanced setup?',
        default: true
      }
    ]);

    if (!proceed) {
      console.log(chalk.yellow('Setup cancelled.'));
      process.exit(0);
    }

    printSeparator();

    // Step 1: Check Docker dependencies
    const depChecker = new DependencyChecker();
    const dockerOk = await depChecker.checkAllDockerDependencies();

    if (!dockerOk) {
      console.log(chalk.red('\n❌ Docker dependencies not satisfied.'));
      console.log('Please install missing dependencies and run this setup again.');
      
      const { continueAnyway } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continueAnyway',
          message: 'Continue with environment setup anyway?',
          default: false
        }
      ]);

      if (!continueAnyway) {
        process.exit(1);
      }
    }

    printSeparator();

    // Step 2: Environment Configuration
    const envGenerator = new EnvGenerator(projectRoot);
    
    console.log(chalk.cyan('🔧 Environment Configuration'));
    console.log('Configuring .env files for the application...\n');

    const { configureApp } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'configureApp',
        message: 'Generate app/.env configuration?',
        default: true
      }
    ]);

    if (configureApp) {
      await envGenerator.generateAppEnv();
    }

    const { configureAgents } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'configureAgents',
        message: 'Generate agents/.env configuration?',
        default: true
      }
    ]);

    if (configureAgents) {
      await envGenerator.generateAgentsEnv();
    }

    printSeparator();

    // Step 3: Optional MySQL container check
    if (dockerOk) {
      console.log(chalk.cyan('🐳 Docker Container Status'));
      await envGenerator.checkMySQLConnection();
      
      const { startMySQL } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'startMySQL',
          message: 'Start MySQL container now?',
          default: true
        }
      ]);

      if (startMySQL) {
        try {
          console.log(chalk.blue('🚀 Starting MySQL container...'));
          execSync('docker compose up app-mysql -d', { 
            cwd: projectRoot,
            stdio: 'inherit' 
          });
          console.log(chalk.green('✅ MySQL container started successfully'));
        } catch (error) {
          console.log(chalk.red('❌ Failed to start MySQL container'));
          console.log(chalk.gray('You can start it manually with: docker compose up app-mysql -d'));
        }
      }
    }

    printSeparator();

    // Step 4: Next Steps
    console.log(chalk.green.bold('🎉 Setup Complete!'));
    console.log('');
    console.log(chalk.cyan('📋 Next Steps:'));
    console.log('');
    console.log('1. Install dependencies:');
    console.log(chalk.gray('   cd agents && pnpm install'));
    console.log(chalk.gray('   cd app && pnpm install'));
    console.log('');
    console.log('2. Run database migrations:');
    console.log(chalk.gray('   cd app && pnpm dlx prisma migrate dev'));
    console.log('');
    console.log('3. Start the services:');
    console.log(chalk.gray('   cd agents && pnpm run dev    # Backend (port 4000)'));
    console.log(chalk.gray('   cd app && pnpm run dev       # Frontend (port 3000)'));
    console.log('');
    console.log('4. Access the application:');
    console.log(chalk.gray('   http://localhost:3000'));
    console.log('');
    
    if (dockerOk) {
      console.log('5. MySQL is available at:');
      console.log(chalk.gray('   Host: localhost:3306'));
      console.log(chalk.gray('   Database: airo_app'));
      console.log(chalk.gray('   User: airo'));
      console.log(chalk.gray('   Password: airopassword'));
      console.log('');
    }

  } catch (error) {
    console.error(chalk.red('❌ Setup failed:'), error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n⏹️  Setup interrupted by user'));
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(chalk.yellow('\n\n⏹️  Setup terminated'));
  process.exit(0);
});

main().catch((error) => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});