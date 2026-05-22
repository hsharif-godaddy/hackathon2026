import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockCreate, mockGetS2SToken, mockRefreshS2SToken } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockGetS2SToken: vi.fn(),
  mockRefreshS2SToken: vi.fn(),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

vi.mock('@airo/ai-lib', () => ({
  getS2SToken: mockGetS2SToken,
  refreshS2SToken: mockRefreshS2SToken,
}));

import OpenAI from 'openai';
import { GocodeClient } from '../gocode-client.js';
import type { Message } from '../gocode-client.js';

const TEST_CONFIG = {
  baseUrl: 'https://gocode.example.com/v1',
  apiKey: 'sk-test',
  useS2S: false,
  model: 'claude-sonnet-4-6',
} as const;

describe('GocodeClient', () => {
  let client: GocodeClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GocodeClient(TEST_CONFIG);
  });

  describe('constructor', () => {
    it('instantiates OpenAI with baseURL and apiKey', () => {
      expect(OpenAI).toHaveBeenCalledWith({
        baseURL: TEST_CONFIG.baseUrl,
        apiKey: TEST_CONFIG.apiKey,
      });
    });
  });

  describe('complete()', () => {
    const messages: Message[] = [{ role: 'user', content: 'hello' }];

    it('calls chat.completions.create with correct model and messages', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'hi there' } }],
      });
      await client.complete(messages);
      expect(mockCreate).toHaveBeenCalledWith({
        model: TEST_CONFIG.model,
        messages,
      });
    });

    it('returns content from first choice', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'response text' } }],
      });
      const result = await client.complete(messages);
      expect(result).toBe('response text');
    });

    it('throws when choices is empty', async () => {
      mockCreate.mockResolvedValue({ choices: [] });
      await expect(client.complete(messages)).rejects.toThrow(
        'GoCode API returned no choices',
      );
    });

    it('throws when content is null', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
      });
      await expect(client.complete(messages)).rejects.toThrow(
        'GoCode API returned null content',
      );
    });

    it('supports multi-turn messages', async () => {
      const multi: Message[] = [
        { role: 'system', content: 'You are a tester.' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: 'bye' },
      ];
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'goodbye' } }],
      });
      const result = await client.complete(multi);
      expect(mockCreate).toHaveBeenCalledWith({
        model: TEST_CONFIG.model,
        messages: multi,
      });
      expect(result).toBe('goodbye');
    });

    it('propagates errors from the OpenAI client', async () => {
      mockCreate.mockRejectedValue(new Error('API error'));
      await expect(client.complete(messages)).rejects.toThrow('API error');
    });

    it('strips unsafe Unicode from message content before sending', async () => {
      const unassignedPlane13 = String.fromCodePoint(0xD5E70);
      const bmpPrivateUse = '\uE001';
      const dirtyMessages: Message[] = [
        { role: 'user', content: `safe${unassignedPlane13}text` },
        { role: 'assistant', content: `pre${bmpPrivateUse}post` },
      ];
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
      });

      await client.complete(dirtyMessages);

      expect(mockCreate).toHaveBeenCalledWith({
        model: TEST_CONFIG.model,
        messages: [
          { role: 'user', content: 'safetext' },
          { role: 'assistant', content: 'prepost' },
        ],
      });
    });

    it('sanitizes ContentPart[] messages, stripping unsafe text parts and preserving non-text parts', async () => {
      const bmpPrivateUse = '\uE001';
      const imagePart = { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,abc' } };
      const dirtyMessages: Message[] = [
        {
          role: 'user',
          content: [
            { type: 'text' as const, text: `dirty${bmpPrivateUse}text` },
            imagePart,
          ],
        },
      ];
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
      });

      await client.complete(dirtyMessages);

      expect(mockCreate).toHaveBeenCalledWith({
        model: TEST_CONFIG.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'dirtytext' },
              imagePart,
            ],
          },
        ],
      });
    });

    it('passes signal option to the OpenAI client', async () => {
      const controller = new AbortController();
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
      });

      await client.complete(messages, { signal: controller.signal });

      expect(mockCreate).toHaveBeenCalledWith(
        { model: TEST_CONFIG.model, messages },
        { signal: controller.signal },
      );
    });

    it('does not pass options object when signal is undefined', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
      });

      await client.complete(messages);

      expect(mockCreate).toHaveBeenCalledWith({
        model: TEST_CONFIG.model,
        messages,
      });
    });
  });

  describe('usage accumulation', () => {
    const messages: Message[] = [{ role: 'user', content: 'hello' }];

    it('accumulates prompt/completion/total tokens and call count across multiple complete() calls', async () => {
      mockCreate
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'a' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'b' } }],
          usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
        });

      await client.complete(messages);
      await client.complete(messages);

      expect(client.getAccumulatedUsage()).toEqual({
        promptTokens: 30,
        completionTokens: 13,
        totalTokens: 43,
        calls: 2,
      });
    });

    it('getAccumulatedUsage() returns a snapshot, not a live reference', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'x' } }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      });

      await client.complete(messages);
      const snapshot = client.getAccumulatedUsage();

      await client.complete(messages);

      expect(snapshot.calls).toBe(1);
      expect(client.getAccumulatedUsage().calls).toBe(2);
    });

    it('increments calls even when response.usage is absent', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'no usage' } }],
      });

      await client.complete(messages);

      expect(client.getAccumulatedUsage()).toMatchObject({ calls: 1 });
    });

    it('does not accumulate token counts when response.usage is absent', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'no usage' } }],
      });

      await client.complete(messages);

      expect(client.getAccumulatedUsage()).toMatchObject({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      });
    });

    it('emits console.warn when response.usage is absent', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'no usage' } }],
      });

      await client.complete(messages);

      expect(warnSpy).toHaveBeenCalledOnce();
      warnSpy.mockRestore();
    });
  });

  describe('resetAccumulatedUsage()', () => {
    const messages: Message[] = [{ role: 'user', content: 'hello' }];

    it('resets all counters to zero', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'a' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      await client.complete(messages);
      client.resetAccumulatedUsage();

      expect(client.getAccumulatedUsage()).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        calls: 0,
      });
    });

    it('accumulation continues correctly after reset', async () => {
      mockCreate
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'a' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'b' } }],
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        });

      await client.complete(messages);
      client.resetAccumulatedUsage();
      await client.complete(messages);

      expect(client.getAccumulatedUsage()).toEqual({
        promptTokens: 4,
        completionTokens: 2,
        totalTokens: 6,
        calls: 1,
      });
    });
  });

  describe('withModel()', () => {
    it('returns a new GocodeClient with the specified model', () => {
      const derived = client.withModel('gpt-4o');
      expect(derived.getModel()).toBe('gpt-4o');
    });

    it('does not mutate the original client model', () => {
      client.withModel('gpt-4o');
      expect(client.getModel()).toBe(TEST_CONFIG.model);
    });

    it('derived client creates a fresh OpenAI instance with same baseUrl/apiKey', () => {
      client.withModel('gpt-4o');
      expect(OpenAI).toHaveBeenLastCalledWith({
        baseURL: TEST_CONFIG.baseUrl,
        apiKey: TEST_CONFIG.apiKey,
      });
    });

    it('derived client has independent usage accumulation', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'x' } }],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      });

      const derived = client.withModel('gpt-4o');
      await derived.complete([{ role: 'user', content: 'hi' }]);

      expect(derived.getAccumulatedUsage().calls).toBe(1);
      expect(client.getAccumulatedUsage().calls).toBe(0);
    });
  });

  describe('S2S mode', () => {
    const S2S_CONFIG = {
      baseUrl: 'https://gocode.example.com/v1',
      apiKey: '',
      useS2S: true,
      model: 'claude-sonnet-4-6',
    } as const;

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function captureOpenAIArgs(): Record<string, unknown> {
      const mock = OpenAI as unknown as { mock: { calls: unknown[][] } };
      return mock.mock.calls.at(-1)![0] as Record<string, unknown>;
    }

    describe('constructor', () => {
      it('uses placeholder apiKey and custom fetch', () => {
        new GocodeClient(S2S_CONFIG);
        expect(OpenAI).toHaveBeenLastCalledWith({
          baseURL: S2S_CONFIG.baseUrl,
          apiKey: 'gocode-s2s-placeholder',
          fetch: expect.any(Function),
        });
      });

      it('does not include fetch in non-S2S mode', () => {
        new GocodeClient({ ...S2S_CONFIG, useS2S: false, apiKey: 'sk-test' });
        expect(OpenAI).toHaveBeenLastCalledWith({
          baseURL: S2S_CONFIG.baseUrl,
          apiKey: 'sk-test',
        });
      });
    });

    describe('fetch wrapper', () => {
      it('injects Authorization: sso-jwt header', async () => {
        mockGetS2SToken.mockResolvedValue('test-jwt');
        const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', mockFetch);

        new GocodeClient(S2S_CONFIG);
        const s2sFetch = captureOpenAIArgs().fetch as typeof globalThis.fetch;
        await s2sFetch('https://api.example.com/chat', {});

        const headers = mockFetch.mock.calls[0][1].headers as Headers;
        expect(headers.get('Authorization')).toBe('sso-jwt test-jwt');
      });

      it('retries with refreshed token on 401', async () => {
        mockGetS2SToken.mockResolvedValue('initial-token');
        mockRefreshS2SToken.mockResolvedValue('refreshed-token');
        const mockFetch = vi.fn()
          .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
          .mockResolvedValueOnce(new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', mockFetch);

        new GocodeClient(S2S_CONFIG);
        const s2sFetch = captureOpenAIArgs().fetch as typeof globalThis.fetch;
        const res = await s2sFetch('https://api.example.com/chat', {});

        expect(mockRefreshS2SToken).toHaveBeenCalledOnce();
        expect(mockFetch).toHaveBeenCalledTimes(2);
        const retryHeaders = mockFetch.mock.calls[1][1].headers as Headers;
        expect(retryHeaders.get('Authorization')).toBe('sso-jwt refreshed-token');
        expect(res.status).toBe(200);
      });

      it('retries with refreshed token on 403', async () => {
        mockGetS2SToken.mockResolvedValue('initial-token');
        mockRefreshS2SToken.mockResolvedValue('refreshed-token');
        const mockFetch = vi.fn()
          .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
          .mockResolvedValueOnce(new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', mockFetch);

        new GocodeClient(S2S_CONFIG);
        const s2sFetch = captureOpenAIArgs().fetch as typeof globalThis.fetch;
        await s2sFetch('https://api.example.com/chat', {});

        expect(mockRefreshS2SToken).toHaveBeenCalledOnce();
      });

      it('does not retry on non-auth error responses', async () => {
        mockGetS2SToken.mockResolvedValue('token');
        const mockFetch = vi.fn().mockResolvedValue(new Response('Error', { status: 500 }));
        vi.stubGlobal('fetch', mockFetch);

        new GocodeClient(S2S_CONFIG);
        const s2sFetch = captureOpenAIArgs().fetch as typeof globalThis.fetch;
        await s2sFetch('https://api.example.com/chat', {});

        expect(mockFetch).toHaveBeenCalledOnce();
        expect(mockRefreshS2SToken).not.toHaveBeenCalled();
      });

      it('preserves existing request headers alongside Authorization', async () => {
        mockGetS2SToken.mockResolvedValue('token-xyz');
        const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', mockFetch);

        new GocodeClient(S2S_CONFIG);
        const s2sFetch = captureOpenAIArgs().fetch as typeof globalThis.fetch;
        await s2sFetch('https://api.example.com/chat', {
          headers: { 'Content-Type': 'application/json' },
        });

        const headers = mockFetch.mock.calls[0][1].headers as Headers;
        expect(headers.get('Authorization')).toBe('sso-jwt token-xyz');
        expect(headers.get('Content-Type')).toBe('application/json');
      });
    });

    describe('withModel()', () => {
      it('derived client preserves useS2S and placeholder apiKey', () => {
        const s2sClient = new GocodeClient(S2S_CONFIG);
        vi.clearAllMocks();
        s2sClient.withModel('gpt-4o');
        expect(OpenAI).toHaveBeenLastCalledWith({
          baseURL: S2S_CONFIG.baseUrl,
          apiKey: 'gocode-s2s-placeholder',
          fetch: expect.any(Function),
        });
      });
    });
  });
});
