# Getty Images Proxy API Authentication

## Current Implementation

The image-search-service uses the **airo-builder proxy** (Option A below) with pluggable authentication.

**Environment Variables:**
```bash
GETTY_UPSTREAM=https://airobuilde-proxy-dev-private-ecs.airobuilde-dev-private.prod.onkatana.net
GETTY_TOKEN=<from-secrets-manager>
GETTY_X_APP_KEY=image-search-service
```

**To get GETTY_TOKEN:**
```bash
aws secretsmanager get-secret-value \
  --secret-id /Katana/Secrets/airobuilde/app/dev-private-ecs/GETTY_TOKEN \
  --profile airobuild-dev-private-sso \
  --query "SecretString" --output text
```

Or use the setup utility:
```bash
pnpm --filter airo-setup start
# Select "Configure Image Search Service (.env)"
```

**Pluggable Auth Architecture:**
The `internal/getty/auth.go` file defines an `AuthProvider` interface allowing different auth strategies:
- `BearerTokenAuth` - Current implementation for airo-builder proxy
- `SSOJWTAuth` - Placeholder for future direct Getty proxy access

---

## Overview

The GoDaddy Getty Images proxy (`https://getty-images-proxy.api.test-godaddy.com`) uses **SSO JWT + mTLS certificate authentication**.

This is NOT a simple Bearer token system. It requires:
1. Client certificates to authenticate with GoDaddy SSO
2. An SSO JWT token obtained from GoDaddy SSO using those certificates
3. An `x-app-key` header identifying the application

## Architecture

```
image-search-service
    │
    │ 1. POST /v1/secure/api/token (with client cert)
    ▼
GoDaddy SSO (sso.test-godaddy.com)
    │
    │ Returns: JWT token
    ▼
image-search-service
    │
    │ Authorization: sso-jwt <jwt-token>
    │ x-app-key: hosting-dev
    ▼
Getty Images Proxy (getty-images-proxy.api.test-godaddy.com)
    │
    ▼
Getty Images API
```

## Required Headers

```
Authorization: sso-jwt <jwt-token>
x-app-key: hosting-dev
User-Agent: image-search-service/1.0
```

## How to Get the SSO JWT Token

### Option 1: Using gd-auth-client (Node.js)

```typescript
import { getTokenFromCertificate } from 'gd-auth-client';

// Read client certificates
const cert = fs.readFileSync('/path/to/getty-client.crt', 'utf8');
const key = fs.readFileSync('/path/to/getty-client.key', 'utf8');

// Get JWT token from SSO
const ssoHost = 'sso.test-godaddy.com'; // or 'sso.godaddy.com' for prod
const jwtToken = await getTokenFromCertificate(ssoHost, cert, key);

// Use token in request
const response = await fetch('https://getty-images-proxy.api.test-godaddy.com/v1/search?phrase=office&pageSize=10', {
  headers: {
    'Authorization': `sso-jwt ${jwtToken}`,
    'x-app-key': 'hosting-dev',
    'User-Agent': 'my-service/1.0'
  }
});
```

### Option 2: Direct SSO API Call (Any Language)

```bash
# This requires mTLS - client certificate auth
curl -X POST "https://sso.test-godaddy.com/v1/secure/api/token" \
  --cert /path/to/getty-client.crt \
  --key /path/to/getty-client.key \
  -H "Content-Type: application/json"
```

The response contains a JWT token to use in subsequent requests.

## Client Certificates

The client certificates are required for SSO authentication:

- `getty-client.crt` - Client certificate
- `getty-client.key` - Client private key

**Where to get them:**
- Katana: https://katana.int.gdcorp.tools/apps/airobuilde/proxy/environment/dev-private-ecs/variables
- They may be stored as environment variables or files

## Example Request to Getty Proxy

Once you have the JWT token:

```bash
curl -X GET "https://getty-images-proxy.api.test-godaddy.com/v1/search?phrase=office&pageSize=10" \
  -H "Authorization: sso-jwt eyJhbGciOiJSUzI1NiIs..." \
  -H "x-app-key: hosting-dev" \
  -H "User-Agent: image-search-service/1.0"
```

## Environment-Specific URLs

| Environment | SSO Host | Getty Proxy |
|-------------|----------|-------------|
| Test | sso.test-godaddy.com | getty-images-proxy.api.test-godaddy.com |
| Production | sso.godaddy.com | getty-images-proxy.api.godaddy.com |

## Search Parameters

| Parameter | Type | Default | Notes |
|-----------|------|---------|-------|
| `phrase` | string | required | Search term |
| `page` | number | 1 | Page number |
| `pageSize` | number | 25 | Max 100 |
| `sortOrder` | string | - | Sort order |
| `orientations` | string | - | e.g., "Horizontal" |
| `compositions` | string | - | e.g., "CopySpace" |

## Implementation Options for image-search-service

### Option A: Use the airo-builder Proxy (Recommended for now)

The `/proxy` directory contains a proxy that handles the SSO authentication for you. It accepts a simpler Bearer token auth:

```bash
curl -X GET "https://airobuilde-proxy-dev-private-ecs.airobuilde-dev-private.prod.onkatana.net/v1/search?phrase=office&pageSize=10" \
  -H "Authorization: Bearer <token-from-VALID_TOKENS>"
```

The token must be in the proxy's `VALID_TOKENS` environment variable.

### Option B: Implement SSO Auth Directly in Go

To call the Getty proxy directly, the image-search-service would need to:

1. **Add a Go SSO client** that:
   - Reads client certificates
   - Makes mTLS request to GoDaddy SSO
   - Caches JWT tokens (they expire after ~50 minutes)
   - Handles token refresh

2. **Update the Getty client** to:
   - Get JWT token from SSO client
   - Send `Authorization: sso-jwt <token>` header
   - Send `x-app-key: hosting-dev` header

This requires the client certificates to be available to the service.

### Option C: Use the agents service's approach

Check how the agents service calls Getty. It may use the airo-builder proxy or have its own SSO integration.

## Token Lifecycle

- JWT tokens from SSO expire (typically ~50 minutes based on the `exp` claim)
- The proxy caches tokens and refreshes them automatically
- On 401 errors, clear the token cache and retry

## Response Format

```json
{
  "result_count": 1234,
  "images": [
    {
      "id": "12345678",
      "title": "Image title",
      "caption": "Image caption",
      "display_sizes": [
        {"name": "thumb", "uri": "https://..."},
        {"name": "preview", "uri": "https://..."},
        {"name": "comp", "uri": "https://..."}
      ],
      "max_dimensions": {
        "width": 5000,
        "height": 3000
      }
    }
  ]
}
```

## Error Responses

### 401 - Invalid/Missing SSO Token
```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing SSO JWT token"
}
```

### 400 - Missing x-app-key
```json
{
  "status": 400,
  "message": "Missing x-app-key"
}
```

## Summary

The Getty Images proxy requires SSO JWT authentication obtained via mTLS client certificates. This is significantly more complex than simple API key authentication.

For the image-search-service, the options are:
1. **Use the airo-builder proxy** (simpler, but adds a hop)
2. **Implement SSO auth in Go** (direct, but requires certificate management)
