import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Static mocks (must precede any dynamic import) ───────────────────────────

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  Logger: {
    create: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  },
}));

vi.mock('../../../services/vite-dedupe.js', () => ({
  ensureViteResolveDedupe: vi.fn(),
}));

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  // Must use a regular function (not arrow) so `new AppRepository()` works
  AppRepository: vi.fn(function MockRepo(this: Record<string, unknown>) {
    this.findById = vi.fn();
  }),
}));

vi.mock('@airo/ai-lib', () => ({
  createOpenAIClient: vi.fn(),
  getFullModelName: vi.fn(() => 'test-model'),
}));

// ── Dynamic imports (after mocks) ────────────────────────────────────────────

const { readFileSync, rmSync, existsSync } = await import('node:fs');
const { readFile, readdir } = await import('node:fs/promises');
const { ensureViteResolveDedupe } = await import('../../../services/vite-dedupe.js');
const { createOpenAIClient } = await import('@airo/ai-lib');
const { AppRepository } = await import('../../../database/repositories/AppRepository.js');

const {
  getFeatureStatusTool,
  listSectionsTool,
  prepareInstallTool,
  generateDiscoveryQuestionsTool,
  hooks,
} = await import('../tools/index.js');

// Grab the mock findById from the singleton instance the module created
const mockRepo = vi.mocked(AppRepository).mock.results[0]!.value as { findById: ReturnType<typeof vi.fn> };

const MOCK_APP = { id: 'app123', path: '/fake/app' };
const MOCK_CTX = { metadata: { appId: 'app123' } };

const MINIMAL_FEATURES_JSON = JSON.stringify({
  features: {
    admin: {
      bookings: { enabled: true },
      services: { enabled: false },
    },
  },
});

// ── getFeatureStatusTool ──────────────────────────────────────────────────────

describe('getFeatureStatusTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when appId is missing', async () => {
    await expect(getFeatureStatusTool.execute({} as never, {})).rejects.toThrow(
      'App ID required',
    );
  });

  it('throws when app is not found', async () => {
    mockRepo.findById.mockReturnValue(null);
    await expect(getFeatureStatusTool.execute({} as never, MOCK_CTX)).rejects.toThrow(
      "App 'app123' not found",
    );
  });

  it('returns installed:false when appointment-features.json is absent', async () => {
    mockRepo.findById.mockReturnValue(MOCK_APP);
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });

    const result = await getFeatureStatusTool.execute({} as never, MOCK_CTX) as {
      installed: boolean;
    };

    expect(result.installed).toBe(false);
  });

  it('returns enabled/disabled arrays when features file is present', async () => {
    mockRepo.findById.mockReturnValue(MOCK_APP);
    vi.mocked(readFileSync).mockReturnValue(MINIMAL_FEATURES_JSON as never);

    const result = await getFeatureStatusTool.execute({} as never, MOCK_CTX) as {
      installed: boolean;
      enabled: string[];
      disabled: string[];
    };

    expect(result.installed).toBe(true);
    expect(result.enabled).toContain('admin.bookings');
    expect(result.disabled).toContain('admin.services');
  });

  it('computeState returns null when not installed', () => {
    const state = getFeatureStatusTool.computeState?.({}, { installed: false, features: [] });
    expect(state).toBeNull();
  });

  it('computeState returns enabledFeatures snapshot when installed', () => {
    const state = getFeatureStatusTool.computeState?.(
      {},
      { installed: true, enabled: ['admin.bookings'], disabled: [] },
    ) as { enabledFeatures: string[]; queriedAt: string } | null;

    expect(state).not.toBeNull();
    expect(state?.enabledFeatures).toEqual(['admin.bookings']);
    expect(typeof state?.queriedAt).toBe('string');
  });
});

// ── listSectionsTool ─────────────────────────────────────────────────────────

describe('listSectionsTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns sections from the sections directory', async () => {
    vi.mocked(readdir).mockResolvedValue(['01-discovery-questions.md'] as never);
    vi.mocked(readFile).mockResolvedValue('# §1 Discovery Questions\n...' as never);

    const result = await listSectionsTool.execute({}, {});

    expect(result.sections).toEqual([
      { slug: '01-discovery-questions', title: 'Discovery Questions' },
    ]);
  });

  it('returns empty title when file has no heading', async () => {
    vi.mocked(readdir).mockResolvedValue(['01-discovery-questions.md'] as never);
    vi.mocked(readFile).mockResolvedValue('no heading here' as never);

    const result = await listSectionsTool.execute({}, {});
    expect(result.sections[0]!.title).toBe('');
  });

  it('propagates readdir errors', async () => {
    vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));
    await expect(listSectionsTool.execute({}, {})).rejects.toThrow('ENOENT');
  });

  it('computeState persists sections catalog and routing_rule', async () => {
    const output = { sections: [{ slug: '01-discovery-questions', title: 'Discovery Questions' }] };
    const state = listSectionsTool.computeState?.({}, output) as Record<string, unknown> | null;

    expect(state).not.toBeNull();
    expect(Array.isArray(state?.sections)).toBe(true);
    expect(typeof state?.routing_rule).toBe('string');
    expect((state?.routing_rule as string).length).toBeGreaterThan(0);
  });

  it('computeState returns null for empty sections', () => {
    const state = listSectionsTool.computeState?.({}, { sections: [] });
    expect(state).toBeNull();
  });
});

