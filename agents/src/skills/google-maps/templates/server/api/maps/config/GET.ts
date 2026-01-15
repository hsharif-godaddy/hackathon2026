/**
 * Google Maps API Configuration Endpoint
 *
 * Returns the Google Maps API key for client-side map rendering.
 * The API key is stored securely in the secrets manager.
 */

import { getSecret } from '#airo/secrets';

export function GET() {
  const apiKey = getSecret('GOOGLE_MAPS_API_KEY');

  if (!apiKey) {
    return Response.json(
      { error: 'Google Maps API key not configured' },
      { status: 500 }
    );
  }

  return Response.json({ apiKey });
}
