import { Router, IRouter } from 'express';
import { AgentRegistry } from '../../registry/index.js';
import { NotFoundError } from '../middleware/index.js';

const router: IRouter = Router();
const registry = AgentRegistry.getInstance();

/**
 * GET /agents - List all available agents
 */
router.get('/', (req, res) => {
  const configs = registry.getEnabledConfigs();
  
  res.json({
    agents: configs.map(config => ({
      id: config.id,
      name: config.name,
      description: config.description,
      version: config.version,
      tags: config.tags,
      toolCount: config.tools.length,
      hasContextBuilder: !!config.contextBuilder,
      handoffCount: config.handoffs?.length || 0,
    })),
    total: configs.length,
  });
});

/**
 * GET /agents/:agentId - Get specific agent information
 */
router.get('/:agentId', async (req, res, next) => {
  try {
    const { agentId } = req.params;
    
    if (!registry.hasAgent(agentId)) {
      throw new NotFoundError(`Agent '${agentId}' not found`);
    }
    
    const config = registry.getAgentConfig(agentId);
    if (!config) {
      throw new NotFoundError(`Agent '${agentId}' configuration not found`);
    }
    
    res.json({
      id: config.id,
      name: config.name,
      description: config.description,
      version: config.version,
      tags: config.tags,
      model: config.model,
      outputType: config.outputType,
      tools: config.tools,
      contextBuilder: config.contextBuilder,
      handoffs: config.handoffs,
    });
  } catch (error) {
    next(error);
  }
});



export { router as agentsRouter };
