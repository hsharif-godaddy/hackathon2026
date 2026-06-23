import type { Request, Response } from 'express';
import { getSecret } from '#airo/secrets';
import type { IDXFeaturedResponse } from '../../../../lib/idx-broker/types';
import { parseIDXListings } from '../../../../lib/idx-broker/types';

/**
 * API Route: GET /api/idx-broker/featured
 *
 * Fetches featured property listings from IDX Broker API with pagination support.
 * Requires IDX_BROKER_API_KEY secret to be configured.
 *
 * Query Parameters:
 * - url (optional): Full IDX Broker pagination URL (e.g., from next/previous fields)
 *
 * Response format:
 * - Success: { listings: IDXListing[], pagination: IDXPaginationMetadata }
 * - Error: { error: string }
 */
export default async function handler(req: Request, res: Response): Promise<void> {
  // Retrieve API key from secrets
  const apiKey = getSecret('IDX_BROKER_API_KEY');

  if (!apiKey || typeof apiKey !== 'string') {
    res.status(500).json({
      error: 'IDX_BROKER_API_KEY not configured. Please add your IDX Broker API key in the secrets settings.',
    });
    return;
  }

  // Get pagination URL from query parameter (optional)
  const url = typeof req.query.url === 'string' ? req.query.url : undefined;
  const defaultUrl = 'https://api.idxbroker.com/clients/featured';

  // Validate pagination URL for security (SSRF prevention)
  let requestUrl = defaultUrl;
  if (url) {
    try {
      const parsedUrl = new URL(url);

      // Only allow IDX Broker API domain
      if (parsedUrl.hostname !== 'api.idxbroker.com') {
        res.status(400).json({
          error: 'Invalid pagination URL. Must be an IDX Broker API URL.',
        });
        return;
      }

      // Only allow /clients/featured endpoint
      if (!parsedUrl.pathname.startsWith('/clients/featured')) {
        res.status(400).json({
          error: 'Invalid pagination URL. Must be a featured listings endpoint.',
        });
        return;
      }

      requestUrl = url;
    } catch {
      res.status(400).json({
        error: 'Invalid URL format.',
      });
      return;
    }
  }

  try {
    // Fetch featured listings from IDX Broker API
    const response = await fetch(requestUrl, {
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
      res.json({
        listings: [],
        pagination: {
          total: 0,
          first: defaultUrl,
          last: defaultUrl,
          next: null,
          previous: null,
        },
      });
      return;
    }

    // Parse response
    const apiResponse = JSON.parse(text) as IDXFeaturedResponse;

    // Transform response from object to array for easier frontend iteration
    // IDX Broker returns { total, first, last, next, previous, data: {...} }
    // where data is an object with encoded keys (e.g., "a000!%M1422715")
    const listings = parseIDXListings(apiResponse);

    // Return listings with pagination metadata
    res.json({
      listings,
      pagination: {
        total: apiResponse.total,
        first: apiResponse.first,
        last: apiResponse.last,
        next: apiResponse.next,
        previous: apiResponse.previous,
      },
    });
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
