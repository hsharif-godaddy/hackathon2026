/**
 * ImageAnalysisService
 *
 * Orchestrates image analysis using Claude Haiku vision, caches results
 * in goknowb, and scores relevance for filtering/ranking search results.
 */
import {
  createAgentFactory,
  getModel,
  createFileInputFromBuffer,
  processFile,
  calculateCostEstimate,
} from "@airo/ai-lib";
import { llmMetadataContext, type LitellmMetadata } from "@airo/ai-common";

import { Logger } from "../logging/index.js";
import { createAgentTelemetryLogger } from "../utils/agent-logger.js";
import { knowBDriver } from "../tools/ai-lib-tools/drivers/knowb-driver.js";

/**
 * Execution context for cost tracking and LiteLLM tagging
 */
export interface ImageAnalysisContext {
  appId?: string;
  conversationId?: string;
  customerId?: string;
}

/**
 * Internal result from analyzeImage including token usage
 */
interface AnalysisResultWithUsage {
  analysis: CachedAnalysis | null;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

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
  KB_NODE_ID: process.env.IMAGE_ANALYSIS_KB_NODE_ID || "/airo_media_v2",
  DEFAULT_THRESHOLD: 0.5,
  DEFAULT_MAX_RESULTS: 5,
  MAX_RESULTS_CAP: 10,
  RETRY_DELAY_MS: 1000,
  ANALYSIS_CONCURRENCY: 3,
} as const;

/**
 * Service for analyzing images and caching results in goknowb
 */
export class ImageAnalysisService {
  private logger = Logger.create({ service: "image-analysis-service" });
  private context?: ImageAnalysisContext;

  constructor(context?: ImageAnalysisContext) {
    this.context = context;
  }

