import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RebuildWorkflowState } from '../../../types/rebuild.js';

vi.mock('@airo/ai-lib', () => ({
  createTool: (_desc: string, _schema: unknown, fn: unknown) => ({ execute: fn }),
}));

const mockFindById = vi.fn();
vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn(function appRepository(this: unknown) {
    return { findById: mockFindById };
  }),
}));

const mockBeginRebuild = vi.fn();
const mockStartRebuild = vi.fn();
const mockGetStatus = vi.fn();
const mockBuildUpfrontPagePrompts = vi.fn();
const mockGetAssetManifest = vi.fn();
const mockSubmitStylePreferences = vi.fn();

vi.mock('../../../services/RebuildOrchestrationService.js', () => ({
  RebuildOrchestrationService: vi.fn(function orchestrationService(this: unknown) {
    return {
      beginRebuild: mockBeginRebuild,
      startRebuild: mockStartRebuild,
      getStatus: mockGetStatus,
      buildUpfrontPagePrompts: mockBuildUpfrontPagePrompts,
      getAssetManifest: mockGetAssetManifest,
      submitStylePreferences: mockSubmitStylePreferences,
    };
  }),
}));

const mockWaitForIntake = vi.fn();
vi.mock('../wait-for-intake.js', () => ({
  waitForIntake: mockWaitForIntake,
}));

const mockWaitForScrapeCompletion = vi.fn();
vi.mock('../wait-for-scrape-completion.js', () => ({
  waitForScrapeCompletion: mockWaitForScrapeCompletion,
}));

vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

const { websiteRebuildAITool } = await import('../website-rebuild.js');

