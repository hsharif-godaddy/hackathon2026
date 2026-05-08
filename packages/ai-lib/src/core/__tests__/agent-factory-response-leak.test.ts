import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentWrapper } from '../agent-factory.js';
import type { AgentConfig } from '../types.js';
import type { ContextPipeline } from '../context-pipeline.js';
import { defaultConvertToLlm } from '../context-normalization.js';

const createMockPipeline = (): ContextPipeline => ({
  transformContext: async (input) => ({
    contextMessages: input.contextMessages,
    conversationMessages: input.conversationMessages,
    userMessage: { role: 'user' as const, content: input.userMessage },
  }),
  convertToLlm: (input) => defaultConvertToLlm(input),
});

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    ToolLoopAgent: vi.fn(),
    stepCountIs: vi.fn((value: number) => ({ type: 'step_count', value })),
    hasToolCall: vi.fn((name: string) => ({ type: 'has_tool_call', value: name })),
  };
});

function flush() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

describe('streamGenerate response-promise leak guard', () => {
  let mockAgent: { stream: ReturnType<typeof vi.fn>; generate: ReturnType<typeof vi.fn> };
  let wrapper: AgentWrapper;
  let unhandled: unknown[];
  const captureUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };

  beforeEach(async () => {
    mockAgent = { stream: vi.fn(), generate: vi.fn() };
    const { ToolLoopAgent } = await import('ai');
    (ToolLoopAgent as any).mockImplementation(() => mockAgent);

    const config: AgentConfig = {
      name: 'leak-test',
      model: 'test-model' as any,
      system: 'sys',
      tools: {},
      maxSteps: 1,
      contextPipeline: createMockPipeline(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    wrapper = new AgentWrapper(config);

    unhandled = [];
    process.on('unhandledRejection', captureUnhandled);
  });

  afterEach(() => {
    process.off('unhandledRejection', captureUnhandled);
    vi.clearAllMocks();
  });

  it('does not leak unhandled rejection when response rejects with AbortError and caller only consumes textStream', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });

    mockAgent.stream.mockResolvedValueOnce({
      textStream: (async function* () {
        yield 'hi';
      })(),
      baseStream: null,
      response: Promise.reject(abortError),
      usage: Promise.resolve({ totalTokens: 0, promptTokens: 0, completionTokens: 0 }),
      finishReason: Promise.resolve('stop'),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([]),
    });

    const result = await wrapper.streamGenerate('hello');
    const chunks: string[] = [];
    for await (const chunk of result.textStream) chunks.push(chunk);

    // Let the response-promise rejection propagate.
    await flush();
    await flush();

    expect(chunks).toEqual(['hi']);
    expect(unhandled).toEqual([]);
  });

  it('does not leak unhandled rejection for non-abort rejections (logs at warn instead)', async () => {
    const networkError = Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' });

    mockAgent.stream.mockResolvedValueOnce({
      textStream: (async function* () {
        yield 'hi';
      })(),
      baseStream: null,
      response: Promise.reject(networkError),
      usage: Promise.resolve({ totalTokens: 0, promptTokens: 0, completionTokens: 0 }),
      finishReason: Promise.resolve('stop'),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([]),
    });

    const result = await wrapper.streamGenerate('hello');
    for await (const _ of result.textStream) { /* drain */ }

    await flush();
    await flush();

    expect(unhandled).toEqual([]);
  });
});
