import type { Request, Response } from 'express';
import { getSecret } from '#airo/secrets';
import type { IDXFeaturedResponse } from '../../../../lib/idx-broker/types';

/**
 * API Route: GET /api/idx-broker/featured
 *
 * Fetches featured property listings from IDX Broker API.
 * Requires IDX_BROKER_API_KEY secret to be configured.
 *
 * Response format:
 * - Success: { listings: IDXListing[] }
 * - Error: { error: string }
 */
export default async function handler(_req: Request, res: Response): Promise<void> {
  // Retrieve API key from secrets
  const apiKey = getSecret('IDX_BROKER_API_KEY');

  if (!apiKey || typeof apiKey !== 'string') {
    res.status(500).json({
      error: 'IDX_BROKER_API_KEY not configured. Please add your IDX Broker API key in the secrets settings.',
    });
    return;
  }

  try {
    // Fetch featured listings from IDX Broker API
    const response = await fetch('https://api.idxbroker.com/clients/featured', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'accesskey': apiKey,
        'outputtype': 'json',
      },
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    // Handle authentication errors (invalid API key)
    if (response.status === 401 || response.status === 403) {
      res.status(401).json({
        error: 'Invalid IDX Broker API key. Please check your API key in the secrets settings.',
      });
      return;
    }

    // Handle other API errors
    if (!response.ok) {
      console.error(`IDX Broker API error: ${response.status} ${response.statusText}`);
      res.status(500).json({
        error: `IDX Broker API returned error: ${response.status}`,
      });
      return;
    }

    // Handle empty response (no featured listings)
    const text = await response.text();
    if (!text || text.trim() === '') {
      res.json({ listings: [] });
      return;
    }

    // Parse response
    const data = JSON.parse(text) as IDXFeaturedResponse;

    // Transform response from object to array for easier frontend iteration
    // IDX Broker returns an object with encoded keys (e.g., "a000!%5362657")
    // Filter out null values
    const listings = Object.values(data).filter((item) => item !== null);

    // Return empty array if no listings (instead of error)
    if (listings.length === 0) {
      res.json({ listings: [] });
      return;
    }

    res.json({ listings });
  } catch (error) {
    // Handle network errors, timeouts, etc.
    console.error('Error fetching IDX Broker listings:', error);

    if (error instanceof Error && error.name === 'TimeoutError') {
      res.status(504).json({
        error: 'Request to IDX Broker API timed out. Please try again.',
      });
      return;
    }

    res.status(500).json({
      error: 'Failed to fetch listings from IDX Broker. Please try again later.',
    });
  }
}
