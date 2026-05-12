import { createReadStream } from 'node:fs';
import { access, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Router, Request, Response, IRouter } from 'express';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { errorToLogError, log } from '../../logging/index.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { requirePermission } from '../middleware/require-permission.js';
import { VideoGenerationTool } from '../../tools/video-generation-tool.js';
import { getSSEEventChannel } from '../ai-lib-websocket-server.js'
import { getSSERegistry } from '../sse/registry-singleton.js';

const router: IRouter = Router();
const appRepo = new AppRepository();

router.use('/:id', validateAppOwnership);

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
    const sseRegistry = getSSERegistry();
    const eventChannel = getSSEEventChannel();
    if (sseRegistry && eventChannel) {
      tool.setSSERegistry({
        sendEvent: (appId, type, data) => {
          for (const convId of sseRegistry.getConversationsByApp(appId)) {
            eventChannel.publish(convId, {
              conversationId: convId,
              type: type as 'video',
              content: '',
              data: data as Record<string, unknown>,
              agentName: 'system',
            })
          }
        }
      });
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

/**
 * GET /:id/video - Stream the generated launch video file
 *
 * Proxies the video through the agents server so the browser can download it
 * without hitting CORS restrictions on the preview container.
 */
router.get('/:id/video', requirePermission('canPublish'), async (req: Request, res: Response) => {
  const contextLogger = req.params.id ? log.forApp(req.params.id) : log.forAgent('video-routes');
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const videoMetadataPath = path.join(app.path, '.airo', 'video.json');

    let metadata: { status: string; url?: string };
    try {
      metadata = JSON.parse(await readFile(videoMetadataPath, 'utf-8'));
    } catch {
      return res.status(404).json({ error: 'Video not found' });
    }

    if (metadata.status !== 'completed' || !metadata.url) {
      return res.status(404).json({ error: 'Video not ready' });
    }

    const videoPath = path.join(app.path, metadata.url);

    // Prevent path traversal: resolved path must stay within app.path
    const resolvedBase = path.resolve(app.path);
    const resolvedVideo = path.resolve(videoPath);
    if (!resolvedVideo.startsWith(resolvedBase + path.sep)) {
      return res.status(400).json({ error: 'Invalid video path' });
    }

    try {
      await access(videoPath);
    } catch {
      return res.status(404).json({ error: 'Video file not found' });
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="launch-video.mp4"');

    const stream = createReadStream(videoPath);
    stream.on('error', (err) => {
      contextLogger.error('route.video.stream.error', err, { error: errorToLogError(err) });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream video' });
      } else {
        res.destroy();
      }
    });
    return void stream.pipe(res);
  } catch (error) {
    contextLogger.error('route.video.download.error', error as Error, {
      error: errorToLogError(error as Error)
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /:id/video - Delete the generated launch video and its metadata
 *
 * Clears video.json and the video file so the next POST /generate-video
 * will run a fresh generation pipeline instead of returning the cached result.
 */
router.delete('/:id/video', requirePermission('canPublish'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const contextLogger = log.forApp(id);
    const videoMetadataPath = path.join(app.path, '.airo', 'video.json');

    try {
      const metadata: { status: string; url?: string } = JSON.parse(
        await readFile(videoMetadataPath, 'utf-8')
      );
      if (metadata.url) {
        const resolvedBase = path.resolve(app.path);
        const resolvedVideo = path.resolve(path.join(app.path, metadata.url));
        if (resolvedVideo.startsWith(resolvedBase + path.sep)) {
          await unlink(resolvedVideo).catch(() => {});
        }
      }
    } catch {
      // video.json missing — nothing to clean up
    }

    await unlink(videoMetadataPath).catch(() => {});

    contextLogger.info('route.video.delete.success', { appId: id });
    return res.status(204).send();
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : log.forAgent('video-routes');
    contextLogger.error('route.video.delete.error', error as Error, {
      error: errorToLogError(error as Error)
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
