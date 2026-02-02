# Image Search Analysis Enhancement

**Date:** 2026-01-26
**Status:** Draft
**Author:** Claude + jeichorn

## Problem

Image search results from Getty often have poor relevance. Search terms don't always correlate with actual image content, leading to agents selecting unsuitable images.

## Solution

Analyze images returned from Getty using Claude Haiku vision, cache analysis in goknowb (`/airo_media`), and use semantic search to filter and re-rank results by relevance to the original search prompt.

## High-Level Flow

```
Agent Request
    ↓
┌─────────────────────────────────────┐
│  1. Parse request (prompt, count)   │
│  2. Fetch 2x images from Getty      │
│     (to allow for filtering)        │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  3. Extract Getty ID from each URL  │
│  4. Check goknowb cache for each ID │
│     - Cache hit: use stored analysis│
│     - Cache miss: analyze w/ Haiku  │
│  5. Store new analyses in goknowb   │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  6. Query goknowb with search prompt│
│     to get relevance scores         │
│  7. Filter images below 0.5 score   │
│  8. Re-rank by relevance            │
│  9. Return top N with metadata      │
└─────────────────────────────────────┘
```

## GoKnowb Cache Schema

**Storage location:** `/airo_media` kbNodeId

**Document format per image:**

```json
{
  "gettyId": "1234567890",
  "analysis": {
    "description": "A diverse group of coworkers collaborating around a laptop in a modern open-plan office with natural lighting",
    "composition": "subject-centered",
    "usageContext": "hero"
  },
  "getty": {
    "title": "Business team meeting",
    "keywords": ["teamwork", "office", "collaboration"],
    "dimensions": { "width": 5472, "height": 3648 },
    "orientation": "horizontal"
  },
  "urls": {
    "thumbnail": "https://media.gettyimages.com/..../thumb.jpg",
    "preview": "https://media.gettyimages.com/..../preview.jpg",
    "highRes": "https://media.gettyimages.com/..../highres.jpg"
  },
  "analyzedAt": "2026-01-26T12:00:00Z"
}
```

**Cache lookup:** Query goknowb with `gettyId:1234567890` to check for existing analysis.

**Relevance scoring:** Query goknowb with the original search prompt - goknowb returns matching documents with scores based on semantic similarity to the stored `description`.

## API Changes

### Updated MediaSearchOptions

```typescript
export interface MediaSearchOptions {
  prompt: string | string[];
  mediaType?: MediaType;
  count?: number; // Default: 5, Max: 10 (reduced from 50)

  // Existing filters
  orientations?: string;
  compositions?: string;
  color?: string;

  // New options
  analyzeImages?: boolean; // Default: true for image search
  relevanceThreshold?: number; // Default: 0.5, range 0-1
  skipCache?: boolean; // Force re-analysis, default: false
}
```

### Updated MediaSearchResult

```typescript
export interface MediaSearchResult {
  success: boolean;
  url?: string;
  urls?: string[];
  error?: string;

  // New fields
  images?: Array<{
    url: string;
    gettyId: string;
    relevanceScore: number;
    analysis: {
      description: string;
      composition: string;
      usageContext: string;
    };
    fromCache: boolean;
  }>;

  filtered?: number; // How many images were filtered out
}
```

## Error Handling

### Retry Strategy

```
goknowb/analysis failure
    ↓
┌─────────────────────────┐
│ Retry once (1s delay)   │
└─────────────────────────┘
    ↓ still failing
┌─────────────────────────┐
│ Return unanalyzed with  │
│ warning flag            │
└─────────────────────────┘
```

### Degraded Response

```typescript
{
  success: true,
  images: [{
    url: "https://...",
    gettyId: "123",
    relevanceScore: null,
    analysis: null,
    fromCache: false,
    analysisSkipped: true,
    skipReason: "goknowb_unavailable"
  }],
  warning: "Image analysis unavailable - returning unfiltered results"
}
```

### Partial Failure

- If 8/10 images analyze successfully, return the 8 with analysis
- Log failures but don't block the response
- Images that fail analysis are returned last (after ranked results)

## New Components

### File Structure

