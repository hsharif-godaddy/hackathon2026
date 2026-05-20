import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger before other imports
vi.mock('../../../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock LogoService — required because tools/index.ts imports it at module load.
vi.mock('../../../../services/LogoService.js', () => ({
  logoService: {
    generateLogos: vi.fn(),
    editLogos: vi.fn(),
  },
}));

// Mock AppRepository
vi.mock('../../../../database/repositories/index.js', () => ({
  appRepository: {
    findById: vi.fn(),
  },
}));

// Mock grantSessionManager
vi.mock('@airo/ai-grants', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    grantSessionManager: {
      getCurrentUserId: vi.fn(),
    },
  };
});

// Mock AppPlanTool
vi.mock('../../../../tools/app-plan-tool.js', () => ({
  appPlanTool: {
    execute: vi.fn(),
  },
}));

// Mock MediaManifestService — the only service the new tool actually exercises.
const mockGetSlot = vi.fn();
vi.mock('../../../../services/MediaManifestService.js', () => ({
  mediaManifestService: {
    setSlot: vi.fn(),
    getSlot: mockGetSlot,
  },
}));

describe('setVentureLogoTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns horizontal + square URLs when both slots are populated', async () => {
    mockGetSlot.mockImplementation(async (_appId: string, slotPath: string) => {
      if (slotPath === 'logo/horizontal') {
        return { success: true, slot: { currentUrl: 'https://cdn/h.png' } };
      }
      if (slotPath === 'logo/primary') {
        return { success: true, slot: { currentUrl: 'https://cdn/s.png' } };
      }
      return { success: false };
    });

    const { setVentureLogoTool } = await import('../index.js');

    const result = await setVentureLogoTool.execute(
      {},
      { metadata: { appId: 'app-123' } }
    );

    expect(result).toMatchObject({
      structuredContent: {
        horizontalUrl: 'https://cdn/h.png',
        squareUrl: 'https://cdn/s.png',
      },
    });
    expect(typeof (result as { text?: unknown }).text).toBe('string');
  });

  it('returns error when horizontal slot is missing', async () => {
    mockGetSlot.mockImplementation(async (_appId: string, slotPath: string) => {
      if (slotPath === 'logo/primary') {
        return { success: true, slot: { currentUrl: 'https://cdn/s.png' } };
      }
      return { success: false };
    });

    const { setVentureLogoTool } = await import('../index.js');
    const result = await setVentureLogoTool.execute({}, { metadata: { appId: 'app-123' } });

    expect(result).toMatchObject({ error: expect.stringContaining('horizontal and square') });
    expect((result as { structuredContent?: unknown }).structuredContent).toBeUndefined();
  });

  it('returns error when square slot is missing', async () => {
    mockGetSlot.mockImplementation(async (_appId: string, slotPath: string) => {
      if (slotPath === 'logo/horizontal') {
        return { success: true, slot: { currentUrl: 'https://cdn/h.png' } };
      }
      return { success: false };
    });

    const { setVentureLogoTool } = await import('../index.js');
    const result = await setVentureLogoTool.execute({}, { metadata: { appId: 'app-123' } });

    expect(result).toMatchObject({ error: expect.stringContaining('horizontal and square') });
  });

  it('returns error when appId is missing from context', async () => {
    const { setVentureLogoTool } = await import('../index.js');
    const result = await setVentureLogoTool.execute({}, { metadata: {} });

    expect(result).toMatchObject({ error: expect.stringContaining('app id') });
    expect(mockGetSlot).not.toHaveBeenCalled();
  });

  it('returns error when slot lookup succeeds but returns slot: undefined', async () => {
    mockGetSlot.mockImplementation(async (_appId: string, slotPath: string) => {
      if (slotPath === 'logo/horizontal') {
        return { success: true, slot: undefined };
      }
      if (slotPath === 'logo/primary') {
        return { success: true, slot: { currentUrl: 'https://cdn/s.png' } };
      }
      return { success: false };
    });

    const { setVentureLogoTool } = await import('../index.js');
    const result = await setVentureLogoTool.execute({}, { metadata: { appId: 'app-123' } });

    expect(result).toMatchObject({ error: expect.stringContaining('horizontal and square') });
  });

  it('returns error when currentUrl is an empty string', async () => {
    mockGetSlot.mockImplementation(async (_appId: string, slotPath: string) => {
      if (slotPath === 'logo/horizontal') {
        return { success: true, slot: { currentUrl: '' } };
      }
      if (slotPath === 'logo/primary') {
        return { success: true, slot: { currentUrl: 'https://cdn/s.png' } };
      }
      return { success: false };
    });

    const { setVentureLogoTool } = await import('../index.js');
    const result = await setVentureLogoTool.execute({}, { metadata: { appId: 'app-123' } });

    expect(result).toMatchObject({ error: expect.stringContaining('horizontal and square') });
  });

  it('returns error when getSlot throws', async () => {
    mockGetSlot.mockRejectedValue(new Error('boom'));

    const { setVentureLogoTool } = await import('../index.js');
    const result = await setVentureLogoTool.execute({}, { metadata: { appId: 'app-123' } });

    expect(result).toMatchObject({ error: expect.stringContaining('look up') });
    expect((result as { structuredContent?: unknown }).structuredContent).toBeUndefined();
  });
});
