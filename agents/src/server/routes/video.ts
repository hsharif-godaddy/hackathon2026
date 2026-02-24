import { Router, Request, Response, IRouter } from 'express';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { errorToLogError, log } from '../../logging/index.js';
import { requirePermission } from '../middleware/require-permission.js';
import { VideoGenerationTool } from '../../tools/video-generation-tool.js';
import { getSocketIO } from '../ai-lib-websocket-server.js';

const router: IRouter = Router();
const appRepo = new AppRepository();

/**
 * POST /:id/generate-video - Start AI video generation (single request)
 *
 * Requires JWT with canPublish=true permission (Airo Plus subscription).
 * Returns 200 with cached video if already generated, or 202 to indicate
 * the async pipeline has started. Result delivered via WebSocket (eventType "video").
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

    const { publishedUrl } = req.body as { publishedUrl?: string };

    if (publishedUrl !== undefined) {
      try {
        const parsed = new URL(publishedUrl);
        if (parsed.protocol !== 'https:') {
          return res.status(400).json({ error: 'publishedUrl must use https protocol', status: 'failed' });
        }
      } catch {
        return res.status(400).json({ error: 'publishedUrl must be a valid URL', status: 'failed' });
      }
    }

    const duration = 12;
    const resolution = '720x1280';

    contextLogger.info('route.video.generate.request', { duration, resolution, publishedUrl });

    const tool = new VideoGenerationTool({ appId: id, appPath: app.path, previewUrl: app.previewUrl });
    const io = getSocketIO();
    if (io) {
      tool.setSocketIO(io);
    }

    const result = await tool.startGeneration({ duration, resolution, publishedUrl });

    contextLogger.info('route.video.generate.response', { status: result.status, url: result.url });

    const statusCode = result.status === 'completed' ? 200 : result.status === 'failed' ? 500 : 202;
    return res.status(statusCode).json({
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
