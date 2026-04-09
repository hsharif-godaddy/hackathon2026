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

/**
 * Validate environment configuration
 */
async function validateEnvironment() {
  // AWS_PROFILE is expected in local dev for S2S auth (logo generation,
  // budget service, knowledge service, etc.). In non-local environments
  // it should not be set — it interferes with instance-profile credentials.
  const isLocal = (process.env.GASKET_ENV || '').startsWith('local') || process.env.NODE_ENV === 'development';
  if (process.env.AWS_PROFILE && !isLocal) {
    console.error('\n❌ AWS_PROFILE is set in your environment');
    console.error('   Please remove it before running the agents service\n');
    process.exit(1);
  }
}

/**
 * Validate GoCode API key for local development (not S2S)
 */
async function validateGoCodeKey() {
  const useS2S = process.env.GOCODE_USE_S2S_AUTH === 'true';

  // Skip validation if using S2S auth
  if (useS2S) {
    return;
  }

  // Detect which provider will be used (priority: Bedrock > Anthropic > OpenAI)
  let provider, apiKey, baseUrl;

  // Skip GoCode validation when AWS credentials indicate Bedrock usage
  // Do not infer Bedrock from AWS_REGION alone, as it's often set globally
  if (process.env.AWS_ACCESS_KEY_ID) {
    // Using Bedrock - no validation needed
    return;
  } else if (process.env.ANTHROPIC_API_KEY) {
    provider = 'anthropic';
    apiKey = process.env.ANTHROPIC_API_KEY;
    baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  } else if (process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL) {
    provider = 'openai';
    apiKey = process.env.OPENAI_API_KEY;
    baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  } else {
    // No provider configured
    return;
  }

  // Only validate if using GoCode proxy (not direct Anthropic/OpenAI)
  const isGoCode = baseUrl && (baseUrl.includes('gocode') || baseUrl.includes('localhost:8080'));
  if (!isGoCode) {
    return;
  }

  if (!apiKey) {
    const skipValidation = process.env.SKIP_GOCODE_KEY_VALIDATION === 'true';
    if (skipValidation) {
      console.warn(`\n⚠️  ${provider.toUpperCase()} base URL points to GoCode but no API key configured (SKIP_GOCODE_KEY_VALIDATION=true, skipping validation)\n`);
      return;
    }

    console.error(`\n❌ ${provider.toUpperCase()} base URL points to GoCode but no API key is configured`);
    console.error('   Please set the appropriate API key in your .env files or');
    console.error('   set SKIP_GOCODE_KEY_VALIDATION=true if you intentionally want to skip validation.\n');
    process.exit(1);
  }

  console.log(`🔍 Validating GoCode API key (using ${provider.toUpperCase()} compatibility layer)...`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${baseUrl}/key/info`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`\n❌ GoCode API key is invalid (${response.status})`);
      console.error(`   Provider: ${provider.toUpperCase()}`);
      console.error(`   Please check your ${provider.toUpperCase()}_API_KEY in .env files\n`);
      process.exit(1);
    }

    const data = await response.json();
    const info = data.info || {};
    const maxBudget = parseFloat(info.max_budget || 0);
    const spend = parseFloat(info.spend || 0);
    const remaining = maxBudget - spend;
    const percentUsed = maxBudget > 0 ? ((spend / maxBudget) * 100).toFixed(1) : 0;

    if (remaining <= 0) {
      console.error('\n❌ GoCode API key has no remaining budget');
      console.error(`   Provider: ${provider.toUpperCase()}`);
      console.error(`   Key: ${info.key_alias || info.key_name || 'N/A'}`);
      console.error(`   Max Budget: $${maxBudget.toFixed(2)}`);
      console.error(`   Spent: $${spend.toFixed(2)}`);
      console.error(`   Budget Duration: ${info.budget_duration || 'N/A'}`);
      if (info.budget_reset_at) {
        console.error(`   Resets: ${info.budget_reset_at}`);
      }
      console.error('');
      process.exit(1);
    }

    console.log(`✅ GoCode API key valid (${provider.toUpperCase()} compatibility layer)`);
    console.log(`   Key: ${info.key_alias || info.key_name || 'N/A'}`);
    console.log(`   Budget: $${remaining.toFixed(2)} remaining (${percentUsed}% used)\n`);
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('\n❌ GoCode API key validation timed out (5s)');
      console.error(`   The GoCode proxy at ${baseUrl} is not responding`);
      console.error('   Check if the proxy is running and accessible\n');
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      console.error('\n❌ Cannot connect to GoCode proxy');
      console.error(`   URL: ${baseUrl}`);
      console.error(`   Error: ${error.message}`);
      console.error('   Check if the proxy is running and the URL is correct\n');
    } else if (error.message.includes('JSON')) {
      console.error('\n❌ Invalid response from GoCode proxy');
      console.error(`   Expected JSON but got: ${error.message}`);
      console.error('   The proxy may be misconfigured or returning errors\n');
    } else {
      console.error(`\n❌ Failed to validate GoCode API key: ${error.message}`);
      console.error(`   Provider: ${provider.toUpperCase()}`);
      console.error(`   Check your ${provider.toUpperCase()}_BASE_URL and ${provider.toUpperCase()}_API_KEY configuration\n`);
    }
    process.exit(1);
  }
}

/**
 * Spawn the child process with signal handling.
 * In local dev, pipes stdout/stderr to both the terminal and a log file
 * so developers can share logs when troubleshooting.
 */
function spawnChildProcess() {
  const isLocalDev = (process.env.GASKET_ENV || '').startsWith('local');
  const logPath = path.join(agentsDir, 'dev.log');
  let logStream;

  if (isLocalDev) {
    logStream = fs.createWriteStream(logPath);
    logStream.on('error', (err) => {
      console.warn(`dev.log write error: ${err.message}`);
      logStream = null;
    });
    console.log(`📝 Logging output to ${logPath}\n`);
  }

  const child = spawn(command, commandArgs, {
    stdio: isLocalDev ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    env: { ...process.env, ...(isLocalDev ? { FORCE_COLOR: '1' } : {}) },
    shell: false
  });

  if (isLocalDev) {
    // eslint-disable-next-line no-control-regex
    const stripAnsi = (buf) => buf.toString().replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

    child.stdout.on('data', (data) => {
      process.stdout.write(data);
      if (logStream) logStream.write(stripAnsi(data));
    });
    child.stderr.on('data', (data) => {
      process.stderr.write(data);
      if (logStream) logStream.write(stripAnsi(data));
    });
  }

  // Guard to prevent double-exit from error and exit events
  let finished = false;

  function finalizeExit(code) {
    if (finished) return;
    finished = true;
    if (logStream) logStream.end();
    process.exit(code);
  }

  // Forward signals to child process
  // For Ctrl-C (SIGINT), the OS already delivers to all processes in the
  // foreground group. This forwarding handles programmatic signals (e.g., kill).
  function forwardSignal(sig) {
    if (!child || child.killed || child.exitCode !== null) return;
    try {
      child.kill(sig);
    } catch (err) {
      if (err.code !== 'ESRCH') {
        console.error(`Warning: Failed to forward signal ${sig}: ${err.message}`);
      }
    }
  }

  // Forward programmatic signals to child
  // SIGINT is excluded — the OS delivers it directly to all processes in the
  // foreground group on Ctrl-C. Forwarding it would cause double delivery.
  ['SIGTERM', 'SIGHUP', 'SIGQUIT'].forEach((sig) => {
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
}

// Run validation chain, then spawn child process
validateEnvironment()
  .then(validateGoCodeKey)
  .then(spawnChildProcess)
  .catch((error) => {
    console.error(`\n❌ Validation failed: ${error.message}`);
    process.exit(1);
  });
