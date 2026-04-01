import { Router, Request, Response, IRouter } from 'express';
import { z } from 'zod';
import {
  SecurityMisconfigurationScannerTool,
  SecurityMisconfigurationScannerOptions,
} from '../../tools/security-misconfiguration-scanner-tool.js';
import { Logger } from '../../logging/index.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { removeUndefined } from '../../utils/remove-undefined.js';

const router: IRouter = Router();
const scanner = new SecurityMisconfigurationScannerTool();
const logger = Logger.create({ component: 'security-misconfig-scan-routes' });

const securityMisconfigScanSchema = z.object({
  workingDir: z.string().optional(),
  timeout: z.number().min(1000).max(300000).optional(),
  skipSemgrep: z.boolean().optional().default(false),
  strictness: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  ignorePaths: z.array(z.string()).optional(),
  allowHttpHosts: z.array(z.string()).optional(),
  adminRoutePatterns: z.array(z.string()).optional(),
});

/**
 * POST /apps/:id/security-misconfig-scan - Run security misconfiguration scan
 *
 * This endpoint runs a hybrid scan (Semgrep + static inspection) to detect:
 * - Admin routes likely exposed without protection
 * - Unprotected endpoints (heuristic)
 * - Missing rate limits
 * - Misconfigured CORS policies
 * - HTTP usage where HTTPS is expected
 * - Missing security headers signals
 *
 * This is a standalone pre-flight check that must be explicitly triggered by the user
 * via the SecurityPanel UI. It does NOT call the dev agent.
 */
router.post('/apps/:id/security-misconfig-scan', validateAppOwnership, async (req: Request, res: Response) => {
  try {
    const { id: appId } = req.params;
    if (!appId) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const parsedOptions = securityMisconfigScanSchema.parse(req.body);
    const options = removeUndefined(parsedOptions) as SecurityMisconfigurationScannerOptions;

    logger.info('security-misconfig-scan.api.start', { appId, options });

    const result = await scanner.scan(appId, options);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Security misconfiguration scan failed',
        executionTime: result.executionTime,
      });
    }

    logger.info('security-misconfig-scan.api.complete', {
      appId,
      executionTime: result.executionTime,
      issuesFound: result.summary.total,
      high: result.summary.high,
      critical: result.summary.critical,
    });

    return res.json(result);
  } catch (error) {
    logger.error('security-misconfig-scan.api.error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return res.status(500).json({
      success: false,
      error: 'Security misconfiguration scan failed',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;