function baseState(overrides: Partial<RebuildWorkflowState> = {}): RebuildWorkflowState {
  return {
    appId: 'app1',
    sourceUrl: 'https://example.com',
    rootPath: '/',
    status: 'style_questions',
    scrapingProgress: { total: 2, completed: 2 },
    pagesBuilt: [],
    currentPage: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function run(
  metadata: Record<string, unknown>,
  input: {
    url: string;
    designDirection?: 'keep-similar' | 'modernize' | 'simplify' | 'bold';
    designIntent?: string;
  } = {
    url: 'https://example.com',
  },
) {
  return (websiteRebuildAITool as { execute: (input: { url: string }, ctx: unknown) => Promise<unknown> }).execute(
    input,
    { metadata: { appId: 'app1', ...metadata } },
  );
}

describe('websiteRebuild orchestration', function websiteRebuildOrchestration() {
  beforeEach(function resetMocks() {
    vi.clearAllMocks();
    mockFindById.mockResolvedValue({ id: 'app1', path: '/apps/app1', initialBuildComplete: false });
    mockBeginRebuild.mockResolvedValue(baseState({ status: 'awaiting_intake' }));
    mockStartRebuild.mockResolvedValue(baseState({ status: 'scraping' }));
    mockWaitForIntake.mockResolvedValue({
      state: baseState({ intakeCompleted: true, rebuildScope: 'small' }),
      intakeTimedOut: false,
    });
    mockWaitForScrapeCompletion.mockResolvedValue(baseState());
    mockBuildUpfrontPagePrompts.mockResolvedValue({
      slugs: ['homepage'],
      homepagePrompt: 'homepage prompt',
    });
    mockGetAssetManifest.mockResolvedValue({
      totalAssets: 0,
      byType: { image: 0, font: 0, icon: 0, other: 0 },
      assets: [],
    });
    mockSubmitStylePreferences.mockResolvedValue(undefined);
  });

  it('uses beginRebuild and waits for intake when intake form flag is on', async function intakeEnabled() {
    await run({ rebuildIntakeFormEnabled: true });

    expect(mockBeginRebuild).toHaveBeenCalledWith('app1', 'https://example.com');
    expect(mockWaitForIntake).toHaveBeenCalled();
    expect(mockStartRebuild).not.toHaveBeenCalled();
  });

  it('uses startRebuild without waiting when intake form flag is off', async function intakeDisabled() {
    await run({ rebuildIntakeFormEnabled: false });

    expect(mockStartRebuild).toHaveBeenCalledWith('app1', 'https://example.com');
    expect(mockWaitForIntake).not.toHaveBeenCalled();
    expect(mockBeginRebuild).not.toHaveBeenCalled();
  });

  it('submits collected style preferences when scrape ends at style_questions', async function existingPreferences() {
    const prefs = {
      designDirection: 'modernize' as const,
      colorPreference: 'keep-original' as const,
      typographyStyle: 'keep-original' as const,
      layoutApproach: 'responsive' as const,
    };
    mockWaitForScrapeCompletion.mockResolvedValue(baseState({ stylePreferences: prefs }));

    await run({ rebuildIntakeFormEnabled: false });

    expect(mockSubmitStylePreferences).toHaveBeenCalledWith('app1', prefs);
  });

  it('applies default style preferences when scrape leaves none', async function defaultPreferences() {
    mockWaitForScrapeCompletion.mockResolvedValue(baseState({ stylePreferences: undefined }));

    await run({ rebuildIntakeFormEnabled: false });

    expect(mockSubmitStylePreferences).toHaveBeenCalledWith('app1', expect.objectContaining({
      designDirection: 'modernize',
    }));
  });

  it('defaults to modernize when only user message is present without tool arg', async function messageDefaultModernize() {
    mockWaitForScrapeCompletion.mockResolvedValue(baseState({ stylePreferences: undefined }));

    await run({
      rebuildIntakeFormEnabled: false,
      _userMessage: 'rebuild and modernize my site: https://example.com',
    });

    expect(mockSubmitStylePreferences).toHaveBeenCalledWith('app1', expect.objectContaining({
      designDirection: 'modernize',
    }));
  });

  it('defaults to modernize when user message implies clone but tool arg is omitted', async function messageCloneDefaultsModernize() {
    mockWaitForScrapeCompletion.mockResolvedValue(baseState({ stylePreferences: undefined }));

    await run({
      rebuildIntakeFormEnabled: false,
      _userMessage: 'rebuild my site, keep a similar look',
    });

    expect(mockSubmitStylePreferences).toHaveBeenCalledWith('app1', expect.objectContaining({
      designDirection: 'modernize',
    }));
  });

  it('applies the homepage design direction on the flag-off path', async function flagOffDirection() {
    mockWaitForScrapeCompletion.mockResolvedValue(baseState({ stylePreferences: undefined }));

    await run({ rebuildIntakeFormEnabled: false, rebuildDesignDirection: 'modernize' });

    expect(mockSubmitStylePreferences).toHaveBeenCalledWith('app1', expect.objectContaining({
      designDirection: 'modernize',
    }));
  });

  it('falls back to modernize for an invalid client design direction', async function invalidDirection() {
    mockWaitForScrapeCompletion.mockResolvedValue(baseState({ stylePreferences: undefined }));

    await run({ rebuildIntakeFormEnabled: false, rebuildDesignDirection: 'nonsense' });

    expect(mockSubmitStylePreferences).toHaveBeenCalledWith('app1', expect.objectContaining({
      designDirection: 'modernize',
    }));
  });

  it('passes resolved design direction to the intake timeout fallback', async function timeoutDirection() {
    await run({ rebuildIntakeFormEnabled: true, rebuildDesignDirection: 'modernize' });

    expect(mockWaitForIntake).toHaveBeenCalledWith(expect.anything(), 'app1', { designDirection: 'modernize' });
  });

  it('defaults intake direction to modernize when no modal or tool arg', async function timeoutDefault() {
    await run({
      rebuildIntakeFormEnabled: true,
      _userMessage: 'rebuild and modernize my site',
    });

    expect(mockWaitForIntake).toHaveBeenCalledWith(expect.anything(), 'app1', { designDirection: 'modernize' });
  });

  it('applies agent tool designDirection', async function toolDirection() {
    mockWaitForScrapeCompletion.mockResolvedValue(baseState({ stylePreferences: undefined }));

    await run(
      { rebuildIntakeFormEnabled: false },
      {
        url: 'https://example.com',
        designDirection: 'modernize',
      },
    );

    expect(mockSubmitStylePreferences).toHaveBeenCalledWith('app1', expect.objectContaining({
      designDirection: 'modernize',
    }));
  });

  it('prefers modal direction over agent tool designDirection', async function modalOverridesTool() {
    mockWaitForScrapeCompletion.mockResolvedValue(baseState({ stylePreferences: undefined }));

    await run(
      { rebuildIntakeFormEnabled: false, rebuildDesignDirection: 'keep-similar' },
      { url: 'https://example.com', designDirection: 'modernize' },
    );

    expect(mockSubmitStylePreferences).toHaveBeenCalledWith('app1', expect.objectContaining({
      designDirection: 'keep-similar',
    }));
  });

  it('threads the agent tool designIntent onto the submitted style preferences', async function toolDesignIntent() {
    mockWaitForScrapeCompletion.mockResolvedValue(baseState({ stylePreferences: undefined }));

    await run(
      { rebuildIntakeFormEnabled: false },
      { url: 'https://example.com', designDirection: 'modernize', designIntent: 'reimagine from first principles, ignore the existing layout' },
    );

    expect(mockSubmitStylePreferences).toHaveBeenCalledWith('app1', expect.objectContaining({
      designIntent: 'reimagine from first principles, ignore the existing layout',
    }));
  });

  it('prefers a client/modal rebuildDesignIntent over the agent tool designIntent', async function modalIntentOverridesTool() {
    mockWaitForScrapeCompletion.mockResolvedValue(baseState({ stylePreferences: undefined }));

    await run(
      { rebuildIntakeFormEnabled: false, rebuildDesignIntent: 'from the intake form' },
      { url: 'https://example.com', designIntent: 'from the tool arg' },
    );

    expect(mockSubmitStylePreferences).toHaveBeenCalledWith('app1', expect.objectContaining({
      designIntent: 'from the intake form',
    }));
  });

  it('passes tool designDirection to intake timeout fallback', async function timeoutToolDirection() {
    await run(
      { rebuildIntakeFormEnabled: true },
      { url: 'https://example.com', designDirection: 'simplify' },
    );

    expect(mockWaitForIntake).toHaveBeenCalledWith(expect.anything(), 'app1', { designDirection: 'simplify' });
  });
});
