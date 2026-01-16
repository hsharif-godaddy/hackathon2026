# Preview App Cross-Domain Authentication

## Overview

Preview apps use **site-scoped JWT tokens** for authentication. The builder generates JWTs that are:

- Signed by the builder using RS256 (RSA + SHA-256)
- Scoped to specific sites using `siteId` claim
- Validated against builder's public keys via JWKS endpoint
- Authorized by verifying user owns the site before issuance

This prevents authorization bypass attacks where a valid token for site A could access site B.

## Problem

Preview apps run on different domains than the builder app, causing a cross-domain cookie issue:

### Production

- **Builder**: `https://airo-builder.test-godaddy.com/`
  - Cookie domain: `.test-godaddy.com`
- **Preview**: `https://41gb5nrnyl.preview.c4.test-airoapp.ai/`
  - Cookie domain: `.test-airoapp.ai`

### Local Development

- **Builder**: `https://local.gasket.dev-godaddy.com:8443/`
  - Cookie domain: `.dev-godaddy.com`
- **Preview**: `http://localhost:${port}/`
  - Cookie domain: `localhost`

**The Issue**: GoDaddy SSO sets the `auth_idp` cookie on the builder's domain (`.test-godaddy.com` or `.dev-godaddy.com`). This cookie will NOT be sent by the browser when accessing preview apps on different domains.

## Solution: Site-Scoped JWT with Authorization Header Bootstrap

The authentication flow uses **site-scoped JWTs** issued by the builder:

1. **User authenticates** with GoDaddy SSO (sets cookie on builder domain)
2. **Builder generates** site-scoped JWT after verifying user owns the site
3. **Authorization header** sends JWT to preview app to bootstrap authentication
4. **Dev-supervisor validates** JWT signature, expiry, and siteId claim
5. **Cookie set** on preview domain for subsequent iframe requests

### Key Security Features:

- ✅ **Site-scoped**: JWT includes `siteId` claim validated by dev-supervisor
- ✅ **Authorization check**: Builder verifies ownership before issuing token
- ✅ **RS256 signatures**: Cryptographic validation using builder's public keys
- ✅ **Short-lived**: 12-hour expiry with automatic refresh
- ✅ **JWKS endpoint**: Public keys distributed via RFC 7517 standard endpoint

The authentication flow uses a **hybrid approach** that combines Authorization headers and cookies:

### 1. Token Generation (Builder)

When the builder needs to authenticate a preview app:

```typescript
// app/src/app/api/auth/token/route.ts
export const GET = withCustomerAuth(async (request, authContext) => {
  const siteId = request.nextUrl.searchParams.get("siteId");

  // CRITICAL: Verify user owns this site (prevents authorization bypass)
  await validateSiteAccess(siteId, authContext.user, authContext.jwt);

  // Generate site-scoped JWT signed by builder
  const jwtService = getJWTService();
  const result = await jwtService.createToken({
    siteId,
    canDownload: false,
    canPublish: false,
  });

  return NextResponse.json({ token: result.token });
});
```

### 2. Initial Request (Bootstrap)

When the builder app checks if a preview app is ready:

```typescript
// app/src/stores/useServerPollingStore.ts:_checkUrlHealth()

// Get site-scoped JWT from builder
const token = await getPreviewAppToken(appId);

// Send Authorization header to preview app
const response = await fetch(previewUrl, {
  method: "HEAD",
  credentials: "include",
  headers: {
    Authorization: `Bearer ${token}`, // Site-scoped JWT
  },
});
```

### 3. Cookie Setup (dev-supervisor)

When dev-supervisor receives the request with Authorization header:

