# CORS Security Guide

Complete guide for CORS (Cross-Origin Resource Sharing) configuration, auditing, and verification in the Airo App Builder project.

## Overview

The Airo App Builder uses a multi-service architecture where the main app (port 3000) makes cross-origin requests to the agents service (port 4000). Proper CORS configuration is critical for security.

### Security Requirements

1. **Never fail open**: CORS must never allow all origins in production
2. **Explicit allowlist**: Origins must be explicitly allowed via `ALLOWED_ORIGINS` environment variable
3. **Environment-aware**: Development and production must have different configurations
4. **No wildcards**: Wildcard (`*`) origins should only be used for truly public endpoints (e.g., JWKS)

## Current CORS Configuration

### Agents Service

Located in: `agents/src/server/middleware/cors.ts`

**Behavior:**

- **Production** (when `ALLOWED_ORIGINS` is set):
  - Only allows origins in the `ALLOWED_ORIGINS` environment variable
  - Rejects all other origins with CORS error
- **Development** (when `NODE_ENV=development` and `ALLOWED_ORIGINS` is not set):
  - Falls back to: `localhost:3000`, `localhost:3001` (http and https)
  - Still validates origins against this list

- **Server-to-Server** (no `Origin` header):
  - Allows requests without Origin header (curl, server-to-server, etc.)

**Key Features:**

- Origin validation callback with explicit allowlist checking
- Credentials support enabled
- Proper preflight handling
- 24-hour preflight cache

### App Service

The Next.js app service primarily makes requests TO the agents service, so it's the client side of CORS. However:

- The JWKS endpoint (`/.well-known/jwks.json`) uses wildcard CORS as it's a public standard
- Other endpoints use Next.js defaults

## Tools

### 1. CORS Configuration Audit Script

**Location:** `scripts/audit-cors-config.js`

Scans the entire codebase to identify CORS configuration issues.

**Usage:**

```bash
node scripts/audit-cors-config.js
```

**What it checks:**

- ✅ Wildcard origins only in public endpoints
- ✅ No "fail open" configurations
- ✅ Localhost origins have environment checks
- ✅ ALLOWED_ORIGINS handling in main CORS config
- ✅ Origin validation callbacks
- ✅ Docker and Nomad configurations
- ✅ Proper error handling for invalid origins

**Exit codes:**

- `0` - Audit passed (no critical or high priority issues)
- `1` - Audit failed (critical or high priority issues found)

**Output:**

The script produces a detailed report with:

- Critical issues (must fix immediately)
- High priority issues (should fix soon)
- Medium priority issues (consider fixing)
- Warnings (review recommended)
- Security recommendations

### 2. Production CORS Verification Tool

**Location:** `scripts/verify-cors-production.js`

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

1. **Malicious origins** - Should be rejected
   - `https://malicious-site.com`
   - `http://malicious-site.com`
   - `https://example.com`

2. **Localhost origins** - Should be rejected in production
   - `http://localhost:3000`
   - `https://localhost:3000`

3. **No origin** - Should be allowed (server-to-server)
   - Requests without Origin header

**For each origin, it tests:**

- GET request to `/health` endpoint
- OPTIONS preflight request to `/agents` endpoint
- GET request to authenticated endpoint `/agents`

**Exit codes:**

- `0` - All tests passed
- `1` - One or more tests failed or security issues detected

**Output:**

The tool produces a detailed report including:

- Test results for each origin
- CORS headers received
- Security assessment
- Configuration recommendations
- Expected production configuration

## Environment Variables

### Required for Production

```bash
# Agents Service (.env)
NODE_ENV=production
ALLOWED_ORIGINS=https://your-app.com,https://app.your-domain.com
```

### Development

```bash
# Agents Service (.env)
NODE_ENV=development
# ALLOWED_ORIGINS not required - falls back to localhost:3000,localhost:3001
```

## CI/CD Integration

### Running in CI

Add to your CI pipeline:

```yaml
- name: Audit CORS Configuration
  run: node scripts/audit-cors-config.js
```

### Pre-deployment Verification

Before deploying to production:

```bash
# Verify staging environment
node scripts/verify-cors-production.js https://staging-agents.your-domain.com

# Verify production after deployment
node scripts/verify-cors-production.js https://agents.your-domain.com
```

## Security Best Practices

1. **Principle of Least Privilege**
   - Only allow origins that absolutely need access
   - Use specific URLs, not domain wildcards

2. **Environment Separation**
   - Different ALLOWED_ORIGINS for dev/staging/production
   - Never use development origins in production

3. **Regular Audits**
   - Run audit script before each deployment
   - Verify production CORS after deployments
   - Review ALLOWED_ORIGINS quarterly

4. **Monitoring**
   - Monitor CORS-related errors in logs
   - Alert on unexpected CORS rejections
   - Track which origins are making requests

5. **Documentation**
   - Document all allowed origins and why
   - Keep ALLOWED_ORIGINS in secure environment variables
   - Review changes to CORS configuration carefully

## Additional Resources

- [MDN CORS Documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- [OWASP CORS Security](https://cheatsheetseries.owasp.org/cheatsheets/CORS_Cheat_Sheet.html)
- Main CORS config: `agents/src/server/middleware/cors.ts`
- Nomad deployment: `app/src/lib/nomad/job-template.ts`
- Docker config: `app/src/lib/dev-environment/services/docker-container-manager.ts`

## Contributing

When modifying CORS configuration:

1. Run the audit script first to understand current state
2. Make your changes
3. Run the audit script again to verify no issues introduced
4. Test locally with verification tool
5. Update this documentation if behavior changes
6. Add changelog entry for the changes
