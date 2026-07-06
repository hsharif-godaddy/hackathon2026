import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockModel, mockGenerateTextWithTracking } = vi.hoisted(() => ({
  mockModel: {},
  mockGenerateTextWithTracking: vi.fn(),
}));

vi.mock('../../../../logging/index.js', () => ({
  Logger: {
    create: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock('../../../../memory/adapters/index.js', () => ({
  getKvMemoryStore: vi.fn().mockReturnValue({
    get: vi.fn(),
  }),
}));

vi.mock('../../../../memory/interfaces/scope.js', () => ({
  workspaceScopeFromAppId: vi.fn().mockReturnValue({ kind: 'local', appId: 'testapp001' }),
}));

vi.mock('@airo/ai-lib', () => ({
  getModel: vi.fn().mockResolvedValue(mockModel),
  generateTextWithTracking: (...args: unknown[]) => mockGenerateTextWithTracking(...args),
}));

vi.mock('../../../../utils/model-selection.js', () => ({
  getAgentModelWithName: vi.fn().mockResolvedValue({ model: mockModel, modelName: 'claude-sonnet-4-6' }),
}));

import { getKvMemoryStore } from '../../../../memory/adapters/index.js';
import { checkAiVisibilityTool, clearAiVisibilityCache } from '../index.js';

const APP_ID = 'testapp001';
const STUB_PROMPTS = 'What bakeries are recommended in Mesa AZ?\nIs Mesa Bakery a good choice for sourdough?';

function makeContext() {
  return { metadata: { appId: APP_ID } } as never;
}

function stubMemory(brandName: string, description = '', location = '', vertical = '') {
  const store = getKvMemoryStore();
  vi.mocked(store.get).mockImplementation(async (_scope, key) => {
    if (key === 'brand.identity') {
      return {
        exists: true,
        value: {
          brandName,
          location,
          vertical,
          personality: { description },
        },
      };
    }
    return { exists: false, value: null };
  });
}

type VisibilityResult = {
  brandName: string;
  prompts: string[];
  results: Array<{ prompt: string; platform: string; response: string | null; error: string | null }>;
};

describe('checkAiVisibilityTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAiVisibilityCache();
  });

  afterEach(() => {
    clearAiVisibilityCache();
  });

  it('returns error when no appId in context', async () => {
    const result = await checkAiVisibilityTool.execute({}, {} as never);
    expect(result).toEqual({ error: 'No app context available.' });
  });

  it('returns error when brand name is missing', async () => {
    stubMemory('');
    const result = await checkAiVisibilityTool.execute({}, makeContext());
    expect((result as { error: string }).error).toMatch(/No brand name/);
  });

  it('returns results from both platforms for each generated prompt', async () => {
    stubMemory('Mesa Bakery', 'artisan sourdough');
    mockGenerateTextWithTracking
      .mockResolvedValueOnce({ text: STUB_PROMPTS })
      .mockResolvedValue({ text: 'Mesa Bakery is highly recommended.' });

    const result = await checkAiVisibilityTool.execute({}, makeContext()) as VisibilityResult;

    expect(result.brandName).toBe('Mesa Bakery');
    expect(result.prompts).toHaveLength(2);
    expect(result.results.length).toBe(4);

    const platforms = [...new Set(result.results.map(r => r.platform))];
    expect(platforms).toContain('ChatGPT (GPT-4o)');
    expect(platforms).toContain('Claude');

    const promptsInResults = [...new Set(result.results.map(r => r.prompt))];
    expect(promptsInResults).toHaveLength(2);
    expect(promptsInResults).toEqual(result.prompts);

    result.results.forEach(r => {
      expect(r.response).toContain('Mesa Bakery');
      expect(r.error).toBeNull();
    });
  });

  it('uses haiku for prompt generation and includes location and vertical', async () => {
    stubMemory('Mesa Bakery', '', 'Mesa, AZ', 'artisan bakery');
    mockGenerateTextWithTracking
      .mockResolvedValueOnce({ text: 'best bakery in Mesa AZ' })
      .mockResolvedValue({ text: 'Some response' });

    await checkAiVisibilityTool.execute({}, makeContext());

    expect(mockGenerateTextWithTracking).toHaveBeenCalledTimes(3);

    const promptGenCall = mockGenerateTextWithTracking.mock.calls[0][0] as { modelName: string; prompt: string };
    expect(promptGenCall.modelName).toBe('haiku');
    expect(promptGenCall.prompt).toContain('Mesa Bakery');
    expect(promptGenCall.prompt).toContain('Mesa, AZ');
    expect(promptGenCall.prompt).toContain('artisan bakery');
    expect(promptGenCall.prompt).toContain('Use the city/region from "Mesa, AZ" in location-related queries');
  });

  it('uses input location and vertical as fallback when memory is empty', async () => {
    stubMemory('Mesa Bakery', '', '', '');
    mockGenerateTextWithTracking
      .mockResolvedValueOnce({ text: 'best coffee roaster in Austin TX' })
      .mockResolvedValue({ text: 'Some response' });

    await checkAiVisibilityTool.execute(
      { location: 'Austin, TX', vertical: 'coffee roaster' },
      makeContext(),
    );

    const promptGenCall = mockGenerateTextWithTracking.mock.calls[0][0] as { modelName: string; prompt: string };
    expect(promptGenCall.prompt).toContain('Austin, TX');
    expect(promptGenCall.prompt).toContain('coffee roaster');
  });

  it('memory location and vertical take precedence over input params', async () => {
    stubMemory('Mesa Bakery', '', 'Phoenix, AZ', 'gym');
    mockGenerateTextWithTracking
      .mockResolvedValueOnce({ text: 'best gym in Phoenix AZ' })
      .mockResolvedValue({ text: 'Some response' });

    await checkAiVisibilityTool.execute(
      { location: 'Seattle, WA', vertical: 'coffee roaster' },
      makeContext(),
    );

    const promptGenCall = mockGenerateTextWithTracking.mock.calls[0][0] as { modelName: string; prompt: string };
    expect(promptGenCall.prompt).toContain('Phoenix, AZ');
    expect(promptGenCall.prompt).toContain('gym');
    expect(promptGenCall.prompt).not.toContain('Seattle, WA');
    expect(promptGenCall.prompt).not.toContain('coffee roaster');
  });

  it('instructs haiku not to infer a location when none is set', async () => {
    stubMemory('Mesa Bakery', '', '', 'artisan bakery');
    mockGenerateTextWithTracking
      .mockResolvedValueOnce({ text: 'best bakery nearby' })
      .mockResolvedValue({ text: 'Some response' });

    await checkAiVisibilityTool.execute({}, makeContext());

    const promptGenCall = mockGenerateTextWithTracking.mock.calls[0][0] as { modelName: string; prompt: string };
    expect(promptGenCall.modelName).toBe('haiku');
    expect(promptGenCall.prompt).toContain('Do not infer or include any specific city or location');
    expect(promptGenCall.prompt).not.toContain('Use "');
  });

  it('records platform error without failing the whole tool', async () => {
    stubMemory('Mesa Bakery');
    mockGenerateTextWithTracking
      .mockResolvedValueOnce({ text: 'best bakery in Mesa AZ' })
      .mockResolvedValueOnce({ text: 'Mesa Bakery is great.' })
      .mockRejectedValueOnce(new Error('Claude returned 429'));

    const result = await checkAiVisibilityTool.execute({}, makeContext()) as VisibilityResult;

    const chatgpt = result.results.find(r => r.platform === 'ChatGPT (GPT-4o)')!;
    expect(chatgpt.response).not.toBeNull();

    const claude = result.results.find(r => r.platform === 'Claude')!;
    expect(claude.response).toBeNull();
    expect(claude.error).toBe('Claude returned 429');
  });

  it('truncates long platform responses to 1000 characters', async () => {
    stubMemory('Mesa Bakery');
    const longResponse = 'x'.repeat(2000);
    mockGenerateTextWithTracking
      .mockResolvedValueOnce({ text: 'best bakery in Mesa AZ' })
      .mockResolvedValueOnce({ text: longResponse })
      .mockResolvedValueOnce({ text: 'short' });

    const result = await checkAiVisibilityTool.execute({}, makeContext()) as VisibilityResult;

    const chatgpt = result.results.find(r => r.platform === 'ChatGPT (GPT-4o)')!;
    expect(chatgpt.response?.length).toBe(1000);
  });

  it('uses cached prompts on second call without re-running haiku', async () => {
    stubMemory('Mesa Bakery');
    mockGenerateTextWithTracking
      .mockResolvedValueOnce({ text: 'best bakery in Mesa AZ' })
      .mockResolvedValue({ text: 'Some response' });

    await checkAiVisibilityTool.execute({}, makeContext());
    const callsAfterFirst = mockGenerateTextWithTracking.mock.calls.length;

    await checkAiVisibilityTool.execute({}, makeContext());

    const callsAfterSecond = mockGenerateTextWithTracking.mock.calls.length;
    const platformCallsPerRun = callsAfterFirst - 1;
    expect(callsAfterSecond).toBe(callsAfterFirst + platformCallsPerRun);
  });

  it('re-queries after cache TTL expires', async () => {
    vi.useFakeTimers();
    stubMemory('Mesa Bakery');
    mockGenerateTextWithTracking
      .mockResolvedValueOnce({ text: 'best bakery in Mesa AZ' })
      .mockResolvedValue({ text: 'Some response' });

    await checkAiVisibilityTool.execute({}, makeContext());
    const callsAfterFirst = mockGenerateTextWithTracking.mock.calls.length;

    vi.advanceTimersByTime(10 * 60 * 1000 + 1);

    mockGenerateTextWithTracking.mockResolvedValueOnce({ text: 'best bakery in Mesa AZ' });

    await checkAiVisibilityTool.execute({}, makeContext());

    expect(mockGenerateTextWithTracking.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    vi.useRealTimers();
  });

  it('includes brand.summary text in the haiku prompt when present', async () => {
    const store = getKvMemoryStore();
    vi.mocked(store.get).mockImplementation(async (_scope, key) => {
      if (key === 'brand.identity') {
        return {
          exists: true,
          value: {
            brandName: 'Mesa Bakery',
            personality: { description: 'warm and artisan' },
            audience: { description: 'local families' },
          },
        };
      }
      if (key === 'brand.summary') {
        return { exists: true, value: { text: 'handcrafted sourdough since 2010' } };
      }
      return { exists: false, value: null };
    });

    mockGenerateTextWithTracking
      .mockResolvedValueOnce({ text: 'best bakery in Mesa AZ' })
      .mockResolvedValue({ text: 'Some response' });

    await checkAiVisibilityTool.execute({}, makeContext());

    const promptGenCall = mockGenerateTextWithTracking.mock.calls[0][0] as { prompt: string };
    expect(promptGenCall.prompt).toContain('warm and artisan');
    expect(promptGenCall.prompt).toContain('local families');
    expect(promptGenCall.prompt).toContain('handcrafted sourdough since 2010');
  });

  it('strips blank lines and caps generated prompts at 5', async () => {
    stubMemory('Mesa Bakery');
    const haikuOutput = [
      'query one',
      '',
      'query two',
      '   ',
      'query three',
      'query four',
      'query five',
      'query six',
    ].join('\n');
    mockGenerateTextWithTracking
      .mockResolvedValueOnce({ text: haikuOutput })
      .mockResolvedValue({ text: 'Some response' });

    const result = await checkAiVisibilityTool.execute({}, makeContext()) as VisibilityResult;

    expect(result.prompts).toHaveLength(5);
    expect(result.prompts).not.toContain('query six');

    const uniquePromptsInResults = [...new Set(result.results.map(r => r.prompt))];
    expect(uniquePromptsInResults).toHaveLength(5);
  });

  it('passes abortSignal to all generateTextWithTracking calls', async () => {
    stubMemory('Mesa Bakery');
    mockGenerateTextWithTracking
      .mockResolvedValueOnce({ text: 'best bakery in Mesa AZ' })
      .mockResolvedValue({ text: 'Some response' });

    await checkAiVisibilityTool.execute({}, makeContext());

    for (const call of mockGenerateTextWithTracking.mock.calls) {
      const args = call[0] as { abortSignal: AbortSignal };
      expect(args.abortSignal).toBeInstanceOf(AbortSignal);
    }
  });

  it('re-queries when brand identity changes between calls', async () => {
    stubMemory('Mesa Bakery');
    mockGenerateTextWithTracking
      .mockResolvedValueOnce({ text: 'best bakery in Mesa AZ' })
      .mockResolvedValue({ text: 'Some response' });

    await checkAiVisibilityTool.execute({}, makeContext());
    const callsAfterFirst = mockGenerateTextWithTracking.mock.calls.length;

    stubMemory('Mesa Bakery Renamed');
    mockGenerateTextWithTracking
      .mockResolvedValueOnce({ text: 'best bakery in Mesa AZ' })
      .mockResolvedValue({ text: 'Some response' });

    const result = await checkAiVisibilityTool.execute({}, makeContext()) as VisibilityResult;
    expect(result.brandName).toBe('Mesa Bakery Renamed');
    expect(mockGenerateTextWithTracking.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('returns an error and skips caching when haiku generates no usable prompts', async () => {
    stubMemory('Mesa Bakery');
    mockGenerateTextWithTracking.mockResolvedValueOnce({ text: '   \n\n  ' });

    const result = await checkAiVisibilityTool.execute({}, makeContext()) as { error: string };
    expect(result.error).toMatch(/Could not generate search queries/);

    mockGenerateTextWithTracking.mockResolvedValueOnce({ text: 'best bakery in Mesa AZ' });
    mockGenerateTextWithTracking.mockResolvedValue({ text: 'Some response' });

    const retryResult = await checkAiVisibilityTool.execute({}, makeContext()) as VisibilityResult;
    expect(retryResult.brandName).toBe('Mesa Bakery');
    expect(retryResult.results.length).toBeGreaterThan(0);
    expect(retryResult.prompts.length).toBeGreaterThan(0);
  });

  it('uses customPrompts directly, skipping haiku prompt generation', async () => {
    stubMemory('Mesa Bakery');
    mockGenerateTextWithTracking.mockResolvedValue({ text: 'Here are some restaurants.' });

    const result = await checkAiVisibilityTool.execute(
      { customPrompts: ['restaurants in Tempe, AZ'] },
      makeContext(),
    ) as VisibilityResult;

    expect(result.prompts).toEqual(['restaurants in Tempe, AZ']);
    expect(result.results.length).toBe(2);

    const platforms = result.results.map(r => r.platform);
    expect(platforms).toContain('ChatGPT (GPT-4o)');
    expect(platforms).toContain('Claude');

    const allCalls = mockGenerateTextWithTracking.mock.calls as Array<[{ modelName: string }]>;
    const haikuCall = allCalls.find(([args]) => args.modelName === 'haiku');
    expect(haikuCall).toBeUndefined();
  });

  it('customPrompts bypass the result cache', async () => {
    stubMemory('Mesa Bakery');
    mockGenerateTextWithTracking
      .mockResolvedValueOnce({ text: 'auto query' })
      .mockResolvedValue({ text: 'Some response' });

    await checkAiVisibilityTool.execute({}, makeContext());
    const callsAfterStandard = mockGenerateTextWithTracking.mock.calls.length;

    mockGenerateTextWithTracking.mockResolvedValue({ text: 'Custom response' });

    await checkAiVisibilityTool.execute(
      { customPrompts: ['restaurants in Tempe, AZ'] },
      makeContext(),
    );

    expect(mockGenerateTextWithTracking.mock.calls.length).toBeGreaterThan(callsAfterStandard);
  });

  it('customPrompts do not require a brand name', async () => {
    stubMemory('');
    mockGenerateTextWithTracking.mockResolvedValue({ text: 'Some response' });

    const result = await checkAiVisibilityTool.execute(
      { customPrompts: ['best coffee shops downtown'] },
      makeContext(),
    ) as VisibilityResult;

    expect(result.prompts).toEqual(['best coffee shops downtown']);
    expect(result.results.length).toBe(2);
  });

  it('customPrompts result is not cached for subsequent standard calls', async () => {
    stubMemory('Mesa Bakery');
    mockGenerateTextWithTracking.mockResolvedValue({ text: 'Some response' });

    await checkAiVisibilityTool.execute(
      { customPrompts: ['restaurants in Tempe, AZ'] },
      makeContext(),
    );
    const callsAfterCustom = mockGenerateTextWithTracking.mock.calls.length;

    mockGenerateTextWithTracking
      .mockResolvedValueOnce({ text: 'standard query' })
      .mockResolvedValue({ text: 'Some response' });

    await checkAiVisibilityTool.execute({}, makeContext());

    expect(mockGenerateTextWithTracking.mock.calls.length).toBeGreaterThan(callsAfterCustom);
  });

  it('platforms: ["claude"] returns only Claude results', async () => {
    stubMemory('Mesa Bakery');
    mockGenerateTextWithTracking
      .mockResolvedValueOnce({ text: 'best bakery in Mesa AZ' })
      .mockResolvedValue({ text: 'Some response' });

    const result = await checkAiVisibilityTool.execute(
      { platforms: ['claude'] },
      makeContext(),
    ) as VisibilityResult;

    expect(result.results.every(r => r.platform === 'Claude')).toBe(true);
    expect(result.results.some(r => r.platform === 'ChatGPT (GPT-4o)')).toBe(false);
    expect(result.results.length).toBe(result.prompts.length);
  });

  it('platforms: ["chatgpt"] returns only ChatGPT results', async () => {
    stubMemory('Mesa Bakery');
    mockGenerateTextWithTracking
      .mockResolvedValueOnce({ text: 'best bakery in Mesa AZ' })
      .mockResolvedValue({ text: 'Some response' });

    const result = await checkAiVisibilityTool.execute(
      { platforms: ['chatgpt'] },
      makeContext(),
    ) as VisibilityResult;

    expect(result.results.every(r => r.platform === 'ChatGPT (GPT-4o)')).toBe(true);
    expect(result.results.some(r => r.platform === 'Claude')).toBe(false);
    expect(result.results.length).toBe(result.prompts.length);
  });

  it('platforms: [] falls back to querying both platforms', async () => {
    stubMemory('Mesa Bakery');
    mockGenerateTextWithTracking
      .mockResolvedValueOnce({ text: 'best bakery in Mesa AZ' })
      .mockResolvedValue({ text: 'Some response' });

    const result = await checkAiVisibilityTool.execute(
      { platforms: [] },
      makeContext(),
    ) as VisibilityResult;

    const platformSet = new Set(result.results.map(r => r.platform));
    expect(platformSet).toContain('ChatGPT (GPT-4o)');
    expect(platformSet).toContain('Claude');
  });

  it('rejects customPrompts with more than 5 entries', () => {
    const result = checkAiVisibilityTool.parameters.safeParse({ customPrompts: ['a', 'b', 'c', 'd', 'e', 'f'] });
    expect(result.success).toBe(false);
  });

  it('rejects a customPrompt entry exceeding 500 characters', () => {
    const result = checkAiVisibilityTool.parameters.safeParse({ customPrompts: ['x'.repeat(501)] });
    expect(result.success).toBe(false);
  });

  it('rejects an empty string customPrompt entry', () => {
    const result = checkAiVisibilityTool.parameters.safeParse({ customPrompts: [''] });
    expect(result.success).toBe(false);
  });
});