```go
// dev-supervisor/jwt_middleware.go:Wrap()

// Extract token from Authorization header
token := ExtractTokenFromHeader(authHeader)

// Validate token using builder's JWKS endpoint
result := validator.ValidateToken(token)

if !result.Valid {
  handleAuthFailure(w, r, result.Reason)
  return
}

// CRITICAL: Validate siteId claim matches SITE_ID (authorization)
if result.Claims.SiteID != config.SiteID {
  handleAuthFailure(w, r, "token not valid for this site")
  return
}

// Set cookie on preview app's domain
http.SetCookie(w, &http.Cookie{
  Name:     "auth_idp",
  Value:    token,  // Site-scoped JWT
  Path:     "/",
  HttpOnly: true,
  Secure:   true,
  SameSite: http.SameSiteNoneMode,
  MaxAge:   43200,
})
```

### 4. Subsequent Requests (Cookie-Based)

Once the cookie is set on the preview app's domain, all subsequent requests (including iframe navigation) automatically include it:

```go
// dev-supervisor/jwt_middleware.go:Wrap()

// Fallback to cookie if no Authorization header (for iframe navigation)
if token == "" {
  if cookie, err := r.Cookie("auth_idp"); err == nil {
    token = cookie.Value
  }
}
```

The browser automatically sends the `auth_idp` cookie to the preview app because it's now on the same domain. The JWT is re-validated on every request, including siteId claim verification.

## Implementation Details

### Builder App (TypeScript)

**1. JWKS Endpoint (`/.well-known/jwks.json`)**

```typescript
// app/src/app/.well-known/jwks.json/route.ts
export async function GET() {
  const jwtService = getJWTService();
  const keyMetadata = await jwtService.getPublicKeys();

  const jwks = keyMetadata
    .filter((key) => key.status === "active" || key.status === "rotating")
    .map((key) => pemToJwk(key.publicKey, key.keyId));

  return NextResponse.json({ keys: jwks });
}
```

**2. Token Generation API (`/api/auth/token`)**

```typescript
// app/src/app/api/auth/token/route.ts
export const GET = withCustomerAuth(async (request, authContext) => {
  const siteId = request.nextUrl.searchParams.get("siteId");

  // Validate user owns this site
  await validateSiteAccess(siteId, authContext.user, authContext.jwt);

  // Generate site-scoped JWT
  const jwtService = getJWTService();
  const result = await jwtService.createToken({
    siteId,
    canDownload: false,
    canPublish: false,
  });

  return NextResponse.json({ token: result.token });
});
```

**3. Helper Function**

```typescript
// app/src/stores/useServerPollingStore.ts
async function getPreviewAppToken(siteId: string): Promise<string | null> {
  const response = await fetch(
    `/api/auth/token?siteId=${encodeURIComponent(siteId)}`,
    {
      method: "GET",
      credentials: "include",
    },
  );
  const data = await response.json();
  return data.token || null;
}
```

**4. Health Check**

```typescript
_checkUrlHealth: async (url: string, appId: string): Promise<boolean> => {
  const token = await getPreviewAppToken(appId);

  const response = await fetch(url, {
    method: "HEAD",
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  return response.ok || response.status < 500;
};
```

### Dev-Supervisor (Go)

**1. JWT Middleware**

- Handles OPTIONS preflight without auth
- Extracts token from Authorization header OR cookie
- Validates token using builder's JWKS endpoint
- **Validates siteId claim matches SITE_ID** (authorization check)
- Sets cookie on preview domain when Authorization header present
- Sets CORS headers for cross-origin requests

**2. JWKS Client**

- Fetches builder's public keys: `https://airo-builder.{env}-godaddy.com/.well-known/jwks.json`
- Caches public keys for 5 minutes
- Standard RFC 7517 JWKS format

**3. JWT Validator**

- Validates RS256 signatures using builder's public keys
- Validates issuer (`airo-app`) and audience (`agents-service`)
- Validates expiry timestamp
- Returns parsed claims for authorization check

## Configuration

### Docker Compose Environment Variables

