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
# Install dependencies
pnpm install

# Build
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