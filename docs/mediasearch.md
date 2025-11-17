# Media Search

## Getty Images Integration

The media search tool provides professional stock images and videos using the Getty Images API for licensed commercial media content.

### Configuration

Requires the following environment variables in `agents/.env`:

```bash
# Getty Images Proxy Configuration
GETTY_API_URL=https://getty-images-proxy.api.test-godaddy.com
GETTY_TOKEN=your-getty-token-here
IMAGE_SEARCH_DRIVER=getty

# Optional: Legacy SSO JWT (if not using GETTY_TOKEN)
# SSO_JWT=your-sso-jwt-token
```

**Note:** `GETTY_API_URL` should be the base URL of the proxy without any path suffixes (e.g., `/img/search`). The paths `/v1/search`, `/v1/videos/search`, and `/v1/videos/upload` are automatically appended by the driver.

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

1. **Authentication**: Uses `GETTY_TOKEN` or `SSO_JWT` for API authentication
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
