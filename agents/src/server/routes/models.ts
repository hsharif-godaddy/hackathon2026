import { Router, type IRouter } from 'express';
import { getCanonicalModelKey, getModelInfo, isModelSupported, validateModelEnvironment } from '@airo/ai-lib';

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

  // Dedup by canonical model key: aliases of the same configured model
  // (e.g. `claude-sonnet-4-5` and `claude-sonnet-4-5-20250929`, or `sonnet` and
  // `claude-sonnet-4-6`) collapse to a single entry, while genuinely distinct
  // variants that happen to share an upstream id (e.g. `azure/Kimi-K2.6` vs
  // `azure/Kimi-K2.6-thinking`) are preserved. The first allowlist entry for a
  // given canonical key wins — and because the isModelSupported /
  // validateModelEnvironment filter runs first, that's the first entry that also
  // passes those checks — so order ALLOWED_OVERRIDE_MODELS with the preferred
  // display name first.
  const seen = new Set<string>();
  const models = [...ALLOWED_OVERRIDE_MODELS]
    .filter(name => isModelSupported(name) && validateModelEnvironment(name))
    .filter(name => {
      const key = getCanonicalModelKey(name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(name => getModelInfo(name));

  res.json({ models });
});

export default router;
