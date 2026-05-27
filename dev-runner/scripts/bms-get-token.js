#!/usr/bin/env node
// Generates an IAM S2S JWT token for calling the remote dev BMS.
// Uses gd-auth-client from packages/ai-lib/node_modules/ via the developer's
// AWS SSO credentials (ambient from AWS_PROFILE environment variable).
//
// Outputs the raw JWT to stdout. Exits non-zero on failure with message to stderr.

const path = require('path');

let IamTokenClient;
try {
  // Try require.resolve first (handles hoisted deps and various pnpm layouts)
  ({ IamTokenClient } = require(require.resolve('gd-auth-client', {
    paths: [path.resolve(__dirname, '..', '..', 'packages', 'ai-lib')]
  })));
} catch {
  // Fallback: direct nested node_modules path
  try {
    const gdAuthPath = path.resolve(__dirname, '..', '..', 'packages', 'ai-lib', 'node_modules', 'gd-auth-client');
    ({ IamTokenClient } = require(gdAuthPath));
  } catch {
    process.stderr.write('gd-auth-client not found. Run pnpm install first.\n');
    process.exit(1);
  }
}

// Force the correct AWS profile for the dev BMS IAM token.
// The developer's shell may have a different AWS_PROFILE set (e.g. a personal account).
// dev-runner's preflight already validates this profile is authenticated (AWSSSOCheck).
process.env.AWS_PROFILE = 'airobuild-dev-private-sso';

const ssoHost = process.env.BMS_SSO_HOST || 'sso.dev-godaddy.com';

const client = new IamTokenClient(ssoHost);
client.getToken()
  .then(token => {
    process.stdout.write(token);
  })
  .catch(err => {
    const msg = err.message || String(err);
    if (msg.includes('expired') || msg.includes('refresh')) {
      process.stderr.write('AWS SSO session expired. Run: aws sso login --profile airobuild-dev-private-sso\n');
    } else {
      process.stderr.write('Failed to get S2S token: ' + msg + '\n');
    }
    process.exit(1);
  });
