import { Router, type IRouter } from 'express';
import { getModelInfo, isModelSupported, validateModelEnvironment } from '@airo/ai-lib';

import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';
import { ALLOWED_OVERRIDE_MODELS } from '../constants.js';

const router: IRouter = Router();

/**
 * GET /models — Returns models available for override selection.
 * Gated by the modelSelectorEnabled JWT claim.
 */
router.get('/models', (req, res) => {
  const agentContext = (req as AuthenticatedRequest).agentContext;
  if (!agentContext?.modelSelectorEnabled) {
    res.status(403).json({ error: 'Model selection is not enabled' });
    return;
  }

  const seen = new Set<string>();
  const models = [...ALLOWED_OVERRIDE_MODELS]
    .filter(name => isModelSupported(name) && validateModelEnvironment(name))
    .map(name => getModelInfo(name))
    .filter(info => !info.shortName.match(/^(sonnet|haiku)$/))
    .filter(info => {
      if (seen.has(info.fullName)) return false;
      seen.add(info.fullName);
      return true;
    });

  res.json({ models });
});

export default router;
