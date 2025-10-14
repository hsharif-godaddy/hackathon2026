#!/usr/bin/env node

import chalk from 'chalk';
import inquirer from 'inquirer';
import path from 'path';
import { fileURLToPath } from 'url';
import { execa } from 'execa';
import fs from 'fs-extra';
import { DependencyChecker } from './deps-checker.js';
import { EnvGenerator } from './env-generator.js';
import { GettyConfigSetup } from './getty-config.js';
import { JWTKeysGenerator } from './jwt-keys-generator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

function printHeader() {
  console.clear();
  console.log(chalk.cyan.bold('🚀 Airo App Builder Setup Utility'));
  console.log(chalk.gray('==================================='));
  console.log('');
}

function printSelectiveHeader() {
  console.clear();
  console.log(chalk.cyan.bold('🔧 Airo App Builder Configuration'));
  console.log(chalk.gray('=================================='));
  console.log('');
}

function printSeparator() {
  console.log(chalk.gray('\n─────────────────────────────────────\n'));
}

async function selectMode(): Promise<'full' | 'selective'> {
  printHeader();
  
  console.log(chalk.yellow('Choose setup mode:'));
  console.log('');
  console.log('🔧 ' + chalk.cyan('Selective Configuration') + ' - Configure individual components');
  console.log('🚀 ' + chalk.cyan('Full Setup') + ' - Complete setup wizard');
  console.log('');

  const { mode } = await inquirer.prompt([
    {
      type: 'list',
      name: 'mode',
      message: 'What would you like to do?',
      choices: [
        { name: '🔧 Selective Configuration - Pick what to configure', value: 'selective' },
        { name: '🚀 Full Setup - Configure everything', value: 'full' }
      ],
      default: 'selective'
    }
  ]);

  return mode;
}

async function selectiveConfiguration(): Promise<void> {
  const depChecker = new DependencyChecker();
  const envGenerator = new EnvGenerator(projectRoot);
  const gettySetup = new GettyConfigSetup();
  const jwtGenerator = new JWTKeysGenerator(projectRoot);

  while (true) {
    printSelectiveHeader();
    
    console.log(chalk.yellow('Select what to configure:'));
    console.log('');

    const choices = [
      { name: '🔍 Check Docker Dependencies', value: 'docker-deps' },
      { name: '📱 Configure App Environment (.env)', value: 'app-env' },
      { name: '🤖 Configure Agents Environment (.env)', value: 'agents-env' },
      { name: '🔐 Generate JWT Keys', value: 'jwt-keys' },
      { name: '🖼️  Configure Getty Images Proxy', value: 'getty-config' },
      { name: '🗄️  Check MySQL Container Status', value: 'mysql-check' },
      { name: '🐳 Start MySQL Container', value: 'mysql-start' },
      { name: '🔍 Check Current Configuration Status', value: 'status-check' },
      new inquirer.Separator(),
      { name: '✅ Exit', value: 'exit' }
    ];

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to configure?',
        choices,
        pageSize: 15
      }
    ]);

    if (action === 'exit') {
      console.log(chalk.green('👋 Configuration complete!'));
      break;
    }

    printSeparator();

    try {
      switch (action) {
        case 'docker-deps':
          await configureDockerDeps(depChecker);
          break;
        case 'app-env':
          await envGenerator.generateAppEnv();
          break;
        case 'agents-env':
          await envGenerator.generateAgentsEnv();
          break;
        case 'jwt-keys':
          await jwtGenerator.generateAndConfigureKeys();
          break;
        case 'getty-config':
          await gettySetup.setup();
          break;
        case 'mysql-check':
          await envGenerator.checkMySQLConnection();
          break;
        case 'mysql-start':
          await startMySQLContainer();
          break;
        case 'status-check':
          await checkCurrentStatus(envGenerator, gettySetup, jwtGenerator);
          break;
      }
    } catch (error) {
      console.log(chalk.red('❌ Configuration failed:'), error);
    }

    printSeparator();
    
    const { continue: shouldContinue } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'continue',
        message: 'Configure something else?',
        default: true
      }
    ]);

    if (!shouldContinue) {
      console.log(chalk.green('👋 Configuration complete!'));
      break;
    }
  }
}

async function configureDockerDeps(depChecker: DependencyChecker): Promise<void> {
  console.log(chalk.cyan('🔍 Docker Dependencies Check'));
  console.log('');
  
  const dockerOk = await depChecker.checkAllDockerDependencies();
  
  if (dockerOk) {
    console.log(chalk.green('✅ All Docker dependencies are satisfied!'));
  } else {
    console.log(chalk.red('❌ Some Docker dependencies are missing.'));
    console.log('Please install missing dependencies and run this check again.');
  }
}

async function startMySQLContainer(): Promise<void> {
  console.log(chalk.cyan('🐳 Starting MySQL Container'));
  console.log('');
  
  try {
    console.log(chalk.blue('🚀 Starting MySQL container...'));
    await execa('docker', ['compose', 'up', 'app-mysql', '-d'], { 
      cwd: projectRoot,
      stdio: 'inherit' 
    });
    console.log(chalk.green('✅ MySQL container started successfully'));
  } catch (error) {
    console.log(chalk.red('❌ Failed to start MySQL container'));
    console.log(chalk.gray('You can start it manually with: docker compose up app-mysql -d'));
    throw error;
  }
}

