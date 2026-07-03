import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../logging/index.js', () => ({
  Logger: { create: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockGenerate = vi.fn();
vi.mock('../../../../services/LogoService.js', () => ({
  logoService: { generate: mockGenerate },
}));

const mockFindById = vi.fn();
vi.mock('../../../../database/repositories/index.js', () => ({
  appRepository: { findById: mockFindById },
}));

const mockGetCurrentUserId = vi.fn();
vi.mock('@airo/ai-grants', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    grantSessionManager: { getCurrentUserId: mockGetCurrentUserId },
  };
});

const mockAppPlanExecute = vi.fn();
vi.mock('../../../../tools/app-plan-tool.js', () => ({
  appPlanTool: { execute: mockAppPlanExecute },
}));

const mockSetSlot = vi.fn();
const mockGetSlot = vi.fn();
vi.mock('../../../../services/MediaManifestService.js', () => ({
  mediaManifestService: { setSlot: mockSetSlot, getSlot: mockGetSlot },
}));

const mockMemoryGet = vi.fn();
vi.mock('../../../../memory/adapters/index.js', () => ({
  getKvMemoryStore: () => ({ get: mockMemoryGet }),
}));

const mockStart = vi.fn(async () => ({
  status: 'queued', jobId: 'job-1', slots: ['logo/horizontal'], done: Promise.resolve(),
}));
vi.mock('../../../../services/logo/LogoGenerationService.js', () => ({
  logoGenerationService: { start: mockStart },
}));

const mockCreateForWorkspace = vi.fn(() => ({ files: {} }));
vi.mock('../../../../workspace/index.js', () => ({
  createForWorkspace: mockCreateForWorkspace,
}));

const mockReadLogoJob = vi.fn(async () => ({ jobId: 'job-1', status: 'completed', logoId: 'logo-abc' }));
vi.mock('../../../../services/logo/logo-job-state.js', () => ({
  readLogoJob: mockReadLogoJob,
}));