```
agents/src/
├── services/
│   └── ImageAnalysisService.ts    # New: orchestrates analysis + caching
├── tools/
│   ├── media-search-tool.ts       # Modified: integrate analysis
│   └── ai-lib-tools/
│       ├── media-tools.ts         # Modified: expose new options
│       └── drivers/
│           └── knowb-driver.ts    # Modified: add upload capability
```

### ImageAnalysisService

```typescript
class ImageAnalysisService {
  // Check goknowb cache for existing analysis
  async getCachedAnalysis(
    gettyIds: string[],
  ): Promise<Map<string, CachedAnalysis>>;

  // Analyze images with Haiku (reuses AssetProcessingService pattern)
  async analyzeImages(images: GettyImage[]): Promise<ImageAnalysis[]>;

  // Store analysis in goknowb
  async cacheAnalysis(analysis: ImageAnalysis[]): Promise<void>;

  // Score relevance using goknowb semantic search
  async scoreRelevance(
    prompt: string,
    analyses: ImageAnalysis[],
  ): Promise<ScoredImage[]>;

  // Main entry point
  async processSearchResults(
    prompt: string,
    images: GettyImage[],
    options: { threshold: number; maxResults: number },
  ): Promise<ProcessedImage[]>;
}
```

### KnowB Driver Extensions

```typescript
interface KnowBUploadOptions {
  kbNodeId: string; // "/airo_media"
  resourceId: string; // Getty ID as unique identifier
  content: string; // JSON stringified analysis
  metadata?: Record<string, unknown>;
}

interface KnowBUploadResult {
  success: boolean;
  resourceId?: string;
  error?: string;
}

class KnowBDriver extends BaseDriver {
  // Existing
  async search(options: KnowBSearchOptions): Promise<KnowBSearchResult>;

  // New
  async upload(options: KnowBUploadOptions): Promise<KnowBUploadResult>;

  // New - batch lookup by resourceId
  async getByIds(
    kbNodeId: string,
    ids: string[],
  ): Promise<Map<string, CachedDocument>>;
}
```

## Implementation Checklist

| File                                                    | Change                                 |
| ------------------------------------------------------- | -------------------------------------- |
| `agents/src/services/ImageAnalysisService.ts`           | New file - analysis orchestration      |
| `agents/src/tools/media-search-tool.ts`                 | Integrate ImageAnalysisService         |
| `agents/src/tools/ai-lib-tools/media-tools.ts`          | Expose new options in schema           |
| `agents/src/tools/ai-lib-tools/drivers/knowb-driver.ts` | Add `upload()` and `getByIds()`        |
| `proxy/src/routes/index.ts`                             | Verify `/v1/knowb/upload` route exists |

## Configuration

| Variable                     | Purpose          | Default |
| ---------------------------- | ---------------- | ------- |
| `IMAGE_ANALYSIS_ENABLED`     | Feature flag     | `true`  |
| `IMAGE_RELEVANCE_THRESHOLD`  | Filter threshold | `0.5`   |
| `IMAGE_SEARCH_DEFAULT_COUNT` | Default results  | `5`     |
| `IMAGE_SEARCH_MAX_COUNT`     | Max results      | `10`    |

## Key Decisions

| Decision          | Choice                                  | Rationale                                       |
| ----------------- | --------------------------------------- | ----------------------------------------------- |
| When to analyze   | At search time                          | Ensures agent always gets relevant results      |
| Cache key         | Getty image ID                          | Same image = same analysis regardless of search |
| kbNodeId          | `/airo_media`                           | Extensible to video analysis later              |
| Result count      | Configurable, default 5, max 10         | Reduced from 50 to improve quality              |
| Relevance scoring | goknowb semantic search                 | Reuses existing infrastructure                  |
| Filter threshold  | 0.5                                     | Aggressive filtering for quality                |
| Cache data        | Full (analysis + Getty metadata + URLs) | Maximize cached value                           |
| Error handling    | Retry then fail open                    | Maintain functionality when degraded            |
| Parallel search   | Shared analysis, per-prompt filtering   | Efficient, avoids duplicate analysis            |
| Analysis model    | Claude Haiku                            | Cost-efficient, consistent with website rebuild |
