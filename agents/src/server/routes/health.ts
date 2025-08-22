import { Router, IRouter } from 'express';
import { AgentRegistry } from '../../registry/index.js';

const router: IRouter = Router();
const registry = AgentRegistry.getInstance();

/**
 * GET /health - Health check endpoint
 */
router.get('/', async (req, res) => {
  const stats = registry.getStats();
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    registry: stats,
    version: process.env.npm_package_version || '0.1.0',
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
