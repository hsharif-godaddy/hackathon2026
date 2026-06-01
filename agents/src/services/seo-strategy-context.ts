import { z } from 'zod';

export const seoBusinessInfoSchema = z.object({
  name: z.string().describe('Business or brand name'),
  type: z
    .string()
    .optional()
    .describe('Business type (e.g., restaurant, SaaS, ecommerce, consulting)'),
  location: z.string().optional().describe('Physical location if applicable'),
  targetAudience: z.string().optional().describe('Primary target audience description'),
});

export const seoStrategyInputSchema = z.object({
  businessInfo: seoBusinessInfoSchema.optional(),
  targetKeywords: z.array(z.string()).optional(),
  targetQuestions: z.array(z.string()).optional(),
  competitorUrls: z.array(z.string()).optional(),
  brandVoice: z.string().optional(),
  uniqueSellingPoints: z.array(z.string()).optional(),
});

export type SeoStrategyInput = z.infer<typeof seoStrategyInputSchema>;

export type SeoBusinessInfo = z.infer<typeof seoBusinessInfoSchema>;

export type SeoStrategyContext = {
  businessInfo: SeoBusinessInfo;
  targetKeywords?: string[];
  targetQuestions?: string[];
  competitorUrls?: string[];
  brandVoice?: string;
  uniqueSellingPoints?: string[];
  analysisGuidance: string;
};

export function generateAnalysisGuidance(context: {
  businessInfo: SeoBusinessInfo;
  targetKeywords?: string[];
  targetQuestions?: string[];
  brandVoice?: string;
  uniqueSellingPoints?: string[];
}): string {
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
  if (uniqueSellingPoints?.length) {
    guidance += `Unique Selling Points:\n${uniqueSellingPoints.map(usp => `- ${usp}`).join('\n')}\n`;
  }
  if (targetKeywords?.length) {
    guidance += `\nTarget Keywords: ${targetKeywords.join(', ')}\n`;
  }
  if (targetQuestions?.length) {
    guidance += `\nTarget Questions:\n${targetQuestions.map(q => `- ${q}`).join('\n')}\n`;
  }

  guidance += `
When fixing or improving pages, consider:
1. How well each page serves the target audience
2. Whether content communicates unique selling points
3. Alignment with brand voice and business goals
4. Natural use of target keywords in titles and meta descriptions
5. Technical issues from the audit report on the same card
`;

  return guidance;
}

export function buildSeoStrategyContext(
  input: SeoStrategyInput,
  defaults: { appName?: string | null },
): SeoStrategyContext {
  const businessInfo: SeoBusinessInfo = {
    name: input.businessInfo?.name?.trim() || defaults.appName?.trim() || 'This business',
    ...(input.businessInfo?.type && { type: input.businessInfo.type }),
    ...(input.businessInfo?.location && { location: input.businessInfo.location }),
    ...(input.businessInfo?.targetAudience && { targetAudience: input.businessInfo.targetAudience }),
  };

  const strategy: SeoStrategyContext = {
    businessInfo,
    analysisGuidance: generateAnalysisGuidance({
      businessInfo,
      ...(input.targetKeywords && { targetKeywords: input.targetKeywords }),
      ...(input.targetQuestions && { targetQuestions: input.targetQuestions }),
      ...(input.brandVoice && { brandVoice: input.brandVoice }),
      ...(input.uniqueSellingPoints && { uniqueSellingPoints: input.uniqueSellingPoints }),
    }),
  };

  if (input.targetKeywords?.length) {
    strategy.targetKeywords = input.targetKeywords;
  }
  if (input.targetQuestions?.length) {
    strategy.targetQuestions = input.targetQuestions;
  }
  if (input.competitorUrls?.length) {
    strategy.competitorUrls = input.competitorUrls;
  }
  if (input.brandVoice) {
    strategy.brandVoice = input.brandVoice;
  }
  if (input.uniqueSellingPoints?.length) {
    strategy.uniqueSellingPoints = input.uniqueSellingPoints;
  }

  return strategy;
}