  /**
   * Check goknowb cache for existing analysis
   *
   * @param gettyIds - Array of Getty image IDs to look up
   * @returns Map of Getty ID to cached analysis
   */
  async getCachedAnalysis(
    gettyIds: string[]
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
      for (const gettyId of gettyIds) {
        const searchResult = await knowBDriver.search({
          query: `gettyId:${gettyId}`,
          kbNodeIds: [CONFIG.KB_NODE_ID],
          maxResults: 1,
          scoreThreshold: 0.8,
        });

        if (
          searchResult.success &&
          searchResult.results &&
          searchResult.results.length > 0
        ) {
          const result = searchResult.results[0];
          if (result) {
            try {
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

  /**
   * Analyze a single image using Claude Haiku vision
   *
   * Downloads the image from URL and uses ai-lib to analyze it with Haiku.
   * Returns structured analysis with description, composition, and usage context.
   *
   * @param image - Getty image to analyze
   * @returns Analysis result with usage data, or null analysis on failure
   */
  private async analyzeImageInternal(image: GettyImage): Promise<AnalysisResultWithUsage> {
    const imageUrl =
      image.urls.preview || image.urls.thumbnail || image.urls.standard;

    if (!imageUrl) {
      this.logger.warn("image-analysis.no-url", { gettyId: image.id });
      return { analysis: null };
    }

    this.logger.info("image-analysis.analyze.begin", {
      gettyId: image.id,
      imageUrl: imageUrl.substring(0, 50),
    });

    try {
      // Download image from URL
      const response = await fetch(imageUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; AiroBuilder/1.0)",
        },
      });

      if (!response.ok) {
        this.logger.warn("image-analysis.fetch-error", {
          gettyId: image.id,
          status: response.status,
          statusText: response.statusText,
        });
        return { analysis: null };
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Determine MIME type from content-type header or URL
      const contentType = response.headers.get("content-type") || "image/jpeg";
      const rawMimeType = contentType.split(";")[0]?.trim() || "image/jpeg";
      const supportedMimeTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
      const mimeType = supportedMimeTypes.includes(rawMimeType as typeof supportedMimeTypes[number])
        ? (rawMimeType as typeof supportedMimeTypes[number])
        : "image/jpeg";

      // Process image using ai-lib
      const fileInput = createFileInputFromBuffer(
        buffer,
        mimeType,
        `getty-${image.id}.jpg`
      );
      const processedFile = await processFile(fileInput);

      // Create agent for image analysis (using Haiku for cost efficiency)
      const model = await getModel("haiku");
      const agentFactory = createAgentFactory();

      const agents = agentFactory.defineAgents({
        imageAnalyst: {
          name: "Image Analysis Agent",
          system: `You are an expert at analyzing images for web development purposes.
Analyze the image and provide:
1. A detailed description (2-3 sentences) of what the image shows
2. The compositional layout - WHERE the visual interest is located (e.g., "subject on left", "centered", "subject on right", "full-bleed texture", "top-heavy", "bottom-weighted")
3. The usage context (one of: hero, icon, logo, background, product, profile, decorative, content, general)

This composition information is CRITICAL for layout decisions. For example:
- If a car/product is on the left side, content should overlay on the right
- If a person is on the right, content should go left
- If it's a centered subject, use split layout or overlay carefully
- If it's a texture/pattern, full overlay is safe

Respond ONLY with valid JSON in this exact format:
{
  "description": "detailed description here",
  "composition": "where the visual interest is (left/right/center/full/top/bottom)",
  "usageContext": "context here"
}`,
          model,
          maxSteps: 1,
          temperature: 0.3,
          maxOutputTokens: 400,
          logger: createAgentTelemetryLogger('image-analyst'),
        },
      });

      const agent = agents.get("imageAnalyst");

      // Build LiteLLM metadata for cost tracking
      const litellmMetadata: LitellmMetadata = {
        ...(this.context?.customerId && { user: this.context.customerId }),
        tags: [
          "source:tool-llm",
          "source:image-analysis",
          ...(this.context?.appId ? [`appId:${this.context.appId}`] : []),
        ],
      };

      // Run with metadata context for LiteLLM tagging
      const result = await llmMetadataContext.run(litellmMetadata, async () => {
        return await agent.generate(
          "Analyze this image and provide the description and usage context in JSON format.",
          {
            files: [processedFile],
          }
        );
      });

      // Extract usage data
      const usage = result.usage
        ? {
            inputTokens: result.usage.inputTokens ?? 0,
            outputTokens: result.usage.outputTokens ?? 0,
            totalTokens: result.usage.totalTokens ?? 0,
          }
        : undefined;

      // Parse JSON response
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn("image-analysis.analyze.no-description", {
          gettyId: image.id,
          response: result.content.substring(0, 100),
        });
        return { analysis: null, usage };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      const analysis: CachedAnalysis = {
        gettyId: image.id,
        analysis: {
          description: parsed.description,
          composition: parsed.composition || "unknown",
          usageContext: parsed.usageContext || "general",
        },
        getty: {
          title: image.title,
          dimensions: image.dimensions
            ? {
                width: image.dimensions.width || 0,
                height: image.dimensions.height || 0,
              }
            : undefined,
          orientation: image.dimensions
            ? (image.dimensions.width || 0) > (image.dimensions.height || 0)
              ? "horizontal"
              : "vertical"
            : undefined,
        },
        urls: {
          thumbnail: image.urls.thumbnail,
          preview: image.urls.preview,
          highRes: image.urls.highRes,
        },
        analyzedAt: new Date().toISOString(),
      };

      this.logger.info("image-analysis.analyze.success", {
        gettyId: image.id,
        description: analysis.analysis.description.substring(0, 50),
        composition: analysis.analysis.composition,
        usageContext: analysis.analysis.usageContext,
      });

      return { analysis, usage };
    } catch (error) {
      this.logger.error("image-analysis.analyze.error", {
        gettyId: image.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return { analysis: null };
    }
  }

  /**
   * Analyze a single image using Claude Haiku vision (public API for backward compatibility)
   *
   * @param image - Getty image to analyze
   * @returns Analysis result or null on failure
   */
  async analyzeImage(image: GettyImage): Promise<CachedAnalysis | null> {
    const result = await this.analyzeImageInternal(image);
    return result.analysis;
  }

  /**
   * Store analysis results in goknowb cache
   *
   * @param analyses - Array of analysis results to cache
   */
  async cacheAnalysis(analyses: CachedAnalysis[]): Promise<void> {
    if (analyses.length === 0) {
      return;
    }

    this.logger.info("image-analysis.cache-store.begin", {
      count: analyses.length,
      gettyIds: analyses.map((a) => a.gettyId),
    });

    const results = await Promise.allSettled(
      analyses.map(async (analysis) => {
        // Format content for semantic search
        const content = `
gettyId:${analysis.gettyId}

Description: ${analysis.analysis.description}

Composition: ${analysis.analysis.composition}

Usage Context: ${analysis.analysis.usageContext}

${analysis.getty.title ? `Title: ${analysis.getty.title}` : ""}
${analysis.getty.keywords?.length ? `Keywords: ${analysis.getty.keywords.join(", ")}` : ""}
${analysis.getty.orientation ? `Orientation: ${analysis.getty.orientation}` : ""}

Full Data:
${JSON.stringify(analysis, null, 2)}
`.trim();

        return knowBDriver.upload({
          kbNodeId: CONFIG.KB_NODE_ID,
          resourceId: analysis.gettyId,
          content,
          metadata: {
            type: "image_analysis",
            gettyId: analysis.gettyId,
            analyzedAt: analysis.analyzedAt,
          },
        });
      })
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    this.logger.info("image-analysis.cache-store.complete", {
      total: analyses.length,
      succeeded,
      failed,
    });
  }

  /**
   * Score images by relevance to search prompt using goknowb semantic search
   *
   * @param prompt - Original search prompt
   * @param analyses - Array of cached analyses to score
   * @returns Array of scored images sorted by relevance
   */
  async scoreRelevance(
    prompt: string,
    analyses: CachedAnalysis[]
  ): Promise<ScoredImage[]> {
    if (analyses.length === 0) {
      return [];
    }

    this.logger.info("image-analysis.score-relevance.begin", {
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
        url:
          analysis.urls.highRes ||
          analysis.urls.preview ||
          analysis.urls.thumbnail ||
          "",
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

      this.logger.info("image-analysis.score-relevance.complete", {
        prompt,
        scoredCount: scored.filter((s) => s.relevanceScore !== null).length,
        topScore: scored[0]?.relevanceScore,
      });

      return scored;
    } catch (error) {
      this.logger.error("image-analysis.score-relevance.error", {
        prompt,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return images without scores on error
      return analyses.map((analysis) => ({
        url:
          analysis.urls.highRes ||
          analysis.urls.preview ||
          analysis.urls.thumbnail ||
          "",
        gettyId: analysis.gettyId,
        relevanceScore: null,
        analysis: analysis.analysis,
        fromCache: true,
      }));
    }
  }

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

    this.logger.info("image-analysis.process.begin", {
      prompt,
      imageCount: images.length,
      threshold,
      maxResults,
      skipCache,
    });

    const gettyIds = images.map((img) => img.id);
    let analyses: CachedAnalysis[] = [];
    let warning: string | undefined;

    // Track aggregate token usage for cost logging
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalTokens = 0;
    let imagesAnalyzed = 0;

    try {
      // Step 1: Check cache (unless skipped)
      const cached = skipCache
        ? new Map<string, CachedAnalysis>()
        : await this.getCachedAnalysis(gettyIds);

      // Step 2: Analyze uncached images
      const uncachedImages = images.filter((img) => !cached.has(img.id));

      if (uncachedImages.length > 0) {
        this.logger.info("image-analysis.process.analyzing-uncached", {
          count: uncachedImages.length,
        });

        // Analyze in batches with concurrency limit
        const newAnalyses: CachedAnalysis[] = [];

        for (
          let i = 0;
          i < uncachedImages.length;
          i += CONFIG.ANALYSIS_CONCURRENCY
        ) {
          const batch = uncachedImages.slice(i, i + CONFIG.ANALYSIS_CONCURRENCY);
          const batchResults = await Promise.all(
            batch.map((img) => this.analyzeImageInternal(img))
          );

          for (const result of batchResults) {
            // Aggregate usage from each analysis
            if (result.usage) {
              totalInputTokens += result.usage.inputTokens;
              totalOutputTokens += result.usage.outputTokens;
              totalTokens += result.usage.totalTokens;
              imagesAnalyzed++;
            }

            if (result.analysis) {
              newAnalyses.push(result.analysis);
            }
          }
        }

        // Log aggregate cost summary after all analyses complete
        if (imagesAnalyzed > 0) {
          const costEstimate = calculateCostEstimate(
            {
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              totalTokens: totalTokens,
            },
            "claude-haiku-4-5"
          );

          this.logger.info("image-analysis.cost.summary", {
            prompt: prompt.substring(0, 50),
            imagesAnalyzed,
            imagesFromCache: cached.size,
            totalInputTokens,
            totalOutputTokens,
            totalTokens,
            estimatedCostUsd: costEstimate.totalCost,
            model: "claude-haiku-4-5",
            appId: this.context?.appId,
            conversationId: this.context?.conversationId,
          });
        }

        // Step 3: Cache new analyses
        if (newAnalyses.length > 0) {
          await this.cacheAnalysis(newAnalyses).catch((err) => {
            this.logger.warn("image-analysis.process.cache-failed", {
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }

        // Combine cached and new analyses
        analyses = [...Array.from(cached.values()), ...newAnalyses];
      } else {
        analyses = Array.from(cached.values());
      }

      // Step 4: Score relevance
      const scored = await this.scoreRelevance(prompt, analyses);

      // Step 5: Filter by threshold
      const filtered = scored.filter(
        (img) => img.relevanceScore === null || img.relevanceScore >= threshold
      );

      const filteredCount = scored.length - filtered.length;

      // Step 6: Limit results
      const finalImages = filtered.slice(0, maxResults);

      this.logger.info("image-analysis.process.complete", {
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
      this.logger.error("image-analysis.process.error", {
        prompt,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return unanalyzed images as fallback (fail open)
      warning = "Image analysis unavailable - returning unfiltered results";

      return {
        images: images.slice(0, maxResults).map((img) => ({
          url:
            img.urls.highRes ||
            img.urls.preview ||
            img.urls.thumbnail ||
            "",
          gettyId: img.id,
          relevanceScore: null,
          analysis: null,
          fromCache: false,
          analysisSkipped: true,
          skipReason: "analysis_failed",
        })),
        filtered: 0,
        warning,
      };
    }
  }
}
