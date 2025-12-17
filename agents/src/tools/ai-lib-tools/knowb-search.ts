/**
 * KnowB Search AI-Lib Tool
 * Searches GoDaddy's knowledge base for deployment and application documentation
 */
import { createTool, type Tool } from '@airo/ai-lib';
import { z } from 'zod';
import { KnowBSearchTool } from '../knowb-search-tool.js';

/**
 * KnowB Search AI Tool
 * Searches GoDaddy's knowledge base for documentation
 */
export const knowBSearchAITool: Tool = createTool(
  `Search GoDaddy's knowledge base for deployment and application documentation.

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
      .describe('Specific knowledge base nodes to search. Defaults to ["/airo_sys"]'),
    maxResults: z
      .number()
      .optional()
      .default(5)
      .describe('Maximum number of results to return (1-10)'),
    scoreThreshold: z
      .number()
      .optional()
      .default(0.35)
      .describe('Minimum similarity score threshold (0.0-1.0)'),
  }),
  async (input, context) => {
    const tool = new KnowBSearchTool();
    const appId = context?.metadata?.appId as string | undefined;

    const result = await tool.search({
      query: input.query,
      ...(input.kbNodeIds && { kbNodeIds: input.kbNodeIds }),
      ...(input.maxResults !== undefined && { maxResults: input.maxResults }),
      ...(input.scoreThreshold !== undefined && { scoreThreshold: input.scoreThreshold }),
      ...(appId && { appId }),
    });

    if (!result.success) {
      return {
        error: result.error || 'KnowB search failed',
        success: false,
      };
    }

    // Format results for better readability
    const formattedResults = result.results?.map((item, index) => ({
      rank: index + 1,
      document: item.location.kbNodeId,
      score: item.score.toFixed(4),
      contentPreview: item.content.text,
      contentType: item.content.type,
    }));

    return {
      success: true,
      totalResults: result.totalResults,
      results: formattedResults,
      message: `Found ${result.totalResults} result(s) for query: "${input.query}"`,
    };
  }
);

