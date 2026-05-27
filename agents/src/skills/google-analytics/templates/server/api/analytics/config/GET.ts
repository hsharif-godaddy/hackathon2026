/**
 * Google Analytics Configuration Endpoint
 *
 * Returns the GA4 Measurement ID for client-side analytics initialization.
 * The Measurement ID is stored securely in the secrets manager.
 */

import type { Request, Response } from 'express';

import { getSecret } from '#airo/secrets';

export default async function handler(_req: Request, res: Response): Promise<void> {
  const measurementId = getSecret('GA_MEASUREMENT_ID');

  if (!measurementId) {
    res.status(500).json({ error: 'GA Measurement ID not configured' });
    return;
  }

  res.json({ measurementId });
}
