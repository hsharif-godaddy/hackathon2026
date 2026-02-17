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

// Check AWS SSO login status for Switchboard (only when AUTH_TYPE=jwt)
const authType = process.env.AUTH_TYPE?.toLowerCase();
const isJWTMode = !authType || authType === 'jwt';

if (isJWTMode && process.env.AWS_PROFILE) {
  const { execFileSync } = require('child_process');

  console.log('   Checking AWS SSO login status...');
  console.log(`      AWS_PROFILE: ${process.env.AWS_PROFILE}`);

  try {
    // Test if AWS credentials are available by calling STS get-caller-identity
    // This will fail if SSO session is expired or not logged in
    // Using execFileSync (not execSync) to avoid shell interpretation for security
    execFileSync(
      'aws',
      ['sts', 'get-caller-identity', '--profile', process.env.AWS_PROFILE],
      { stdio: 'pipe', encoding: 'utf-8', timeout: 5000 }
    );
    console.log('      ✅ AWS SSO session is active\n');
  } catch (error) {
    // Differentiate between AWS CLI not found vs SSO session issues
    const isAwsNotFound = error.code === 'ENOENT';

    if (isAwsNotFound) {
      console.error('\n   ❌ ERROR: AWS CLI is not installed!');
      console.error('');
      console.error('   Install AWS CLI to use SSO authentication:');
      console.error('      https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html');
      console.error('');
      console.error('   Or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY instead.\n');
    } else {
      console.error('\n   ❌ ERROR: AWS SSO session is not active or expired!');
      console.error('');
      console.error('   This will cause Switchboard authentication to fail with:');
      console.error('      "Token Management Error: Unable to obtain token from SSO"');
      console.error('');
      console.error('   To fix this, run:');
      console.error(`      aws sso login --profile ${process.env.AWS_PROFILE}`);
      console.error('');
      console.error('   Then restart the dev server.');

      // Log actual error for debugging (stderr output from AWS CLI)
      if (error.stderr) {
        console.error('');
        console.error('   Debug details:');
        console.error(`      ${error.stderr.toString().trim()}`);
      }
      console.error('');
    }
    process.exit(1);
  }
} else if (isJWTMode && !process.env.AWS_PROFILE) {
  console.warn('\n   WARNING: AUTH_TYPE=jwt but AWS_PROFILE is not set!');
  console.warn('      Switchboard authentication may fail.');
  console.warn('      Set AWS_PROFILE in your .env file or shell:');
  console.warn('         export AWS_PROFILE=airobuild-dev-private-sso\n');
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
// Use detached on POSIX to create process group for proper signal forwarding
const child = spawn(command, commandArgs, {
  stdio: 'inherit',
  env: process.env,
  shell: false,
  ...(process.platform !== 'win32' && { detached: true })
});

// Guard to prevent double-exit from error and exit events
let finished = false;

function finalizeExit(code) {
  if (finished) return;
  finished = true;
  process.exit(code);
}

// Forward signals to child process (or process group on POSIX)
function forwardSignal(sig) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    // On POSIX systems, forward to process group to catch grandchildren
    // On Windows, only direct child kill is supported
    if (process.platform !== 'win32') {
      process.kill(-child.pid, sig);
    } else {
      child.kill(sig);
    }
  } catch (err) {
    // Only ignore ESRCH (process doesn't exist) - log other errors
    if (err.code !== 'ESRCH') {
      console.error(`Warning: Failed to forward signal ${sig}: ${err.message}`);
    }
  }
}

// Forward common signals to child
// SIGINT (Ctrl+C), SIGTERM (kill), SIGHUP (terminal disconnect), SIGQUIT (Ctrl+\)
['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'].forEach((sig) => {
  process.on(sig, () => forwardSignal(sig));
});

// Handle child process exit
child.on('exit', (code, signal) => {
  if (signal) {
    // Child was killed by signal - exit with 128 + signal number
    // This follows standard Unix convention for signal-based termination
    const os = require('os');
    const sigNum = os.constants.signals[signal] || 0;
    finalizeExit(128 + (sigNum || 1));
  } else {
    // Exit with child's exit code (default to 0 if null/undefined)
    finalizeExit(code ?? 0);
  }
});

// Handle spawn errors (e.g., command not found)
child.on('error', (error) => {
  console.error(`Failed to start command '${command}': ${error.message}`);
  finalizeExit(1);
});

