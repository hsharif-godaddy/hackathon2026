import type OpenAI from 'openai';

import { getS2SToken, isS2SAuthEnabled } from '@airo/ai-lib';

/**
 * Get authorization token for video API requests.
 * Uses S2S token in hosted environments, falls back to OpenAI API key locally.
 */
export async function getVideoAuthToken(openaiClient: OpenAI): Promise<string> {
  if (isS2SAuthEnabled()) {
    return getS2SToken();
  }
  return openaiClient.apiKey;
}

/**
 * Make an authenticated request to the video API.
 */
export async function videoApiFetch(
  openaiClient: OpenAI,
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getVideoAuthToken(openaiClient);

  return fetch(`${openaiClient.baseURL}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      ...options.headers
    }
  });
}
