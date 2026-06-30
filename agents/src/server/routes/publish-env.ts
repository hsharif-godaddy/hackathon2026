import { Router, Request, Response, IRouter } from 'express';

import { collectPublishEnv } from '../../publish-env/collect.js';
import { discoverPublishEnvContributors } from '../../publish-env/discover.js';
import { Logger } from '../../logging/index.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';

const router: IRouter = Router();
const logger = Logger.create({ component: 'publish-env-routes' });

router.get('/:id([a-z0-9]{10})/publish-env', validateAppOwnership, async (req: Request, res: Response) => {
  const appId = req.params.id!;

  try {
    const contributors = await discoverPublishEnvContributors();
    const publishEnv = await collectPublishEnv(appId, contributors);
    res.json(publishEnv);
  } catch (error) {
    logger.error('publish_env.collect.failed', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to collect publish env' });
  }
});

export default router;
