import { setTimeout as sleep } from 'node:timers/promises';

export type ChatRole = 'system' | 'user' | 'assistant';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: ChatRole;
  content: string | ContentPart[];
}

export interface GocaasClientConfig {
  baseUrl: string;
  apiKey: string;
}

export interface ChatCompletionResult {
  content: string;
  raw: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object';
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`LLM call failed: ${res.status} ${res.statusText}\n${text.slice(0, 2000)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new Error(
      `LLM call returned non-JSON response: ${err instanceof Error ? err.message : String(err)}\n${text.slice(0, 2000)}`,
    );
  }
}

export class GocaasClient {
  constructor(private readonly config: GocaasClientConfig) {}

  async chat(params: {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<ChatCompletionResult> {
    // OpenAI-compatible surface (most GoDaddy internal proxies expose this).
    const url = `${this.config.baseUrl}/chat/completions`;
    // Keys with `undefined` values are dropped by JSON.stringify, so omitting temperature here
    // sends a request without the field at all.
    const buildBody = (temperature: number | undefined): string =>
      JSON.stringify({
        model: params.model,
        messages: params.messages,
        temperature,
        max_tokens: params.maxTokens,
      });

    const post = (body: string): Promise<unknown> =>
      requestJson(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
      });

    try {
      return this.parseCompletion(await post(buildBody(params.temperature)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // Some models (e.g. Opus 4.x on Bedrock) deprecate `temperature` entirely (even 0).
      // Retry once without the field if temperature-related 400 error.
      if (msg.includes(' 400 ') && /temperature/i.test(msg)) {
        try {
          return this.parseCompletion(await post(buildBody(undefined)));
        } catch (retryErr) {
          // If retry also fails, throw the original error (more informative)
          throw err;
        }
      }

      // Retry once for transient 429/5xx patterns that proxies sometimes return.
      if (msg.includes(' 429 ') || msg.includes(' 5')) {
        await sleep(800);
        return this.parseCompletion(await post(buildBody(params.temperature)));
      }

      throw err;
    }
  }

  private parseCompletion(raw: unknown): ChatCompletionResult {
    if (!isObject(raw)) throw new Error('LLM response is not an object');
    const choices = raw['choices'];
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new Error('LLM response missing choices');
    }
    const first = choices[0];
    if (!isObject(first)) throw new Error('LLM response choice is not an object');
    const message = first['message'];
    if (!isObject(message)) throw new Error('LLM response missing message');
    const content = message['content'];
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('LLM response missing content string');
    }
    return { content, raw };
  }
}
