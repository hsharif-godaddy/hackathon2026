# Image Search Service Design

**Date:** 2026-02-02
**Status:** Draft
**Author:** Claude + jeichorn

## Problem

The current image search implementation has two key issues:

1. **Image analysis is slow** (7-10 seconds per image via Haiku) - requires robust caching and parallelism management
2. **Knowb isn't a hybrid solution** - no easy way to search by ID, filter by tags/metadata, or combine filters with semantic search

## Solution

Build a new dedicated Go service (`image-search-service`) that:

- Owns the full image/video search lifecycle
- Uses Qdrant for hybrid vector + metadata search
- Uses S3 as durable backup (source of truth for reindexing)
- Manages rate limiting and parallelism for Getty API and Haiku analysis
- Returns cached results immediately when sufficient, otherwise waits up to timeout

## Architecture Overview

```
Agent Request
    ↓
image-search-service (Go)
    ├── Getty API (rate limited)
    ├── Qdrant (hybrid search: vector + metadata filters)
    ├── Haiku Analysis (rate limited, queued)
    └── S3 (durable backup)
    ↓
Response (cached or wait-for-analysis)
```

## Query Requirements

**Must-have:**

1. Direct lookup by Getty ID
2. Getty ID + metadata filters (orientations, compositions, tags, etc.)
3. Pre-filtered semantic search (semantic search within filtered subset)

**Nice-to-have:** 4. Tag/keyword browsing without semantic relevance

## Enhanced Analysis Schema

Getty's API returns sparse metadata (just id, URLs, dimensions, title, caption). Rich filtering metadata comes from two sources:

1. **Haiku analysis** - Semantic understanding of image content
2. **Programmatic extraction** - Color palette extraction using node-vibrant

### Analysis Fields

**Subject Focus (Haiku):**

- `primarySubject` - What the image is actually about ("two people shaking hands")
- `subjectCategory` - High-level category (people, workspace, technology, nature, abstract, food)
- `activity` - What's happening (meeting, working, celebrating, relaxing, none)
- `settingType` - Where (office, home, outdoor, studio, abstract background)

**Color (Mixed Sources):**

- `dominantColors` - Top 3 hex codes _(programmatic - node-vibrant)_
- `colorMood` - warm / cool / neutral / vibrant / muted _(derived from dominantColors)_
- `textSafeColors` - light-only / dark-only / either / neither _(Haiku - for text overlay)_
- `backgroundType` - solid, gradient, complex, transparent _(Haiku)_

**Composition (Haiku):**

- `composition` - Where visual interest is (left, right, center, full, top, bottom)
- `copySpaceLocation` - Where text could go (top, bottom, left, right, center, none)
- `copySpaceAmount` - high / medium / low / none
- `visualComplexity` - minimal / moderate / busy

**People (Haiku):**

- `peopleCount` - 0, 1, 2-3, 4+
- `peopleFocus` - Are people the subject? (primary, secondary, background, none)

**Mood (Haiku):**

- `tone` - professional, casual, energetic, calm, serious, playful

**Usage (Haiku):**

- `usageContext` - hero, icon, logo, background, product, profile, decorative, content, general

**Style (Haiku):**

- `authenticityStyle` - stock / editorial / candid / artistic / documentary
- `aspectRatioCategory` - square / landscape / portrait / panoramic / vertical-banner

## Service Architecture

### Directory Structure

```
image-search-service/
├── cmd/server/main.go        # Entry point, config loading
├── internal/
│   ├── api/                  # HTTP handlers, JWT validation
│   ├── getty/                # Getty API client, rate limiter
│   ├── analysis/             # Haiku client, rate limiter
│   ├── storage/
│   │   ├── qdrant/           # Vector + metadata queries
│   │   └── s3/               # Durable backup
│   ├── workers/
│   │   ├── analyzer.go       # Analysis worker pool
│   │   └── backfill.go       # Background batch processing
│   └── queue/                # Request queue, backpressure
└── pkg/
    └── models/               # Shared types (analysis schema, etc.)
```

### Worker Pools

| Pool          | Purpose            | Concurrency   | Rate Limit       |
| ------------- | ------------------ | ------------- | ---------------- |
| Getty         | API searches       | 10 concurrent | 50 req/sec (TBD) |
| Analyzer      | Haiku vision calls | 5 concurrent  | 20 req/sec (TBD) |
| S3 Writer     | Backup persistence | 3 concurrent  | None             |
| Qdrant Writer | Index updates      | 5 concurrent  | None             |

### Backpressure

- Bounded channel between Getty results and Analyzer pool
- When Analyzer pool is saturated, Getty search handler slows (natural backpressure)
- If queue exceeds threshold, new requests get 503 with `Retry-After` header

## Storage Layer

