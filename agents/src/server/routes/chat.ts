import { Router } from 'express';
import { globalTracer } from '../../utils/index.js';

const router = Router();



/**
 * GET /agent/traces - Get tracing information for debugging
 */
router.get('/traces', (req, res) => {
  const { agentId, threadId, type, since } = req.query;
  
  const filters: any = {};
  if (agentId) filters.agentId = agentId as string;
  if (threadId) filters.threadId = threadId as string;
  if (type) filters.type = type as string;
  if (since) filters.since = new Date(since as string);
  
  const events = globalTracer.getEvents(filters);
  
  res.json({
    total: events.length,
    filters,
    events: events.slice(0, 100), // Limit to last 100 events
  });
});

/**
 * DELETE /agent/traces - Clear traces
 */
router.delete('/traces', (req, res) => {
  globalTracer.clear();
  res.json({ message: 'Traces cleared' });
});



export { router as chatRouter };
