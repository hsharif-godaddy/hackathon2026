#!/usr/bin/env node

/**
 * Environment-specific .env file loader for agents service
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
 * 2. .env.local              # User overrides
 * 3. .env.local.{env}        # GASKET_ENV file (highest priority)
 *
 * Usage:
 *   node agents/load-env.cjs pnpm run dev
 *   node agents/load-env.cjs <any command>
 */

const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const agentsDir = __dirname;
const gasketEnv = process.env.GASKET_ENV || 'local.dev';

// Extract the environment suffix (dev, test, prod)
const envSuffix = gasketEnv.replace('local.', '');

// Define the loading order
const envFiles = [
  path.join(agentsDir, '.env'),                    // 1. Base defaults
  path.join(agentsDir, '.env.local'),              // 2. User overrides
  path.join(agentsDir, `.env.local.${envSuffix}`)  // 3. GASKET_ENV file (highest priority)
];

console.log('\n🔧 Loading agents environment configuration...');
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
  console.warn('\n⚠️  No .env files found - using system environment only\n');
} else {
  console.log(`\n✨ ${filesLoaded} environment file(s) loaded successfully\n`);
}

// Display key configuration
if (process.env.JWKS_URL) {
  console.log('   Configuration detected:');
  console.log(`      JWKS_URL: ${process.env.JWKS_URL}`);
  console.log(`      AUTH_TYPE: ${process.env.AUTH_TYPE || 'none'}`);
  console.log('');
}

// Get the command to execute from arguments
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Error: No command specified');
  console.error('Usage: node agents/load-env.cjs <command> [args...]');
  process.exit(1);
}

// Execute the command with loaded environment
const [command, ...commandArgs] = args;

// Security: Whitelist allowed commands
const allowedCommands = ['npm', 'pnpm', 'node', 'npx', 'yarn', 'tsx'];
if (!allowedCommands.includes(command)) {
  console.error(`Error: Command "${command}" is not allowed`);
  console.error(`Allowed commands: ${allowedCommands.join(', ')}`);
  process.exit(1);
}

// Spawn without shell for better security
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
