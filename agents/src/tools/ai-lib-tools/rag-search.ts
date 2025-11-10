/**
 * RAG Search Tool for AI-Lib
 *
 * Search for design styles, trends, and inspiration using semantic similarity
 * against a curated collection of design knowledge.
 */

import { createTool, type Tool } from '@airo/ai-lib';
import { z } from 'zod';
import { RagTool, type RagSearchOptions } from '../rag-tool.js';

/**
 * Initialize RAG tool instance
 */
const ragTool = new RagTool();

/**
 * Format message when no results are found
 */
function formatNoResultsMessage(query: string): string {
  return `🎨 No design inspiration found matching: "${query}"

Try:
* Broader search terms (e.g., "modern" instead of "ultra-modern minimalist")
* Different design aspects (e.g., "color palette" or "typography")
* Classic styles (e.g., "brutalism", "swiss design", "art deco")`;
}

/**
 * Format a list of items as markdown bullet points
 */
function formatList(items: string[], maxItems = 3): string {
  return items
    .slice(0, maxItems)
    .map((item) => `* ${item}`)
    .join('\n');
}

/**
 * Format design result with visual characteristics, colors, and typography
 */
function formatDesignResult(data: any, index: number): string {
  const score = data.score?.toFixed(2) || 'N/A';
  const sections: string[] = [];

  sections.push(`**${index + 1}. ${data.name}** (relevance: ${score})`);
  sections.push(`Type: ${data.type === 'classic-style' ? '🏛️ Classic Style' : '🚀 Design Trend'}`);

  if (data.description) {
    sections.push(`\n${data.description}`);
  }

  if (data.visualCharacteristics?.length > 0) {
    sections.push(`\n**Visual Style:**\n${formatList(data.visualCharacteristics)}`);
  }

  if (data.colors?.schemes?.length > 0) {
    sections.push(`\n**Color Schemes:**\n${formatList(data.colors.schemes)}`);
    if (data.colors.guidance) {
      sections.push(`_${data.colors.guidance}_`);
    }
  }

  if (data.typography) {
    if (data.typography.styles?.length > 0) {
      sections.push(`\n**Typography:**\n${formatList(data.typography.styles)}`);
    }
    if (data.typography.fonts?.length > 0) {
      sections.push(`**Font Suggestions:** ${data.typography.fonts.slice(0, 3).join(', ')}`);
    }
    if (data.typography.guidance) {
      sections.push(`_${data.typography.guidance}_`);
    }
  }

  if (data.keyElements?.length > 0) {
    sections.push(`\n**Key Elements:** ${data.keyElements.slice(0, 4).join(', ')}`);
  }

  if (data.useCases?.length > 0) {
    sections.push(`**Best For:** ${data.useCases.slice(0, 3).join(', ')}`);
  }

  if (data.industries?.length > 0) {
    sections.push(`**Industries:** ${data.industries.slice(0, 3).join(', ')}`);
  }

  if (data.relatedDesigns?.length > 0) {
    sections.push(`**Related Styles:** ${data.relatedDesigns.slice(0, 3).join(', ')}`);
  }

  return sections.join('\n');
}

/**
 * Format font result with characteristics and pairings
 */
function formatFontResult(data: any, index: number): string {
  const score = data.score?.toFixed(2) || 'N/A';
  const sections: string[] = [];

  sections.push(`**${index + 1}. ${data.name}** (relevance: ${score})`);

  if (data.category) {
    sections.push(`Category: ${data.category}`);
  }

  if (data.description) {
    sections.push(`\n${data.description}`);
  }

  if (data.characteristics?.length > 0) {
    sections.push(`\n**Characteristics:**\n${formatList(data.characteristics)}`);
  }

  if (data.useCases?.length > 0) {
    sections.push(`**Best For:** ${data.useCases.slice(0, 3).join(', ')}`);
  }

  if (data.pairsWith?.length > 0) {
    sections.push(`**Pairs Well With:** ${data.pairsWith.slice(0, 3).join(', ')}`);
  }

  if (data.variants?.length > 0) {
    sections.push(`**Available Weights:** ${data.variants.join(', ')}`);
  }

  return sections.join('\n');
}

/**
 * Format complete search results with header and tips
 */
function formatSearchResults(query: string, results: any[]): string {
  const sections: string[] = [];

  sections.push(
    `🎨 Found ${results.length} design inspiration${results.length !== 1 ? 's' : ''} for "${query}":\n`
  );

  results.forEach((item, index) => {
    const data = item.value as any;

    const isFont = data.category || data.pairsWith;
    const formattedResult = isFont
      ? formatFontResult(data, index)
      : formatDesignResult(data, index);

    sections.push(formattedResult);
    sections.push('\n---\n');
  });

  sections.push('💡 **Tips:**');
  sections.push('* Use these inspirations to inform your design decisions');
  sections.push('* Adapt elements to match your specific requirements');

  if (results.length > 0 && results[0]) {
    const firstResult = results[0].value as any;
    if (firstResult?.name) {
      sections.push(
        `* Search for specific aspects (e.g., "${firstResult.name} colors" or "${firstResult.name} typography")`
      );
    }
  }

  return sections.join('\n').trim();
}

/**
 * RAG Search Tool for Design Inspiration
 *
 * Search through curated design styles, trends, and patterns for inspiration.
 * Use this to find design inspiration, color schemes, typography suggestions,
 * and visual style references.
 */
export const ragSearchAITool: Tool = createTool(
  'Search for design inspiration, styles, trends, and Google Fonts using semantic similarity. Use collection="design" for general design inspiration, or collection="fonts" for Google Fonts typography recommendations. Returns relevant results from curated knowledge bases.',
  z.object({
    query: z
      .string()
      .describe(
        'Search query (e.g., "minimalist color schemes", "modern sans-serif fonts for tech", "corporate design trends")'
      ),
    collection: z
      .string()
      .default('designs')
      .describe(
        'Knowledge base to search: "design" for design styles/trends, "fonts" for Google Fonts (default: "design")'
      ),
    limit: z
      .number()
      .default(5)
      .describe('Maximum number of results to return (default: 5, max: 20)'),
    score_threshold: z
      .number()
      .default(0.7)
      .describe('Minimum similarity score threshold (0-1, default: 0.7, higher = more relevant)')
  }),
  async (input) => {
    const limit = Math.min(input.limit || 5, 20);

    const aliases = new Map<string, string>([
      ['design', 'designs'],
      ['font', 'fonts']
    ]);

    const collection = aliases.get(input.collection) || input.collection;
    const result = await ragTool.search({
      query: input.query,
      collection: collection || 'designs',
      limit,
      score_threshold: input.score_threshold
    } as RagSearchOptions);

    if (!result.success) {
      throw new Error(result.error || 'Failed to search design knowledge base');
    }

    if (!result.results || result.results.length === 0) {
      return formatNoResultsMessage(input.query);
    }

    return formatSearchResults(input.query, result.results);
  }
);

