import express, { Request, Response, Router } from 'express';
import logger from '../utils/logger';

const router: Router = express.Router();

/**
 * Get public key from SSO and return it
 * GET /v1/api/key/:kid
 *
 * Simple proxy to fetch public keys from SSO service
 * Agents will handle JWK to PEM conversion and JWT validation
 */
router.get('/v1/api/key/:kid', async (req: Request, res: Response): Promise<void> => {
  const { kid } = req.params;
  const requestId = String((req as { id?: string | number }).id ?? 'sso-' + Date.now());

  try {
    const ssoHost = process.env.AGENT_SSO_HOST ?? 'sso.test-godaddy.com';
    const keyUrl = `https://${ssoHost}/v1/api/key/${kid}`;

    const response = await fetch(keyUrl, {
      headers: { 'User-Agent': 'airo-proxy/2.0.0' }
    });

    if (!response.ok) {
      logger.warn('SSO public key fetch failed', {
        requestId,
        kid,
        statusCode: response.status
      });

      res.status(response.status).json({
        error: 'Failed to fetch public key from SSO'
      });
      return;
    }

    const publicKeyResponse = await response.text();

    // Return raw response from SSO (JWK format)
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(publicKeyResponse);

  } catch (error: unknown) {
    logger.error('SSO public key fetch error', {
      requestId,
      kid,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

export default router;