### Qdrant Collection Schema

Collection: `image_analyses`

```json
{
  "id": "getty-123456789",
  "vector": [0.1, 0.2, ...],
  "payload": {
    "gettyId": "123456789",
    "title": "Business team meeting",
    "dimensions": {"width": 5000, "height": 3333},
    "orientation": "horizontal",

    "primarySubject": "four colleagues around conference table",
    "subjectCategory": "people",
    "activity": "meeting",
    "settingType": "office",
    "dominantColors": ["#2C3E50", "#ECF0F1", "#3498DB"],
    "colorMood": "cool",
    "backgroundType": "complex",
    "copySpaceLocation": "none",
    "copySpaceAmount": "low",
    "visualComplexity": "moderate",
    "peopleCount": "4+",
    "peopleFocus": "primary",
    "tone": "professional",
    "composition": "center",
    "usageContext": "hero",

    "thumbnailUrl": "...",
    "previewUrl": "...",
    "highResUrl": "...",

    "analyzedAt": "2026-02-02T10:30:00Z",
    "analysisVersion": "1"
  }
}
```

**Embedding vector generated from:** Concatenation of `primarySubject` + `description` + `activity` + `settingType`

### S3 Backup Structure

```
s3://image-analysis-backup/
└── analyses/
    └── v1/
        └── getty-123456789.json
```

One JSON file per image. Version prefix (`v1/`) allows schema migrations.

## Request Flow

### Search Request

```
POST /api/v1/search
Authorization: Bearer <customer-agent-jwt>
```

```json
{
  "query": "professional team meeting in modern office",
  "count": 10,
  "filters": {
    "orientations": ["horizontal", "square"],
    "subjectCategory": ["people", "workspace"],
    "peopleCount": ["2-3", "4+"],
    "peopleFocus": ["primary"],
    "tone": ["professional"],
    "copySpaceAmount": ["medium", "high"],
    "colorMood": ["cool", "neutral"]
  },
  "minCachedResults": 5,
  "maxWaitSeconds": 30
}
```

### Response Strategy

1. **Getty Search** - Query Getty API, get ~2x requested images
2. **Qdrant Lookup** - Check which Getty IDs have cached analyses
3. **Sufficiency Check:**
   - If cached ≥ `minCachedResults` → return immediately, queue uncached for background
   - If cached < `minCachedResults` → proceed to wait mode
4. **Wait Mode** - Enqueue uncached for analysis, wait until:
   - Enough results ready (cached + newly analyzed ≥ count)
   - Timeout reached
5. **Return** - Whatever's ready, sorted by relevance score

### Response Format

```json
{
  "results": [
    {
      "gettyId": "123456789",
      "urls": {
        "thumbnail": "...",
        "preview": "...",
        "highRes": "..."
      },
      "relevanceScore": 0.87,
      "analysis": {
        "primarySubject": "four colleagues discussing around whiteboard",
        "composition": "left",
        "copySpaceLocation": "right",
        "tone": "professional"
      },
      "fromCache": true
    }
  ],
  "meta": {
    "total": 10,
    "cached": 8,
    "analyzed": 2,
    "filtered": 5,
    "complete": true,
    "pendingAnalysis": 0
  }
}
```

## API Endpoints

| Endpoint                   | Method | Purpose                           |
| -------------------------- | ------ | --------------------------------- |
| `/api/v1/search`           | POST   | Search images/videos with filters |
| `/api/v1/images/{gettyId}` | GET    | Direct lookup by ID               |
| `/api/v1/images/batch`     | POST   | Batch lookup by IDs               |
| `/api/v1/health`           | GET    | Health check                      |
| `/api/v1/stats`            | GET    | Queue depths, cache hit rate      |

## Authentication

- **Incoming requests:** Customer agent JWT passed through, validated
- **Getty API:** Service manages credentials via AWS SSO JWT (same as proxy)
- **Haiku API:** S2S gocode path via AWS SSO JWT
- **Haiku costs:** Platform cost, not per-customer credits

## Configuration

```bash
# Service
PORT=8080
LOG_LEVEL=info

# Getty API
GETTY_UPSTREAM=https://api.gettyimages.com
GETTY_APP_KEY=...

# Haiku/Claude (S2S auth)
ANTHROPIC_API_URL=...
SSO_HOST=sso.godaddy.com

# Qdrant
QDRANT_HOST=qdrant.internal
QDRANT_PORT=6334
QDRANT_COLLECTION=image_analyses

# S3
S3_BUCKET=image-analysis-backup-prod
S3_REGION=us-west-2

# Rate limits
GETTY_RATE_LIMIT_RPS=50
HAIKU_RATE_LIMIT_RPS=20
HAIKU_CONCURRENCY=5

# Response behavior
DEFAULT_MIN_CACHED=5
DEFAULT_MAX_WAIT_SECONDS=30

# Elastic APM
ELASTIC_APM_SERVER_URL=https://apm.godaddy.com
ELASTIC_APM_SERVICE_NAME=image-search-service
ELASTIC_APM_ENVIRONMENT=prod
```

