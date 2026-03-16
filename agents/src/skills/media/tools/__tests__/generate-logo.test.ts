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

// Mock LogoService
const mockGenerateLogos = vi.fn();
vi.mock('../../../../services/LogoService.js', () => ({
  logoService: {
    generateLogos: mockGenerateLogos,
  },
}));

// Mock AppRepository
const mockFindById = vi.fn();
vi.mock('../../../../database/repositories/index.js', () => ({
  appRepository: {
    findById: mockFindById,
  },
}));

// Mock grantSessionManager
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

// Mock AppPlanTool
const mockAppPlanExecute = vi.fn();
vi.mock('../../../../tools/app-plan-tool.js', () => ({
  appPlanTool: {
    execute: mockAppPlanExecute,
  },
}));

// Mock ClientActionService (still needed for image/video tools in same file)
vi.mock('../../../../server/ai-lib-websocket-server.js', () => ({
  getClientActionService: vi.fn(),
}));

describe('generateLogoTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock returns
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
          transparentUrl: 'https://cdn/t.png',
          solidUrl: 'https://cdn/s.png',
          mockupUrl: 'https://cdn/m.png',
        },
      ],
    });

    // Default: no app plan enrichment
    mockAppPlanExecute.mockResolvedValue({ success: false });
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

  it('should return structured content on success', async () => {
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
      structuredContent: {
        sessionId: 'sess-123',
        logos: [
          {
            id: 'logo-1',
            transparentUrl: 'https://cdn/t.png',
            solidUrl: 'https://cdn/s.png',
            mockupUrl: 'https://cdn/m.png',
          },
        ],
      },
    });
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
