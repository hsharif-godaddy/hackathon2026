#!/usr/bin/env node

/**
 * Environment-specific .env file loader and command executor
 * 
 * Automatically loads the correct .env file based on GASKET_ENV,
 * then executes the provided command with those environment variables.
 * 
 * GASKET_ENV determines which environment-specific file to load:
 * - GASKET_ENV=local.dev  → loads .env.local.dev
 * - GASKET_ENV=local.test → loads .env.local.test
 * - GASKET_ENV=local.prod → loads .env.local.prod
 * 
 * Loading order (later files override earlier):
 * 1. .env                    # Base defaults
 * 2. .env.{NODE_ENV}         # Next.js NODE_ENV file (e.g., .env.development)
 * 3. .env.local              # User overrides
 * 4. .env.{NODE_ENV}.local   # Next.js NODE_ENV.local (e.g., .env.development.local)
 * 5. .env.local.{env}        # Our GASKET_ENV file (highest priority)
 * 
 * IMPORTANT: This script loads env vars BEFORE Next.js starts.
 * - Next.js will load the same files again, but dotenv won't override existing vars
 * - Our values take precedence since we load first
 * - NEXT_PUBLIC_* vars should still be in standard Next.js files for build-time embedding
 * 
 * Usage:
 *   node scripts/load-env.js npm run local
 *   node scripts/load-env.js <any command>
 */

const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const appDir = path.resolve(__dirname, '../app');
const gasketEnv = process.env.GASKET_ENV || 'local.dev';
const nodeEnv = process.env.NODE_ENV || 'development';

// Extract the environment suffix (dev, test, prod)
const envSuffix = gasketEnv.replace('local.', '');

// Define the loading order (matches Next.js pattern but adds our custom files)
// Next.js will load these again but won't override (dotenv default behavior)
const envFiles = [
  path.join(appDir, '.env'),                    // 1. Base defaults
  path.join(appDir, `.env.${nodeEnv}`),         // 2. Next.js NODE_ENV file
  path.join(appDir, '.env.local'),              // 3. User overrides
  path.join(appDir, `.env.${nodeEnv}.local`),   // 4. Next.js NODE_ENV.local
  path.join(appDir, `.env.local.${envSuffix}`)  // 5. Our GASKET_ENV file (highest priority)
];

console.log('\n🔧 Loading environment configuration...');
console.log(`   GASKET_ENV: ${gasketEnv}`);

let filesLoaded = 0;

envFiles.forEach((filePath) => {
  if (fs.existsSync(filePath)) {
    const result = dotenv.config({ path: filePath, override: false });
    
    if (result.error) {
      console.error(`   Error loading ${path.basename(filePath)}: ${result.error.message}`);
    } else {
      filesLoaded++;
      console.log(`   Loaded: ${path.basename(filePath)}`);
    }
  } else {
    console.log(`   Skipped: ${path.basename(filePath)} (not found)`);
  }
});

if (filesLoaded === 0) {
  console.warn('\n    No .env files found - using system environment only\n');
} else {
  console.log(`\n   ✨ ${filesLoaded} environment file(s) loaded successfully\n`);
}

if (process.env.SSO_LOGIN_URL) {
  console.log('   Configuration detected:');
  console.log(`      SSO_LOGIN_URL: ${process.env.SSO_LOGIN_URL}`);
  console.log(`      LOGIN_REDIRECT_URL: ${process.env.LOGIN_REDIRECT_URL || '(not set)'}`);
  
  if (envSuffix === 'prod' && !process.env.JWT_PRIVATE_KEY) {
    console.warn('\n   WARNING: Running prod V2 without JWT_PRIVATE_KEY!');
    console.warn('      Agent API calls will fail. See GETTING_STARTED.md\n');
  }
  
  console.log('');
}

// Warn about NEXT_PUBLIC_ vars in GASKET_ENV files
const envFile = path.join(appDir, `.env.local.${envSuffix}`);
if (fs.existsSync(envFile)) {
  const envContent = fs.readFileSync(envFile, 'utf-8');
  if (envContent.includes('NEXT_PUBLIC_')) {
    console.warn('   WARNING: NEXT_PUBLIC_ vars detected in .env.local.' + envSuffix);
    console.warn('      These should be in standard Next.js files (.env.development, .env.production)');
    console.warn('      for proper build-time embedding.\n');
  }
}

// Get the command to execute from arguments
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Error: No command specified');
  console.error('Usage: node scripts/load-env.js <command> [args...]');
  process.exit(1);
}

// Execute the command with loaded environment
const [command, ...commandArgs] = args;

// Security: Whitelist allowed commands as an extra safety measure
const allowedCommands = ['npm', 'pnpm', 'node', 'npx', 'yarn'];
if (!allowedCommands.includes(command)) {
  console.error(`Error: Command "${command}" is not allowed`);
  console.error(`Allowed commands: ${allowedCommands.join(', ')}`);
  process.exit(1);
}

// Spawn without shell for better security
// Environment variables are passed directly via the env option
// No shell is needed - npm/pnpm/node are executable binaries on PATH
const child = spawn(command, commandArgs, {
  stdio: 'inherit',
  env: process.env,
  shell: false
});

child.on('exit', (code) => {
  process.exit(code);
});

