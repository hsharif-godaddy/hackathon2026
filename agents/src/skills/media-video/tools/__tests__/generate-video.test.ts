import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockGenerateSoraVideo = vi.fn();
vi.mock('@airo/ai-lib', () => ({
  generateSoraVideo: mockGenerateSoraVideo,
}));

const mockUploadGeneratedVideo = vi.fn();
vi.mock('../../../../utils/upload-generated-video.js', () => ({
  uploadGeneratedVideo: mockUploadGeneratedVideo,
}));

const mockFindById = vi.fn();
vi.mock('../../../../database/repositories/index.js', () => ({
  appRepository: {
    findById: mockFindById,
  },
}));

const mockBuildLitellmMetadataFromContext = vi.fn();
const mockLlmMetadataRun = vi.fn();

vi.mock('@airo/ai-common', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    llmMetadataContext: {
      run: mockLlmMetadataRun,
      getStore: vi.fn(),
    },
  };
});

const mockGetCurrentUserId = vi.fn();
vi.mock('@airo/ai-grants', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    buildLitellmMetadataFromContext: mockBuildLitellmMetadataFromContext,
    LlmCallSource: {
      ...(actual.LlmCallSource as Record<string, string>),
      ToolVideoGenerate: 'tool:video-generate',
    },
    grantSessionManager: {
      getCurrentUserId: mockGetCurrentUserId,
      getSubscriptionIdForSession: vi.fn(),
      getSubscriptionState: vi.fn(),
    },
  };
});

const mockGetManifest = vi.fn();
const mockSetSlot = vi.fn();
vi.mock('../../../../services/MediaManifestService.js', () => ({
  mediaManifestService: {
    getManifest: mockGetManifest,
    setSlot: mockSetSlot,
  },
}));

vi.mock('../../../../services/MediaCaptionService.js', () => ({
  captionFromPrompt: vi.fn().mockResolvedValue('test caption'),
}));

interface ToolTestContext {
  socketId: string;
  metadata: Record<string, unknown>;
}

function confirmedContext(metadata: Record<string, unknown> = { appId: 'app-123' }): ToolTestContext {
  return {
    socketId: 'socket-1',
    metadata: {
      _userMessage: 'confirmed',
      ...metadata,
    },
  };
}

