import OpenAI from 'openai';
import { getS2SToken, refreshS2SToken } from '@airo/ai-lib';

import type { Config } from '../../config/environments/types.js';
import { stripUnsafeUnicode } from '../util/sanitize.js';
import { retryTransient } from '../util/retry-transient.js';
import { warnLine } from '../util/warn-line.js';

/**
 * Default 429 retry budget for every LLM call routed through
 * `GocodeClient.complete()`. Matches the values previously hard-coded in
 * `LLMJudgeEvaluator` so behavior for the judge calls is unchanged; the win is
 * that the synthetic-user conversation loop and all other evaluators now share
 * the same `Retry-After`-honoring retry instead of falling through with only
 * the OpenAI SDK's default attempts.
 */
export const DEFAULT_RATE_LIMIT_MAX_RETRIES = 5;
export const DEFAULT_RATE_LIMIT_WAIT_MS = 30_000;

/**
 * Backoff between retries for transient connection/5xx errors. Kept short
 * (unlike the 30s rate-limit fallback) because a transient blip clears fast —
 * this approximates the sub-second backoff the OpenAI SDK applied before
 * `maxRetries: 0` disabled its retry layer, rather than making a brief network
 * hiccup cost the full rate-limit wait.
 */
export const DEFAULT_TRANSIENT_WAIT_MS = 1_000;

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
/**
 * Per-call options for {@link IGocodeClient.complete}. `temperature`/`seed` are
 * additive determinism knobs (omitted from the request body when unset, so
 * existing calls are byte-for-byte unchanged); the gocode proxy may ignore
 * them, which is safe.
 */
export interface CompleteOptions {
  signal?: AbortSignal;
  temperature?: number;
  seed?: number;
}

export interface IGocodeClient extends ProbeUsageSource {
  complete(messages: Message[], options?: CompleteOptions): Promise<string>;
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

/**
 * Builds a fetch wrapper that injects `Authorization: sso-jwt <token>` on every
 * request and retries once with a refreshed token on 401/403.
 */
function buildS2SFetch(): typeof globalThis.fetch {
  return async (input, init) => {
    const token = await getS2SToken();
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `sso-jwt ${token}`);
    const res = await globalThis.fetch(input, { ...init, headers });
    if (res.status === 401 || res.status === 403) {
      await res.arrayBuffer(); // drain body to prevent connection leak on retry
      const fresh = await refreshS2SToken();
      const retryHeaders = new Headers(init?.headers);
      retryHeaders.set('Authorization', `sso-jwt ${fresh}`);
      return globalThis.fetch(input, { ...init, headers: retryHeaders });
    }
    return res;
  };
}

export class GocodeClient implements IGocodeClient {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly config: Config['gocode'];
  private readonly maxRetries: number;
  private readonly defaultWaitMs: number;
  private accumulated: ProbeUsage = { ...ZERO_USAGE };

  constructor(config: Config['gocode']) {
    this.config = config;
    this.maxRetries = config.rateLimitRetry?.maxRetries ?? DEFAULT_RATE_LIMIT_MAX_RETRIES;
    this.defaultWaitMs = config.rateLimitRetry?.waitMs ?? DEFAULT_RATE_LIMIT_WAIT_MS;
    // `maxRetries: 0` disables the OpenAI SDK's own retry layer (default 2, which
    // also honors Retry-After) so `retryTransient` is the single source of truth
    // for both the 429 and the transient-error budgets. Without this the SDK's
    // hidden attempts compound beneath our wrap, making the effective attempt
    // count and total wait larger than the configured budgets.
    this.client = config.useS2S
      ? new OpenAI({
          baseURL: config.baseUrl,
          apiKey: 'gocode-s2s-placeholder',
          fetch: buildS2SFetch(),
          maxRetries: 0,
        })
      : new OpenAI({
          baseURL: config.baseUrl,
          apiKey: config.apiKey,
          maxRetries: 0,
        });
    this.model = config.model;
  }

  withModel(model: string): IGocodeClient {
    return new GocodeClient({ ...this.config, model });
  }

  async complete(
    messages: Message[],
    options?: CompleteOptions,
  ): Promise<string> {
    const body = {
      model: this.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: sanitize(m.content),
      })) as OpenAI.ChatCompletionMessageParam[],
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
      ...(options?.seed !== undefined && { seed: options.seed }),
      metadata: {
        guardrails: {
          'unicode-security': {
            extra_body: {
              mode: this.config.unicodeSecurityMode ?? 'disabled',
            },
          },
          'pii-detection': {
            extra_body: {
              detect_pii: this.config.piiDetection ?? false,
            },
          },
        },
      },
    } as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming;
    const response = await retryTransient(
      () =>
        options?.signal
          ? this.client.chat.completions.create(body, { signal: options.signal })
          : this.client.chat.completions.create(body),
      {
        maxRetries: this.maxRetries,
        defaultWaitMs: this.defaultWaitMs,
        transientWaitMs: DEFAULT_TRANSIENT_WAIT_MS,
        signal: options?.signal,
        onRetry: ({ attempt, maxRetries, waitMs, kind }) => {
          warnLine(
            kind === 'rate-limit'
              ? 'GoCode rate-limited; retrying.'
              : 'GoCode transient error; retrying.',
            {
              model: this.model,
              attempt,
              maxAttempts: maxRetries,
              waitSeconds: waitMs / 1000,
            },
          );
        },
        onExhausted: ({ totalAttempts, kind }) => {
          warnLine(
            kind === 'rate-limit'
              ? 'GoCode rate-limit retry budget exhausted.'
              : 'GoCode transient-error retry budget exhausted.',
            {
              model: this.model,
              totalAttempts,
            },
          );
        },
      },
    );
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
