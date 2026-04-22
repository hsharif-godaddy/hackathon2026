import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockGenerateLogos = vi.fn();
vi.mock('../../../../services/LogoService.js', () => ({
  logoService: {
    generateLogos: mockGenerateLogos,
  },
}));

const mockFindById = vi.fn();
vi.mock('../../../../database/repositories/index.js', () => ({
  appRepository: {
    findById: mockFindById,
  },
}));

const mockGetCurrentUserId = vi.fn();
const mockGetSubscriptionIdForSession = vi.fn();
const mockGetSubscriptionState = vi.fn();
vi.mock('@airo/ai-grants', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    grantSessionManager: {
      getCurrentUserId: mockGetCurrentUserId,
      getSubscriptionIdForSession: mockGetSubscriptionIdForSession,
      getSubscriptionState: mockGetSubscriptionState,
    },
  };
});

const mockAppPlanExecute = vi.fn();
vi.mock('../../../../tools/app-plan-tool.js', () => ({
  appPlanTool: {
    execute: mockAppPlanExecute,
  },
}));

const mockSetSlot = vi.fn();
const mockGetSlot = vi.fn();
vi.mock('../../../../services/MediaManifestService.js', () => ({
  mediaManifestService: {
    importSlot: vi.fn(),
    setSlot: mockSetSlot,
    getSlot: mockGetSlot,
  },
}));

