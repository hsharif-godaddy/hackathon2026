import type { SkillToolDefinition } from '@airo/ai-skills';
import { z } from 'zod';

import { AppRepository } from '../../../database/repositories/AppRepository.js';
import { Logger } from '../../../logging/index.js';
import {
  buildSeoAuditExecutionContext,
  formatSeoAuditSummary,
  getCachedSeoAuditReport,
  runAndCacheSeoAudit,
  type SeoAuditReport,
} from '../../../services/seo-audit.js';

const logger = Logger.create({ component: 'seo-skill-audit' });
const appRepo = new AppRepository();

const seoAuditInputSchema = z.object({
  includeSourceScan: z
    .boolean()
    .optional()
    .describe('When true (default), scan src/pages for Helmet usage and seo-routes registration'),
  useCachedReport: z
    .boolean()
    .optional()
    .describe('When true (default), reuse a recent cached audit for this app if still fresh'),
});

export const seoAuditTool: SkillToolDefinition = {
  name: 'audit',
  description: `Run a structured SEO audit for this app.

Returns a user-visible report widget. Checks source files (Helmet tags, seo-routes registration) to reflect the latest code — always runs against source, never fetches the live site.

For a full SEO check (strategy + audit widget), use the global **seoAnalysis** tool. Use this tool only to re-run the technical audit without refreshing strategy.

STOP after this tool: do NOT edit files in the same turn. The UI shows a "Fix SEO issues" button — wait until the user clicks it or explicitly asks you to fix. Do not implement optimizations until then.`,

  parameters: seoAuditInputSchema,

  async execute(input, context) {
    const appId = context?.metadata?.appId as string | undefined;
    if (!appId) {
      throw new Error('App ID is required for SEO audit');
    }

    const app = appRepo.findById(appId);
    if (!app?.path) {
      throw new Error(`App '${appId}' not found`);
    }

    const useCached = input.useCachedReport !== false;
    const cacheLookup = {
      appId,
      includeSourceScan: input.includeSourceScan !== false,
    };
    let report: SeoAuditReport | null = useCached ? getCachedSeoAuditReport(cacheLookup) : null;

    if (!report) {
      logger.info('seo.skill.audit.run', { appId, includeSourceScan: input.includeSourceScan !== false });
      report = await runAndCacheSeoAudit({
        appPath: app.path,
        ...cacheLookup,
        executionContext: buildSeoAuditExecutionContext(
          context as { socketId?: string; metadata?: Record<string, unknown> },
        ),
      });
    } else {
      logger.info('seo.skill.audit.cache-hit', { appId });
    }

    const summary = formatSeoAuditSummary(report);
    const offerFix = report.summary.issueCount > 0;

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

${offerFix
  ? 'STOP — audit complete. Do not call fileEdit, readFile for fixes, or implement SEO changes in this turn. Tell the user the report is above and they can click "Fix SEO issues" or ask you to fix when ready.'
  : 'No critical issues in the audit. You may briefly note optional enhancements only if the user asks — do not bulk-implement without confirmation.'}`,
    };
  },

  config: {
    timeout: 120000,
    requiresApp: true,
    stopAfter: true,
  },
};