```typescript
// app/src/lib/dev-environment/services/docker-compose-generator.ts

if (config.enableJwtAuth) {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://local.gasket.dev-godaddy.com:8443";
  const ssoLoginUrl =
    process.env.SSO_LOGIN_URL || "https://sso.dev-godaddy.com/login";

  // Builder JWKS Configuration
  env.DEV_SUPERVISOR_ENABLE_JWT_AUTH = "true";
  env.DEV_SUPERVISOR_JWKS_URL = `${appUrl}/.well-known/jwks.json`;
  env.DEV_SUPERVISOR_JWT_ISSUER = "airo-app";
  env.DEV_SUPERVISOR_JWT_AUDIENCE = "agents-service";

  // Smart redirect configuration
  env.DEV_SUPERVISOR_JWT_REDIRECT_URL = `${ssoLoginUrl}?app=airo-builder&redirect={url}`;
  env.DEV_SUPERVISOR_JWT_BUILDER_BASE_URL = appUrl;
  env.DEV_SUPERVISOR_JWT_EXCLUDED_PATHS = "/api/health";

  // SITE_ID is required for authorization check
  env.SITE_ID = config.appId;
}
```

### Extra Hosts (Local Development)

```typescript
// For local development, map builder hostname to host gateway
if (config.enableJwtAuth && appUrl.includes("local.gasket.dev-godaddy.com")) {
  extraHosts.push("local.gasket.dev-godaddy.com:host-gateway");
}
```

This allows containers to reach `https://local.gasket.dev-godaddy.com:8443/.well-known/jwks.json` with proper TLS certificate validation.

## Smart Redirects

When users access preview apps directly (not through the builder iframe), they need authentication. The system implements **smart redirects** that redirect users to the builder with that specific app open.

### How It Works

1. User accesses preview app directly (no auth cookie on that domain)
2. Dev-supervisor uses configured `AppID` environment variable
3. Redirects to builder with that specific app: `https://airo-builder.{env}-godaddy.com/develop/{appId}?siteId={appId}`

### Example

**Production:**

- User accesses: `https://41gb5nrnyl.preview.c4.test-airoapp.ai/`
- No auth → Redirect to SSO login
- After login → Smart redirect to `https://airo-builder.test-godaddy.com/develop/41gb5nrnyl?siteId=41gb5nrnyl`
- Builder opens that specific app
- Preview iframe loads with proper authentication

**Local Development:**

- User accesses: `https://localhost:5001/`
- No auth → Redirect to SSO login
- After login → Smart redirect to `https://local.gasket.dev-godaddy.com:8443/develop/41gb5nrnyl?siteId=41gb5nrnyl`
- Builder opens that specific app
- Preview iframe loads with proper authentication

### Implementation

**Configuration:**

```typescript
// docker-compose-generator.ts
env.DEV_SUPERVISOR_JWT_REDIRECT_URL = `${ssoLoginUrl}?app=airo-builder&redirect={url}`;
env.DEV_SUPERVISOR_JWT_BUILDER_BASE_URL = appUrl; // Builder base URL
env.DEV_SUPERVISOR_APP_ID = config.appId; // App ID for all environments
```

**Middleware Logic:**

```go
// jwt_middleware.go:buildSmartRedirectURL()
// Simple approach: Use AppID from environment (set for all preview apps)
if m.config.AppID == "" {
    return "" // Use default redirect
}
return fmt.Sprintf("%s/develop/%s?siteId=%s",
    builderBaseURL, m.config.AppID, m.config.AppID)
```

## Flow Diagrams

