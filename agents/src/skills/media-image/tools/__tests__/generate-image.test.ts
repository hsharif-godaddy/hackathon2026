import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockGenerateImages = vi.fn();
vi.mock('../../../../services/ImagegenService.js', () => ({
  imagegenService: {
    generateImages: mockGenerateImages,
    editImage: vi.fn(),
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

vi.mock('../../../../services/MediaCaptionService.js', () => ({
  captionFromPrompt: vi.fn().mockResolvedValue('test caption'),
}));

describe('generateImageTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFindById.mockReturnValue({
      id: 'app-123',
      customerId: 'cust-abc',
      subscriptionId: 'sub-xyz',
      path: '/tmp/airo-app-builder/app-123/preview',
    });

    mockGetCurrentUserId.mockReturnValue('budget-user-111');

    mockGenerateImages.mockResolvedValue({
      sessionId: 'sess-img-123',
      images: [
        { id: 'img-1', url: 'https://cdn/img1.png' },
        { id: 'img-2', url: 'https://cdn/img2.png' },
      ],
    });

    mockGetManifest.mockResolvedValue({
      success: true,
      manifest: { 'pages/home/hero': { mediaType: 'image', currentUrl: '/old.jpg', alternatives: ['/alt.jpg'] } },
    });
    mockSetSlot.mockResolvedValue({ success: true });
  });

  it('should call imagegenService with mapped params', async () => {
    const { generateImageTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    await generateImageTool.execute(
      {
        prompt: 'A professional business team',
        orientation: 'landscape',
        imageCount: 2,
        slotName: 'pages/home/hero',
      },
      context
    );

    expect(mockGenerateImages).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'A professional business team',
        orientation: 'landscape',
        count: 2,
        customerId: 'cust-abc',
        budgetUserId: 'budget-user-111',
      })
    );
  });

  it('should return structured content on success', async () => {
    const { generateImageTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    const result = await generateImageTool.execute(
      {
        prompt: 'A sunset',
        orientation: 'landscape',
        imageCount: 2,
        slotName: 'pages/home/hero',
      },
      context
    );

    expect(result).toEqual({
      structuredContent: {
        sessionId: 'sess-img-123',
        images: [
          { id: 'img-1', url: 'https://cdn/img1.png' },
          { id: 'img-2', url: 'https://cdn/img2.png' },
        ],
        slotUrl: '/airo-assets/images/pages/home/hero',
        slotSaveFailed: false,
      },
    });
  });

  it('should return error when customerId not found', async () => {
    mockFindById.mockReturnValue(null);

    const { generateImageTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'unknown-app' },
    };

    const result = await generateImageTool.execute(
      {
        prompt: 'Test',
        orientation: 'landscape',
        imageCount: 1,
        slotName: 'pages/home/hero',
      },
      context
    );

    expect(result).toEqual({
      error: 'Unable to determine customer identity for image generation',
    });
    expect(mockGenerateImages).not.toHaveBeenCalled();
  });

  it('should return error when grants exhausted', async () => {
    mockGetCurrentUserId.mockReturnValue(undefined);

    const { generateImageTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    const result = await generateImageTool.execute(
      {
        prompt: 'Test',
        orientation: 'landscape',
        imageCount: 1,
        slotName: 'pages/home/hero',
      },
      context
    );

    expect(result).toEqual({
      error: 'All credit grants have been exhausted. Please purchase additional credits to generate images.',
    });
    expect(mockGenerateImages).not.toHaveBeenCalled();
  });

  it('should propagate error when imagegenService throws', async () => {
    mockGenerateImages.mockRejectedValue(new Error('Imagegen API error (image.generate): 500 Internal Server Error'));

    const { generateImageTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    await expect(
      generateImageTool.execute(
        {
          prompt: 'Test',
          orientation: 'landscape',
          imageCount: 1,
          slotName: 'pages/home/hero',
        },
        context
      )
    ).rejects.toThrow('Imagegen API error (image.generate): 500 Internal Server Error');
  });

  describe('manifest write', () => {
    it('should save generated images to manifest as generated slot', async () => {
      const { generateImageTool } = await import('../index.js');

      const context = { socketId: 'socket-1', metadata: { appId: 'app-123' } };

      await generateImageTool.execute(
        {
          prompt: 'A sunset',
          orientation: 'landscape',
          imageCount: 2,
          slotName: 'pages/home/hero',
        },
        context
      );

      expect(mockSetSlot).toHaveBeenCalledWith(
        'app-123',
        'pages/home/hero',
        expect.objectContaining({
          mediaType: 'generated',
          currentUrl: 'https://cdn/img1.png',
          searchQuery: 'test caption',
          caption: 'test caption',
          alternatives: ['/old.jpg', 'https://cdn/img2.png', '/alt.jpg'],
          aiGeneratedUrls: ['https://cdn/img1.png', 'https://cdn/img2.png'],
          userModified: true,
        }),
        true
      );
    });

    it('should resolve slot via exact full-segment suffix match', async () => {
      mockGetManifest.mockResolvedValue({
        success: true,
        manifest: {
          'pages/home/hero': { mediaType: 'image', currentUrl: '/old.jpg', alternatives: [] },
        },
      });

      const { generateImageTool } = await import('../index.js');
      const context = { socketId: 'socket-1', metadata: { appId: 'app-123' } };

      await generateImageTool.execute(
        {
          prompt: 'Test',
          orientation: 'landscape',
          imageCount: 1,
          slotName: 'home/hero',
        },
        context
      );

      expect(mockSetSlot).toHaveBeenCalledWith('app-123', 'pages/home/hero', expect.any(Object), true);
    });

    it('should omit slotUrl when manifest write fails', async () => {
      mockSetSlot.mockResolvedValue({ success: false, error: 'disk full' });

      const { generateImageTool } = await import('../index.js');
      const context = { socketId: 'socket-1', metadata: { appId: 'app-123' } };

      const result = await generateImageTool.execute(
        {
          prompt: 'Test',
          orientation: 'landscape',
          imageCount: 1,
          slotName: 'pages/home/hero',
        },
        context
      );

      expect(result).toEqual({
        text: 'Generated 2 image(s). Slot save failed — the image will not appear in the Media Panel until retried. Tell the user and offer to retry.',
        structuredContent: {
          sessionId: 'sess-img-123',
          images: [
            { id: 'img-1', url: 'https://cdn/img1.png' },
            { id: 'img-2', url: 'https://cdn/img2.png' },
          ],
          slotUrl: undefined,
          slotSaveFailed: true,
        },
      });
    });

    it('should cap aiGeneratedUrls at 20 entries', async () => {
      const existingUrls = Array.from({ length: 25 }, (_, i) => `https://cdn/old-${i}.png`);
      mockGetManifest.mockResolvedValue({
        success: true,
        manifest: {
          'pages/home/hero': {
            mediaType: 'generated',
            currentUrl: existingUrls[0],
            alternatives: [],
            aiGeneratedUrls: existingUrls,
          },
        },
      });

      mockGenerateImages.mockResolvedValue({
        sessionId: 'sess-img-123',
        images: [{ id: 'img-1', url: 'https://cdn/new.png' }],
      });

      const { generateImageTool } = await import('../index.js');
      const context = { socketId: 'socket-1', metadata: { appId: 'app-123' } };

      await generateImageTool.execute(
        {
          prompt: 'New image',
          orientation: 'landscape',
          imageCount: 1,
          slotName: 'pages/home/hero',
        },
        context
      );

      const slotArg = mockSetSlot.mock.calls[0][2];
      expect(slotArg.aiGeneratedUrls).toHaveLength(20);
      expect(slotArg.aiGeneratedUrls[0]).toBe('https://cdn/new.png');
    });
  });
});
