import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../logging/index.js', () => ({
  Logger: { create: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../../services/LogoService.js', () => ({
  logoService: { generate: vi.fn() },
}));

vi.mock('../../../../database/repositories/index.js', () => ({
  appRepository: { findById: vi.fn() },
}));

vi.mock('@airo/ai-grants', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    grantSessionManager: { getCurrentUserId: vi.fn() },
  };
});

vi.mock('../../../../tools/app-plan-tool.js', () => ({
  appPlanTool: { execute: vi.fn() },
}));

const mockGetSlot = vi.fn();
vi.mock('../../../../services/MediaManifestService.js', () => ({
  mediaManifestService: { setSlot: vi.fn(), getSlot: mockGetSlot },
}));

vi.mock('../../../../memory/adapters/index.js', () => ({
  getKvMemoryStore: () => ({ get: vi.fn() }),
}));

vi.mock('../../../../services/logo/LogoGenerationService.js', () => ({
  logoGenerationService: { start: vi.fn() },
}));

const mockReadLogoJob = vi.fn(async () => null);
vi.mock('../../../../services/logo/logo-job-state.js', () => ({
  readLogoJob: (...a: unknown[]) => mockReadLogoJob(),
}));
vi.mock('../../../../workspace/index.js', () => ({
  createForWorkspace: () => ({ files: {} }),
}));

// LOGO_SLOT_PATHS values the tool looks up.
const HORIZONTAL_PATH = 'logo/horizontal';
const SQUARE_PATH = 'logo/primary';

describe('media-logo set_venture_logo tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadLogoJob.mockResolvedValue(null);
  });

  const baseContext = { socketId: 'sock-1', metadata: { appId: 'app-1' } };

  it('returns an error when no appId is in context', async () => {
    const { setVentureLogoTool } = await import('../index.js');

    const result = await setVentureLogoTool.execute({}, { socketId: 'sock-1', metadata: {} });

    expect(result.error).toMatch(/app id/i);
    expect(mockGetSlot).not.toHaveBeenCalled();
  });

  it('returns an error when a slot lookup rejects', async () => {
    mockGetSlot.mockRejectedValue(new Error('manifest unavailable'));

    const { setVentureLogoTool } = await import('../index.js');

    const result = await setVentureLogoTool.execute({}, baseContext);

    expect(result.error).toMatch(/look up the current logos/i);
    expect(result.structuredContent).toBeUndefined();
  });

  it('returns an error when the square logo is missing', async () => {
    mockGetSlot.mockImplementation((_appId: string, path: string) => {
      if (path === HORIZONTAL_PATH) {
        return Promise.resolve({ success: true, slot: { currentUrl: 'https://cdn/h.png' } });
      }
      // square slot has no current logo yet
      return Promise.resolve({ success: false });
    });

    const { setVentureLogoTool } = await import('../index.js');

    const result = await setVentureLogoTool.execute({}, baseContext);

    expect(result.error).toMatch(/could not find both/i);
  });

  it('sends both URLs to the dashboard on success', async () => {
    mockGetSlot.mockImplementation((_appId: string, path: string) => {
      if (path === HORIZONTAL_PATH) {
        return Promise.resolve({ success: true, slot: { currentUrl: 'https://cdn/h.png' } });
      }
      if (path === SQUARE_PATH) {
        return Promise.resolve({ success: true, slot: { currentUrl: 'https://cdn/s.png' } });
      }
      return Promise.resolve({ success: false });
    });

    const { setVentureLogoTool } = await import('../index.js');

    const result = await setVentureLogoTool.execute({}, baseContext);

    expect(result.error).toBeUndefined();
    expect(result.structuredContent).toEqual({
      horizontalUrl: 'https://cdn/h.png',
      squareUrl: 'https://cdn/s.png',
    });
    expect(mockGetSlot).toHaveBeenCalledWith('app-1', HORIZONTAL_PATH);
    expect(mockGetSlot).toHaveBeenCalledWith('app-1', SQUARE_PATH);
  });

  describe('set_venture_logo while a job is in flight', () => {
    it('returns pending without reading slots', async () => {
      mockReadLogoJob.mockResolvedValueOnce({ jobId: 'job-1', status: 'generating' } as never);
      const { setVentureLogoTool } = await import('../index.js');
      const result = await setVentureLogoTool.execute({}, baseContext);
      expect(result.structuredContent).toEqual({ pending: true });
      expect(mockGetSlot).not.toHaveBeenCalled();
    });
  });
});
