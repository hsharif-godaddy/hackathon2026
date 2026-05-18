# Media Search

## Getty Images Integration

The media search tool provides professional stock images and videos using the Getty Images API for licensed commercial media content.

### Configuration

Agents call the GoDaddy Getty Images proxy **directly** (no `airo-proxy` hop on
this path). Common bases include `https://getty-images-proxy.api.dev-godaddy.com`
(dev direct), `https://api.test-godaddy.com/getty-proxy`, and
`https://api.godaddy.com/getty-proxy`. Set **`GETTY_IMAGE_PROXY_URL`** when the
default below is wrong for your environment.

**Authentication** — `GettyMediaDriver` and `GettyUploadService` use
**`BaseDriverV2`** (`agents/src/tools/ai-lib-tools/drivers/base-driver-v2.ts`):

- **IAM / S2S**: `GOCODE_USE_S2S_AUTH=true`. JWTs come from `getS2SToken()` /
  `refreshS2SToken()` with **`SSO_HOST`** as the issuer host when set, otherwise
  **`sso.test-godaddy.com`**. Local dev usually relies on Gasket’s `SSO_HOST`
  (for example `sso.dev-godaddy.com`) plus an AWS SSO profile such as
  `airobuild-dev-private-sso` after `aws sso login` (see dev-runner Getty
  preflight).
- **Raw jomax JWT**: `SSO_JWT=<token>` sends `Authorization: sso-jwt <token>`
  without IAM minting.

User-facing log/search error copy for missing setup lives in
**`agents/src/tools/ai-lib-tools/drivers/getty-config-messages.ts`** — keep it
aligned with dev-runner Getty messaging.

```bash
# Required: enable the Getty driver
IMAGE_SEARCH_DRIVER=getty

# Recommended (matches dev-runner Getty fixer / agents defaults):
GOCODE_USE_S2S_AUTH=true
# AWS_PROFILE=airobuild-dev-private-sso

# Issuer host for IAM mint (optional; Gasket local.dev often sets this)
# SSO_HOST=sso.dev-godaddy.com

# Instead of IAM, use a GoDaddy jomax JWT for this process:
# SSO_JWT=<your-jomax-jwt>

# Proxy base URL (optional). Base only; trailing slashes are stripped.
# When unset, agents default to:
#   https://getty-images-proxy.api.dev-godaddy.com
# GETTY_IMAGE_PROXY_URL=https://api.test-godaddy.com/getty-proxy
# GETTY_IMAGE_PROXY_URL=https://api.godaddy.com/getty-proxy

# GETTY_APP_KEY=airo-app-builder
```

**`GETTY_API_URL`**: replaced by **`GETTY_IMAGE_PROXY_URL`** (same role: proxy
base only).

**`GETTY_TOKEN` (legacy Bearer)**: not used by `BaseDriverV2` Getty flows. If it
is still set, **`GettyUploadService`** logs a warning on construction; remove
it to clear the warning.

### Implementation

The `MediaSearchTool` class provides a unified interface for searching both images and videos using the Getty Images driver (`GettyMediaDriver`). It supports:

**Image Search:**

- Single or multiple prompts
- Multiple results per prompt (configurable count)
- Parallel searches with multiple prompts
- Default media type when not specified

**Video Search:**

- Single prompt only (no parallel searches)
- Returns one video per search
- Requires explicit `mediaType: 'video'` parameter
- Two-step process: search for video ID, then upload to get final URL

### Media Types

The tool supports two media types:

- `image` (default) - Professional stock photography
- `video` - Professional stock video footage

### Getty Media Driver (`GettyMediaDriver`)

**Location:** `agents/src/tools/ai-lib-tools/drivers/getty-media-driver.ts`

The underlying Getty API integration is implemented in `GettyMediaDriver`. This driver handles:

1. **Authentication**: With `GOCODE_USE_S2S_AUTH=true`, an IAM JWT is minted and
   sent as `Authorization: sso-jwt <jwt>`; with `SSO_JWT` set, that value is sent
   directly. Token lifecycle (cache, expiry refresh, one 401 retry) lives in
   `BaseDriverV2`. User-facing setup strings live in
   `agents/src/tools/ai-lib-tools/drivers/getty-config-messages.ts` (keep in
   sync with dev-runner Getty preflight).
2. **Image Search**: Direct search and retrieval of image URLs
3. **Video Search**: Two-step process
   - Step 1: Search for videos via `/v1/videos/search` endpoint
   - Step 2: Upload request via `/v1/videos/upload` endpoint to get final video URL
4. **Error Handling**: Comprehensive error handling and logging
5. **Response Processing**: Normalizes Getty API responses into consistent format

### API Endpoints

The proxy exposes these endpoints for Getty integration:

- `GET /v1/search` - Search for images
- `GET /v1/videos/search` - Search for videos (returns video ID)
- `POST /v1/videos/upload` - Upload video ID to get final video URL
- `POST /v1/upload` - Upload images to CDN (used by `GettyUploadService`)
- `PUT /v1/usage` - Report image usage (used by `GettyUploadService`)

### Usage Examples

**Image Search (single prompt):**

```typescript
await findMedia({
  prompt: "sunset over ocean",
  count: 3, // Optional, returns 3 images
});
```

**Image Search (multiple prompts):**

```typescript
await findMedia({
  prompt: ["sunset over ocean", "mountain landscape"],
  count: 2, // 2 images per prompt
});
```

**Video Search:**

```typescript
await findMedia({
  prompt: "abstract technology background",
  mediaType: "video", // Must be explicit
});
```

### Migration from Legacy Tools

The `MediaSearchTool` replaces the previous separate `ImageSearchTool` and `VideoSearchTool` implementations. The old tools have been deprecated in favor of this unified interface.

**Key Changes:**

- Single tool for both images and videos
- Simplified API with `mediaType` parameter
- Consistent response format across media types
- Centralized validation and error handling
- Driver moved to `ai-lib-tools/drivers/` for better organization