## Observability

### Elastic APM Integration

**HTTP Handler Pattern:**

```go
import "go.elastic.co/apm/module/apmhttprouter/v2"

router.POST("/api/v1/search", apmhttprouter.Wrap(
    decorate(s.Search, authMW, logMW, panicMW),
    "/api/v1/search",
))
```

**Internal Spans:**

```go
span, ctx := apm.StartSpan(ctx, "GettySearch", "getty")
span.Context.SetLabel("query", query)
defer span.End()

span, ctx := apm.StartSpan(ctx, "QdrantBatchLookup", "qdrant")
span.Context.SetLabel("idCount", len(ids))
defer span.End()

span, ctx := apm.StartSpan(ctx, "HaikuImageAnalysis", "anthropic")
span.Context.SetLabel("gettyId", gettyId)
defer span.End()
```

### Key Metrics

- `getty.search.duration` - Getty API latency
- `qdrant.lookup.duration` - Cache lookup time
- `qdrant.cache.hit_rate` - % of images found in cache
- `analysis.queue.depth` - Pending analysis count
- `analysis.duration` - Per-image Haiku analysis time
- `search.wait.duration` - Time spent waiting for analysis

## Integration with Agents

### New Flow

```
Agent → MediaSearchTool → ImageSearchServiceClient → image-search-service
```

### Changes to agents/

1. **New client:** `agents/src/clients/ImageSearchServiceClient.ts`
2. **Update MediaSearchTool:** Replace direct Getty + ImageAnalysisService calls
3. **Keep ImageAnalysisService:** Still needed for site scraping/rebuild flows
4. **Video search:** Also moves to this service

### Feature Flag

- `IMAGE_SEARCH_SERVICE_ENABLED` controls routing
- Allows gradual rollout and instant rollback

## Migration & Rollout Plan

### Phase 0: Analysis Quality Evaluation

- Build test harness for analysis on diverse sample set (100-200 images)
- Include: various subjects, compositions, orientations, edge cases
- Human evaluation of accuracy:
  - Is `primarySubject` correct?
  - Is `peopleCount` accurate?
  - Is `copySpaceLocation` useful?
  - Are `dominantColors` reasonable?
- Iterate on prompt until quality is acceptable
- Output: Finalized prompt, baseline metrics, sample outputs for regression

### Phase 1: Build & Deploy (no traffic)

- Build image-search-service
- Deploy to staging with Qdrant + S3
- Verify endpoints with manual testing
- Optional: pre-warm cache with popular images

### Phase 2: Shadow Mode

- `IMAGE_SEARCH_SERVICE_ENABLED=shadow`
- MediaSearchTool calls both old and new in parallel
- Compare results, log discrepancies
- New results discarded, old results returned
- Monitor latency, error rates

### Phase 3: Canary Rollout

- `IMAGE_SEARCH_SERVICE_ENABLED=canary`
- 10% of searches route to new service
- Monitor cache hit rates, queue depth, response times
- Instant rollback if issues

### Phase 4: Full Rollout

- `IMAGE_SEARCH_SERVICE_ENABLED=true`
- All image + video searches through new service
- Old Knowb cache becomes read-only fallback

### Phase 5: Cleanup

- Remove feature flag
- Remove Knowb image analysis code from agents
- Delete `/airo_media` Knowb node
- Archive old code (keep site scraping methods)

### Rollback Triggers

- Error rate > 5%
- P95 latency > 10s
- Analysis queue depth > 1000 (sustained)

## Future Considerations

- **Per-user image analysis:** Service currently handles Getty/stock images only. User-uploaded image analysis is a future phase.
- **Schema versioning:** `analysisVersion` field allows re-processing when prompt/schema changes
- **Migration to pgvector:** S3 backup enables easy reindexing if we switch from Qdrant

## Key Decisions

| Decision          | Choice                   | Rationale                                                   |
| ----------------- | ------------------------ | ----------------------------------------------------------- |
| Language          | Go                       | Better concurrency primitives for workqueues, rate limiting |
| Vector DB         | Qdrant                   | Native hybrid search (vector + payload filters)             |
| Backup            | S3                       | Portable, cheap, enables reindexing and env sync            |
| Auth              | JWT passthrough          | Consistent with existing agent auth patterns                |
| Haiku costs       | Platform                 | Shared resource, not per-customer                           |
| Response strategy | Cache-sufficient or wait | Fast when warm, graceful when cold                          |
