import { Router, type Request, type Response } from 'express';

import {
  AdSenseSettingsFileService,
  AdSenseSettingsValidationError,
} from '../../services/AdSenseSettingsFileService.js';
import { Logger } from '../../logging/index.js';
import { WorkspaceUnavailableError } from '../../workspace/errors.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { asyncHandler } from '../middleware/async-handler.js';

const router: Router = Router();
const settingsService = new AdSenseSettingsFileService();
const logger = Logger.create({ component: 'adsense-routes' });

router.use('/apps/:id', validateAppOwnership);

router.get('/apps/:id/adsense', asyncHandler(async (req: Request, res: Response) => {
  const { id: appId } = req.params;

  if (!appId) {
    return res.status(400).json({ error: 'App ID is required' });
  }

  logger.info('adsense.settings.read.begin', { appId });

  try {
    const settings = await settingsService.readSettings(appId);
    return res.json(settings);
  } catch (error) {
    return handleAdSenseRouteError(error, appId, 'read', res);
  }
}));

router.put('/apps/:id/adsense', asyncHandler(async (req: Request, res: Response) => {
  const { id: appId } = req.params;

  if (!appId) {
    return res.status(400).json({ error: 'App ID is required' });
  }

  logger.info('adsense.settings.save.begin', { appId });

  try {
    const settings = await settingsService.saveSettings(appId, req.body);
    return res.json(settings);
  } catch (error) {
    return handleAdSenseRouteError(error, appId, 'save', res);
  }
}));

function handleAdSenseRouteError(
  error: unknown,
  appId: string,
  operation: 'read' | 'save',
  res: Response,
): Response | void {
  if (error instanceof AdSenseSettingsValidationError) {
    logger.warn('adsense.settings.save.validation_failed', {
      appId,
      fields: Object.keys(error.errors),
    });
    return res.status(400).json({
      error: 'Invalid AdSense settings',
      fields: error.errors,
    });
  }

  if (error instanceof WorkspaceUnavailableError) {
    logger.warn(`adsense.settings.${operation}.workspace_unavailable`, { appId });
    return res.status(404).json({ error: 'App not found' });
  }

  logger.error(`adsense.settings.${operation}.failed`, {
    appId,
    error: error instanceof Error ? error.message : String(error),
  });
  throw error;
}

export default router;
