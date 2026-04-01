/**
 * Transfer Validation Route
 *
 * Checks whether an app is eligible for ownership transfer by inspecting
 * agent-side state (e.g. GoDaddy Commerce OAuth tokens). Called by the
 * BFF before the transfer dialog is opened.
 *
 * GET /apps/:id/transfer/validate
 */

import { Router, Request, Response, IRouter } from 'express';

import { oauthTokenRepository } from '../../database/repositories/index.js';
import { Logger } from '../../logging/index.js';
import { getErrorMessage } from '../../utils/error.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';

const router: IRouter = Router();
const logger = Logger.create({ component: 'transfer-validate-routes' });

router.use('/apps/:id/transfer/validate', validateAppOwnership);

/**
 * GET /apps/:id/transfer/validate
 *
 * Returns transfer eligibility for the app. Currently checks whether
 * a GoDaddy Commerce OAuth token exists for the app.
 *
 * Response: { canTransfer: boolean, gdCommerce: boolean }
 */
router.get('/apps/:id/transfer/validate', (req: Request, res: Response) => {
  const appId = req.params.id!;

  try {
    const token = oauthTokenRepository.findOne(appId, 'godaddy');
    const gdCommerce = token !== null;

    logger.info('transfer.validate.checked', { appId, gdCommerce });

    res.json({ canTransfer: !gdCommerce, gdCommerce });
  } catch (error) {
    logger.error('transfer.validate.error', {
      appId,
      error: getErrorMessage(error),
    });
    res.status(500).json({ error: 'Failed to validate transfer eligibility' });
  }
});

export default router;