// ── prepareInstallTool ────────────────────────────────────────────────────────

describe('prepareInstallTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty arrays when appId is missing', async () => {
    const result = await prepareInstallTool.execute({} as never, {}) as {
      deleted: string[];
      skipped: string[];
    };
    expect(result.deleted).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('returns empty arrays when app is not found', async () => {
    mockRepo.findById.mockReturnValue(null);
    const result = await prepareInstallTool.execute({} as never, MOCK_CTX) as {
      deleted: string[];
      skipped: string[];
    };
    expect(result.deleted).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('deletes api-client.ts when it exists and reports it in deleted', async () => {
    mockRepo.findById.mockReturnValue(MOCK_APP);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(rmSync).mockImplementation(() => {});

    const result = await prepareInstallTool.execute({} as never, MOCK_CTX) as {
      deleted: string[];
      skipped: string[];
    };

    expect(rmSync).toHaveBeenCalledOnce();
    expect(result.deleted).toContain('src/lib/api-client.ts');
    expect(result.skipped).toEqual([]);
  });

  it('skips api-client.ts when it does not exist', async () => {
    mockRepo.findById.mockReturnValue(MOCK_APP);
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await prepareInstallTool.execute({} as never, MOCK_CTX) as {
      deleted: string[];
      skipped: string[];
    };

    expect(rmSync).not.toHaveBeenCalled();
    expect(result.skipped).toContain('src/lib/api-client.ts');
    expect(result.deleted).toEqual([]);
  });
});

// ── generateDiscoveryQuestionsTool ───────────────────────────────────────────

const MOCK_QUESTIONS = Array.from({ length: 6 }, (_, i) => ({
  question: `Question ${i + 1}`,
  type: 'chips_single' as const,
  suggestions: ['A', 'B', 'C', 'D'],
  allowOther: false,
  multiSelect: false,
}));

function makeMockOpenAI(content: string) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content } }],
        }),
      },
    },
  };
}

describe('generateDiscoveryQuestionsTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns LLM questions on success', async () => {
    vi.mocked(createOpenAIClient).mockResolvedValue(
      makeMockOpenAI(JSON.stringify({ questions: MOCK_QUESTIONS })) as never,
    );

    const result = await generateDiscoveryQuestionsTool.execute(
      { userRequirements: 'I need a booking system' },
      {},
    ) as { questions: unknown[] };

    expect(result.questions).toEqual(MOCK_QUESTIONS);
  });

  it('falls back to FALLBACK_QUESTIONS when LLM throws', async () => {
    vi.mocked(createOpenAIClient).mockRejectedValue(new Error('LLM unavailable'));

    const result = await generateDiscoveryQuestionsTool.execute(
      { userRequirements: 'test' },
      {},
    ) as { questions: unknown[] };

    expect(Array.isArray(result.questions)).toBe(true);
    expect(result.questions.length).toBeGreaterThan(0);
  });

  it('falls back when LLM returns empty questions array', async () => {
    vi.mocked(createOpenAIClient).mockResolvedValue(
      makeMockOpenAI(JSON.stringify({ questions: [] })) as never,
    );

    const result = await generateDiscoveryQuestionsTool.execute(
      { userRequirements: 'test' },
      {},
    ) as { questions: unknown[] };

    expect(result.questions.length).toBeGreaterThan(0);
  });

  it('falls back when LLM returns malformed JSON', async () => {
    vi.mocked(createOpenAIClient).mockResolvedValue(
      makeMockOpenAI('not valid json') as never,
    );

    const result = await generateDiscoveryQuestionsTool.execute(
      { userRequirements: 'test' },
      {},
    ) as { questions: unknown[] };

    expect(result.questions.length).toBeGreaterThan(0);
  });

  it('falls back when LLM returns non-array questions', async () => {
    vi.mocked(createOpenAIClient).mockResolvedValue(
      makeMockOpenAI(JSON.stringify({ questions: 'not an array' })) as never,
    );

    const result = await generateDiscoveryQuestionsTool.execute(
      { userRequirements: 'test' },
      {},
    ) as { questions: unknown[] };

    expect(result.questions.length).toBeGreaterThan(0);
  });

  it('filters out malformed items and falls back when none survive validation', async () => {
    const malformed = [
      { question: 'Q1', type: 'invalid_type', suggestions: ['A'], allowOther: false, multiSelect: false },
      { question: '', type: 'chips_single', suggestions: ['A'], allowOther: false, multiSelect: false },
      { type: 'chips_single', suggestions: ['A'], allowOther: false, multiSelect: false },
    ];
    vi.mocked(createOpenAIClient).mockResolvedValue(
      makeMockOpenAI(JSON.stringify({ questions: malformed })) as never,
    );

    const result = await generateDiscoveryQuestionsTool.execute(
      { userRequirements: 'test' },
      {},
    ) as { questions: unknown[] };

    // All items fail validation → fallback
    expect(result.questions.length).toBeGreaterThan(0);
  });

  it('returns only the valid items when array is partially valid', async () => {
    const mixed = [
      ...MOCK_QUESTIONS.slice(0, 2),
      { question: '', type: 'bad_type', suggestions: [], allowOther: false, multiSelect: false },
    ];
    vi.mocked(createOpenAIClient).mockResolvedValue(
      makeMockOpenAI(JSON.stringify({ questions: mixed })) as never,
    );

    const result = await generateDiscoveryQuestionsTool.execute(
      { userRequirements: 'test' },
      {},
    ) as { questions: unknown[] };

    // 2 valid items survive, malformed one is dropped
    expect(result.questions).toEqual(MOCK_QUESTIONS.slice(0, 2));
  });
});

