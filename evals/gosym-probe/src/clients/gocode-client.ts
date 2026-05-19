import OpenAI from 'openai';

import type { Config } from '../../config/environments/types.js';
import { stripUnsafeUnicode } from '../util/sanitize.js';

type Content = string | OpenAI.ChatCompletionContentPart[];

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: Content;
}

export interface ProbeUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: number;
}

/** Minimal interface for evaluators that read probe usage. */
export interface ProbeUsageSource {
  getAccumulatedUsage(): ProbeUsage;
}

/** Full interface for GoCode LLM clients used by the eval harness. */
export interface IGocodeClient extends ProbeUsageSource {
  complete(messages: Message[], options?: { signal?: AbortSignal }): Promise<string>;
  getModel(): string;
  resetAccumulatedUsage(): void;
  withModel(model: string): IGocodeClient;
}

const ZERO_USAGE: ProbeUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  calls: 0,
};

function sanitize(content: Content): Content {
  if (typeof content === 'string') return stripUnsafeUnicode(content);
  return content.map((part) =>
    part.type === 'text'
      ? { ...part, text: stripUnsafeUnicode(part.text) }
      : part,
  );
}

export class GocodeClient implements IGocodeClient {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private accumulated: ProbeUsage = { ...ZERO_USAGE };

  constructor(config: Config['gocode']) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.client = new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
    });
    this.model = config.model;
  }

  withModel(model: string): IGocodeClient {
    return new GocodeClient({ baseUrl: this.baseUrl, apiKey: this.apiKey, model });
  }

  async complete(
    messages: Message[],
    options?: { signal?: AbortSignal },
  ): Promise<string> {
    const body = {
      model: this.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: sanitize(m.content),
      })) as OpenAI.ChatCompletionMessageParam[],
    };
    const response = options?.signal
      ? await this.client.chat.completions.create(body, { signal: options.signal })
      : await this.client.chat.completions.create(body);
    this.accumulated.calls += 1;
    if (response.usage) {
      this.accumulated.promptTokens += response.usage.prompt_tokens;
      this.accumulated.completionTokens += response.usage.completion_tokens;
      this.accumulated.totalTokens += response.usage.total_tokens;
    } else {
      console.warn(
        'GocodeClient: response.usage is absent; token counts will not be accumulated for this call',
      );
    }
    if (response.choices.length === 0) {
      throw new Error('GoCode API returned no choices');
    }
    const content = response.choices[0]!.message.content;
    if (content === null || content === undefined) {
      throw new Error('GoCode API returned null content');
    }
    return content;
  }

  getModel(): string {
    return this.model;
  }

  getAccumulatedUsage(): ProbeUsage {
    return { ...this.accumulated };
  }

  /**
   * Resets accumulated usage counters to zero.
   *
   * NOTE: `accumulated` is per-instance state. When multiple trials share
   * a single `GocodeClient` instance (the common case in `SuiteRunner`),
   * counters reflect the union of all calls made by that instance since
   * construction or the last reset. Call this method between trials if
   * per-trial isolation is required; otherwise use the snapshot returned
   * by `getAccumulatedUsage()` at trial boundaries.
   */
  resetAccumulatedUsage(): void {
    this.accumulated = { ...ZERO_USAGE };
  }
}