async function checkCurrentStatus(envGenerator: EnvGenerator, gettySetup: GettyConfigSetup, jwtGenerator: JWTKeysGenerator): Promise<void> {
  console.log(chalk.cyan('🔍 Current Configuration Status'));
  console.log('');

  // Check .env files
  const appEnvPath = path.join(projectRoot, 'app', '.env');
  const agentsEnvPath = path.join(projectRoot, 'agents', '.env');
  
  console.log(chalk.blue('📄 Configuration Files:'));
  if (await fs.pathExists(appEnvPath)) {
    console.log(chalk.green('  ✅ app/.env exists'));
  } else {
    console.log(chalk.red('  ❌ app/.env missing'));
  }
  
  if (await fs.pathExists(agentsEnvPath)) {
    console.log(chalk.green('  ✅ agents/.env exists'));
  } else {
    console.log(chalk.red('  ❌ agents/.env missing'));
  }

  console.log('');
  
  // Check JWT keys
  await jwtGenerator.displayStatus();

  console.log('');
  
  // Check MySQL
  console.log(chalk.blue('🗄️  MySQL Container:'));
  const mysqlRunning = await envGenerator.checkMySQLConnection();
  if (!mysqlRunning) {
    console.log(chalk.yellow('  ⚠️  MySQL container not running'));
  }

  console.log('');
  
  // Check Getty configuration
  console.log(chalk.blue('🖼️  Getty Images:'));
  const gettyConfigured = await gettySetup.quickCheck();
  if (!gettyConfigured) {
    console.log(chalk.yellow('  ⚠️  Getty Images not configured or inaccessible'));
  }

  console.log('');
  
  // Check Docker
  console.log(chalk.blue('🐳 Docker:'));
  const depChecker = new DependencyChecker();
  const dockerOk = await depChecker.checkAllDockerDependencies();
  if (!dockerOk) {
    console.log(chalk.yellow('  ⚠️  Docker dependencies not satisfied'));
  }
}

async function fullSetup(): Promise<void> {
  printHeader();
  
  console.log(chalk.yellow('This full setup will:'));
  console.log('• Check Docker and Docker Compose installation');
  console.log('• Verify Docker daemon is running');
  console.log('• Configure app/.env file with AI and database settings');
  console.log('• Configure agents/.env file with AI and MySQL settings');
  console.log('• Generate JWT keys for secure agent communication');
  console.log('• Set up Getty Images proxy with AWS Secrets Manager token');
  console.log('• Generate SSO JWT tokens automatically if available');
  console.log('');

  const { proceed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'proceed',
      message: 'Continue with full setup?',
      default: true
    }
  ]);

  if (!proceed) {
    console.log(chalk.yellow('Setup cancelled.'));
    return;
  }

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
      return;
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

  // Step 2.5: JWT Keys Generation
  console.log(chalk.cyan('🔐 JWT Keys Configuration'));
  console.log('JWT keys are required for secure communication between app and agents.\n');

  const jwtGenerator = new JWTKeysGenerator(projectRoot);
  const jwtStatus = await jwtGenerator.checkKeysConfigured();
  
  if (jwtStatus.app && jwtStatus.agents) {
    console.log(chalk.green('✅ JWT keys already configured'));
    
    const { regenerateKeys } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'regenerateKeys',
        message: 'Regenerate JWT keys?',
        default: false
      }
    ]);

    if (regenerateKeys) {
      await jwtGenerator.generateAndConfigureKeys();
    }
  } else {
    const { generateKeys } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'generateKeys',
        message: 'Generate JWT keys now?',
        default: true
      }
    ]);

    if (generateKeys) {
      await jwtGenerator.generateAndConfigureKeys();
    } else {
      console.log(chalk.yellow('⚠️  Skipping JWT keys generation'));
      console.log(chalk.gray('   You can generate them later with: node scripts/generate-jwt-keys.js'));
    }
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
        await execa('docker', ['compose', 'up', 'app-mysql', '-d'], { 
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

  // Step 4: Getty Configuration (standalone option)
  const { configureGettyStandalone } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'configureGettyStandalone',
      message: 'Configure Getty Images proxy separately?',
      default: false
    }
  ]);

  if (configureGettyStandalone) {
    const gettySetup = new GettyConfigSetup();
    await gettySetup.setup();
  }

  printSeparator();

  // Step 5: Next Steps
  console.log(chalk.green.bold('🎉 Setup Complete!'));
  console.log('');
  console.log(chalk.cyan('📋 Next Steps:'));
  console.log('');
  console.log('1. Install dependencies:');
  console.log(chalk.gray('   pnpm install  # Install all workspace dependencies'));
  console.log('');
  console.log('2. Run database migrations:');
  console.log(chalk.gray('   pnpm --filter website dlx prisma migrate dev'));
  console.log('');
  console.log('3. Start the services:');
  console.log(chalk.gray('   pnpm run dev  # Start both services concurrently'));
  console.log(chalk.gray('   # Or start individually:'));
  console.log(chalk.gray('   pnpm run dev:agents  # Backend (port 4000)'));
  console.log(chalk.gray('   pnpm run dev:app     # Frontend (port 3000)'));
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
}

async function main() {
  try {
    const mode = await selectMode();
    
    if (mode === 'selective') {
      await selectiveConfiguration();
    } else {
      await fullSetup();
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