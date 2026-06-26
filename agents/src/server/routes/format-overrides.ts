import { Router, type Request, type Response } from 'express';

import { Logger } from '../../logging/index.js';
import {
  FormatOverrideNotFoundError,
  FormatOverrideService,
  FormatOverrideValidationError,
} from '../../services/FormatOverrideService.js';
import { WorkspaceUnavailableError } from '../../workspace/errors.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';

const router: Router = Router();
const logger = Logger.create({ component: 'format-overrides-routes' });
const service = new FormatOverrideService();

function statusForError(error: unknown): number {
  if (error instanceof FormatOverrideNotFoundError) return 404;
  if (error instanceof FormatOverrideValidationError) return 400;
  if (error instanceof WorkspaceUnavailableError) return 503;
  return 500;
}

function responseMessageForError(error: unknown): string {
  if (error instanceof FormatOverrideNotFoundError || error instanceof FormatOverrideValidationError) {
    return error.message;
  }
  if (error instanceof WorkspaceUnavailableError) {
    return 'Workspace unavailable';
  }
  return 'Internal server error';
}

router.post('/:id/format-overrides', validateAppOwnership, async (req: Request, res: Response) => {
  const appId = req.params.id;
  if (!appId) {
    return res.status(400).json({ success: false, error: 'App ID is required' });
  }

  try {
    logger.info('route.formatOverrides.update.begin', {
      appId,
      devId: req.body?.devId,
      sourceKind: req.body?.target?.sourceKind,
    });

    const result = await service.update(appId, req.body);
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('route.formatOverrides.update.failed', {
      appId,
      error: message,
    });
    return res.status(statusForError(error)).json({ success: false, error: responseMessageForError(error) });
  }
});

export default router;
