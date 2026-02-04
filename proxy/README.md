# Getty Images API Proxy

A secure proxy for Getty Images API with token-based authentication.

### Katana

Create new Dev build/deploy
https://github.com/gdcorp-partners/airo-app-builder/actions/workflows/aws-deploy-proxy.yml

Promote to higher env using
https://katana.int.gdcorp.tools/apps/airobuilde/proxy

## Quick Start

### Environment Variables

```bash
# Required
VALID_TOKENS=token1,token2,token3

# Optional
PORT=8888
GETTY_IMAGES_UPSTREAM=https://getty-images-proxy.api.godaddy.com
SSO_ENDPOINT=https://sso.godaddy.com/v1/secure/api/token
```

### Docker

```bash
# Build and run
docker compose up proxy

# Or build manually
docker build -t airo-proxy .
docker run -p 8888:8888 -e VALID_TOKENS=your-tokens airo-proxy
```

### Local Development

```bash
# Install dependencies (run from monorepo root)
cd /path/to/airo-app-builder
pnpm install

# Build (from proxy directory)
cd proxy
pnpm run build

# Start
pnpm start
```

## API Endpoints

### Search Images

```bash
GET /img/search?phrase=cats&page=1&pageSize=10
Authorization: Bearer your-token
```

### Health Check

```bash
GET /health
```

## Testing

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch
```

### Test Configuration

Tests use Jest with the following setup:

- **Test Setup File** (`tests/setup.ts`): Automatically loaded before tests via `setupFiles` in `package.json`. Sets critical environment variables needed for tests:

  - `VALID_TOKENS`: Test authentication tokens (fake values only)
  - `GETTY_IMAGES_UPSTREAM`: Test Getty API endpoint
  - `SSO_ENDPOINT`: Test SSO endpoint
  - `LOG_LEVEL`: Controls log verbosity during tests

- **Mocks** (`__mocks__/`): Provides test doubles for Node.js modules:
  - `fs.ts`: Mocks filesystem operations (certificate checks). Required because `server.ts` validates certificate existence on import.
  - `https.ts`: Mocks HTTPS server creation. Required because `server.ts` starts an HTTPS server during module initialization, not just for testing HTTPS functionality.

**IMPORTANT**: All test credentials and endpoints are fake values that must NOT match production. See security warning in `tests/setup.ts`.

## Certificate Setup

Get certs from here https://katana.int.gdcorp.tools/apps/airobuilde/proxy/environment/dev-private-ecs/variables

Provide Getty API certificates via environment variables:

```bash
# Option 1: Individual certificate content
GETTY_CERT="-----BEGIN CERTIFICATE-----..."
GETTY_KEY="-----BEGIN PRIVATE KEY-----..."

# Option 2: Mount files to /app/certs/
# - getty-client.crt
# - getty-client.key
```

# TODO

Switch AWS IAM JWT token validation?
