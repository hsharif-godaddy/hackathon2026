import { Router, IRouter } from 'express';
import { NotFoundError } from '../middleware/index.js';
import { aiLibAgentMetadata } from '../../agents/ai-lib-agents/index.js';

const router: IRouter = Router();

/**
 * GET /agents - List all available agents (using AI-Lib agents)
 */
router.get('/', (req, res) => {
  // Use AI-Lib agent metadata (same as WebSocket system)
  const agentList = Object.values(aiLibAgentMetadata);
  
  res.json({
    agents: agentList.map(metadata => ({
      id: metadata.id,
      name: metadata.name,
      description: metadata.description,
      version: metadata.version,
      tags: metadata.tags,
      toolCount: metadata.toolGroups.length,
      hasContextBuilder: true, // AI-Lib agents always have context
      handoffCount: 0, // Available in AI-Lib but not exposed in metadata
    })),
    total: agentList.length,
  });
});

/**
 * GET /agents/:agentId - Get specific agent information (using AI-Lib agents)
 */
router.get('/:agentId', async (req, res, next) => {
  try {
    const { agentId } = req.params;
    
    // Check if agent exists in AI-Lib metadata
    const metadata = aiLibAgentMetadata[agentId];
    if (!metadata) {
      throw new NotFoundError(`Agent '${agentId}' not found`);
    }
    
    res.json({
      id: metadata.id,
      name: metadata.name,
      description: metadata.description,
      version: metadata.version,
      tags: metadata.tags,
      toolGroups: metadata.toolGroups,
      hasContextBuilder: true,
      handoffCount: 0, // Available in AI-Lib but not exposed in metadata
    });
  } catch (error) {
    next(error);
  }
});



export { router as agentsRouter };
