import { track } from './cost-tracker.js';

export interface OpenAIClientOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

interface OpenAIResponse {
  id: string;
  model: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

const DEFAULT_MODEL = 'gpt-5';
const DEFAULT_BASE_URL = 'https://api.gocode.caas.test-gdcorp.tools/v1';
const DEFAULT_MAX_TOKENS = 16_384;
const DEFAULT_TIMEOUT_MS = 120_000;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && (
    error.name === 'TimeoutError' || error.name === 'AbortError'
  );
}

export async function callOpenAI(
  prompt: string,
  options: OpenAIClientOptions
): Promise<string> {
  const {
    apiKey,
    model = DEFAULT_MODEL,
    baseUrl = DEFAULT_BASE_URL,
    maxTokens = DEFAULT_MAX_TOKENS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`OpenAI API request timed out after ${timeoutMs / 1000}s`);
    }
    throw error;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '(body unavailable)');
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${body}`);
  }

  const data = await response.json() as OpenAIResponse;

  if (data.usage) {
    track({
      model: data.model ?? model,
      promptTokens: data.usage.prompt_tokens ?? 0,
      completionTokens: data.usage.completion_tokens ?? 0,
      reasoningTokens: data.usage.completion_tokens_details?.reasoning_tokens ?? 0,
    });
  }

  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('No content in OpenAI response');
  }

  return content.trim();
}

export function parseJsonResponse<T>(response: string): T {
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();

  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    const objectMatch = response.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]) as T;
    }
    throw new Error(`Failed to parse JSON from response: ${jsonStr.slice(0, 200)}`);
  }
}
