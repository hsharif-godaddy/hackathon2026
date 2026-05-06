import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import type { BudgetOverride } from '@airo/ai-grants';

vi.mock('../../../utils/model-selection.js', () => ({
  getAgentModelWithName: vi.fn().mockResolvedValue({
    model: { name: 'mock-model' },
    modelName: 'mock-model',
  }),
}));

const mockGenerateTextWithTracking = vi.fn();
vi.mock('@airo/ai-lib', () => ({
  generateTextWithTracking: (opts: unknown) => mockGenerateTextWithTracking(opts),
}));

vi.mock('@airo/ai-common', () => ({
  llmMetadataContext: { run: vi.fn((_meta: unknown, fn: () => unknown) => fn()) },
}));

const { DiagnoseLlmClient } = await import('../DiagnoseLlmClient.js');
import type { LlmGenerateArgs } from '../types.js';

const schema = z.object({ ok: z.boolean() });

function makeArgs(
  overrides: Partial<LlmGenerateArgs<{ ok: boolean }>> = {}
): LlmGenerateArgs<{ ok: boolean }> {
  return {
    system: 'sys',
    user: 'user',
    schema,
    timeoutMs: 50,
    budgetUser: 'fallback' as unknown as BudgetOverride,
    tags: [],
    ...overrides,
  };
}

describe('DiagnoseLlmClient', () => {
  let client: InstanceType<typeof DiagnoseLlmClient>;

  beforeEach(() => {
    mockGenerateTextWithTracking.mockReset();
    client = new DiagnoseLlmClient();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts the underlying LLM call and rejects with timeout error when the timer fires', async () => {
    vi.useFakeTimers();

    let capturedSignal: AbortSignal | undefined;
    mockGenerateTextWithTracking.mockImplementation((opts: { abortSignal?: AbortSignal }) => {
      capturedSignal = opts.abortSignal;
      return new Promise((_, reject) => {
        opts.abortSignal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const promise = client.generateStructured(makeArgs({ timeoutMs: 50 }));
    promise.catch(() => {}); // prevent unhandled-rejection warnings while we advance timers

    await vi.advanceTimersByTimeAsync(60);

    await expect(promise).rejects.toThrow('LLM call timed out after 50ms');
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('does not abort on successful completion and clears the timeout timer', async () => {
    vi.useFakeTimers();

    let capturedSignal: AbortSignal | undefined;
    mockGenerateTextWithTracking.mockImplementation((opts: { abortSignal?: AbortSignal }) => {
      capturedSignal = opts.abortSignal;
      return Promise.resolve({
        text: '{"ok":true}',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
        modelName: 'mock-model',
      });
    });

    const result = await client.generateStructured(makeArgs({ timeoutMs: 1000 }));

    expect(result).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(capturedSignal?.aborted).toBe(false);
  });

  it('rethrows non-timeout errors unchanged', async () => {
    mockGenerateTextWithTracking.mockRejectedValueOnce(new Error('upstream 500'));

    await expect(client.generateStructured(makeArgs({ timeoutMs: 1000 }))).rejects.toThrow(
      'upstream 500'
    );
  });

  it('throws a JSON-parse error when the LLM returns non-JSON text', async () => {
    mockGenerateTextWithTracking.mockResolvedValueOnce({
      text: 'this is not json at all',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
      modelName: 'mock-model',
    });

    await expect(client.generateStructured(makeArgs({ timeoutMs: 1000 }))).rejects.toThrow(
      /valid json/i
    );
  });

  it('strips ```json fences before parsing', async () => {
    mockGenerateTextWithTracking.mockResolvedValueOnce({
      text: '```json\n{"ok":true}\n```',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
      modelName: 'mock-model',
    });

    await expect(client.generateStructured(makeArgs({ timeoutMs: 1000 }))).resolves.toEqual({
      ok: true,
    });
  });

  it('throws a schema-validation error when the LLM returns JSON of the wrong shape', async () => {
    mockGenerateTextWithTracking.mockResolvedValueOnce({
      text: '{"ok":"not-a-boolean"}',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
      modelName: 'mock-model',
    });

    await expect(client.generateStructured(makeArgs({ timeoutMs: 1000 }))).rejects.toThrow(
      /expected schema/i
    );
  });
});