describe('resolveFollowUpVariants (via generateLogoTool)', () => {
  const baseContext = { socketId: 'sock-1', metadata: { appId: 'app-1' } };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById.mockReturnValue({ id: 'app-1', customerId: 'cust-1' });
    mockGetCurrentUserId.mockReturnValue('budget-user-1');
    mockAppPlanExecute.mockResolvedValue({ success: false });
    mockMemoryGet.mockResolvedValue({ success: true, exists: false });
    mockSetSlot.mockResolvedValue({ success: true });
    mockGetSlot.mockResolvedValue({ success: false });
    mockStart.mockResolvedValue({
      status: 'queued', jobId: 'job-1', slots: ['logo/horizontal'], done: Promise.resolve(),
    });
  });

  function getFollowUpVariants(): string[] | undefined {
    const callArg: Record<string, unknown> = mockStart.mock.calls[0]?.[0] ?? {};
    return callArg.followUpVariants as string[] | undefined;
  }

  it('returns no followUpVariants when no siblings are populated and none explicit', async () => {
    const { generateLogoTool } = await import('../index.js');
    await generateLogoTool.execute({ prompt: 'logo', layout: 'horizontal' }, baseContext);
    expect(getFollowUpVariants()).toBeUndefined();
  });

  it('passes explicit followUpVariants through unchanged', async () => {
    const { generateLogoTool } = await import('../index.js');
    await generateLogoTool.execute(
      { prompt: 'logo', layout: 'horizontal', followUpVariants: ['square', 'favicon'] },
      baseContext,
    );
    const variants = getFollowUpVariants();
    expect(variants).toContain('square');
    expect(variants).toContain('favicon');
  });

  it('auto-detects populated sibling with currentUrl + logoSourceMap', async () => {
    mockGetSlot.mockImplementation(async (_appId: string, slotPath: string) => {
      if (slotPath === 'logo/primary') {
        return { success: true, slot: { currentUrl: '/logo.png', logoSourceMap: { '/logo.png': 'src' } } };
      }
      return { success: false };
    });

    const { generateLogoTool } = await import('../index.js');
    await generateLogoTool.execute({ prompt: 'logo', layout: 'horizontal' }, baseContext);

    const variants = getFollowUpVariants();
    expect(variants).toContain('square');
  });

  it('does NOT auto-detect sibling with currentUrl but no logoSourceMap', async () => {
    mockGetSlot.mockImplementation(async (_appId: string, slotPath: string) => {
      if (slotPath === 'logo/primary') {
        return { success: true, slot: { currentUrl: '/logo.png' } };
      }
      return { success: false };
    });

    const { generateLogoTool } = await import('../index.js');
    await generateLogoTool.execute({ prompt: 'logo', layout: 'horizontal' }, baseContext);

    expect(getFollowUpVariants()).toBeUndefined();
  });

  it('does NOT auto-detect sibling when logoSourceMap has no entry for currentUrl', async () => {
    mockGetSlot.mockImplementation(async (_appId: string, slotPath: string) => {
      if (slotPath === 'logo/primary') {
        return {
          success: true,
          slot: { currentUrl: '/new-logo.png', logoSourceMap: { '/old-logo.png': 'stale-source' } },
        };
      }
      return { success: false };
    });

    const { generateLogoTool } = await import('../index.js');
    await generateLogoTool.execute({ prompt: 'logo', layout: 'horizontal' }, baseContext);

    expect(getFollowUpVariants()).toBeUndefined();
  });

  it('skips slots that are currently being generated', async () => {
    // Generate 'all' layouts — all 3 slots are generating, so none should be auto-detected
    mockGetSlot.mockResolvedValue({
      success: true, slot: { currentUrl: '/logo.png', logoSourceMap: { '/logo.png': 'src' } },
    });

    const { generateLogoTool } = await import('../index.js');
    await generateLogoTool.execute({ prompt: 'logo', layout: 'all' }, baseContext);

    // The only possible auto-detect is favicon (square/horizontal/vertical are generating)
    const variants = getFollowUpVariants();
    expect(variants).not.toContain('square');
    expect(variants).not.toContain('horizontal');
    expect(variants).not.toContain('vertical');
  });

  it('auto-detects favicon when its slot is populated and not generating', async () => {
    mockGetSlot.mockImplementation(async (_appId: string, slotPath: string) => {
      if (slotPath === 'logo/favicon') {
        return { success: true, slot: { currentUrl: '/fav.png', logoSourceMap: { '/fav.png': 'src' } } };
      }
      return { success: false };
    });

    const { generateLogoTool } = await import('../index.js');
    await generateLogoTool.execute({ prompt: 'logo', layout: 'horizontal' }, baseContext);

    const variants = getFollowUpVariants();
    expect(variants).toContain('favicon');
  });

  it('deduplicates: explicit variant not added again by auto-detect', async () => {
    mockGetSlot.mockImplementation(async (_appId: string, slotPath: string) => {
      if (slotPath === 'logo/primary') {
        return { success: true, slot: { currentUrl: '/logo.png', logoSourceMap: { '/logo.png': 'src' } } };
      }
      return { success: false };
    });

    const { generateLogoTool } = await import('../index.js');
    await generateLogoTool.execute(
      { prompt: 'logo', layout: 'horizontal', followUpVariants: ['square'] },
      baseContext,
    );

    const variants = getFollowUpVariants();
    const squareCount: number = variants?.filter((v) => v === 'square').length ?? 0;
    expect(squareCount).toBe(1);
  });

  it('merges explicit + auto-detected into one array', async () => {
    mockGetSlot.mockImplementation(async (_appId: string, slotPath: string) => {
      if (slotPath === 'logo/primary') {
        return { success: true, slot: { currentUrl: '/sq.png', logoSourceMap: { '/sq.png': 'src' } } };
      }
      return { success: false };
    });

    const { generateLogoTool } = await import('../index.js');
    await generateLogoTool.execute(
      { prompt: 'logo', layout: 'horizontal', followUpVariants: ['favicon'] },
      baseContext,
    );

    const variants = getFollowUpVariants();
    expect(variants).toContain('favicon');
    expect(variants).toContain('square');
  });

  it('logs a warning and skips the slot when getSlot throws', async () => {
    const { logger: mockLogger } = await import('../../../../logging/index.js');
    mockGetSlot.mockImplementation(async (_appId: string, slotPath: string) => {
      if (slotPath === 'logo/primary') {
        throw new Error('manifest service down');
      }
      if (slotPath === 'logo/vertical') {
        return { success: true, slot: { currentUrl: '/v.png', logoSourceMap: { '/v.png': 'src' } } };
      }
      return { success: false };
    });

    const { generateLogoTool } = await import('../index.js');
    await generateLogoTool.execute({ prompt: 'logo', layout: 'horizontal' }, baseContext);

    const variants = getFollowUpVariants();
    // square slot threw but vertical was detected
    expect(variants).not.toContain('square');
    expect(variants).toContain('vertical');

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'skill.media-logo.followUp.slot_lookup_failed',
      expect.objectContaining({ appId: 'app-1', slotPath: 'logo/primary' }),
    );
  });
});
