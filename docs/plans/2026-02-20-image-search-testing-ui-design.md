# Image Search Testing UI Design

**Goal:** Add a testing UI for the image-search-service to the debug-console, with JOMAX (GoDaddy employee) token authentication support.

**Approach:** Dual validator in image-search-service (accepts both airo-app JWTs and JOMAX tokens), standalone UI component in debug-console at `/image-search` route.

---

## Architecture Overview

```
User Browser
    │
    ▼
Debug Console UI (/image-search)
    │ POST /api/image-search
    ▼
Debug Console API Route
    │ Extracts JOMAX token from cookie
    │ POST /api/v1/search with Bearer token
    ▼
Image Search Service
    │ Detects JOMAX token
    │ Fetches key from sso.godaddy.com
    │ Validates signature
    ▼
Search Orchestrator
    │ Qdrant lookup + Getty API
    ▼
Response back up the chain
```

---

## Part 1: Image Search Service Auth Changes

### New Files

- `internal/auth/jomax.go` - JOMAX token validator
- `internal/auth/jomax_test.go` - Tests

### Modified Files

- `internal/auth/middleware.go` - Detect token type and route to correct validator
- `internal/config/config.go` - Add SSO host config

### Token Detection Logic

```go
// Decode JWT header+payload (without verification) to inspect claims
// JOMAX tokens have: per, jti, typ="jomax"
// Airo-app tokens have: siteId, canPublish, iss="airo-app"

func detectTokenType(token string) string {
    claims := decodeUnverified(token)
    if claims["iss"] == "airo-app" {
        return "airo-app"
    }
    if claims["per"] != nil || claims["typ"] == "jomax" {
        return "jomax"
    }
    return "unknown"
}
```

### JOMAX Validation Flow

1. Extract `kid` from JWT header
2. Fetch public key from `https://sso.{env}.godaddy.com/v1/api/key/{kid}`
3. Cache key for 24 hours (keys are long-lived)
4. Verify RS256 signature
5. Check `exp` claim for expiration

### Config Additions

| Variable   | Default           | Description                       |
| ---------- | ----------------- | --------------------------------- |
| `SSO_HOST` | `sso.godaddy.com` | GoDaddy SSO host for key fetching |

---

## Part 2: Debug Console UI

### New Files

- `debug-console/src/app/image-search/page.tsx` - Route page (protected)
- `debug-console/src/components/ImageSearchPanel.tsx` - Main component (standalone)
- `debug-console/src/app/api/image-search/route.ts` - API proxy to pass JOMAX token

### Page Structure

```
/image-search
├── Header with link back to main debug console
├── Search Controls
│   ├── Text input for search query
│   ├── Filters: cached only / live only / all
│   └── Search button
├── Results Gallery
│   ├── Grid of image thumbnails (Getty preview URLs)
│   ├── Each shows: image, title, relevance score, cached badge
│   └── Click to expand details
└── Image Detail Panel (expandable)
    ├── Larger preview
    ├── Getty ID, title, keywords
    ├── Analysis data (if cached)
    └── Raw JSON toggle
```

### API Proxy Pattern

The debug-console backend proxies requests to image-search-service, forwarding the JOMAX token from the user's cookie:

```typescript
// debug-console/src/app/api/image-search/route.ts
export async function POST(request: NextRequest) {
  const token = gdAuthService.extractTokenFromRequest(request);

  const response = await fetch(`${IMAGE_SEARCH_URL}/api/v1/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: await request.text(),
  });

  return NextResponse.json(await response.json());
}
```

### Navigation

- Add "Image Search" link to debug console header (next to Analytics link)

---

## Part 3: Error Handling

| Error                     | HTTP Status | UI Display                         |
| ------------------------- | ----------- | ---------------------------------- |
| Not authenticated         | 401         | Redirect to SSO login              |
| JOMAX token expired       | 401         | "Session expired, please refresh"  |
| Image search service down | 503         | "Image search service unavailable" |
| Invalid search query      | 400         | Show validation message            |
| No results                | 200         | "No images found for query"        |

---

## Part 4: Configuration

### Debug Console

| Variable                   | Default                 | Description              |
| -------------------------- | ----------------------- | ------------------------ |
| `IMAGE_SEARCH_SERVICE_URL` | `http://localhost:8080` | Image search service URL |

### Image Search Service

| Variable   | Default           | Description                             |
| ---------- | ----------------- | --------------------------------------- |
| `SSO_HOST` | `sso.godaddy.com` | GoDaddy SSO host for JOMAX key fetching |

---

## Standalone Extraction Notes

The UI is designed for easy extraction to a separate application:

- `ImageSearchPanel.tsx` has no dependencies on other debug-console components
- Only needs: auth token, service URL
- Can be moved to separate app by copying component + API route
- All image-search-specific code is isolated in:
  - `src/app/image-search/` (route)
  - `src/components/ImageSearchPanel.tsx` (component)
  - `src/app/api/image-search/` (API proxy)
