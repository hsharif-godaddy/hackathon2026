/**
 * QA Analysis API Routes
 *
 * Provides endpoints for running semantic QA analysis on app content.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';

import { AppRepository } from '../../database/repositories/AppRepository.js';
import { logger } from '../../logging/index.js';
import { createForWorkspace } from '../../workspace/index.js';
import { qaAnalyzeAITool, markIssuesAsFixed } from '../../tools/ai-lib-tools/qa-analyze.js';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';
import {requirePermission} from "../middleware/index.js";

const qaAnalyzeSchema = z.object({
  appId: z.string(),
  mode: z.enum(['semantic', 'technical', 'full']).optional().default('semantic'),
  forceRefresh: z.boolean().optional().default(false),
});

const markFixedSchema = z.object({
  appId: z.string(),
  runId: z.string(),
  issueIds: z.array(z.string()),
});

const router: Router = Router();
const appRepo = new AppRepository();

router.post('/qa-analyze', requirePermission('canDownload'), async (req: Request, res: Response) => {
  try {
    const { appId, mode, forceRefresh } = qaAnalyzeSchema.parse(req.body);

    logger.info('qa-analyze.api.start', { appId, mode });

    const app = await appRepo.findById(appId);
    if (!app) {
      return res.status(404).json({ error: `App '${appId}' not found` });
    }

    if (!qaAnalyzeAITool.execute) {
      throw new Error('QA analyze tool execute method is not available');
    }

    const result = await qaAnalyzeAITool.execute(
      { mode: mode || 'semantic', forceRefresh },
      {
        toolCallId: 'api-route-call',
        messages: [],
        experimental_context: { metadata: { appId } }
      }
    );

    if (!result.success) {
      logger.error('qa-analyze.api.failed', { appId, error: result.message });
      return res.status(500).json({
        success: false,
        error: result.message || 'QA analysis failed'
      });
    }

    logger.info('qa-analyze.api.complete', {
      appId,
      total: result.report?.summary?.total,
      errors: result.report?.summary?.errors,
      warnings: result.report?.summary?.warnings,
    });

    return res.json({
      success: true,
      report: result.report,
      timestamp: result.timestamp,
      isCached: result.isCached,
      fixedIssueIds: result.fixedIssueIds,
      runId: result.runId,
    });
  } catch (error) {
    logger.error('qa-analyze.api.error', {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });

    return res.status(500).json({
      success: false,
      error: 'QA analysis failed',
      details: (error as Error).message,
    });
  }
});

router.post('/qa-analyze/mark-fixed', async (req: Request, res: Response) => {
  try {
    const { appId, runId, issueIds } = markFixedSchema.parse(req.body);

    const workspace = createForWorkspace(appId, 'preview');
    if (!workspace) {
      return res.status(404).json({ error: `App '${appId}' not found` });
    }

    logger.info('qa-analyze.mark-fixed.start', { appId, runId, issueCount: issueIds.length });

    await markIssuesAsFixed(appId, runId, issueIds);

    logger.info('qa-analyze.mark-fixed.complete', { appId, runId, fixedCount: issueIds.length });

    return res.json({
      success: true,
      message: `Marked ${issueIds.length} issue(s) as fixed`
    });
  } catch (error) {
    logger.error('qa-analyze.mark-fixed.error', {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to mark issues as fixed',
      details: (error as Error).message,
    });
  }
});

export default router;
