import { Router, Request, Response, IRouter } from 'express';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { generateVideo } from '../../tools/video-generation-tool.js';
import { errorToLogError, log } from '../../logging/index.js';

const router: IRouter = Router();
const appRepo = new AppRepository();

/**
 * POST /video/:id/generate - Generate AI video with intelligent prompt from app summary
 * 
 * This endpoint generates a professional video prompt based on the app's conversation summary,
 * then uses that prompt to generate a 12-second portrait video (720x1280) using OpenAI Sora-2.
 * 
 * Portrait format (9:16) is optimized for mobile viewing and social media platforms
 * (Instagram Reels, YouTube Shorts, TikTok).
 * 
 * No request body required - generates everything from the app's conversation summary.
 */
router.post('/:id/generate-video', async (req: Request, res: Response) => {
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