describe('generateLogoTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFindById.mockReturnValue({
      id: 'app-123',
      customerId: 'cust-abc',
      subscriptionId: 'sub-xyz',
      path: '/tmp/airo-app-builder/app-123/preview',
    });

    mockGetCurrentUserId.mockReturnValue('budget-user-111');
    mockGetSubscriptionIdForSession.mockReturnValue('sub-xyz');
    mockGetSubscriptionState.mockReturnValue({
      grants: [{ llmBudgetUserId: 'budget-user-111' }],
      currentIndex: 0,
    });

    mockGenerateLogos.mockResolvedValue({
      sessionId: 'sess-123',
      logos: [
        {
          id: 'logo-1',
          transparentUrl: 'https://cdn/t1.png',
          solidUrl: 'https://cdn/s1.png',
          mockupUrl: 'https://cdn/m1.png',
        },
        {
          id: 'logo-2',
          transparentUrl: 'https://cdn/t2.png',
          solidUrl: 'https://cdn/s2.png',
          mockupUrl: 'https://cdn/m2.png',
        },
      ],
    });

    mockAppPlanExecute.mockResolvedValue({ success: false });
    mockSetSlot.mockResolvedValue({ success: true });
    mockGetSlot.mockResolvedValue({ success: false });
  });

  it('should call logoService with brand inputs and context headers', async () => {
    const { generateLogoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    await generateLogoTool.execute(
      {
        brandName: 'My Brand',
        brandDescription: 'A cool brand',
        style: 'flat',
      },
      context
    );

    expect(mockGenerateLogos).toHaveBeenCalledWith(
      expect.objectContaining({
        brandName: 'My Brand',
        brandDescription: 'A cool brand',
        style: 'flat',
        customerId: 'cust-abc',
        budgetUserId: 'budget-user-111',
      })
    );
  });

  it('should return structured content with slotUrl on success', async () => {
    const { generateLogoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    const result = await generateLogoTool.execute(
      {
        brandName: 'My Brand',
        brandDescription: 'A cool brand',
        style: 'flat',
      },
      context
    );

    expect(result).toEqual({
      text: expect.stringContaining('Generated 2 logos and saved to slot'),
      structuredContent: {
        sessionId: 'sess-123',
        logos: expect.arrayContaining([
          expect.objectContaining({ id: 'logo-1' }),
          expect.objectContaining({ id: 'logo-2' }),
        ]),
        slotUrl: '/airo-assets/images/logo/primary',
        slotPath: 'logo/primary',
      },
    });
  });

  it('should auto-save logos into the media slot system', async () => {
    const { generateLogoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    await generateLogoTool.execute(
      {
        brandName: 'My Brand',
        brandDescription: 'A cool brand',
        style: 'flat',
      },
      context
    );

    expect(mockSetSlot).toHaveBeenCalledWith('app-123', 'logo/primary', expect.objectContaining({
      mediaType: 'logo',
      currentUrl: 'https://cdn/t1.png',
      searchQuery: 'My Brand',
      alternatives: ['https://cdn/t2.png'],
      solidUrlMap: {
        'https://cdn/t1.png': 'https://cdn/s1.png',
        'https://cdn/t2.png': 'https://cdn/s2.png',
      },
      userModified: false,
    }));
  });

  it('should still return result when slot save fails', async () => {
    mockSetSlot.mockRejectedValue(new Error('Manifest write failed'));

    const { generateLogoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    const result = await generateLogoTool.execute(
      {
        brandName: 'My Brand',
        brandDescription: 'A cool brand',
        style: 'flat',
      },
      context
    );

    expect(result).toHaveProperty('structuredContent.logos');
    expect(result).toHaveProperty('structuredContent.slotUrl');
  });

  it('should return error when customerId not found', async () => {
    mockFindById.mockReturnValue(null);

    const { generateLogoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'unknown-app' },
    };

    const result = await generateLogoTool.execute(
      {
        brandName: 'Test',
        brandDescription: 'Test',
        style: 'flat',
      },
      context
    );

    expect(result).toEqual({
      error: 'Unable to determine customer identity for logo generation',
    });
    expect(mockGenerateLogos).not.toHaveBeenCalled();
    expect(mockSetSlot).not.toHaveBeenCalled();
  });

  it('should propagate error when logoService throws', async () => {
    mockGenerateLogos.mockRejectedValue(new Error('Logo API error: 500 Internal Server Error'));

    const { generateLogoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    await expect(
      generateLogoTool.execute(
        {
          brandName: 'Test',
          brandDescription: 'Test',
          style: 'flat',
        },
        context
      )
    ).rejects.toThrow('Logo API error: 500 Internal Server Error');
  });

  it('should return error when grant state missing', async () => {
    mockGetSubscriptionIdForSession.mockReturnValue(undefined);
    mockGetSubscriptionState.mockReturnValue(undefined);
    mockGetCurrentUserId.mockReturnValue(undefined);

    const { generateLogoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    const result = await generateLogoTool.execute(
      {
        brandName: 'Test',
        brandDescription: 'Test',
        style: 'flat',
      },
      context
    );

    expect(result).toEqual({
      error: 'All credit grants have been exhausted. Please purchase additional credits to generate logos.',
    });
    expect(mockGenerateLogos).not.toHaveBeenCalled();
  });

  it('should merge with existing logos when slot already exists', async () => {
    mockGetSlot.mockResolvedValue({
      success: true,
      slot: {
        mediaType: 'logo',
        currentUrl: 'https://cdn/old-t1.png',
        alternatives: ['https://cdn/old-t2.png'],
        solidUrlMap: {
          'https://cdn/old-t1.png': 'https://cdn/old-s1.png',
          'https://cdn/old-t2.png': 'https://cdn/old-s2.png',
        },
      },
    });

    const { generateLogoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    await generateLogoTool.execute(
      {
        brandName: 'My Brand',
        brandDescription: 'A cool brand',
        style: 'flat',
      },
      context
    );

    expect(mockSetSlot).toHaveBeenCalledWith('app-123', 'logo/primary', expect.objectContaining({
      currentUrl: 'https://cdn/t1.png',
      alternatives: ['https://cdn/t2.png', 'https://cdn/old-t1.png', 'https://cdn/old-t2.png'],
      solidUrlMap: {
        'https://cdn/old-t1.png': 'https://cdn/old-s1.png',
        'https://cdn/old-t2.png': 'https://cdn/old-s2.png',
        'https://cdn/t1.png': 'https://cdn/s1.png',
        'https://cdn/t2.png': 'https://cdn/s2.png',
      },
    }));
  });

  describe('brand data enrichment', () => {
    it('should enrich brandColors from app plan when not provided', async () => {
      mockAppPlanExecute.mockResolvedValue({
        success: true,
        data: {
          colorPalette: {
            primary: '#ff6600',
            secondary: '#333333',
            accent: '#00aaff',
          },
        },
      });

      const { generateLogoTool } = await import('../index.js');

      const context = { socketId: 'socket-1', metadata: { appId: 'app-123' } };

      await generateLogoTool.execute(
        { brandName: 'Test', brandDescription: 'Test', style: 'flat' },
        context
      );

      expect(mockGenerateLogos).toHaveBeenCalledWith(
        expect.objectContaining({
          brandColors: 'primary: #ff6600, secondary: #333333, accent: #00aaff',
        })
      );
    });
  });
});
