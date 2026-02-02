# Image Search Analysis Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enhance image search with AI analysis, goknowb caching, and relevance-based filtering/ranking.

**Architecture:** New `ImageAnalysisService` orchestrates cache lookup, Haiku vision analysis, goknowb storage, and relevance scoring. Integrates with existing `MediaSearchTool` via optional `analyzeImages` flag.

**Tech Stack:** TypeScript, Claude Haiku (via ai-lib), goknowb RAG API, Getty Images API

---

## Task 1: Add KnowB Driver Upload Method

**Files:**

- Modify: `agents/src/tools/ai-lib-tools/drivers/knowb-driver.ts`
- Test: `agents/src/tools/__tests__/knowb-driver.test.ts` (new)

**Step 1: Write the failing test**

Create `agents/src/tools/__tests__/knowb-driver.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KnowBDriver } from "../ai-lib-tools/drivers/knowb-driver.js";

describe("KnowBDriver", () => {
  let driver: KnowBDriver;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    process.env.GETTY_API_URL = "https://test-proxy.example.com";
    process.env.GETTY_TOKEN = "test-token";
    driver = new KnowBDriver();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.GETTY_API_URL;
    delete process.env.GETTY_TOKEN;
  });

  describe("upload", () => {
    it("should upload content to goknowb", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi
          .fn()
          .mockResolvedValue({ success: true, resourceId: "getty-123" }),
        text: vi.fn().mockResolvedValue('{"success":true}'),
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await driver.upload({
        kbNodeId: "/airo_media",
        resourceId: "getty-123",
        content: JSON.stringify({ description: "test image" }),
        metadata: { type: "image_analysis" },
      });

      expect(result.success).toBe(true);
      expect(result.resourceId).toBe("getty-123");
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/v1/knowb/upload"),
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("should handle upload errors gracefully", async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue("Internal Server Error"),
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await driver.upload({
        kbNodeId: "/airo_media",
        resourceId: "getty-123",
        content: JSON.stringify({ description: "test" }),
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit agents/src/tools/__tests__/knowb-driver.test.ts`

Expected: FAIL with "upload is not a function" or similar

**Step 3: Add upload types and method to KnowBDriver**

Modify `agents/src/tools/ai-lib-tools/drivers/knowb-driver.ts`, add after the existing interfaces:

```typescript
/**
 * Options for uploading to KnowB
 */
export interface KnowBUploadOptions {
  kbNodeId: string;
  resourceId: string;
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Result from KnowB upload
 */
export interface KnowBUploadResult {
  success: boolean;
  resourceId?: string;
  error?: string;
}
```

Add upload method to `KnowBDriver` class:

