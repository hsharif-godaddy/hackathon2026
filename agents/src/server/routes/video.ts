import { Router, Request, Response, IRouter } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { generateVideo } from '../../tools/video-generation-tool.js';
import { errorToLogError, log } from '../../logging/index.js';
import { requirePermission } from '../middleware/require-permission.js';

const router: IRouter = Router();
const appRepo = new AppRepository();
const APPS_BASE_DIR = process.env.APPS_BASE_DIR || '/tmp/apps';

/**
 * POST /:id/generate-video - Generate AI video with intelligent prompt from app summary
 *
 * Requires JWT with canPublish=true permission (Airo Plus subscription).
 *
 * Checks for existing go_live-* video in the app's public/images folder first.
 * If found, returns the existing video immediately without regenerating.
 * If not found, generates a new professional video prompt based on the app's conversation summary,
 * then uses that prompt to generate a 12-second portrait video (720x1280) using OpenAI Sora-2.
 *
 * Portrait format (9:16) is optimized for mobile viewing and social media platforms
 * (Instagram Reels, YouTube Shorts, TikTok).
 *
 */
router.post('/:id/generate-video', requirePermission('canPublish'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const contextLogger = log.forApp(id);
    const app = appRepo.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    // Fixed parameters for video generation
    const duration = 12;
    const resolution = '720x1280'; // Portrait format (9:16) for mobile/social media

    // Check if video already exists before generating
    const appPath = path.join(APPS_BASE_DIR, id);
    const appSubdirPath = path.join(appPath, 'app');
    const hasAppSubdir = fs.existsSync(appSubdirPath);

    // In local mode: /tmp/apps/{appId}/app/public/images
    // In deployed mode: /tmp/apps/{appId}/public/images
    const publicDir = hasAppSubdir
      ? path.join(appSubdirPath, 'public')
      : path.join(appPath, 'public');
    const imagesDir = path.join(publicDir, 'images');

    // Look for existing go_live video
    if (fs.existsSync(imagesDir)) {
      try {
        const files = fs.readdirSync(imagesDir);
        const existingVideo = files.find(file => file.startsWith('go_live-') && file.endsWith('.mp4'));

        if (existingVideo) {
          const filepath = path.join(imagesDir, existingVideo);
          const publicPath = `/images/${existingVideo}`;
          const videoUrl = app?.previewUrl
            ? `${app.previewUrl.replace(/\/+$/, '')}${publicPath}`
            : publicPath;

          contextLogger.info('route.video.generate.existing-found', {
            filename: existingVideo,
            publicPath,
            url: videoUrl
          });

          return res.json({
            success: true,
            video: {
              url: videoUrl,
              publicPath,
              filepath,
              jobId: 'existing'
            }
          });
        }
      } catch (error) {
        contextLogger.warn('route.video.generate.check-existing-failed', {
          error: error instanceof Error ? error.message : String(error),
          message: 'Failed to check for existing video, will proceed with generation'
        });
      }
    }

    contextLogger.info('route.video.generate.begin', {
      duration,
      resolution
    });

    // Generate video (tool will generate prompt from app summary internally)
    const result = await generateVideo({
      appId: id,
      duration,
      resolution
    });

    if (!result.success) {
      contextLogger.error('route.video.generate.failed', {
        error: result.error
      });
      return res.status(500).json({
        error: 'Video generation failed',
        details: result.error
      });
    }

    contextLogger.info('route.video.generate.success', {
      url: result.url,
      publicPath: result.publicPath,
      jobId: result.jobId
    });

    return res.json({
      success: true,
      video: {
        url: result.url,
        publicPath: result.publicPath,
        filepath: result.filepath,
        jobId: result.jobId
      }
    });
  } catch (error) {
    const contextLogger = req.params.id ? log.forApp(req.params.id) : log.forAgent('video-routes');
    contextLogger.error('route.video.generate.error', error as Error, {
      error: errorToLogError(error as Error)
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
