import { readFile } from 'node:fs/promises';

/**
 * Anthropic Claude API client utilities
 * Supports both text and vision (image) analysis
 */

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64';
    media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    data: string;
  };
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text?: string }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface AnthropicClientOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  timeoutMs?: number;
  authType?: 'api-key' | 'bearer';
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_BASE_URL = process.env['ANTHROPIC_BASE_URL'] || 'https://api.anthropic.com';
const DEFAULT_AUTH_TYPE = (process.env['ANTHROPIC_AUTH_TYPE'] === 'bearer' ? 'bearer' : 'api-key') as 'api-key' | 'bearer';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 60_000;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && (
    error.name === 'TimeoutError' || error.name === 'AbortError'
  );
}

function buildAuthHeaders(apiKey: string, authType: 'api-key' | 'bearer'): Record<string, string> {
  if (authType === 'bearer') {
    return { 'Authorization': `Bearer ${apiKey}` };
  }
  return { 'x-api-key': apiKey };
}

/**
 * Call Anthropic Claude API with text prompt
 */
export async function callAnthropic(
  prompt: string,
  options: AnthropicClientOptions
): Promise<string> {
  const {
    apiKey,
    model = DEFAULT_MODEL,
    baseUrl = DEFAULT_BASE_URL,
    maxTokens = DEFAULT_MAX_TOKENS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    authType = DEFAULT_AUTH_TYPE,
  } = options;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(apiKey, authType),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Anthropic API request timed out after ${timeoutMs / 1000}s`);
    }
    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json() as AnthropicResponse;
  const textContent = data.content.find(c => c.type === 'text');

  if (!textContent?.text) {
    throw new Error('No text content in Anthropic response');
  }

  return textContent.text;
}

/**
 * Call Anthropic Claude API with image (vision) analysis
 */
export async function callAnthropicVision(
  imagePath: string,
  prompt: string,
  options: AnthropicClientOptions
): Promise<string> {
  const {
    apiKey,
    model = DEFAULT_MODEL,
    baseUrl = DEFAULT_BASE_URL,
    maxTokens = DEFAULT_MAX_TOKENS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    authType = DEFAULT_AUTH_TYPE,
  } = options;

  // Read and encode the image
  const imageBuffer = await readFile(imagePath);
  const base64Image = imageBuffer.toString('base64');

  // Determine media type from extension
  const ext = imagePath.toLowerCase().split('.').pop();
  let mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' = 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') mediaType = 'image/jpeg';
  else if (ext === 'gif') mediaType = 'image/gif';
  else if (ext === 'webp') mediaType = 'image/webp';

  const messages: AnthropicMessage[] = [
    {
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: base64Image,
          },
        },
        {
          type: 'text',
          text: prompt,
        },
      ],
    },
  ];

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(apiKey, authType),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Anthropic API request timed out after ${timeoutMs / 1000}s`);
    }
    throw error;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json() as AnthropicResponse;
  const textContent = data.content.find(c => c.type === 'text');

  if (!textContent?.text) {
    throw new Error('No text content in Anthropic response');
  }

  return textContent.text;
}

/**
 * Parse JSON from Claude response, handling markdown code blocks
 */
export function parseJsonResponse<T>(response: string): T {
  // Try to extract JSON from markdown code block
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();

  try {
    return JSON.parse(jsonStr) as T;
  } catch (error) {
    // Try to find JSON object in the response
    const objectMatch = response.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]) as T;
    }
    throw new Error(`Failed to parse JSON from response: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Create a reusable client instance
 */
export function createClient(options: AnthropicClientOptions) {
  return {
    call: (prompt: string) => callAnthropic(prompt, options),
    callVision: (imagePath: string, prompt: string) => callAnthropicVision(imagePath, prompt, options),
  };
}