### Normal Flow (via Builder Iframe)

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User logs into GoDaddy SSO                              │
│    → auth_idp cookie set on .test-godaddy.com              │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Builder app health check                                │
│    → GET /api/auth/token (reads cookie from builder domain)│
│    → HEAD https://41gb5nrnyl.preview.c4.test-airoapp.ai/   │
│      Authorization: Bearer <token>                          │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Dev-supervisor JWT middleware                           │
│    → Validates token with GoDaddy SSO JWKS                 │
│    → Sets auth_idp cookie on .test-airoapp.ai              │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Builder app embeds iframe                               │
│    <iframe src="https://41gb5nrnyl.preview.c4..."/>        │
│    → Browser automatically sends auth_idp cookie           │
│    → Dev-supervisor validates using cookie                 │
└─────────────────────────────────────────────────────────────┘
```

### Smart Redirect Flow (Direct Access)

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User accesses preview app directly                      │
│    → https://41gb5nrnyl.preview.c4.test-airoapp.ai/        │
│    → No auth cookie (different domain)                     │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Dev-supervisor detects no authentication                │
│    → Parses appId from hostname using regex                │
│    → Builds smart redirect URL                             │
│    → Redirects to SSO with smart URL                       │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. SSO login                                                │
│    → User authenticates                                     │
│    → Cookie set on .test-godaddy.com                        │
│    → Redirects to builder app with appId                   │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Builder opens specific app                              │
│    → https://airo-builder.test-godaddy.com/develop/41gb... │
│    → Preview iframe loads with bootstrap auth flow         │
└─────────────────────────────────────────────────────────────┘
```

## Security Considerations

### Authorization (NEW)

1. **Site-scoped JWTs**: Each token includes `siteId` claim validated by dev-supervisor
2. **Ownership verification**: Builder validates user owns site before issuing token
3. **Prevents bypass**: A valid token for site A cannot access site B
4. **Authorization in middleware**: Dev-supervisor checks `siteId` claim on every request

### Authentication

1. **RS256 signatures**: Cryptographic validation using builder's private keys
2. **JWKS endpoint**: Public keys distributed via standard RFC 7517 endpoint
3. **Key rotation**: Supports active + rotating keys for zero-downtime rotation
4. **Token expiry**: 12-hour TTL with automatic refresh

### Transport Security

1. **HttpOnly Cookies**: Auth tokens stored in HttpOnly cookies, inaccessible to JavaScript
2. **Secure Flag**: Cookies marked Secure (HTTPS only)
3. **SameSite=None**: Required for cross-site iframe navigation
4. **CORS Headers**: Properly configured for cross-origin requests
5. **OPTIONS Preflight**: Handled without authentication (by design)

### Operational Security

1. **Key management**: Private keys stored in AWS Secrets Manager
2. **Key caching**: Public keys cached for 5 minutes to reduce load
3. **Audit logging**: Token issuance and validation logged for monitoring

## Testing

### Manual Test

1. Log into builder app (sets auth_idp on builder domain)
2. Create or open an app
3. Observe health check in Network tab - should show Authorization header
4. Observe preview iframe loads without SSO redirect
5. Check Application > Cookies - should see auth_idp on both domains

### Automated Test

```bash
# Check health endpoint with Authorization header
curl -H "Authorization: Bearer <token>" https://localhost:5001/ -I

# Check subsequent request with cookie
curl -H "Cookie: auth_idp=<token>" https://localhost:5001/ -I
```

## Troubleshooting

### Preview App Redirects to SSO

- **Cause**: Authorization header not sent on health check, or token fetch failed
- **Check**: Network tab for `/api/auth/token` and health check request
- **Fix**: Ensure auth_idp cookie exists on builder domain

### CORS Errors

- **Cause**: Missing CORS headers on JWT middleware responses
- **Check**: Response headers in Network tab
- **Fix**: Ensure SetCORSHeaders() called in returnError() and redirect()

### OPTIONS Request Fails

- **Cause**: JWT middleware trying to authenticate preflight requests
- **Check**: Should return 204 immediately for OPTIONS
- **Fix**: Ensure OPTIONS handling is before JWT validation

### Cookie Not Set on Preview Domain

- **Cause**: No Authorization header sent, or token validation failed
- **Check**: dev-supervisor logs for jwt.middleware events
- **Fix**: Verify JWKS URL, token validity, and dev-supervisor configuration
