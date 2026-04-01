import { Router, Request, Response, IRouter } from 'express';
import { z } from 'zod';
import { Logger } from '../../logging/index.js';
import { SecretsScannerTool, SecretsScannerOptions } from '../../tools/secrets-scanner-tool.js';
import { removeUndefined } from '../../utils/remove-undefined.js';

const router: IRouter = Router();
const secretsScanner = new SecretsScannerTool();
const logger = Logger.create({ component: 'secrets-scan-routes' });

const secretsScanSchema = z.object({
  workingDir: z.string().optional(),
  timeout: z.number().min(1000).max(300000).optional(),
  skipSemgrep: z.boolean().optional().default(false),
  forceRescan: z.boolean().optional().default(false),
});

/**
 * POST /apps/:id/secrets-scan - Run comprehensive secrets scan
 *
 * This endpoint runs a comprehensive secrets scan using:
 * - gitleaks for detecting hard-coded credentials, API keys, tokens
 * - Semgrep (optional) for additional pattern-based secret detection
 *
 * This is part of the go-live flow and does NOT call the dev agent.
 */
router.post('/apps/:id/secrets-scan', async (req: Request, res: Response) => {
  try {
    const { id: appId } = req.params;

    if (!appId) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const parsedOptions = secretsScanSchema.safeParse(req.body);
    if (!parsedOptions.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: z.treeifyError(parsedOptions.error),
      });
    }
    // Remove undefined values to satisfy exactOptionalPropertyTypes
    const options = removeUndefined(parsedOptions.data) as SecretsScannerOptions;

    logger.info('secrets-scan.api.start', {
      appId,
      options,
    });

    const result = await secretsScanner.scan(appId, options);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Secrets scan failed',
        executionTime: result.executionTime,
      });
    }

    logger.info('secrets-scan.api.complete', {
      appId,
      executionTime: result.executionTime,
      findingsCount: result.findings.length,
      cached: result.cached,
    });

    return res.json(result);
  } catch (error) {
    logger.error('secrets-scan.api.error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return res.status(500).json({
      success: false,
      error: 'Secrets scan failed',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
