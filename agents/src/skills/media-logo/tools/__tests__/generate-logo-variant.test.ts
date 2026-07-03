import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../logging/index.js', () => ({
  Logger: { create: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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

const mockGetSlot = vi.fn();
vi.mock('../../../../services/MediaManifestService.js', () => ({
  mediaManifestService: { getSlot: mockGetSlot },
}));

const mockMemoryGet = vi.fn();
vi.mock('../../../../memory/adapters/index.js', () => ({
  getKvMemoryStore: () => ({ get: mockMemoryGet }),
}));

const mockStartVariant = vi.fn();
vi.mock('../../../../services/logo/LogoGenerationService.js', () => ({
  logoGenerationService: { startVariant: mockStartVariant },
}));

vi.mock('../../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(() => ({ files: {} })),
}));

vi.mock('../../../../services/logo/logo-job-state.js', () => ({
  readLogoJob: vi.fn(async () => ({ jobId: 'job-1', status: 'completed', logoId: 'logo-abc' })),
}));

vi.mock('@airo/ai-transport', () => ({
  getCurrentTraceIds: vi.fn(() => undefined),
}));

const SQUARE_SLOT = 'logo/primary';
const HORIZONTAL_SLOT = 'logo/horizontal';
const FAVICON_SLOT = 'logo/favicon';

const makeSlotResult = (url: string) => ({
  success: true,
  slot: {
    currentUrl: url,
    logoSourceMap: { [url]: { sessionId: 'sess-1', logoId: 'logo-1' } },
    userModified: false,
    createdAt: '2026-01-01T00:00:00Z',
    lastUpdated: '2026-01-01T00:00:00Z',
  },
});

const emptySlotResult = { success: false };

