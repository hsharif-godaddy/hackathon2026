import { createTool } from '@airo/ai-lib';
import { z } from 'zod';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { getErrorMessage } from '../../utils/error.js';
import { logger } from '../../logging/index.js';

const appRepo = new AppRepository();

export const seoAnalyze = createTool(
  'Collects business context and app information for intelligent SEO analysis. Returns structured data for the agent to analyze using other tools.',
  z.object({
    businessInfo: z
      .object({
        name: z.string().describe('Business or brand name'),
        type: z
          .string()
          .optional()
          .describe('Business type (e.g., restaurant, SaaS, ecommerce, consulting)'),
        location: z.string().optional().describe('Physical location if applicable'),
        targetAudience: z.string().optional().describe('Primary target audience description'),
      })
      .describe('Essential business context for personalized SEO strategy'),
    targetKeywords: z
      .array(z.string())
      .optional()
      .describe('Keywords the business wants to rank for'),
    targetQuestions: z
      .array(z.string())
      .optional()
      .describe('Questions your target audience is asking'),
    competitorUrls: z
      .array(z.string())
      .optional()
      .describe('Competitor websites for competitive analysis'),
    brandVoice: z
      .string()
      .optional()
      .describe('Brand voice and tone (e.g., professional, friendly, technical)'),
    uniqueSellingPoints: z
      .array(z.string())
      .optional()
      .describe('What makes this business unique'),
  }),
  async (input, context: any) => {
    const appId = context?.metadata?.appId as string;
    if (!appId) {
      throw new Error('App ID is required for SEO analysis');
    }

    const app = appRepo.findById(appId);
    if (!app) {
      throw new Error(`App '${appId}' not found`);
    }

    const contextLogger = logger.withContext({
      toolName: 'seoAnalyze',
      appId,
    });

    contextLogger.info('seo_analyze.begin', {
      appPath: app.path,
      businessInfo: input.businessInfo,
      hasKeywords: !!input.targetKeywords?.length,
      hasQuestions: !!input.targetQuestions?.length,
    });

    try {
      // Build analysis context
      const analysisContext = {
        appId,
        appPath: app.path,
        businessInfo: input.businessInfo,
        ...(input.targetKeywords && { targetKeywords: input.targetKeywords }),
        ...(input.targetQuestions && { targetQuestions: input.targetQuestions }),
        ...(input.competitorUrls && { competitorUrls: input.competitorUrls }),
        ...(input.brandVoice && { brandVoice: input.brandVoice }),
        ...(input.uniqueSellingPoints && { uniqueSellingPoints: input.uniqueSellingPoints }),
      };

      const analysisGuidance = generateAnalysisGuidance(analysisContext);

      contextLogger.info('seo_analyze.complete', {
        appId,
        hasBusinessContext: true,
      });

      return {
        success: true,
        message: `SEO analysis context prepared for ${input.businessInfo.name}`,
        analysisContext,
        analysisGuidance,
        nextSteps: `
Use the following tools to analyze the app:

1. **directoryListing** - Find pages to analyze:
   - Look for pages in common directories (pages/, src/pages/, app/)
   - Identify key pages: home, about, products/services, contact

2. **readFile** - Read page contents:
   - Examine each important page's content and structure
   - Look for metadata, headings, content quality

3. **grepSearch** - Search for specific patterns:
   - Find metadata exports or Head components
   - Search for SEO-related patterns
   - Identify content that matches target keywords

4. **fileEdit** - Make strategic improvements:
   - Update metadata based on business context
   - Improve content to align with brand voice
   - Add structured data where appropriate

Remember: Focus on improvements that make sense for THIS specific business.
        `.trim(),
      };
    } catch (error) {
      contextLogger.error('seo_analyze.error', {
        error: getErrorMessage(error),
      });

      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }
);

function generateAnalysisGuidance(context: any): string {
  const { businessInfo, targetKeywords, targetQuestions, brandVoice, uniqueSellingPoints } = context;

  let guidance = `You are analyzing the SEO for ${businessInfo.name}`;

  if (businessInfo.type) {
    guidance += `, a ${businessInfo.type} business`;
  }
  if (businessInfo.location) {
    guidance += ` located in ${businessInfo.location}`;
  }
  guidance += '.\n\n';

  if (businessInfo.targetAudience) {
    guidance += `Target Audience: ${businessInfo.targetAudience}\n`;
  }
  if (brandVoice) {
    guidance += `Brand Voice: ${brandVoice}\n`;
  }
  if (uniqueSellingPoints?.length > 0) {
    guidance += `Unique Selling Points:\n${uniqueSellingPoints.map((usp: string) => `- ${usp}`).join('\n')}\n`;
  }
  if (targetKeywords?.length > 0) {
    guidance += `\nTarget Keywords: ${targetKeywords.join(', ')}\n`;
  }
  if (targetQuestions?.length > 0) {
    guidance += `\nTarget Questions:\n${targetQuestions.map((q: string) => `- ${q}`).join('\n')}\n`;
  }

  guidance += `
\nWhen analyzing pages, consider:
1. How well each page serves the target audience
2. Whether content effectively communicates the unique selling points
3. Alignment with brand voice and business goals
4. Natural opportunities to incorporate target keywords
5. How to answer target audience questions
6. Technical improvements specific to each page's purpose
7. Content gaps and opportunities

Provide intelligent, context-aware recommendations that make sense for THIS specific business and brand.
`;

  return guidance;
}