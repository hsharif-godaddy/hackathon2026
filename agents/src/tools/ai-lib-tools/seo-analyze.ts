import { createTool } from '@airo/ai-lib';
import { z } from 'zod';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { formatSeoAuditSummary, buildSeoAuditExecutionContext, runSeoCheck } from '../../services/seo-audit.js';
import { resolveSiteSeoContextFromToolContext } from '../../services/site-published-url.js';
import {
  buildSeoStrategyContext,
  seoStrategyInputSchema,
} from '../../services/seo-strategy-context.js';
import { getErrorMessage } from '../../utils/error.js';
import { logger } from '../../logging/index.js';

const appRepo = new AppRepository();

const seoAnalyzeInputSchema = seoStrategyInputSchema.extend({
  includeAudit: z
    .boolean()
    .optional()
    .describe('When true (default), run technical SEO audit and show the report widget with strategy context'),
  includeSourceScan: z
    .boolean()
    .optional()
    .describe('When includeAudit is true: scan src/pages for Helmet and seo-routes (default true)'),
  useCachedAudit: z
    .boolean()
    .optional()
    .describe('When includeAudit is true: reuse a recent audit if still fresh (default true)'),
});

export const seoAnalyze = createTool(
  'Runs SEO analysis: business/strategy context plus a structured technical audit report (default). Use includeAudit:false for strategy text only.',
  seoAnalyzeInputSchema,
  async (input, context) => {
    const appId = context?.metadata?.appId as string | undefined;
    if (!appId) {
      throw new Error('App ID is required for SEO analysis');
    }

    const app = appRepo.findById(appId);
    if (!app?.path) {
      throw new Error(`App '${appId}' not found`);
    }

    const includeAudit = input.includeAudit !== false;
    const { includeAudit: _ia, includeSourceScan, useCachedAudit, ...strategyInput } = input;

    const contextLogger = logger.withContext({
      toolName: 'seoAnalyze',
      appId,
    });

    contextLogger.info('seo_analyze.begin', {
      appPath: app.path,
      includeAudit,
      hasBusinessInfo: Boolean(strategyInput.businessInfo),
      hasKeywords: !!strategyInput.targetKeywords?.length,
      hasQuestions: !!strategyInput.targetQuestions?.length,
    });

    try {
      if (includeAudit) {
        const siteSeo = await resolveSiteSeoContextFromToolContext(appId, context);
        const report = await runSeoCheck({
          appId,
          appPath: app.path,
          publishedUrl: siteSeo.publishedUrl,
          previewUrl: siteSeo.previewUrl ?? app.previewUrl ?? null,
          isPublished: siteSeo.isPublished,
          includeSourceScan: includeSourceScan !== false,
          useCachedAudit: useCachedAudit !== false,
          strategyInput,
          appDisplayName: app.name,
          executionContext: buildSeoAuditExecutionContext(context),
        });

        const summary = formatSeoAuditSummary(report);
        const offerFix = report.summary.issueCount > 0;
        const strategyName = report.strategy?.businessInfo.name ?? 'your site';

        contextLogger.info('seo_analyze.complete', {
          appId,
          includeAudit: true,
          issueCount: report.summary.issueCount,
        });

        return {
          success: true,
          widgetType: 'seo-audit-report',
          widgetData: {
            type: 'seo-audit-report',
            appId,
            report,
            offerFix,
          },
          message: `${summary}

Strategy context prepared for ${strategyName}.

${offerFix
  ? 'STOP — analysis complete. Do not edit code in this turn. Tell the user the report is above and they can click "Fix SEO issues" when ready.'
  : 'No critical technical issues in the audit. You may note optional strategy enhancements only if the user asks.'}`,
          analysisGuidance: report.strategy?.analysisGuidance,
        };
      }

      const strategy = buildSeoStrategyContext(strategyInput, { appName: app.name });

      contextLogger.info('seo_analyze.complete', {
        appId,
        includeAudit: false,
        hasBusinessContext: true,
      });

      return {
        success: true,
        message: `SEO analysis context prepared for ${strategy.businessInfo.name}`,
        analysisContext: {
          appId,
          appPath: app.path,
          businessInfo: strategy.businessInfo,
          ...(strategy.targetKeywords && { targetKeywords: strategy.targetKeywords }),
          ...(strategy.targetQuestions && { targetQuestions: strategy.targetQuestions }),
          ...(strategy.competitorUrls && { competitorUrls: strategy.competitorUrls }),
          ...(strategy.brandVoice && { brandVoice: strategy.brandVoice }),
          ...(strategy.uniqueSellingPoints && { uniqueSellingPoints: strategy.uniqueSellingPoints }),
        },
        analysisGuidance: strategy.analysisGuidance,
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
  },
);