describe('media-logo generate_logo_variant tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFindById.mockReturnValue({ id: 'app-1', customerId: 'cust-1' });
    mockGetCurrentUserId.mockReturnValue('budget-user-1');
    mockAppPlanExecute.mockResolvedValue({ success: false });
    mockMemoryGet.mockResolvedValue({ success: true, exists: false });

    // Default: square slot has a logo, others empty
    mockGetSlot.mockImplementation(async (_appId: string, path: string) => {
      if (path === SQUARE_SLOT) return makeSlotResult('https://cdn.example.com/logo-square.png');
      return emptySlotResult;
    });

    mockStartVariant.mockResolvedValue({
      status: 'queued', jobId: 'job-1', slots: [FAVICON_SLOT], done: Promise.resolve(),
    });
  });

  const baseContext = { socketId: 'sock-1', metadata: { appId: 'app-1' } };

  describe('input validation + context resolution', () => {
    it('returns an error when no appId in context', async () => {
      const { generateLogoVariantTool } = await import('../index.js');

      const result = await generateLogoVariantTool.execute(
        { variant: 'favicon' },
        { socketId: 'sock-1', metadata: {} },
      );

      expect((result as { error?: string }).error).toMatch(/app id/i);
      expect(mockStartVariant).not.toHaveBeenCalled();
    });

    it('returns an error when the app has no customerId', async () => {
      mockFindById.mockReturnValueOnce({ id: 'app-1' });
      const { generateLogoVariantTool } = await import('../index.js');

      const result = await generateLogoVariantTool.execute({ variant: 'favicon' }, baseContext);

      expect((result as { error?: string }).error).toMatch(/customer/i);
      expect(mockStartVariant).not.toHaveBeenCalled();
    });

    it('returns an error when grants are exhausted', async () => {
      mockGetCurrentUserId.mockReturnValueOnce(undefined);
      const { generateLogoVariantTool } = await import('../index.js');

      const result = await generateLogoVariantTool.execute({ variant: 'favicon' }, baseContext);

      expect((result as { error?: string }).error).toMatch(/credit/i);
      expect(mockStartVariant).not.toHaveBeenCalled();
    });

    it('returns an error when no existing logo in any slot', async () => {
      mockGetSlot.mockResolvedValue(emptySlotResult);
      const { generateLogoVariantTool } = await import('../index.js');

      const result = await generateLogoVariantTool.execute({ variant: 'favicon' }, baseContext);

      expect((result as { error?: string }).error).toMatch(/no existing logo/i);
      expect(mockStartVariant).not.toHaveBeenCalled();
    });

    it('returns an error when slot exists but has no logoSourceMap', async () => {
      mockGetSlot.mockResolvedValue({
        success: true,
        slot: { currentUrl: 'https://cdn.example.com/logo.png', userModified: false },
      });
      const { generateLogoVariantTool } = await import('../index.js');

      const result = await generateLogoVariantTool.execute({ variant: 'favicon' }, baseContext);

      expect((result as { error?: string }).error).toMatch(/no existing logo/i);
    });
  });

  describe('favicon variant', () => {
    it('calls startVariant with sourceUrl from square slot and variant=favicon', async () => {
      const { generateLogoVariantTool } = await import('../index.js');

      await generateLogoVariantTool.execute({ variant: 'favicon' }, baseContext);

      expect(mockStartVariant).toHaveBeenCalledOnce();
      const call = mockStartVariant.mock.calls[0][0];
      expect(call.appId).toBe('app-1');
      expect(call.variant).toBe('favicon');
      expect(call.sourceUrl).toBe('https://cdn.example.com/logo-square.png');
      expect(call.customerId).toBe('cust-1');
      expect(call.budgetUserId).toBe('budget-user-1');
    });

    it('falls back to horizontal slot when square slot has no logoSourceMap', async () => {
      mockGetSlot.mockImplementation(async (_appId: string, path: string) => {
        if (path === SQUARE_SLOT) {
          // slot exists but no logoSourceMap → not usable as reference
          return { success: true, slot: { currentUrl: 'https://cdn.example.com/logo-sq.png', userModified: false } };
        }
        if (path === HORIZONTAL_SLOT) return makeSlotResult('https://cdn.example.com/logo-h.png');
        return emptySlotResult;
      });

      const { generateLogoVariantTool } = await import('../index.js');

      await generateLogoVariantTool.execute({ variant: 'favicon' }, baseContext);

      const call = mockStartVariant.mock.calls[0][0];
      expect(call.sourceUrl).toBe('https://cdn.example.com/logo-h.png');
    });

    it('passes optional prompt to startVariant', async () => {
      const { generateLogoVariantTool } = await import('../index.js');

      await generateLogoVariantTool.execute(
        { variant: 'favicon', prompt: 'simplify for small sizes' },
        baseContext,
      );

      const call = mockStartVariant.mock.calls[0][0];
      expect(call.prompt).toBe('simplify for small sizes');
    });

    it('returns queued status in background mode (default)', async () => {
      const { generateLogoVariantTool } = await import('../index.js');

      const result = await generateLogoVariantTool.execute({ variant: 'favicon' }, baseContext) as Record<string, unknown>;

      expect((result.structuredContent as Record<string, unknown>).status).toBe('queued');
      expect((result.structuredContent as Record<string, unknown>).jobId).toBe('job-1');
    });
  });

  describe('layout variant', () => {
    it('calls startVariant with variant=square and resolves source from square slot', async () => {
      const { generateLogoVariantTool } = await import('../index.js');

      await generateLogoVariantTool.execute({ variant: 'square' }, baseContext);

      const call = mockStartVariant.mock.calls[0][0];
      expect(call.variant).toBe('square');
      expect(call.sourceUrl).toBe('https://cdn.example.com/logo-square.png');
    });

    it('calls startVariant with variant=horizontal', async () => {
      mockGetSlot.mockImplementation(async (_appId: string, path: string) => {
        if (path === SQUARE_SLOT) return makeSlotResult('https://cdn.example.com/logo-sq.png');
        return emptySlotResult;
      });

      const { generateLogoVariantTool } = await import('../index.js');

      await generateLogoVariantTool.execute({ variant: 'horizontal' }, baseContext);

      const call = mockStartVariant.mock.calls[0][0];
      expect(call.variant).toBe('horizontal');
    });
  });

  describe('synchronous mode', () => {
    it('returns completed status when background=false and job succeeds', async () => {
      const mockLogo = {
        id: 'logo-abc',
        generatedAt: '2026-06-02T00:00:00Z',
        prompt: '',
        modelUsed: 'logo-agent',
        urls: { square: { transparent: 'https://cdn.example.com/favicon.png', solid: '', mockup: '', landscapeMockup: '' } },
      };
      mockStartVariant.mockResolvedValueOnce({
        status: 'queued',
        jobId: 'job-1',
        slots: [FAVICON_SLOT],
        done: Promise.resolve({
          status: 'completed',
          jobId: 'job-1',
          logoId: 'logo-abc',
          logo: mockLogo,
          sessionId: 'sess-1',
          slotSaveFailed: false,
          failedLayouts: [],
          skippedLayouts: [],
        }),
      });

      const { generateLogoVariantTool } = await import('../index.js');

      const result = await generateLogoVariantTool.execute(
        { variant: 'favicon', background: false },
        baseContext,
      ) as Record<string, unknown>;

      expect((result.structuredContent as Record<string, unknown>).status).toBe('completed');
      expect((result.structuredContent as Record<string, unknown>).logoId).toBe('logo-abc');
    });
  });
});