// ── hooks.onInstall ───────────────────────────────────────────────────────────

describe('hooks.onInstall', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls ensureViteResolveDedupe when appPath is present', async () => {
    vi.mocked(ensureViteResolveDedupe).mockImplementation(() => {});
    await hooks.onInstall!({ skillName: 'online-appointments', appPath: '/app' });
    expect(ensureViteResolveDedupe).toHaveBeenCalledWith('/app');
  });

  it('skips ensureViteResolveDedupe when appPath is absent', async () => {
    await hooks.onInstall!({ skillName: 'online-appointments' });
    expect(ensureViteResolveDedupe).not.toHaveBeenCalled();
  });

  it('rethrows when ensureViteResolveDedupe throws', async () => {
    vi.mocked(ensureViteResolveDedupe).mockImplementation(() => { throw new Error('dedupe failed'); });
    await expect(hooks.onInstall!({ skillName: 'online-appointments', appPath: '/app' }))
      .rejects.toThrow('dedupe failed');
  });
});

// ── hooks.onSessionStart ──────────────────────────────────────────────────────

describe('hooks.onSessionStart', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when appPath is absent', async () => {
    const result = await hooks.onSessionStart!({ skillName: 'online-appointments' });
    expect(result).toBeNull();
  });

  it('returns null when features.json is absent and no state.json exists', async () => {
    // readFileSync throws for features.json → readFeaturesJson returns null
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await hooks.onSessionStart!({
      skillName: 'online-appointments',
      appPath: '/app',
    });

    expect(result).toBeNull();
  });

  it('returns lightweight announcement when features absent but state.json exists', async () => {
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
    vi.mocked(existsSync).mockReturnValue(true);

    const result = await hooks.onSessionStart!({
      skillName: 'online-appointments',
      appPath: '/app',
    });

    expect(result).not.toBeNull();
    expect(result!.announcements.length).toBe(1);
    expect(result!.announcements[0]!.id).toBe('ola-skill-loaded');
  });

  it('returns full announcement with section catalog when features are installed', async () => {
    vi.mocked(readFileSync).mockReturnValue(MINIMAL_FEATURES_JSON as never);
    vi.mocked(readdir).mockResolvedValue(['01-discovery-questions.md'] as never);
    vi.mocked(readFile).mockResolvedValue('# §1 Discovery Questions\n...' as never);

    const result = await hooks.onSessionStart!({
      skillName: 'online-appointments',
      appPath: '/app',
    });

    expect(result).not.toBeNull();
    const mainAnnouncement = result!.announcements.find(a => a.id === 'ola-load-sections');
    expect(mainAnnouncement).toBeDefined();
    expect(mainAnnouncement!.summary).toContain('01-discovery-questions');
  });

  it('includes disabled feature announcements when features are installed', async () => {
    vi.mocked(readFileSync).mockReturnValue(MINIMAL_FEATURES_JSON as never);
    vi.mocked(readdir).mockResolvedValue([] as never);

    const result = await hooks.onSessionStart!({
      skillName: 'online-appointments',
      appPath: '/app',
    });

    expect(result).not.toBeNull();
    // admin.services is disabled in MINIMAL_FEATURES_JSON
    const disabledAnnouncement = result!.announcements.find(a => a.id === 'admin.services');
    expect(disabledAnnouncement).toBeDefined();
  });

  it('section catalog falls back gracefully when readdir throws', async () => {
    vi.mocked(readFileSync).mockReturnValue(MINIMAL_FEATURES_JSON as never);
    vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));

    const result = await hooks.onSessionStart!({
      skillName: 'online-appointments',
      appPath: '/app',
    });

    expect(result).not.toBeNull();
    const mainAnnouncement = result!.announcements.find(a => a.id === 'ola-load-sections');
    expect(mainAnnouncement!.summary).toContain('listSections');
  });
});
