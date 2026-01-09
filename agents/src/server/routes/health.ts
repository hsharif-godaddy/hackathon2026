import { conversationRepository } from '../../database/repositories/index.js';
import { AgentRegistry } from '../../registry/index.js';
import { Router, IRouter } from 'express';
import { logger } from '../../logging/index.js';

const router: IRouter = Router();
const registry = AgentRegistry.getInstance();

/**
 * GET /health - Health check endpoint
 */
router.get('/', async (req, res) => {
  let status = 'healthy';
  const stats = registry.getStats();

  let lastMessage: string | null = null;
  try {
    lastMessage = await conversationRepository.getLastMessageTimestamp();
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
    registry: stats,
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

/**
 * GET /health/agents - Detailed agent health check
 */
router.get('/agents', async (req, res, next) => {
  try {
    const validation = await registry.validateAll();

    res.json({
      status: validation.invalid.length === 0 ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      agents: {
        valid: validation.valid,
        invalid: validation.invalid,
        total: validation.valid.length + validation.invalid.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

export { router as healthRouter };
