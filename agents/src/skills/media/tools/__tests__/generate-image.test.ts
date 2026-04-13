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

// Mock ImagegenService
const mockGenerateImages = vi.fn();
vi.mock('../../../../services/ImagegenService.js', () => ({
  imagegenService: {
    generateImages: mockGenerateImages,
    editImage: vi.fn(),
    generateVideo: vi.fn(),
  },
}));

// Mock LogoService (needed because same file exports all tools)
vi.mock('../../../../services/LogoService.js', () => ({
  logoService: {
    generateLogos: vi.fn(),
  },
}));

// Mock MediaManifestService (needed because same file exports logo tool)
vi.mock('../../../../services/MediaManifestService.js', () => ({
  mediaManifestService: {
    importSlot: vi.fn(),
    setSlot: vi.fn(),
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

// Mock AppPlanTool
vi.mock('../../../../tools/app-plan-tool.js', () => ({
  appPlanTool: {
    execute: vi.fn(),
  },
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
        },
        context
      )
    ).rejects.toThrow('Imagegen API error (image.generate): 500 Internal Server Error');
  });
});
