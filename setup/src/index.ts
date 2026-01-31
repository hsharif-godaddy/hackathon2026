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
import { CommerceConfigSetup } from './commerce-config.js';
import { CertConfigSetup } from './cert-config.js';
import { JWTKeysGenerator } from './jwt-keys-generator.js';
import { CASetup } from './ca-setup.js';
import { KnowBConfigSetup } from './knowb-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

// Global warnings/follow-ups collection
const setupWarnings: string[] = [];

function addSetupWarning(message: string): void {
  setupWarnings.push(message);
}

function displaySetupWarnings(): void {
  if (setupWarnings.length === 0) {
    return;
  }

  console.log('');
  console.log(chalk.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.yellow.bold('⚠️  IMPORTANT: Setup Warnings & Follow-ups'));
  console.log(chalk.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log('');

  setupWarnings.forEach((warning, index) => {
    console.log(chalk.yellow(`${index + 1}. ${warning}`));
  });

  console.log('');
  console.log(chalk.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log('');
}

function printHeader() {
  console.clear();
  console.log(chalk.cyan.bold('🚀 Airo Builder Setup Utility'));
  console.log(chalk.gray('==================================='));
  console.log('');
}

function printSelectiveHeader() {
  console.clear();
  console.log(chalk.cyan.bold('🔧 Airo Builder Configuration'));
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
  const commerceSetup = new CommerceConfigSetup();
  const certSetup = new CertConfigSetup();
  const jwtGenerator = new JWTKeysGenerator(projectRoot);
  const caSetup = new CASetup(projectRoot);
  const knowbSetup = new KnowBConfigSetup();

  while (true) {
    printSelectiveHeader();

    console.log(chalk.yellow('Select what to configure:'));
    console.log('');

    const choices = [
      { name: '🔍 Check Docker Dependencies', value: 'docker-deps' },
      { name: '🔒 Setup Development CA (SSL Certificates)', value: 'ca-setup' },
      { name: '📱 Configure App Environment (.env)', value: 'app-env' },
      { name: '🤖 Configure Agents Environment (.env)', value: 'agents-env' },
      { name: '🔐 Generate JWT Keys', value: 'jwt-keys' },
      { name: '🖼️  Configure Getty Images Proxy', value: 'getty-config' },
      { name: '📚 Configure KnowB Knowledge Base', value: 'knowb-config' },
      { name: '🛒 Configure GoDaddy Commerce OAuth', value: 'commerce-config' },
      { name: '📜 Configure Client Certificates', value: 'cert-config' },
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
        case 'ca-setup':
          await caSetup.setup();
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
        case 'knowb-config':
          await configureKnowB(knowbSetup);
          break;
        case 'commerce-config':
          await commerceSetup.setup();
          break;
        case 'cert-config':
          await certSetup.setup();
          break;
        case 'mysql-check':
          await envGenerator.checkMySQLConnection();
          break;
        case 'mysql-start':
          await startMySQLContainer();
          break;
        case 'status-check':
          await checkCurrentStatus(envGenerator, gettySetup, knowbSetup, commerceSetup, certSetup, jwtGenerator, caSetup);
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

async function configureKnowB(knowbSetup: KnowBConfigSetup): Promise<void> {
  const result = await knowbSetup.setup();

  if (result.success && result.token) {
    console.log('');
    const { updateEnv } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'updateEnv',
        message: 'Update agents/.env with this configuration?',
        default: true
      }
    ]);

    if (updateEnv) {
      await knowbSetup.updateAgentsEnv(projectRoot, result.token);
    } else {
      console.log(chalk.yellow('Remember to add the configuration to agents/.env manually'));
    }
  }
}

async function checkCurrentStatus(envGenerator: EnvGenerator, gettySetup: GettyConfigSetup, knowbSetup: KnowBConfigSetup, commerceSetup: CommerceConfigSetup, certSetup: CertConfigSetup, jwtGenerator: JWTKeysGenerator, caSetup: CASetup): Promise<void> {
  console.log(chalk.cyan('🔍 Current Configuration Status'));
  console.log('');

  // Check CA
  await caSetup.checkStatus();
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

  // Check KnowB configuration
  console.log(chalk.blue('📚 KnowB Knowledge Base:'));
  const knowbConfigured = await knowbSetup.quickCheck();
  if (!knowbConfigured) {
    console.log(chalk.yellow('  ⚠️  KnowB not configured (ssojwt binary required)'));
  }

  console.log('');

  // Check Commerce configuration
  console.log(chalk.blue('🛒 GoDaddy Commerce:'));
  const commerceConfigured = await commerceSetup.quickCheck();
  if (!commerceConfigured) {
    console.log(chalk.yellow('  ⚠️  Commerce credentials not configured or inaccessible'));
  }

  console.log('');

  // Check Certificate configuration
  console.log(chalk.blue('📜 Client Certificates:'));
  const certConfigured = await certSetup.quickCheck();
  if (!certConfigured) {
    console.log(chalk.yellow('  ⚠️  Client certificates not configured or inaccessible'));
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

async function fullSetup(yesToAll: boolean = false): Promise<void> {
  // Clear any previous warnings
  setupWarnings.length = 0;

  printHeader();

  if (yesToAll) {
    console.log(chalk.green('🚀 Running full automated setup with defaults...'));
    console.log('');
  }

  console.log(chalk.yellow('This full setup will:'));
  console.log('• Check Docker and Docker Compose installation');
  console.log('• Verify Docker daemon is running');
  console.log('• Generate and trust development CA for SSL certificates');
  console.log('• Configure GoDaddy Commerce OAuth credentials (optional)');
  console.log('• Generate app/.env configuration file');
  console.log('  - AI model provider settings');
  console.log('  - Database connection');
  console.log('  - Client certificates');
  console.log('  - Commerce OAuth (if configured above)');
  console.log('• Generate agents/.env configuration file');
  console.log('  - AI model provider settings');
  console.log('  - MySQL connection for created apps');
  console.log('  - Getty Images proxy (optional)');
  console.log('  - Commerce OAuth (if configured above)');
  console.log('• Generate JWT keys for secure agent communication');
  console.log('• Start MySQL container (optional)');
  console.log('• Configure client certificates for GraphQL and TestPilot APIs');
  console.log('');

  if (!yesToAll) {
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
  }

  // Step 1: Check Docker dependencies
  const depChecker = new DependencyChecker();
  const dockerOk = await depChecker.checkAllDockerDependencies();

  if (!dockerOk) {
    console.log(chalk.red('\n❌ Docker dependencies not satisfied.'));
    console.log('Please install missing dependencies and run this setup again.');

    if (yesToAll) {
      console.log(chalk.red('Automated mode requires Docker. Exiting...'));
      process.exit(1);
    }

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

  // Step 2: Setup Development CA
  const caSetup = new CASetup(projectRoot);
  console.log(chalk.cyan('🔒 Development Certificate Authority Setup'));
  console.log('Setting up CA for trusted HTTPS certificates...\n');

  await caSetup.setup(yesToAll);

  printSeparator();

  // Step 3: Commerce Configuration (ask once for full setup)
  console.log(chalk.cyan('🛒 GoDaddy Commerce Configuration'));

  let configureCommerce = yesToAll;
  if (!yesToAll) {
    const response = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'configureCommerce',
        message: 'Would you like to enable and configure GoDaddy Commerce?',
        default: true
      }
    ]);
    configureCommerce = response.configureCommerce;
  } else {
    console.log(chalk.gray('Automated mode: attempting Commerce configuration...'));
  }

  let commerceResult = null;
  if (configureCommerce) {
    const commerceSetup = new CommerceConfigSetup();
    commerceResult = await commerceSetup.setup(yesToAll);

    if (!commerceResult.success) {
      const warningMsg = 'Commerce configuration failed. You can configure it later by running setup again.';
      setupWarnings.push(warningMsg);
      console.log(chalk.yellow(`⚠️  ${warningMsg}`));
      commerceResult = null;
    }
  }

  printSeparator();

  // Step 4: Environment Configuration
  const envGenerator = new EnvGenerator(projectRoot, setupWarnings);

  console.log(chalk.cyan('🔧 Environment Configuration'));
  console.log('Configuring .env files for the application...\n');

  let configureApp = yesToAll;
  if (!yesToAll) {
    const response = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'configureApp',
        message: 'Generate app/.env configuration?',
        default: true
      }
    ]);
    configureApp = response.configureApp;
  } else {
    console.log(chalk.gray('Generating app/.env with defaults...'));
  }

  if (configureApp) {
    await envGenerator.generateAppEnv(yesToAll, commerceResult);
  }

  let configureAgents = yesToAll;
  if (!yesToAll) {
    const response = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'configureAgents',
        message: 'Generate agents/.env configuration?',
        default: true
      }
    ]);
    configureAgents = response.configureAgents;
  } else {
    console.log(chalk.gray('Generating agents/.env with defaults...'));
  }

  if (configureAgents) {
    await envGenerator.generateAgentsEnv(yesToAll, commerceResult);
  }

  printSeparator();

  // Step 2.5: JWT Keys Generation
  console.log(chalk.cyan('🔐 JWT Keys Configuration'));
  console.log('JWT keys are required for secure communication between app and agents.\n');

  const jwtGenerator = new JWTKeysGenerator(projectRoot);
  const jwtStatus = await jwtGenerator.checkKeysConfigured();

  if (jwtStatus.app && jwtStatus.agents) {
    console.log(chalk.green('✅ JWT keys already configured'));

    if (!yesToAll) {
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
      console.log(chalk.gray('Keeping existing JWT keys...'));
    }
  } else {
    let generateKeys = yesToAll;
    if (!yesToAll) {
      const response = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'generateKeys',
          message: 'Generate JWT keys now?',
          default: true
        }
      ]);
      generateKeys = response.generateKeys;
    } else {
      console.log(chalk.gray('Generating JWT keys...'));
    }

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

    let startMySQL = yesToAll;
    if (!yesToAll) {
      const response = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'startMySQL',
          message: 'Start MySQL container now?',
          default: true
        }
      ]);
      startMySQL = response.startMySQL;
    } else {
      console.log(chalk.gray('Starting MySQL container...'));
    }

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

  // Step 4: Certificate Configuration
  let configureCerts = false;
  if (!yesToAll) {
    const response = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'configureCerts',
        message: 'Configure client certificates for GraphQL and TestPilot APIs?',
        default: true
      }
    ]);
    configureCerts = response.configureCerts;
  } else {
    console.log(chalk.gray('Skipping client certificates configuration in automated mode...'));
  }

  if (configureCerts) {
    const certSetup = new CertConfigSetup();
    await certSetup.setup();
  }

  printSeparator();

  // Step 5: Next Steps (only in interactive mode, bash script handles it in automated mode)
  if (!yesToAll) {
    console.log(chalk.green.bold('🎉 Setup Complete!'));
    console.log('');
    console.log(chalk.cyan('📋 Next Steps:'));
    console.log('');
    console.log('1. Install dependencies:');
    console.log(chalk.gray('   pnpm install  # Install all workspace dependencies'));
    console.log('');
    console.log('2. Run database migrations:');
    console.log(chalk.gray('   pnpm --filter website exec prisma migrate dev'));
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

  // Display warnings at the end (before bash script takes over)
  displaySetupWarnings();
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const yesToAll = args.includes('--yes-to-all');

    if (yesToAll) {
      await fullSetup(true);
    } else {
      const mode = await selectMode();

      if (mode === 'selective') {
        await selectiveConfiguration();
      } else {
        await fullSetup(false);
      }
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
