import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../logging/index.js', () => ({
  Logger: {
    create: vi.fn(function () { return {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }; }),
  },
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
        variations: [{ style: 'glyph' }],
      },
      context
    );

    expect(mockGenerateLogos).toHaveBeenCalledWith(
      expect.objectContaining({
        brandName: 'My Brand',
        brandDescription: 'A cool brand',
        style: 'glyph',
        appId: 'app-123',
        customerId: 'cust-abc',
        budgetUserId: 'budget-user-111',
        count: 1,
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
        variations: [{ style: 'glyph' }],
      },
      context
    );

    expect(result).toEqual({
      text: expect.stringContaining('Generated 1 of 1 logos'),
      structuredContent: {
        sessionId: 'sess-123',
        logos: expect.arrayContaining([
          expect.objectContaining({ id: 'logo-1' }),
        ]),
        slotUrl: '/airo-assets/images/logo/primary',
        slotPath: 'logo/primary',
        savedSlots: { square: '/airo-assets/images/logo/primary' },
        slotSaveFailed: false,
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
        variations: [{ style: 'glyph' }],
      },
      context
    );

    expect(mockSetSlot).toHaveBeenCalledWith('app-123', 'logo/primary', expect.objectContaining({
      mediaType: 'logo',
      currentUrl: 'https://cdn/t1.png',
      searchQuery: 'My Brand',
      alternatives: [],
      solidUrlMap: {
        'https://cdn/t1.png': 'https://cdn/s1.png',
      },
      logoSourceMap: {
        'https://cdn/t1.png': { sessionId: 'sess-123', logoId: 'logo-1' },
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
        variations: [{ style: 'glyph' }],
      },
      context
    );

    expect(result).toHaveProperty('structuredContent.logos');
    expect(result).toHaveProperty('structuredContent.slotUrl');
  });

  it('should handle logos with no transparent URLs (empty savedSlots)', async () => {
    mockGenerateLogos.mockResolvedValue({
      sessionId: 'sess-no-urls',
      logos: [
        { id: 'logo-1', mockupUrl: 'https://cdn/m1.png' },
      ],
    });

    const { generateLogoTool } = await import('../index.js');
    const { logger } = await import('../../../../logging/index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    const result = await generateLogoTool.execute(
      {
        brandName: 'My Brand',
        brandDescription: 'A cool brand',
        variations: [{ style: 'glyph' }],
      },
      context
    );

    expect(mockSetSlot).not.toHaveBeenCalled();
    expect(result).toHaveProperty('text');
    expect((result as { text: string }).text).toContain('No slot URLs saved');
    expect(logger.warn).toHaveBeenCalledWith('skills.media-logo.tools.generate_logo.no_slots_saved', expect.objectContaining({
      appId: 'app-123',
      logoCount: 1,
      sessionId: 'sess-no-urls',
    }));
  });

  it('should return error when appId is missing from context metadata', async () => {
    const { generateLogoTool } = await import('../index.js');

    const result = await generateLogoTool.execute(
      {
        brandName: 'Test',
        brandDescription: 'Test',
        variations: [{ style: 'glyph' }],
      },
      { socketId: 'socket-1' }
    );

    expect(result).toEqual({
      error: 'Unable to determine app id for logo generation',
    });
    expect(mockFindById).not.toHaveBeenCalled();
    expect(mockGenerateLogos).not.toHaveBeenCalled();
    expect(mockSetSlot).not.toHaveBeenCalled();
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
        variations: [{ style: 'glyph' }],
      },
      context
    );

    expect(result).toEqual({
      error: 'Unable to determine customer identity for logo generation',
    });
    expect(mockGenerateLogos).not.toHaveBeenCalled();
    expect(mockSetSlot).not.toHaveBeenCalled();
  });

  it('should return error text when all variations fail', async () => {
    mockGenerateLogos.mockRejectedValue(new Error('Logo API error: 500 Internal Server Error'));

    const { generateLogoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    const result = await generateLogoTool.execute(
      {
        brandName: 'Test',
        brandDescription: 'Test',
        variations: [{ style: 'glyph' }],
      },
      context
    );

    expect(result).toEqual({
      text: 'All logo variations failed to generate. Please try again.',
    });
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
        variations: [{ style: 'glyph' }],
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
        variations: [{ style: 'glyph' }],
      },
      context
    );

    expect(mockSetSlot).toHaveBeenCalledWith('app-123', 'logo/primary', expect.objectContaining({
      currentUrl: 'https://cdn/t1.png',
      alternatives: ['https://cdn/old-t1.png', 'https://cdn/old-t2.png'],
      solidUrlMap: {
        'https://cdn/old-t1.png': 'https://cdn/old-s1.png',
        'https://cdn/old-t2.png': 'https://cdn/old-s2.png',
        'https://cdn/t1.png': 'https://cdn/s1.png',
      },
    }));
  });

  it('should merge reversedSolidUrlMap and mockupUrlMap with existing slot', async () => {
    mockGenerateLogos.mockResolvedValue({
      sessionId: 'sess-123',
      logos: [
        {
          id: 'logo-1',
          transparentUrl: 'https://cdn/t1.png',
          solidUrl: 'https://cdn/s1.png',
          reversedUrl: 'https://cdn/r1.png',
          reversedSolidUrl: 'https://cdn/rs1.png',
          mockupUrl: 'https://cdn/m1.png',
        },
      ],
    });

    mockGetSlot.mockResolvedValue({
      success: true,
      slot: {
        mediaType: 'logo',
        currentUrl: 'https://cdn/old-t1.png',
        alternatives: [],
        reversedSolidUrlMap: { 'https://cdn/old-t1.png': 'https://cdn/old-rs1.png' },
        mockupUrlMap: { 'https://cdn/old-t1.png': 'https://cdn/old-m1.png' },
      },
    });

    const { generateLogoTool } = await import('../index.js');

    await generateLogoTool.execute(
      {
        brandName: 'My Brand',
        brandDescription: 'A cool brand',
        variations: [{ style: 'glyph' }],
      },
      { socketId: 'socket-1', metadata: { appId: 'app-123' } }
    );

    expect(mockSetSlot).toHaveBeenCalledWith('app-123', 'logo/primary', expect.objectContaining({
      reversedSolidUrlMap: {
        'https://cdn/old-t1.png': 'https://cdn/old-rs1.png',
        'https://cdn/t1.png': 'https://cdn/rs1.png',
      },
      mockupUrlMap: {
        'https://cdn/old-t1.png': 'https://cdn/old-m1.png',
        'https://cdn/t1.png': 'https://cdn/m1.png',
      },
    }));
  });

  it('should persist landscapeMockupUrlMap when logo includes landscapeMockupUrl', async () => {
    mockGenerateLogos.mockResolvedValue({
      sessionId: 'sess-123',
      logos: [
        {
          id: 'logo-1',
          transparentUrl: 'https://cdn/t1.png',
          solidUrl: 'https://cdn/s1.png',
          mockupUrl: 'https://cdn/m1.png',
          landscapeMockupUrl: 'https://cdn/lm1.png',
        },
      ],
    });

    mockGetSlot.mockResolvedValue({ success: false });

    const { generateLogoTool } = await import('../index.js');

    await generateLogoTool.execute(
      {
        brandName: 'My Brand',
        brandDescription: 'A cool brand',
        variations: [{ style: 'glyph' }],
      },
      { socketId: 'socket-1', metadata: { appId: 'app-123' } }
    );

    expect(mockSetSlot).toHaveBeenCalledWith('app-123', 'logo/primary', expect.objectContaining({
      mockupUrlMap: { 'https://cdn/t1.png': 'https://cdn/m1.png' },
      landscapeMockupUrlMap: { 'https://cdn/t1.png': 'https://cdn/lm1.png' },
    }));
  });

  it('should merge landscapeMockupUrlMap with existing slot that only has mockupUrlMap', async () => {
    mockGenerateLogos.mockResolvedValue({
      sessionId: 'sess-123',
      logos: [
        {
          id: 'logo-1',
          transparentUrl: 'https://cdn/t1.png',
          solidUrl: 'https://cdn/s1.png',
          mockupUrl: 'https://cdn/m1.png',
          landscapeMockupUrl: 'https://cdn/lm1.png',
        },
      ],
    });

    mockGetSlot.mockResolvedValue({
      success: true,
      slot: {
        mediaType: 'logo',
        currentUrl: 'https://cdn/old-t1.png',
        alternatives: [],
        mockupUrlMap: { 'https://cdn/old-t1.png': 'https://cdn/old-m1.png' },
      },
    });

    const { generateLogoTool } = await import('../index.js');

    await generateLogoTool.execute(
      {
        brandName: 'My Brand',
        brandDescription: 'A cool brand',
        variations: [{ style: 'glyph' }],
      },
      { socketId: 'socket-1', metadata: { appId: 'app-123' } }
    );

    expect(mockSetSlot).toHaveBeenCalledWith('app-123', 'logo/primary', expect.objectContaining({
      mockupUrlMap: {
        'https://cdn/old-t1.png': 'https://cdn/old-m1.png',
        'https://cdn/t1.png': 'https://cdn/m1.png',
      },
      landscapeMockupUrlMap: { 'https://cdn/t1.png': 'https://cdn/lm1.png' },
    }));
  });

  it('should pass layout parameter to logoService', async () => {
    const { generateLogoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    await generateLogoTool.execute(
      {
        brandName: 'My Brand',
        brandDescription: 'A cool brand',
        layout: 'all',
        variations: [{ style: 'glyph' }],
      },
      context
    );

    expect(mockGenerateLogos).toHaveBeenCalledWith(
      expect.objectContaining({
        layout: 'all',
      })
    );
  });

  it('should handle horizontal-only logos in slot saving', async () => {
    mockGenerateLogos.mockResolvedValue({
      sessionId: 'sess-horiz',
      logos: [
        {
          id: 'logo-h1',
          horizontalTransparentUrl: 'https://cdn/ht1.png',
          horizontalSolidUrl: 'https://cdn/hs1.png',
          horizontalMockupUrl: 'https://cdn/hm1.png',
        },
      ],
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
        layout: 'horizontal',
        variations: [{ style: 'glyph' }],
      },
      context
    );

    expect(mockSetSlot).toHaveBeenCalledWith('app-123', 'logo/horizontal', expect.objectContaining({
      currentUrl: 'https://cdn/ht1.png',
      solidUrlMap: {
        'https://cdn/ht1.png': 'https://cdn/hs1.png',
      },
    }));
  });

  describe('brand data enrichment', () => {
    it('should enrich brandColors from app plan when not provided in variation', async () => {
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
        { brandName: 'Test', brandDescription: 'Test', variations: [{ style: 'glyph' }] },
        context
      );

      expect(mockGenerateLogos).toHaveBeenCalledWith(
        expect.objectContaining({
          brandColors: 'primary: #ff6600, secondary: #333333, accent: #00aaff',
        })
      );
    });
  });

  describe('parallel variations', () => {
    it('should call logoService once per variation and combine results', async () => {
      mockGenerateLogos
        .mockResolvedValueOnce({ sessionId: 'sess-1', logos: [{ id: 'logo-1', horizontalTransparentUrl: 'https://cdn/h1.png' }] })
        .mockResolvedValueOnce({ sessionId: 'sess-2', logos: [{ id: 'logo-2', horizontalTransparentUrl: 'https://cdn/h2.png' }] })
        .mockResolvedValueOnce({ sessionId: 'sess-3', logos: [{ id: 'logo-3', horizontalTransparentUrl: 'https://cdn/h3.png' }] });

      const { generateLogoTool } = await import('../index.js');

      const context = { socketId: 'socket-1', metadata: { appId: 'app-123' } };

      const result = await generateLogoTool.execute(
        {
          brandName: 'Test Brand',
          brandDescription: 'A test business',
          layout: 'horizontal',
          variations: [
            { style: 'glyph', symbol: 'star' },
            { style: 'line', styleDescription: 'minimal' },
            { style: 'full-color' },
          ],
        },
        context
      );

      expect(mockGenerateLogos).toHaveBeenCalledTimes(3);
      expect(mockGenerateLogos).toHaveBeenCalledWith(expect.objectContaining({ style: 'glyph', symbol: 'star', count: 1 }));
      expect(mockGenerateLogos).toHaveBeenCalledWith(expect.objectContaining({ style: 'line', styleDescription: 'minimal', count: 1 }));
      expect(mockGenerateLogos).toHaveBeenCalledWith(expect.objectContaining({ style: 'full-color', count: 1 }));
      expect((result as any).structuredContent.logos).toHaveLength(3);
    });

    it('should return partial results when some variations fail', async () => {
      mockGenerateLogos
        .mockResolvedValueOnce({ sessionId: 'sess-1', logos: [{ id: 'logo-1', horizontalTransparentUrl: 'https://cdn/h1.png' }] })
        .mockRejectedValueOnce(new Error('API timeout'))
        .mockResolvedValueOnce({ sessionId: 'sess-3', logos: [{ id: 'logo-3', horizontalTransparentUrl: 'https://cdn/h3.png' }] });

      const { generateLogoTool } = await import('../index.js');

      const context = { socketId: 'socket-1', metadata: { appId: 'app-123' } };

      const result = await generateLogoTool.execute(
        {
          brandName: 'Test Brand',
          brandDescription: 'A test business',
          layout: 'horizontal',
          variations: [
            { style: 'glyph' },
            { style: 'line' },
            { style: 'full-color' },
          ],
        },
        context
      );

      expect((result as any).structuredContent.logos).toHaveLength(2);
    });
  });
});
