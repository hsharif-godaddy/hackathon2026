/**
 * KnowB Search AI-Lib Tool
 * Searches GoDaddy's knowledge base for deployment and application documentation
 */
import { createTool, type Tool } from '@airo/ai-lib';
import { z } from 'zod';
import { knowBSearchTool } from '../knowb-search-tool.js';
import { logger } from '../../logging/index.js';

/**
 * KnowB Search AI Tool
 * Searches GoDaddy's knowledge base for documentation
 */
export const knowBSearchAITool: Tool = createTool(
  `Search the knowledge base for deployment and application documentation.

Use this tool to find information about:
- Deployment procedures and publishing
- Application configuration and setup
- Technical documentation and guides
- Best practices and recommendations

The search returns relevant documentation with similarity scores.`,
  z.object({
    query: z.string().describe('The search query - describe what you want to find'),
    kbNodeIds: z
      .array(z.string())
      .optional()
      .describe('Specific knowledge base nodes to search. Defaults to ["/airo_info"]'),
    maxResults: z
      .number()
      .optional()
      .default(2)
      .describe('Maximum number of results to return (driver default: 2 unique docs after dedup; tuned for the current 3-doc corpus)'),
    // Cohere rerank replaces raw cosine and outputs probability-calibrated
    // scores that do NOT correspond to raw cosine magnitudes. The driver
    // sends scoreThreshold: 0.0 to Bedrock regardless, because Bedrock's
    // default 0.5 would drop most Cohere rerank results. Keep this field
    // exposed for backward compatibility, but note the final ranking comes
    // from Cohere + dedup + top-K=3 inside KnowBDriver, not this threshold.
    scoreThreshold: z
      .number()
      .optional()
      .default(0.0)
      .describe(
        'Score threshold passed to Bedrock. Defaults to 0.0 because Cohere rerank + top-K drives selection.',
      ),
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string | undefined;

    const result = await knowBSearchTool.search({
      query: input.query,
      ...(input.kbNodeIds && { kbNodeIds: input.kbNodeIds }),
      ...(input.maxResults !== undefined && { maxResults: input.maxResults }),
      ...(input.scoreThreshold !== undefined && { scoreThreshold: input.scoreThreshold }),
      ...(appId && { appId }),
    });

    if (!result.success) {
      // Only place appId + the failure reason are co-located in one log entry.
      // KnowBSearchTool logs the failure separately but doesn't have appId in scope.
      logger.warn('knowb-search-ai-tool.search.failed', {
        appId,
        error: result.error,
        query: input.query.substring(0, 100),
      });
      return {
        error: result.error || 'KnowB search failed',
        success: false,
      };
    }

    // Defensive: the type allows results?: KnowBSearchItem[] but
    // KnowBSearchTool.search() always populates via `|| []`. Warn if we ever
    // see undefined on a nominally successful response so the model doesn't
    // get "Found undefined result(s)".
    if (result.results === undefined) {
      logger.warn('knowb-search-ai-tool.search.missing_results_on_success', {
        appId,
        query: input.query.substring(0, 100),
      });
    }
    const resultsArray = result.results ?? [];
    const formattedResults = resultsArray.map((item, index) => ({
      rank: index + 1,
      document: item.location.kbNodeId,
      score: item.score.toFixed(4),
      contentPreview: item.content.text,
      contentType: item.content.type,
    }));

    return {
      success: true,
      totalResults: resultsArray.length,
      results: formattedResults,
      message: `Found ${resultsArray.length} result(s) for query: "${input.query}"`,
    };
  }
);