```typescript
/**
 * Upload content to the knowledge base
 *
 * @param options - Upload options containing content and metadata
 * @returns Promise resolving to upload result
 */
async upload(options: KnowBUploadOptions): Promise<KnowBUploadResult> {
  const { kbNodeId, resourceId, content, metadata } = options;

  this.logger.info('knowb-driver.upload.begin', {
    kbNodeId,
    resourceId,
    contentLength: content.length,
  });

  try {
    if (!this.hasAuth()) {
      return {
        success: false,
        error: this.getAuthErrorMessage(),
      };
    }

    // Create markdown content with resourceId in a searchable format
    const markdownContent = `# Image Analysis: ${resourceId}\n\n${content}`;
    const blob = new Blob([markdownContent], { type: 'text/markdown' });
    const formData = new FormData();
    formData.append('file', blob, `${resourceId}.md`);
    formData.append('kbNodeId', kbNodeId);
    formData.append('resourceType', 'document');
    if (metadata) {
      formData.append('metadata', JSON.stringify({ ...metadata, resourceId }));
    }

    const url = `${this.apiBaseUrl}/v1/knowb/upload`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': this.ssoJwt,
        'x-app-key': this.appKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error('knowb-driver.upload.error', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return {
        success: false,
        error: `KnowB upload error: ${response.status} ${response.statusText}`,
      };
    }

    this.logger.info('knowb-driver.upload.success', {
      resourceId,
      kbNodeId,
    });

    return {
      success: true,
      resourceId,
    };
  } catch (error) {
    this.logger.error('knowb-driver.upload.exception', {
      resourceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: `KnowB upload failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit agents/src/tools/__tests__/knowb-driver.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add agents/src/tools/ai-lib-tools/drivers/knowb-driver.ts agents/src/tools/__tests__/knowb-driver.test.ts
git commit -m "$(cat <<'EOF'
feat(knowb-driver): add upload method for caching content

Adds upload() method to KnowBDriver for storing image analysis
results in goknowb. Uses markdown format with resourceId for
searchable cache lookup.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create ImageAnalysisService Types

**Files:**

- Create: `agents/src/services/ImageAnalysisService.ts`

**Step 1: Write the type definitions**

Create `agents/src/services/ImageAnalysisService.ts`:

```typescript
/**
 * ImageAnalysisService
 *
 * Orchestrates image analysis using Claude Haiku vision, caches results
 * in goknowb, and scores relevance for filtering/ranking search results.
 */
import { Logger } from "../logging/index.js";

const logger = Logger.create({ service: "image-analysis-service" });

/**
 * Getty image data from search results
 */
export interface GettyImage {
  id: string;
  urls: {
    preview?: string;
    thumbnail?: string;
    standard?: string;
    highRes?: string;
  };
  dimensions?: {
    height?: number;
    width?: number;
  };
  title?: string;
  caption?: string;
}

/**
 * Cached analysis from goknowb
 */
export interface CachedAnalysis {
  gettyId: string;
  analysis: {
    description: string;
    composition: string;
    usageContext: string;
  };
  getty: {
    title?: string;
    keywords?: string[];
    dimensions?: { width: number; height: number };
    orientation?: string;
  };
  urls: {
    thumbnail?: string;
    preview?: string;
    highRes?: string;
  };
  analyzedAt: string;
}

/**
 * Image with analysis and relevance score
 */
export interface ScoredImage {
  url: string;
  gettyId: string;
  relevanceScore: number | null;
  analysis: {
    description: string;
    composition: string;
    usageContext: string;
  } | null;
  fromCache: boolean;
  analysisSkipped?: boolean;
  skipReason?: string;
}

/**
 * Options for processing search results
 */
export interface ProcessOptions {
  threshold: number;
  maxResults: number;
  skipCache?: boolean;
}

/**
 * Result from processing search results
 */
export interface ProcessedResult {
  images: ScoredImage[];
  filtered: number;
  warning?: string;
}

/**
 * Extract Getty ID from image URL or item
 *
 * @param image - Getty image item
 * @returns Getty ID string
 */
export function extractGettyId(image: GettyImage): string {
  return image.id;
}

/**
 * Configuration constants
 */
export const CONFIG = {
  KB_NODE_ID: "/airo_media",
  DEFAULT_THRESHOLD: 0.5,
  DEFAULT_MAX_RESULTS: 5,
  MAX_RESULTS_CAP: 10,
  RETRY_DELAY_MS: 1000,
  ANALYSIS_CONCURRENCY: 3,
} as const;
```

**Step 2: Run typecheck to verify types compile**

Run: `pnpm --filter @airo/agents exec tsc --noEmit`

Expected: No type errors

**Step 3: Commit**

```bash
git add agents/src/services/ImageAnalysisService.ts
git commit -m "$(cat <<'EOF'
feat(image-analysis): add service types and config

Defines interfaces for GettyImage, CachedAnalysis, ScoredImage,
and configuration constants for the image analysis service.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Implement Cache Lookup Method

**Files:**

- Modify: `agents/src/services/ImageAnalysisService.ts`
- Test: `agents/src/services/__tests__/ImageAnalysisService.test.ts` (new)

**Step 1: Write the failing test**

Create `agents/src/services/__tests__/ImageAnalysisService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the knowb-driver before importing the service
vi.mock("../../tools/ai-lib-tools/drivers/knowb-driver.js", () => ({
  knowBDriver: {
    search: vi.fn(),
    upload: vi.fn(),
  },
}));

import { ImageAnalysisService } from "../ImageAnalysisService.js";
import { knowBDriver } from "../../tools/ai-lib-tools/drivers/knowb-driver.js";

describe("ImageAnalysisService", () => {
  let service: ImageAnalysisService;

  beforeEach(() => {
    service = new ImageAnalysisService();
    vi.clearAllMocks();
  });

  describe("getCachedAnalysis", () => {
    it("should return cached analysis for found IDs", async () => {
      const mockSearchResult = {
        success: true,
        results: [
          {
            kbNodeId: "/airo_media/getty-123",
            text: JSON.stringify({
              gettyId: "getty-123",
              analysis: {
                description: "A sunset",
                composition: "centered",
                usageContext: "hero",
              },
              analyzedAt: "2026-01-26T12:00:00Z",
            }),
            score: 0.95,
          },
        ],
      };
      vi.mocked(knowBDriver.search).mockResolvedValue(mockSearchResult);

      const result = await service.getCachedAnalysis([
        "getty-123",
        "getty-456",
      ]);

      expect(result.has("getty-123")).toBe(true);
      expect(result.has("getty-456")).toBe(false);
      expect(result.get("getty-123")?.analysis.description).toBe("A sunset");
    });

    it("should return empty map when search fails", async () => {
      vi.mocked(knowBDriver.search).mockResolvedValue({
        success: false,
        error: "Network error",
      });

      const result = await service.getCachedAnalysis(["getty-123"]);

      expect(result.size).toBe(0);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit agents/src/services/__tests__/ImageAnalysisService.test.ts`

Expected: FAIL with "getCachedAnalysis is not a function"

**Step 3: Implement getCachedAnalysis method**

Add to `agents/src/services/ImageAnalysisService.ts`:

```typescript
import { knowBDriver } from "../tools/ai-lib-tools/drivers/knowb-driver.js";

/**
 * Service for analyzing images and caching results in goknowb
 */
export class ImageAnalysisService {
  private logger = Logger.create({ service: "image-analysis-service" });

  /**
   * Check goknowb cache for existing analysis
   *
   * @param gettyIds - Array of Getty image IDs to look up
   * @returns Map of Getty ID to cached analysis
   */
  async getCachedAnalysis(
    gettyIds: string[],
  ): Promise<Map<string, CachedAnalysis>> {
    const cached = new Map<string, CachedAnalysis>();

    if (gettyIds.length === 0) {
      return cached;
    }

    this.logger.info("image-analysis.cache-lookup.begin", {
      gettyIds,
      count: gettyIds.length,
    });

    try {
      // Search for each ID in goknowb
      // We search with the ID as the query to find exact matches
      for (const gettyId of gettyIds) {
        const searchResult = await knowBDriver.search({
          query: `gettyId:${gettyId}`,
          kbNodeIds: [CONFIG.KB_NODE_ID],
          maxResults: 1,
          scoreThreshold: 0.8, // High threshold for exact ID match
        });

        if (
          searchResult.success &&
          searchResult.results &&
          searchResult.results.length > 0
        ) {
          const result = searchResult.results[0];
          try {
            // Parse the cached JSON from the result text
            const analysis = JSON.parse(result.text) as CachedAnalysis;
            if (analysis.gettyId === gettyId) {
              cached.set(gettyId, analysis);
              this.logger.debug("image-analysis.cache-hit", { gettyId });
            }
          } catch {
            this.logger.warn("image-analysis.cache-parse-error", {
              gettyId,
              text: result.text.substring(0, 100),
            });
          }
        }
      }

      this.logger.info("image-analysis.cache-lookup.complete", {
        requested: gettyIds.length,
        found: cached.size,
        missed: gettyIds.length - cached.size,
      });

      return cached;
    } catch (error) {
      this.logger.error("image-analysis.cache-lookup.error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return cached;
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit agents/src/services/__tests__/ImageAnalysisService.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add agents/src/services/ImageAnalysisService.ts agents/src/services/__tests__/ImageAnalysisService.test.ts
git commit -m "$(cat <<'EOF'
feat(image-analysis): implement cache lookup method

Adds getCachedAnalysis() to check goknowb for existing image
analysis results by Getty ID.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Implement Image Analysis Method

**Files:**

- Modify: `agents/src/services/ImageAnalysisService.ts`
- Modify: `agents/src/services/__tests__/ImageAnalysisService.test.ts`

**Step 1: Write the failing test**

Add to test file:

```typescript
describe("analyzeImage", () => {
  it("should analyze image and return description", async () => {
    // Mock the ai-lib agent
    const mockAgent = {
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          description: "A beautiful mountain landscape at sunset",
          composition: "subject-left",
          usageContext: "hero",
        }),
      }),
    };

    vi.doMock("@airo/ai-lib", () => ({
      createAgentFactory: () => ({
        defineAgents: () => ({
          get: () => mockAgent,
        }),
      }),
      getModel: vi.fn().mockResolvedValue({}),
      createFileInput: vi.fn(),
      processFile: vi.fn().mockResolvedValue({}),
    }));

    const image: GettyImage = {
      id: "getty-789",
      urls: { preview: "https://example.com/preview.jpg" },
      title: "Mountain sunset",
    };

    const result = await service.analyzeImage(image);

    expect(result).not.toBeNull();
    expect(result?.analysis.description).toContain("mountain");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit agents/src/services/__tests__/ImageAnalysisService.test.ts`

Expected: FAIL with "analyzeImage is not a function"

**Step 3: Implement analyzeImage method**

Add to `ImageAnalysisService` class:

```typescript
import { createAgentFactory, getModel, createFileInput, processFile } from '@airo/ai-lib';

/**
 * Analyze a single image using Claude Haiku vision
 *
 * @param image - Getty image to analyze
 * @returns Analysis result or null on failure
 */
async analyzeImage(image: GettyImage): Promise<CachedAnalysis | null> {
  const imageUrl = image.urls.preview || image.urls.thumbnail || image.urls.standard;

  if (!imageUrl) {
    this.logger.warn('image-analysis.no-url', { gettyId: image.id });
    return null;
  }

  this.logger.info('image-analysis.analyze.begin', {
    gettyId: image.id,
    imageUrl: imageUrl.substring(0, 50),
  });

  try {
    // Fetch the image
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    // Create temp file for ai-lib processing
    const tempPath = `/tmp/image-analysis-${image.id}-${Date.now()}.jpg`;
    const fs = await import('node:fs/promises');
    await fs.writeFile(tempPath, imageBuffer);

    try {
      const fileInput = createFileInput(tempPath);
      const processedFile = await processFile(fileInput);

      // Use Haiku for cost-efficient analysis
      const model = await getModel('haiku');
      const agentFactory = createAgentFactory();

      const agents = agentFactory.defineAgents({
        imageAnalyst: {
          name: 'Image Analysis Agent',
          system: `You are an expert at analyzing images for web development.
Analyze the image and provide:
1. A detailed description (2-3 sentences) of what the image shows
2. The compositional layout - WHERE the visual interest is (e.g., "subject-left", "subject-right", "centered", "full-bleed", "top-heavy", "bottom-weighted")
3. The usage context (one of: hero, icon, logo, background, product, profile, decorative, content, general)

${image.title ? `The image title is: "${image.title}"` : ''}

Respond ONLY with valid JSON:
{
  "description": "detailed description here",
  "composition": "where visual interest is located",
  "usageContext": "context here"
}`,
          model,
          visionEnabled: true,
          maxSteps: 1,
          temperature: 0.3,
          maxOutputTokens: 400,
        },
      });

      const agent = agents.get('imageAnalyst');
      const result = await agent.generate('Analyze this image.', {
        files: [processedFile],
      });

      // Parse JSON response
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      const analysis: CachedAnalysis = {
        gettyId: image.id,
        analysis: {
          description: parsed.description,
          composition: parsed.composition || 'unknown',
          usageContext: parsed.usageContext || 'general',
        },
        getty: {
          title: image.title,
          dimensions: image.dimensions ? {
            width: image.dimensions.width || 0,
            height: image.dimensions.height || 0,
          } : undefined,
          orientation: image.dimensions
            ? (image.dimensions.width || 0) > (image.dimensions.height || 0)
              ? 'horizontal'
              : 'vertical'
            : undefined,
        },
        urls: {
          thumbnail: image.urls.thumbnail,
          preview: image.urls.preview,
          highRes: image.urls.highRes,
        },
        analyzedAt: new Date().toISOString(),
      };

      this.logger.info('image-analysis.analyze.success', {
        gettyId: image.id,
        description: analysis.analysis.description.substring(0, 50),
        composition: analysis.analysis.composition,
        usageContext: analysis.analysis.usageContext,
      });

      return analysis;
    } finally {
      // Cleanup temp file
      await fs.unlink(tempPath).catch(() => {});
    }
  } catch (error) {
    this.logger.error('image-analysis.analyze.error', {
      gettyId: image.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit agents/src/services/__tests__/ImageAnalysisService.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add agents/src/services/ImageAnalysisService.ts agents/src/services/__tests__/ImageAnalysisService.test.ts
git commit -m "$(cat <<'EOF'
feat(image-analysis): implement Haiku vision analysis

Adds analyzeImage() method that fetches image, processes with
Claude Haiku vision, and returns structured analysis with
description, composition, and usage context.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Implement Cache Storage Method

**Files:**

- Modify: `agents/src/services/ImageAnalysisService.ts`
- Modify: `agents/src/services/__tests__/ImageAnalysisService.test.ts`

**Step 1: Write the failing test**

Add to test file:

```typescript
describe("cacheAnalysis", () => {
  it("should store analysis in goknowb", async () => {
    vi.mocked(knowBDriver.upload).mockResolvedValue({
      success: true,
      resourceId: "getty-123",
    });

    const analysis: CachedAnalysis = {
      gettyId: "getty-123",
      analysis: {
        description: "Test",
        composition: "centered",
        usageContext: "hero",
      },
      getty: { title: "Test Image" },
      urls: { preview: "https://example.com/preview.jpg" },
      analyzedAt: "2026-01-26T12:00:00Z",
    };

    await service.cacheAnalysis([analysis]);

    expect(knowBDriver.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        kbNodeId: "/airo_media",
        resourceId: "getty-123",
      }),
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit agents/src/services/__tests__/ImageAnalysisService.test.ts`

Expected: FAIL with "cacheAnalysis is not a function"

**Step 3: Implement cacheAnalysis method**

Add to `ImageAnalysisService` class:

```typescript
/**
 * Store analysis results in goknowb cache
 *
 * @param analyses - Array of analysis results to cache
 */
async cacheAnalysis(analyses: CachedAnalysis[]): Promise<void> {
  if (analyses.length === 0) {
    return;
  }

  this.logger.info('image-analysis.cache-store.begin', {
    count: analyses.length,
    gettyIds: analyses.map(a => a.gettyId),
  });

  const results = await Promise.allSettled(
    analyses.map(async (analysis) => {
      // Format content for semantic search
      const content = `
gettyId:${analysis.gettyId}

Description: ${analysis.analysis.description}

Composition: ${analysis.analysis.composition}

Usage Context: ${analysis.analysis.usageContext}

${analysis.getty.title ? `Title: ${analysis.getty.title}` : ''}
${analysis.getty.keywords?.length ? `Keywords: ${analysis.getty.keywords.join(', ')}` : ''}
${analysis.getty.orientation ? `Orientation: ${analysis.getty.orientation}` : ''}

Full Data:
${JSON.stringify(analysis, null, 2)}
`.trim();

      return knowBDriver.upload({
        kbNodeId: CONFIG.KB_NODE_ID,
        resourceId: analysis.gettyId,
        content,
        metadata: {
          type: 'image_analysis',
          gettyId: analysis.gettyId,
          analyzedAt: analysis.analyzedAt,
        },
      });
    })
  );

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  this.logger.info('image-analysis.cache-store.complete', {
    total: analyses.length,
    succeeded,
    failed,
  });
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit agents/src/services/__tests__/ImageAnalysisService.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add agents/src/services/ImageAnalysisService.ts agents/src/services/__tests__/ImageAnalysisService.test.ts
git commit -m "$(cat <<'EOF'
feat(image-analysis): implement cache storage method

Adds cacheAnalysis() to store image analysis in goknowb with
semantic-searchable content format including description,
composition, and full JSON data.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Implement Relevance Scoring Method

**Files:**

- Modify: `agents/src/services/ImageAnalysisService.ts`
- Modify: `agents/src/services/__tests__/ImageAnalysisService.test.ts`

**Step 1: Write the failing test**

Add to test file:

```typescript
describe("scoreRelevance", () => {
  it("should score images by relevance to prompt", async () => {
    vi.mocked(knowBDriver.search).mockResolvedValue({
      success: true,
      results: [
        { kbNodeId: "/airo_media/getty-123", text: "...", score: 0.85 },
        { kbNodeId: "/airo_media/getty-456", text: "...", score: 0.45 },
      ],
    });

    const analyses: CachedAnalysis[] = [
      {
        gettyId: "getty-123",
        analysis: {
          description: "Sunset over mountains",
          composition: "centered",
          usageContext: "hero",
        },
        getty: {},
        urls: { preview: "https://example.com/1.jpg" },
        analyzedAt: "2026-01-26T12:00:00Z",
      },
      {
        gettyId: "getty-456",
        analysis: {
          description: "Office meeting room",
          composition: "centered",
          usageContext: "content",
        },
        getty: {},
        urls: { preview: "https://example.com/2.jpg" },
        analyzedAt: "2026-01-26T12:00:00Z",
      },
    ];

    const scored = await service.scoreRelevance("sunset mountains", analyses);

    expect(scored).toHaveLength(2);
    expect(scored[0].gettyId).toBe("getty-123");
    expect(scored[0].relevanceScore).toBe(0.85);
    expect(scored[1].relevanceScore).toBe(0.45);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit agents/src/services/__tests__/ImageAnalysisService.test.ts`

Expected: FAIL with "scoreRelevance is not a function"

**Step 3: Implement scoreRelevance method**

Add to `ImageAnalysisService` class:

```typescript
/**
 * Score images by relevance to search prompt using goknowb semantic search
 *
 * @param prompt - Original search prompt
 * @param analyses - Array of cached analyses to score
 * @returns Array of scored images sorted by relevance
 */
async scoreRelevance(prompt: string, analyses: CachedAnalysis[]): Promise<ScoredImage[]> {
  if (analyses.length === 0) {
    return [];
  }

  this.logger.info('image-analysis.score-relevance.begin', {
    prompt,
    imageCount: analyses.length,
  });

  try {
    // Search goknowb with the prompt to get relevance scores
    const searchResult = await knowBDriver.search({
      query: prompt,
      kbNodeIds: [CONFIG.KB_NODE_ID],
      maxResults: analyses.length + 10, // Request extra to ensure we get all
      scoreThreshold: 0.0, // Get all scores, we'll filter later
    });

    // Build a map of gettyId to score
    const scoreMap = new Map<string, number>();

    if (searchResult.success && searchResult.results) {
      for (const result of searchResult.results) {
        // Extract gettyId from the result text
        const idMatch = result.text.match(/gettyId:(\S+)/);
        if (idMatch && idMatch[1]) {
          scoreMap.set(idMatch[1], result.score);
        }
      }
    }

    // Build scored images array
    const scored: ScoredImage[] = analyses.map((analysis) => ({
      url: analysis.urls.highRes || analysis.urls.preview || analysis.urls.thumbnail || '',
      gettyId: analysis.gettyId,
      relevanceScore: scoreMap.get(analysis.gettyId) ?? null,
      analysis: analysis.analysis,
      fromCache: true,
    }));

    // Sort by relevance score (highest first), nulls last
    scored.sort((a, b) => {
      if (a.relevanceScore === null && b.relevanceScore === null) return 0;
      if (a.relevanceScore === null) return 1;
      if (b.relevanceScore === null) return -1;
      return b.relevanceScore - a.relevanceScore;
    });

    this.logger.info('image-analysis.score-relevance.complete', {
      prompt,
      scoredCount: scored.filter(s => s.relevanceScore !== null).length,
      topScore: scored[0]?.relevanceScore,
    });

    return scored;
  } catch (error) {
    this.logger.error('image-analysis.score-relevance.error', {
      prompt,
      error: error instanceof Error ? error.message : String(error),
    });

    // Return images without scores on error
    return analyses.map((analysis) => ({
      url: analysis.urls.highRes || analysis.urls.preview || analysis.urls.thumbnail || '',
      gettyId: analysis.gettyId,
      relevanceScore: null,
      analysis: analysis.analysis,
      fromCache: true,
    }));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit agents/src/services/__tests__/ImageAnalysisService.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add agents/src/services/ImageAnalysisService.ts agents/src/services/__tests__/ImageAnalysisService.test.ts
git commit -m "$(cat <<'EOF'
feat(image-analysis): implement relevance scoring

Adds scoreRelevance() that queries goknowb with the search prompt
to get semantic similarity scores for cached image analyses.
Returns images sorted by relevance with scores.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Implement Main Processing Method

**Files:**

- Modify: `agents/src/services/ImageAnalysisService.ts`
- Modify: `agents/src/services/__tests__/ImageAnalysisService.test.ts`

**Step 1: Write the failing test**

Add to test file:

```typescript
describe("processSearchResults", () => {
  it("should process images with caching, analysis, and filtering", async () => {
    // Setup mocks for full flow
    vi.mocked(knowBDriver.search)
      .mockResolvedValueOnce({ success: false }) // Cache miss
      .mockResolvedValueOnce({ success: false }) // Cache miss
      .mockResolvedValueOnce({
        // Relevance scoring
        success: true,
        results: [
          { kbNodeId: "/airo_media", text: "gettyId:getty-1 ...", score: 0.75 },
          { kbNodeId: "/airo_media", text: "gettyId:getty-2 ...", score: 0.35 },
        ],
      });

    vi.mocked(knowBDriver.upload).mockResolvedValue({ success: true });

    // Mock the analyzeImage method
    const mockAnalysis = {
      gettyId: "getty-1",
      analysis: {
        description: "Sunset",
        composition: "centered",
        usageContext: "hero",
      },
      getty: {},
      urls: { preview: "https://example.com/1.jpg" },
      analyzedAt: "2026-01-26T12:00:00Z",
    };
    vi.spyOn(service, "analyzeImage").mockResolvedValue(mockAnalysis);

    const images: GettyImage[] = [
      { id: "getty-1", urls: { preview: "https://example.com/1.jpg" } },
      { id: "getty-2", urls: { preview: "https://example.com/2.jpg" } },
    ];

    const result = await service.processSearchResults("sunset beach", images, {
      threshold: 0.5,
      maxResults: 5,
    });

    expect(result.images).toHaveLength(1); // One filtered out below threshold
    expect(result.filtered).toBe(1);
    expect(result.images[0].gettyId).toBe("getty-1");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit agents/src/services/__tests__/ImageAnalysisService.test.ts`

Expected: FAIL with "processSearchResults is not a function"

**Step 3: Implement processSearchResults method**

Add to `ImageAnalysisService` class:

```typescript
/**
 * Main entry point - process search results with analysis and filtering
 *
 * @param prompt - Original search prompt
 * @param images - Getty images from search
 * @param options - Processing options (threshold, maxResults, skipCache)
 * @returns Processed result with filtered, scored images
 */
async processSearchResults(
  prompt: string,
  images: GettyImage[],
  options: ProcessOptions
): Promise<ProcessedResult> {
  const { threshold, maxResults, skipCache = false } = options;

  this.logger.info('image-analysis.process.begin', {
    prompt,
    imageCount: images.length,
    threshold,
    maxResults,
    skipCache,
  });

  const gettyIds = images.map(img => img.id);
  let analyses: CachedAnalysis[] = [];
  let warning: string | undefined;

  try {
    // Step 1: Check cache (unless skipped)
    const cached = skipCache
      ? new Map<string, CachedAnalysis>()
      : await this.getCachedAnalysis(gettyIds);

    // Step 2: Analyze uncached images
    const uncachedImages = images.filter(img => !cached.has(img.id));

    if (uncachedImages.length > 0) {
      this.logger.info('image-analysis.process.analyzing-uncached', {
        count: uncachedImages.length,
      });

      // Analyze in batches with concurrency limit
      const newAnalyses: CachedAnalysis[] = [];

      for (let i = 0; i < uncachedImages.length; i += CONFIG.ANALYSIS_CONCURRENCY) {
        const batch = uncachedImages.slice(i, i + CONFIG.ANALYSIS_CONCURRENCY);
        const batchResults = await Promise.all(
          batch.map(img => this.analyzeImage(img))
        );

        for (const result of batchResults) {
          if (result) {
            newAnalyses.push(result);
          }
        }
      }

      // Step 3: Cache new analyses
      if (newAnalyses.length > 0) {
        await this.cacheAnalysis(newAnalyses).catch(err => {
          this.logger.warn('image-analysis.process.cache-failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      // Combine cached and new analyses
      analyses = [
        ...Array.from(cached.values()),
        ...newAnalyses,
      ];
    } else {
      analyses = Array.from(cached.values());
    }

    // Step 4: Score relevance
    const scored = await this.scoreRelevance(prompt, analyses);

    // Step 5: Filter by threshold
    const filtered = scored.filter(img =>
      img.relevanceScore === null || img.relevanceScore >= threshold
    );

    const filteredCount = scored.length - filtered.length;

    // Step 6: Limit results
    const finalImages = filtered.slice(0, maxResults);

    this.logger.info('image-analysis.process.complete', {
      prompt,
      inputCount: images.length,
      analyzedCount: analyses.length,
      scoredCount: scored.length,
      filteredOut: filteredCount,
      outputCount: finalImages.length,
    });

    return {
      images: finalImages,
      filtered: filteredCount,
      warning,
    };
  } catch (error) {
    this.logger.error('image-analysis.process.error', {
      prompt,
      error: error instanceof Error ? error.message : String(error),
    });

    // Retry once
    try {
      await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY_MS));
      return this.processSearchResults(prompt, images, { ...options, skipCache: true });
    } catch {
      // Return unanalyzed images as fallback
      warning = 'Image analysis unavailable - returning unfiltered results';

      return {
        images: images.slice(0, maxResults).map(img => ({
          url: img.urls.highRes || img.urls.preview || img.urls.thumbnail || '',
          gettyId: img.id,
          relevanceScore: null,
          analysis: null,
          fromCache: false,
          analysisSkipped: true,
          skipReason: 'analysis_failed',
        })),
        filtered: 0,
        warning,
      };
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit agents/src/services/__tests__/ImageAnalysisService.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add agents/src/services/ImageAnalysisService.ts agents/src/services/__tests__/ImageAnalysisService.test.ts
git commit -m "$(cat <<'EOF'
feat(image-analysis): implement main processing pipeline

Adds processSearchResults() that orchestrates the full flow:
1. Check goknowb cache for existing analysis
2. Analyze uncached images with Haiku
3. Store new analyses in goknowb
4. Score relevance using semantic search
5. Filter below threshold and limit results

Includes retry logic and graceful degradation on failure.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Export Service and Add to Index

**Files:**

- Modify: `agents/src/services/index.ts`

**Step 1: Add export**

Add to `agents/src/services/index.ts`:

```typescript
export {
  ImageAnalysisService,
  type ScoredImage,
  type ProcessedResult,
  type ProcessOptions,
} from "./ImageAnalysisService.js";
```

**Step 2: Run typecheck**

Run: `pnpm --filter @airo/agents exec tsc --noEmit`

Expected: No type errors

**Step 3: Commit**

```bash
git add agents/src/services/index.ts
git commit -m "$(cat <<'EOF'
feat(image-analysis): export service from index

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Integrate with MediaSearchTool

**Files:**

- Modify: `agents/src/tools/media-search-tool.ts`
- Modify: `agents/src/tools/__tests__/media-search-tool.test.ts`

**Step 1: Update MediaSearchOptions interface**

In `agents/src/tools/media-search-tool.ts`, update the interface:

```typescript
export interface MediaSearchOptions {
  prompt: string | string[];
  mediaType?: MediaType;
  count?: number;
  orientations?: string;
  compositions?: string;
  color?: string;
  appId?: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024" | "auto";
  filename?: string;
  // New options
  analyzeImages?: boolean;
  relevanceThreshold?: number;
  skipCache?: boolean;
}
```

**Step 2: Update MediaSearchResult interface**

```typescript
export interface MediaSearchResult {
  success: boolean;
  url?: string;
  urls?: string[];
  error?: string;
  results?: Array<{
    prompt: string;
    success: boolean;
    url?: string;
    urls?: string[];
    error?: string;
  }>;
  filepath?: string;
  publicPath?: string;
  base64Data?: string;
  // New fields
  images?: Array<{
    url: string;
    gettyId: string;
    relevanceScore: number | null;
    analysis: {
      description: string;
      composition: string;
      usageContext: string;
    } | null;
    fromCache: boolean;
    analysisSkipped?: boolean;
    skipReason?: string;
  }>;
  filtered?: number;
  warning?: string;
}
```

**Step 3: Integrate ImageAnalysisService in searchSingle**

Add import at top:

```typescript
import {
  ImageAnalysisService,
  CONFIG as ANALYSIS_CONFIG,
} from "../services/ImageAnalysisService.js";
```

Modify `searchSingle` method to use analysis:

```typescript
private async searchSingle(
  prompt: string,
  mediaType: MediaType,
  count = 1,
  options?: {
    orientations?: string;
    compositions?: string;
    color?: string;
    analyzeImages?: boolean;
    relevanceThreshold?: number;
    skipCache?: boolean;
  }
): Promise<MediaSearchResult> {
  try {
    const analyzeImages = options?.analyzeImages ?? (mediaType === 'image');
    const relevanceThreshold = options?.relevanceThreshold ?? ANALYSIS_CONFIG.DEFAULT_THRESHOLD;

    // Request 2x images when analyzing to allow for filtering
    const requestCount = analyzeImages ? Math.min(count * 2, 20) : count;

    const eventLogger = mediaType === 'video' ? toolVideoSearchEvents : toolImageSearchEvents;
    eventLogger.begin(logger, {
      toolName: 'MediaSearchTool',
      prompt,
      count: requestCount,
      provider: 'getty',
    });

    const result = await this.driver.search(mediaType as 'image' | 'video', {
      phrase: prompt.trim(),
      page: 1,
      pageSize: Math.min(requestCount, mediaType === 'image' ? 20 : 1),
      ...(mediaType === 'image' && { graphicalStyles: 'photography' }),
      ...(options?.orientations && { orientations: options.orientations }),
      ...(options?.compositions && { compositions: options.compositions }),
      ...(options?.color && { color: options.color }),
      sortOrder: 'best_match'
    });

    if (!result.success || !result.items || result.items.length === 0) {
      eventLogger.failure(logger, new Error(result.error || `No ${mediaType}s found`), {
        toolName: 'MediaSearchTool',
        prompt,
        count: requestCount,
        provider: 'getty',
      });
      return {
        success: false,
        error: result.error || `No ${mediaType}s found for this search query`
      };
    }

    // For images with analysis enabled, process through ImageAnalysisService
    if (mediaType === 'image' && analyzeImages && result.items.length > 0) {
      const analysisService = new ImageAnalysisService();
      const processed = await analysisService.processSearchResults(
        prompt,
        result.items,
        {
          threshold: relevanceThreshold,
          maxResults: count,
          skipCache: options?.skipCache,
        }
      );

      eventLogger.success(logger, {
        toolName: 'MediaSearchTool',
        prompt,
        count,
        provider: 'getty',
        resultUrls: processed.images.map(i => i.url),
        resultCount: processed.images.length,
        filteredCount: processed.filtered,
      });

      return {
        success: true,
        images: processed.images,
        filtered: processed.filtered,
        warning: processed.warning,
        // Backward compatibility
        urls: processed.images.map(i => i.url),
        ...(processed.images.length === 1 && { url: processed.images[0].url }),
      };
    }

    // Original behavior for video or when analysis disabled
    const mediaUrls: string[] = [];
    for (const item of result.items.slice(0, count)) {
      const mediaUrl = item?.urls?.highRes || item?.urls?.standard || item?.urls?.preview || item?.urls?.thumbnail;
      if (mediaUrl) {
        mediaUrls.push(mediaUrl);
      }
    }

    if (mediaUrls.length === 0) {
      eventLogger.failure(logger, new Error(`No valid ${mediaType} URLs found`), {
        toolName: 'MediaSearchTool',
        prompt,
        count,
        provider: 'getty',
      });
      return {
        success: false,
        error: `No valid ${mediaType} URLs found in Getty response`
      };
    }

    eventLogger.success(logger, {
      toolName: 'MediaSearchTool',
      prompt,
      count,
      provider: 'getty',
      resultUrls: mediaUrls,
      resultCount: mediaUrls.length,
    });

    if (count === 1 && mediaUrls.length > 0) {
      return { success: true, url: mediaUrls[0]! };
    } else {
      return { success: true, urls: mediaUrls };
    }
  } catch (error) {
    // ... existing error handling
  }
}
```

**Step 4: Run tests**

Run: `pnpm --filter @airo/agents test:unit`

Expected: All tests pass

**Step 5: Commit**

```bash
git add agents/src/tools/media-search-tool.ts
git commit -m "$(cat <<'EOF'
feat(media-search): integrate image analysis service

Updates MediaSearchTool to:
- Accept analyzeImages, relevanceThreshold, skipCache options
- Request 2x images when analyzing to allow filtering headroom
- Process results through ImageAnalysisService
- Return enriched response with analysis metadata
- Maintain backward compatibility with url/urls fields

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Update AI Tool Schema

**Files:**

- Modify: `agents/src/tools/ai-lib-tools/media-tools.ts`

**Step 1: Update zod schema**

Update the schema in `media-tools.ts`:

```typescript
export const mediaSearchAITool: Tool = createTool(
  'Search for professional stock images/videos OR generate AI images. By DEFAULT, this searches for IMAGES with AI-powered relevance analysis. Use "video" for video search, or "generate" to create custom AI images.',
  z.object({
    prompt: z.union([z.string(), z.array(z.string())]).describe('Text prompt(s) describing the media to search for. Limit each prompt to 1-5 keywords for best results.'),
    mediaType: z.enum(['image', 'video', 'generate']).default('image').describe('Type of media. Defaults to "image".'),
    count: z.number().min(1).max(10).optional().describe('Number of results to return per prompt (1-10, default 5). Images are analyzed and filtered by relevance.'),
    orientations: z.string().optional().describe('Filter by orientation: "horizontal", "vertical", "square", "panoramic_horizontal", "panoramic_vertical".'),
    compositions: z.string().optional().describe('Filter by composition: "abstract", "candid", "close_up", "copy_space", etc.'),
    color: z.string().optional().describe('Filter by color hex code (e.g. "#FF0000").'),
    size: z.enum(['1024x1024', '1024x1536', '1536x1024', 'auto']).default('1024x1024').optional().describe('Size for generated images (only for mediaType: "generate")'),
    filename: z.string().optional().describe('Custom filename for generated images (only for mediaType: "generate")'),
    analyzeImages: z.boolean().default(true).optional().describe('Enable AI analysis of images for relevance filtering. Default true for image search.'),
    relevanceThreshold: z.number().min(0).max(1).default(0.5).optional().describe('Minimum relevance score (0-1). Images below this are filtered out. Default 0.5.'),
  }),
  // ... rest of implementation
```

**Step 2: Pass new options through**

Update the tool implementation to pass through the new options:

```typescript
const options: MediaSearchOptions = {
  prompt,
  mediaType,
  ...(count !== undefined && { count }),
  ...(appId && { appId }),
  ...(size && { size }),
  ...(filename && { filename }),
  ...(orientations && { orientations }),
  ...(compositions && { compositions }),
  ...(color && { color }),
  ...(analyzeImages !== undefined && { analyzeImages }),
  ...(relevanceThreshold !== undefined && { relevanceThreshold }),
};
```

**Step 3: Run typecheck and tests**

Run: `pnpm --filter @airo/agents exec tsc --noEmit && pnpm --filter @airo/agents test:unit`

Expected: All pass

**Step 4: Commit**

```bash
git add agents/src/tools/ai-lib-tools/media-tools.ts
git commit -m "$(cat <<'EOF'
feat(media-tools): expose analysis options in AI tool schema

Updates the mediaSearchAITool schema to expose:
- analyzeImages: enable/disable analysis (default true)
- relevanceThreshold: minimum score for filtering (default 0.5)
- Reduced max count from 50 to 10 for better quality

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Add Feature Flag

**Files:**

- Modify: `agents/src/services/features.ts`

**Step 1: Add feature flag**

Add to `agents/src/services/features.ts`:

```typescript
IMAGE_ANALYSIS_ENABLED: process.env.IMAGE_ANALYSIS_ENABLED !== 'false',
```

**Step 2: Use feature flag in MediaSearchTool**

In `media-search-tool.ts`, check the flag:

```typescript
import { features } from "../services/features.js";

// In searchSingle:
const analyzeImages =
  features.IMAGE_ANALYSIS_ENABLED &&
  (options?.analyzeImages ?? mediaType === "image");
```

**Step 3: Commit**

```bash
git add agents/src/services/features.ts agents/src/tools/media-search-tool.ts
git commit -m "$(cat <<'EOF'
feat(features): add IMAGE_ANALYSIS_ENABLED flag

Allows disabling image analysis via environment variable
for testing or fallback scenarios.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Run Full Test Suite

**Step 1: Run all tests**

Run: `pnpm --filter @airo/agents test:unit && pnpm --filter @airo/agents test:integration`

Expected: All tests pass

**Step 2: Run typecheck**

Run: `pnpm typecheck`

Expected: No errors

**Step 3: Run lint**

Run: `pnpm lint`

Expected: No errors (or fix any that appear)

**Step 4: Final commit if needed**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: fix lint/type issues from image analysis feature

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

This implementation plan adds AI-powered image analysis to the media search tool:

1. **KnowB Driver** - Added upload method for caching
2. **ImageAnalysisService** - New service orchestrating:
   - Cache lookup via goknowb
   - Haiku vision analysis
   - Cache storage
   - Relevance scoring via semantic search
3. **MediaSearchTool** - Integrated analysis with filtering/ranking
4. **AI Tool Schema** - Exposed new options to agents
5. **Feature Flag** - Added kill switch for the feature

Key behaviors:

- Fetches 2x images to allow filtering headroom
- Caches analysis in `/airo_media` by Getty ID
- Filters below 0.5 relevance threshold
- Returns enriched response with analysis metadata
- Falls back gracefully on errors
