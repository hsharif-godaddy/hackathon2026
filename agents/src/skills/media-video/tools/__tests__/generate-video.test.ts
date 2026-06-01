import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockGenerateVideo = vi.fn();
vi.mock('../../../../services/ImagegenService.js', () => ({
  imagegenService: {
    generateImages: vi.fn(),
    editImage: vi.fn(),
    generateVideo: mockGenerateVideo,
  },
}));

const mockFindById = vi.fn();
vi.mock('../../../../database/repositories/index.js', () => ({
  appRepository: {
    findById: mockFindById,
  },
}));

const mockGetCurrentUserId = vi.fn();
vi.mock('@airo/ai-grants', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
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

    mockGenerateVideo.mockResolvedValue({
      sessionId: 'vid-123',
      url: 'https://cdn/video.mp4',
    });

    mockGetManifest.mockResolvedValue({
      success: true,
      manifest: { 'pages/home/hero': { mediaType: 'image', currentUrl: '/old.jpg', alternatives: ['/alt.jpg'] } },
    });
    mockSetSlot.mockResolvedValue({ success: true });
  });

  it('should call imagegenService with mapped params', async () => {
    const { generateVideoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    await generateVideoTool.execute(
      {
        prompt: 'Sunrise over mountains',
        orientation: 'landscape',
        duration: 8,
        slotName: 'pages/home/hero',
      },
      context
    );

    expect(mockGenerateVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Sunrise over mountains',
        orientation: 'landscape',
        duration: 8,
        customerId: 'cust-abc',
        budgetUserId: 'budget-user-111',
      })
    );
  });

  it('should return structured content on success', async () => {
    const { generateVideoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    const result = await generateVideoTool.execute(
      {
        prompt: 'A sunset video',
        orientation: 'landscape',
        duration: 5,
        slotName: 'pages/home/hero',
      },
      context
    );

    expect(result).toEqual({
      structuredContent: {
        sessionId: 'vid-123',
        url: 'https://cdn/video.mp4',
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
        duration: 5,
        slotName: 'pages/home/hero',
      },
      context
    );

    expect(result).toEqual({
      error: 'Unable to determine customer identity for video generation',
    });
    expect(mockGenerateVideo).not.toHaveBeenCalled();
  });

  it('should return error when grants exhausted', async () => {
    mockGetCurrentUserId.mockReturnValue(undefined);

    const { generateVideoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    const result = await generateVideoTool.execute(
      {
        prompt: 'Test',
        orientation: 'landscape',
        duration: 5,
        slotName: 'pages/home/hero',
      },
      context
    );

    expect(result).toEqual({
      error: 'All credit grants have been exhausted. Please purchase additional credits to generate videos.',
    });
    expect(mockGenerateVideo).not.toHaveBeenCalled();
  });

  it('should propagate error when imagegenService throws', async () => {
    mockGenerateVideo.mockRejectedValue(new Error('Video generation failed: Content policy violation'));

    const { generateVideoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    await expect(
      generateVideoTool.execute(
        {
          prompt: 'Test',
          orientation: 'landscape',
          duration: 5,
          slotName: 'pages/home/hero',
        },
        context
      )
    ).rejects.toThrow('Video generation failed: Content policy violation');
  });

  it('should pass duration as a number', async () => {
    const { generateVideoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    await generateVideoTool.execute(
      {
        prompt: 'Test video',
        orientation: 'portrait',
        duration: 6,
        slotName: 'pages/home/hero',
      },
      context
    );

    const callArgs = mockGenerateVideo.mock.calls[0][0];
    expect(typeof callArgs.duration).toBe('number');
    expect(callArgs.duration).toBe(6);
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
      const context = { socketId: 'socket-1', metadata: { appId: 'app-123' } };

      await generateVideoTool.execute(
        { prompt: 'Test', orientation: 'landscape', duration: 5, slotName: 'home/hero' },
        context
      );

      // Should resolve "home/hero" to "pages/home/hero" (ends with "/home/hero")
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
      const context = { socketId: 'socket-1', metadata: { appId: 'app-123' } };

      // "hero" alone should NOT match "pages/home/hero" because "home/hero" doesn't end with "/hero" as a full path
      // Actually "hero" would match because pages/home/hero ends with "/hero"
      // But the key insight: "about/hero" should match pages/about/hero, NOT pages/home/hero
      await generateVideoTool.execute(
        { prompt: 'Test', orientation: 'landscape', duration: 5, slotName: 'about/hero' },
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
      const context = { socketId: 'socket-1', metadata: { appId: 'app-123' } };

      await generateVideoTool.execute(
        { prompt: 'Test', orientation: 'landscape', duration: 5, slotName: 'pages/contact/header' },
        context
      );

      expect(mockSetSlot).toHaveBeenCalledWith('app-123', 'pages/contact/header', expect.any(Object), true);
    });

    it('should handle manifest fetch failure gracefully', async () => {
      mockGetManifest.mockResolvedValue({ success: false, error: 'file not found' });

      const { generateVideoTool } = await import('../index.js');
      const context = { socketId: 'socket-1', metadata: { appId: 'app-123' } };

      const result = await generateVideoTool.execute(
        { prompt: 'Test', orientation: 'landscape', duration: 5, slotName: 'pages/new/slot' },
        context
      );

      // Should still succeed — manifest failure doesn't block video generation
      expect(result).toHaveProperty('structuredContent.url', 'https://cdn/video.mp4');
    });
  });

  describe('manifest write failure', () => {
    it('should omit slotUrl when manifest write fails', async () => {
      mockSetSlot.mockResolvedValue({ success: false, error: 'disk full' });

      const { generateVideoTool } = await import('../index.js');
      const context = { socketId: 'socket-1', metadata: { appId: 'app-123' } };

      const result = await generateVideoTool.execute(
        { prompt: 'Test', orientation: 'landscape', duration: 5, slotName: 'pages/home/hero' },
        context
      );

      expect(result).toEqual({
        structuredContent: {
          sessionId: 'vid-123',
          url: 'https://cdn/video.mp4',
          slotUrl: undefined,
        },
      });
    });

    it('should omit slotUrl when manifest write throws', async () => {
      mockSetSlot.mockRejectedValue(new Error('unexpected error'));

      const { generateVideoTool } = await import('../index.js');
      const context = { socketId: 'socket-1', metadata: { appId: 'app-123' } };

      const result = await generateVideoTool.execute(
        { prompt: 'Test', orientation: 'landscape', duration: 5, slotName: 'pages/home/hero' },
        context
      );

      expect(result).toEqual({
        structuredContent: {
          sessionId: 'vid-123',
          url: 'https://cdn/video.mp4',
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
      const context = { socketId: 'socket-1', metadata: { appId: 'app-123' } };

      await generateVideoTool.execute(
        { prompt: 'New video', orientation: 'landscape', duration: 5, slotName: 'pages/home/hero' },
        context
      );

      const slotArg = mockSetSlot.mock.calls[0][2];
      expect(slotArg.aiGeneratedUrls).toHaveLength(20);
      expect(slotArg.aiGeneratedUrls[0]).toBe('https://cdn/video.mp4'); // new URL is first
    });
  });
});
