import { Router } from 'express';
import { AgentRegistry } from '../../registry/index.js';
import { NotFoundError, BadRequestError } from '../middleware/index.js';

const router = Router();
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
    
    // Get the agent instance to get the system prompt
    const agent = await registry.getAgent(agentId);
    const systemPrompt = await agent.getSystemPrompt();
    
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
      systemPrompt,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /agents/:agentId/system-prompt - Get agent's system prompt
 */
router.get('/:agentId/system-prompt', async (req, res, next) => {
  try {
    const { agentId } = req.params;
    
    if (!registry.hasAgent(agentId)) {
      throw new NotFoundError(`Agent '${agentId}' not found`);
    }
    
    const agent = await registry.getAgent(agentId);
    const systemPrompt = await agent.getSystemPrompt();
    
    res.json({
      agentId,
      systemPrompt,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /agents/search - Search agents by query
 */
router.get('/search', (req, res, next) => {
  try {
    const { q, tag } = req.query;
    
    if (!q && !tag) {
      throw new BadRequestError('Query parameter "q" or "tag" is required');
    }
    
    let results;
    if (tag && typeof tag === 'string') {
      results = registry.findAgentsByTag(tag);
    } else if (q && typeof q === 'string') {
      results = registry.searchAgents(q);
    } else {
      throw new BadRequestError('Invalid search parameters');
    }
    
    res.json({
      query: q || tag,
      agents: results.map(config => ({
        id: config.id,
        name: config.name,
        description: config.description,
        tags: config.tags,
      })),
      total: results.length,
    });
  } catch (error) {
    next(error);
  }
});

export { router as agentsRouter };
