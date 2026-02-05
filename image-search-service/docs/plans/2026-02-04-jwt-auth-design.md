# JWT Authentication for Image Search Service

**Goal:** Add JWT authentication to protect API endpoints, accepting the same tokens used by the agents service.

**Approach:** Validate JWTs signed by GoDaddy SSO using public keys from JWKS endpoint. Shared service model (no site isolation for now).

---

## Architecture

The image-search-service will add JWT authentication middleware that:

1. **Extracts** the Bearer token from `Authorization` header
2. **Fetches** the public key from the JWKS endpoint (with caching)
3. **Validates** the JWT signature (RS256), expiration, issuer (`airo-app`), and audience (`agents-service`)
4. **Allows** the request to proceed if valid, returns 401 if not

**Auth modes:**

- `AUTH_TYPE=jwt` - Full validation (production)
- `AUTH_TYPE=none` - Skip auth entirely (local development)

**New files:**

- `internal/auth/jwt.go` - JWT validation logic + JWKS client
- `internal/auth/middleware.go` - HTTP middleware

---

## JWT Validation Flow

**Validation steps** (in order):

1. Check `Authorization` header exists and starts with `Bearer `
2. Decode JWT header (without verification) to extract `kid` (key ID)
3. Fetch public key from JWKS endpoint using `kid` (cache for 30 days)
4. Verify signature using RS256 algorithm
5. Validate claims:
   - `iss` == `"airo-app"`
   - `aud` == `"agents-service"`
   - `exp` > current time (not expired)

**Error responses:**

- Missing/malformed token → `401 Unauthorized`
- Invalid signature → `401 Unauthorized`
- Expired token → `401 Unauthorized`
- JWKS fetch failure → `503 Service Unavailable` (temporary)

**Dependencies:**

- `github.com/golang-jwt/jwt/v5` - JWT parsing and validation
- Standard library for HTTP/crypto (JWKS fetching, key conversion)

---

## Route Protection

| Route                      | Auth Required      |
| -------------------------- | ------------------ |
| `/api/v1/health`           | No (health checks) |
| `/api/v1/stats`            | No (monitoring)    |
| `/api/v1/search`           | Yes                |
| `/api/v1/images/{gettyId}` | Yes                |
| `/api/v1/images/batch`     | Yes                |

---

## Configuration

**New config fields:**

| Variable    | Default                                                       | Description                |
| ----------- | ------------------------------------------------------------- | -------------------------- |
| `AUTH_TYPE` | `jwt`                                                         | Auth mode: "jwt" or "none" |
| `JWKS_URL`  | `https://airo-builder.test-godaddy.com/.well-known/jwks.json` | JWKS endpoint              |

---

## JWKS Caching

- In-memory map of `kid` → public key
- 30-day TTL per key (new keys have new `kid`, so cache miss handles rotation)
- On cache miss: fetch from JWKS endpoint, find matching `kid`, cache result

---

## Future Considerations

- Site isolation (`siteId` claim validation) when customer image uploads are added
- Separate audience claim (`image-search-service`) if stricter token scoping needed
