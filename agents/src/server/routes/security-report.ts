import fs from 'node:fs/promises';
import path from 'node:path';
import { Router, Request, Response, IRouter } from 'express';
import { AppRepository } from '../../database/index.js';
import { Logger } from '../../logging/index.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';

const router: IRouter = Router();
const appRepo = new AppRepository();
const logger = Logger.create({ component: 'security-report-routes' });

router.use('/apps/:id([a-z0-9]{10})', validateAppOwnership);

/**
 * GET /apps/:id/security-report - Fetch the most recent stored security scan result
 *
 * Returns the latest entry from .airo/security-report.json.
 * Returns 404 if no report has been stored yet.
 */
router.get('/apps/:id/security-report', async (req: Request, res: Response) => {
  const { id: appId } = req.params;

  if (!appId) {
    return res.status(400).json({ error: 'App ID is required' });
  }

  const app = appRepo.findById(appId);
  if (!app) {
    return res.status(404).json({ error: 'App not found' });
  }

  const reportPath = path.join(app.path, '.airo', 'security-report.json');

  let raw: string;
  try {
    raw = await fs.readFile(reportPath, 'utf-8');
  } catch {
    return res.status(404).json({ error: 'No security report found' });
  }

  let file: { version: number; reports: Array<{ id: string; scannedAt: string; executionTime: number; result: unknown }> };
  try {
    file = JSON.parse(raw);
  } catch {
    logger.warn('security-report.api.parse.failure', { appId });
    return res.status(500).json({ error: 'Security report file is corrupt' });
  }

  const latest = Array.isArray(file.reports) ? file.reports[0] : undefined;
  if (!latest) {
    return res.status(404).json({ error: 'No security report found' });
  }

  logger.info('security-report.api.fetch.success', { appId, scannedAt: latest.scannedAt });

  return res.json({
    scannedAt: latest.scannedAt,
    executionTime: latest.executionTime,
    result: latest.result,
  });
});

export default router;
