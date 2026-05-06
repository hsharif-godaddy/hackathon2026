import OpenAI from 'openai';
import type { Config } from '../../config/environments/types.js';
import { stripUnsafeUnicode } from '../util/sanitize.js';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
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

const ZERO_USAGE: ProbeUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  calls: 0,
};

export class GocodeClient {
  private client: OpenAI;
  private model: string;
  private accumulated: ProbeUsage = { ...ZERO_USAGE };

  constructor(config: Config['gocode']) {
    this.client = new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
    });
    this.model = config.model;
  }

  async complete(messages: Message[]): Promise<string> {
    const sanitized = messages.map(m => ({
      ...m,
      content: stripUnsafeUnicode(m.content),
    }));
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: sanitized as OpenAI.ChatCompletionMessageParam[],
    });
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
    return response.choices[0]!.message.content ?? '';
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