describe('generateVideoTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFindById.mockReturnValue({
      id: 'app-123',
      customerId: 'cust-abc',
      subscriptionId: 'sub-xyz',
      path: '/tmp/airo-app-builder/app-123/preview',
    });

    mockGetCurrentUserId.mockReturnValue('budget-user-111');
    mockBuildLitellmMetadataFromContext.mockReturnValue({
      user: 'budget-user-111',
      tags: ['source:tool:video-generate'],
    });
    mockLlmMetadataRun.mockImplementation(async (_metadata: unknown, fn: () => Promise<unknown>) => fn());

    mockGenerateSoraVideo.mockResolvedValue({
      videoId: 'vid-123',
      buffer: Buffer.from('video-bytes'),
    });

    mockUploadGeneratedVideo.mockResolvedValue('/airo-assets/uploads/ai-video-abc123.mp4');

    mockGetManifest.mockResolvedValue({
      success: true,
      manifest: { 'pages/home/hero': { mediaType: 'image', currentUrl: '/old.jpg', alternatives: ['/alt.jpg'] } },
    });
    mockSetSlot.mockResolvedValue({ success: true });
  });

  it('should reject generated video when the current user message is not the confirmation answer', async () => {
    const { generateVideoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: {
        appId: 'app-123',
        _userMessage: 'add 4 cat videos doing hello using stock videos',
      },
    };

    const result = await generateVideoTool.execute(
      {
        prompt: 'Four cats waving hello',
        orientation: 'landscape',
        duration: 4,
        slotName: 'pages/home/cat-gallery-1',
        userConfirmed: true as const,
      },
      context
    );

    expect(result).toEqual({
      error: 'Generated video requires explicit confirmation. Use the media tool with mediaType video for stock clips, or ask the user to confirm generated video first.',
    });
    expect(mockGenerateSoraVideo).not.toHaveBeenCalled();
  });

  it('should call generateSoraVideo with mapped params', async () => {
    const { generateVideoTool } = await import('../index.js');

    const context = confirmedContext();

    await generateVideoTool.execute(
      {
        prompt: 'Sunrise over mountains',
        orientation: 'landscape',
        duration: 8,
        slotName: 'pages/home/hero',
        userConfirmed: true as const,
      },
      context
    );

    expect(mockGenerateSoraVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Sunrise over mountains',
        orientation: 'landscape',
        duration: 8,
      })
    );
    expect(mockBuildLitellmMetadataFromContext).toHaveBeenCalledWith(
      expect.objectContaining({
        socketId: 'socket-1',
        metadata: expect.objectContaining({ appId: 'app-123', customerId: 'cust-abc' }),
      }),
      expect.objectContaining({ source: 'tool:video-generate' })
    );
    expect(mockLlmMetadataRun).toHaveBeenCalled();
    expect(mockUploadGeneratedVideo).toHaveBeenCalledWith('app-123', Buffer.from('video-bytes'));
  });

  it('should return structured content on success', async () => {
    const { generateVideoTool } = await import('../index.js');

    const context = confirmedContext();

    const result = await generateVideoTool.execute(
      {
        prompt: 'A sunset video',
        orientation: 'landscape',
        duration: 4,
        slotName: 'pages/home/hero',
        userConfirmed: true as const,
      },
      context
    );

    expect(result).toEqual({
      structuredContent: {
        sessionId: 'vid-123',
        url: '/airo-assets/uploads/ai-video-abc123.mp4',
        slotUrl: '/airo-assets/videos/pages/home/hero',
      },
    });
  });

  it('should return error when customerId not found', async () => {
    mockFindById.mockReturnValue(null);

    const { generateVideoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'unknown-app' },
    };

    const result = await generateVideoTool.execute(
      {
        prompt: 'Test',
        orientation: 'landscape',
        duration: 4,
        slotName: 'pages/home/hero',
        userConfirmed: true as const,
      },
      context
    );

    expect(result).toEqual({
      error: 'Unable to determine customer identity for video generation',
    });
    expect(mockGenerateSoraVideo).not.toHaveBeenCalled();
  });

  it('should return error when grants exhausted', async () => {
    mockBuildLitellmMetadataFromContext.mockReturnValue(null);

    const { generateVideoTool } = await import('../index.js');

    const context = confirmedContext();

    const result = await generateVideoTool.execute(
      {
        prompt: 'Test',
        orientation: 'landscape',
        duration: 4,
        slotName: 'pages/home/hero',
        userConfirmed: true as const,
      },
      context
    );

    expect(result).toEqual({
      error: 'Video generation is expensive and credit grants are exhausted. Recommend the media tool with mediaType video for free stock clips instead of AI generation.',
    });
    expect(mockGenerateSoraVideo).not.toHaveBeenCalled();
  });

  it('should return error when appId is missing', async () => {
    const { generateVideoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: {},
    };

    const result = await generateVideoTool.execute(
      {
        prompt: 'Test',
        orientation: 'landscape',
        duration: 4,
        slotName: 'pages/home/hero',
        userConfirmed: true as const,
      },
      context
    );

    expect(result).toEqual({
      error: 'Unable to upload generated video without app context',
    });
    expect(mockGenerateSoraVideo).not.toHaveBeenCalled();
  });

  it('should propagate error when generateSoraVideo throws', async () => {
    mockGenerateSoraVideo.mockRejectedValue(new Error('Sora video generation failed'));

    const { generateVideoTool } = await import('../index.js');

    const context = confirmedContext();

    await expect(
      generateVideoTool.execute(
        {
          prompt: 'Test',
          orientation: 'landscape',
          duration: 4,
          slotName: 'pages/home/hero',
          userConfirmed: true as const,
        },
        context
      )
    ).rejects.toThrow('Sora video generation failed');
  });

  it('should pass duration as a number', async () => {
    const { generateVideoTool } = await import('../index.js');

    const context = confirmedContext();

    await generateVideoTool.execute(
      {
        prompt: 'Test video',
        orientation: 'portrait',
        duration: 12,
        slotName: 'pages/home/hero',
        userConfirmed: true as const,
      },
      context
    );

    const callArgs = mockGenerateSoraVideo.mock.calls[0][0];
    expect(typeof callArgs.duration).toBe('number');
    expect(callArgs.duration).toBe(12);
  });

  it('passes BMS budget metadata through llmMetadataContext in BMS mode', async () => {
    mockBuildLitellmMetadataFromContext.mockReturnValue({
      user: 'airo-builder:sid:sub-xyz',
      tags: ['mode:bms'],
      budgetServiceEnabled: true,
      budgetId: 'budget-123',
      budgetSessionId: 'session-456',
    });

    const { generateVideoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: {
        appId: 'app-123',
        _userMessage: 'confirmed',
        budgetServiceEnabled: true,
        bmsBudgetId: 'budget-123',
        budgetSessionId: 'session-456',
      },
    };

    await generateVideoTool.execute(
      {
        prompt: 'Test',
        orientation: 'landscape',
        duration: 4,
        slotName: 'pages/home/hero',
        userConfirmed: true as const,
      },
      context
    );

    expect(mockBuildLitellmMetadataFromContext).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          budgetServiceEnabled: true,
          bmsBudgetId: 'budget-123',
          budgetSessionId: 'session-456',
        }),
      }),
      expect.objectContaining({ source: 'tool:video-generate' })
    );
    expect(mockLlmMetadataRun).toHaveBeenCalledWith(
      expect.objectContaining({
        budgetSessionId: 'session-456',
        user: 'airo-builder:sid:sub-xyz',
      }),
      expect.any(Function)
    );
    expect(mockGenerateSoraVideo).toHaveBeenCalled();
  });

  it('returns stock recommendation when Sora budget is exceeded', async () => {
    const { BudgetExceededError } = await import('@airo/ai-common');
    mockGenerateSoraVideo.mockRejectedValueOnce(
      new BudgetExceededError('Sora submit budget exceeded', 400, 'budget_exceeded'),
    );

    const { generateVideoTool } = await import('../index.js');
    const context = confirmedContext();

    const result = await generateVideoTool.execute(
      {
        prompt: 'Sunrise over mountains',
        orientation: 'landscape',
        duration: 8,
        slotName: 'pages/home/hero',
        userConfirmed: true as const,
      },
      context,
    );

    expect(result).toEqual({
      error:
        'Generated video budget exceeded. Use the media tool with mediaType video for stock clips instead of generated video.',
    });
    expect(mockUploadGeneratedVideo).not.toHaveBeenCalled();
  });

  describe('slot resolution', () => {
    it('should resolve slot via exact full-segment suffix match', async () => {
      mockGetManifest.mockResolvedValue({
        success: true,
        manifest: {
          'pages/home/hero': { mediaType: 'image', currentUrl: '/old.jpg', alternatives: [] },
          'pages/about/banner': { mediaType: 'image', currentUrl: '/b.jpg', alternatives: [] },
        },
      });

      const { generateVideoTool } = await import('../index.js');
      const context = confirmedContext();

      await generateVideoTool.execute(
        { prompt: 'Test', orientation: 'landscape', duration: 8, slotName: 'home/hero', userConfirmed: true as const },
        context
      );

      expect(mockSetSlot).toHaveBeenCalledWith('app-123', 'pages/home/hero', expect.any(Object), true);
    });

    it('should NOT match partial segment collisions (prevents clobbering)', async () => {
      mockGetManifest.mockResolvedValue({
        success: true,
        manifest: {
          'pages/home/hero': { mediaType: 'image', currentUrl: '/old.jpg', alternatives: [] },
          'pages/about/hero': { mediaType: 'image', currentUrl: '/about.jpg', alternatives: [] },
        },
      });

      const { generateVideoTool } = await import('../index.js');
      const context = confirmedContext();

      await generateVideoTool.execute(
        { prompt: 'Test', orientation: 'landscape', duration: 8, slotName: 'about/hero', userConfirmed: true as const },
        context
      );

      expect(mockSetSlot).toHaveBeenCalledWith('app-123', 'pages/about/hero', expect.any(Object), true);
    });

    it('should use original slot name when no match found', async () => {
      mockGetManifest.mockResolvedValue({
        success: true,
        manifest: {
          'pages/home/hero': { mediaType: 'image', currentUrl: '/old.jpg', alternatives: [] },
        },
      });

      const { generateVideoTool } = await import('../index.js');
      const context = confirmedContext();

      await generateVideoTool.execute(
        { prompt: 'Test', orientation: 'landscape', duration: 8, slotName: 'pages/contact/header', userConfirmed: true as const },
        context
      );

      expect(mockSetSlot).toHaveBeenCalledWith('app-123', 'pages/contact/header', expect.any(Object), true);
    });

    it('should handle manifest fetch failure gracefully', async () => {
      mockGetManifest.mockResolvedValue({ success: false, error: 'file not found' });

      const { generateVideoTool } = await import('../index.js');
      const context = confirmedContext();

      const result = await generateVideoTool.execute(
        { prompt: 'Test', orientation: 'landscape', duration: 8, slotName: 'pages/new/slot', userConfirmed: true as const },
        context
      );

      expect(result).toHaveProperty('structuredContent.url', '/airo-assets/uploads/ai-video-abc123.mp4');
    });
  });

  describe('manifest write failure', () => {
    it('should omit slotUrl when manifest write fails', async () => {
      mockSetSlot.mockResolvedValue({ success: false, error: 'disk full' });

      const { generateVideoTool } = await import('../index.js');
      const context = confirmedContext();

      const result = await generateVideoTool.execute(
        { prompt: 'Test', orientation: 'landscape', duration: 8, slotName: 'pages/home/hero', userConfirmed: true as const },
        context
      );

      expect(result).toEqual({
        structuredContent: {
          sessionId: 'vid-123',
          url: '/airo-assets/uploads/ai-video-abc123.mp4',
          slotUrl: undefined,
        },
      });
    });

    it('should omit slotUrl when manifest write throws', async () => {
      mockSetSlot.mockRejectedValue(new Error('unexpected error'));

      const { generateVideoTool } = await import('../index.js');
      const context = confirmedContext();

      const result = await generateVideoTool.execute(
        { prompt: 'Test', orientation: 'landscape', duration: 8, slotName: 'pages/home/hero', userConfirmed: true as const },
        context
      );

      expect(result).toEqual({
        structuredContent: {
          sessionId: 'vid-123',
          url: '/airo-assets/uploads/ai-video-abc123.mp4',
          slotUrl: undefined,
        },
      });
    });
  });

  describe('aiGeneratedUrls cap', () => {
    it('should cap aiGeneratedUrls at 20 entries', async () => {
      const existingUrls = Array.from({ length: 25 }, (_, i) => `https://cdn/old-${i}.mp4`);
      mockGetManifest.mockResolvedValue({
        success: true,
        manifest: {
          'pages/home/hero': { mediaType: 'video', currentUrl: existingUrls[0], alternatives: [], aiGeneratedUrls: existingUrls },
        },
      });

      const { generateVideoTool } = await import('../index.js');
      const context = confirmedContext();

      await generateVideoTool.execute(
        { prompt: 'New video', orientation: 'landscape', duration: 8, slotName: 'pages/home/hero', userConfirmed: true as const },
        context
      );

      const slotArg = mockSetSlot.mock.calls[0][2];
      expect(slotArg.aiGeneratedUrls).toHaveLength(20);
      expect(slotArg.aiGeneratedUrls[0]).toBe('/airo-assets/uploads/ai-video-abc123.mp4');
    });
  });
});
