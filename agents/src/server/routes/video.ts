import { Router, Request, Response, IRouter } from 'express';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { errorToLogError, log } from '../../logging/index.js';
import { requirePermission } from '../middleware/require-permission.js';
import { startVideoGeneration } from '../../tools/video-generation-tool.js';

const router: IRouter = Router();
const appRepo = new AppRepository();

/**
 * POST /:id/generate-video - Start or poll AI video generation (non-blocking)
 *
 * Requires JWT with canPublish=true permission (Airo Plus subscription).
 *
 * This endpoint is idempotent and can be used for both starting generation and polling:
 * Portrait format (9:16) is optimized for mobile viewing and social media platforms
 * (Instagram Reels, YouTube Shorts, TikTok).
 */
router.post('/:id/generate-video', requirePermission('canPublish'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required', status: 'failed' });
    }

    const contextLogger = log.forApp(id);
    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found', status: 'failed' });
    }

    // Fixed parameters for video generation
    const duration = 12;
    const resolution = '720x1280'; // Portrait format (9:16) for mobile/social media

    contextLogger.info('route.video.generate.request', { duration, resolution });

    const result = await startVideoGeneration({
      appId: id,
      duration,
      resolution
    });

    contextLogger.info('route.video.generate.response', { status: result.status, url: result.url });

    return res.json({
      success: result.status !== 'failed',
      status: result.status,
      url: result.url || null,
      error: result.error
    });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : log.forAgent('video-routes');
    contextLogger.error('route.video.generate.error', error as Error, {
      error: errorToLogError(error as Error)
    });
    return res.status(500).json({ error: 'Internal server error', status: 'failed' });
  }
});

export default router;
