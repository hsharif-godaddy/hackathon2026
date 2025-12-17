# Scripts Directory

This directory contains various utility scripts for development, security auditing, and maintenance of the Airo Builder project.

## Security Scripts

### CORS Configuration Audit

Tools for auditing and verifying CORS (Cross-Origin Resource Sharing) configurations.

#### `audit-cors-config.js`

Scans the entire codebase to identify CORS configuration issues.

**Usage:**

```bash
node scripts/audit-cors-config.js
```

**What it checks:**

- Wildcard origins only in public endpoints
- No "fail open" configurations
- Localhost origins have environment checks
- ALLOWED_ORIGINS handling in main CORS config
- Origin validation callbacks
- Docker and Nomad configurations

**Exit codes:**

- `0` - Audit passed (no critical or high priority issues)
- `1` - Audit failed (critical or high priority issues found)

#### `verify-cors-production.js`

Tests a live production agents service to verify CORS headers are configured correctly.

**Usage:**

```bash
# Basic usage
node scripts/verify-cors-production.js https://your-production-agents-url.com

# Verbose output
node scripts/verify-cors-production.js https://your-production-agents-url.com --verbose

# Test local development
node scripts/verify-cors-production.js http://localhost:4000 --verbose
```

**What it tests:**

- Malicious origins (should be rejected)
- Localhost origins (should be rejected in production)
- Server-to-server requests (no origin header, should be allowed)
- Preflight OPTIONS requests
- Authenticated endpoint access

**Exit codes:**

- `0` - All tests passed
- `1` - One or more tests failed or security issues detected

**Documentation:** See [docs/cors-security-guide.md](../docs/cors-security-guide.md) for complete CORS configuration guide.

#### `verify-cors-batch.js`

Tests CORS configuration for multiple production agents in parallel.

**Usage:**

```bash
# Basic usage
node scripts/verify-cors-batch.js app1,app2,app3

# With higher concurrency
node scripts/verify-cors-batch.js app1,app2,app3 --concurrency 10

# Verbose output
node scripts/verify-cors-batch.js app1,app2,app3 --verbose
```

**What it tests:**

For each agent:

- Malicious origin (should be rejected)
- Server-to-server request (no origin, should be allowed)

**Features:**

- Parallel testing with configurable concurrency (default: 5)
- Progress indicators during batch run
- Summary with passed/failed/skipped/error counts
- Detailed reporting for failed agents

**Exit codes:**

- `0` - All tests passed
- `1` - One or more agents failed CORS verification

---

### `check-tools-security.js`

Scans the `agents/src/tools/` directory for dangerous process execution patterns to ensure tool security.

**Usage:**

```bash
node scripts/check-tools-security.js
```

**What it detects:**

- Direct `child_process` module usage
- `exec()`, `execSync()` calls (except via dev-supervisor)
- `spawn()`, `spawnSync()` calls
- `fork()` calls
- `execFile()`, `execFileSync()` calls

**Why it matters:**
Tools should not execute arbitrary commands in the agent container. All command execution must route through the dev-supervisor API for proper containerization and security isolation.

**Exit codes:**

- `0` - No security violations found
- `1` - Security violations detected

---

## Authentication & Security

### `generate-jwt-keys.js`

Generates RSA key pairs for JWT signing and verification.

**Usage:**

```bash
node scripts/generate-jwt-keys.js
```

**Output:**

- RSA 2048-bit key pair
- Private key for signing (keep secure!)
- Public key for verification (can be public)
- Environment variable format for easy setup
- Writes keys to `./keys/` directory if writable

**Environment Variables Generated:**

```bash
JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n..."
```

**Security Notes:**

- Keep `JWT_PRIVATE_KEY` secure and never expose it
- `JWT_PUBLIC_KEY` can be public (exposed via JWKS endpoint)
- Use secure secret management in production (AWS Secrets Manager, K8s secrets, etc.)
- Rotate keys periodically

---

## License Management

### `license-check.sh`

Validates that all dependencies use approved open-source licenses.

**Usage:**

```bash
# From project root
./scripts/license-check.sh

# For specific package
MATRIX_PACKAGE=agents ./scripts/license-check.sh
MATRIX_PACKAGE=app ./scripts/license-check.sh
```

**Allowed Licenses:**

- MIT
- Apache-2.0
- BSD-3-Clause
- BSD-2-Clause
- ISC
- BlueOak-1.0.0
- Unlicense

**Features:**

- Automatically detects and excludes internal packages (`@godaddy/*`, `@ux/*`, `gd-*`)
- Package-specific exclusions for workspace packages
- Configurable dependency depth checking
- Generates `licenses-report.txt` with full details

**Exit codes:**

- `0` - All licenses are approved
- `1` - Unapproved licenses found

**Requirements:**

- `license-checker` npm package (auto-installed if missing)
- `jq` for JSON parsing

---

## CI/CD Integration

### CORS Audit

Add to your CI pipeline:

```yaml
- name: Audit CORS Configuration
  run: node scripts/audit-cors-config.js

- name: Verify Production CORS (post-deploy)
  run: node scripts/verify-cors-production.js https://agents.yourdomain.com
```

### Tools Security Check

```yaml
- name: Check Tools Security
  run: node scripts/check-tools-security.js
```

### License Check

```yaml
- name: Check Licenses
  run: ./scripts/license-check.sh
```

---

## Development Workflow

### Before Committing

1. Run security checks:

   ```bash
   node scripts/check-tools-security.js
   ```

2. Verify CORS configuration:

   ```bash
   node scripts/audit-cors-config.js
   ```

3. Check licenses (if dependencies changed):
   ```bash
   ./scripts/license-check.sh
   ```

### Before Deploying

1. Audit CORS:

   ```bash
   node scripts/audit-cors-config.js
   ```

2. Generate JWT keys (first deployment only):

   ```bash
   node scripts/generate-jwt-keys.js
   ```

3. Verify production after deployment:
   ```bash
   node scripts/verify-cors-production.js https://your-agents-url.com
   ```

---

## Troubleshooting

### Permission Denied

Make scripts executable:

```bash
chmod +x scripts/*.sh scripts/*.js
```

### Module Not Found

Scripts use Node.js built-in modules and should work without `npm install`. If you see module errors, ensure you're running from the project root.

### CORS Verification Connection Errors

Check:

1. Is the target URL accessible?
2. Is the service running?
3. Are there firewall rules blocking the connection?
4. Is the URL correct (https vs http)?

---

## Contributing

When adding new scripts:

1. Add executable permissions: `chmod +x scripts/your-script.js`
2. Include a header comment explaining what the script does
3. Add usage documentation to this README
4. Include exit codes (0 for success, 1 for failure)
5. Make scripts safe to run multiple times (idempotent)
6. Update changelog if the script affects production workflows
