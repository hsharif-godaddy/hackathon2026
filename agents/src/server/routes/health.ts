import { Router, IRouter } from 'express';
import { logger } from '../../logging/index.js';
import { getConversationTokenStore } from '../../memory/adapters/index.js';

const router: IRouter = Router();
const tokens = getConversationTokenStore();

/**
 * GET /health - Health check endpoint
 * Returns basic health information (no detailed stats)
 * For detailed V8 heap diagnostics, use /diagnostics/memory endpoint
 */
router.get('/', async (req, res) => {
  let status = 'healthy';

  let lastMessage: string | null = null;
  try {
    lastMessage = await tokens.getLastMessageTimestamp();
  } catch (error) {
    status = 'degraded';
    logger.warn('health.lastMessage.failure', {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  res.json({
    status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || '0.1.0',
    agent_version: process.env.AGENT_IMAGE_TAG || 'unknown',
    // Remove dev_app_version once we have switched to preview_app_version
    dev_app_version: process.env.DEV_APP_IMAGE_TAG || 'unknown',
    preview_app_version: process.env.PREVIEW_APP_IMAGE_TAG || process.env.DEV_APP_IMAGE_TAG || 'unknown',
    publish_app_version: process.env.PUBLISH_APP_IMAGE_TAG || 'unknown',
    pre_start_version: process.env.PRE_START_IMAGE_TAG || 'unknown',
    last_message_at: lastMessage,
  });
});

export const healthRouter = router;
