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
const mockGenerateVideo = vi.fn();
vi.mock('../../../../services/ImagegenService.js', () => ({
  imagegenService: {
    generateImages: vi.fn(),
    editImage: vi.fn(),
    generateVideo: mockGenerateVideo,
  },
}));

// Mock LogoService (needed because same file exports all tools)
vi.mock('../../../../services/LogoService.js', () => ({
  logoService: {
    generateLogos: vi.fn(),
  },
}));

// Mock MediaManifestService (needed because same file exports tools that use it)
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
      },
      context
    );

    expect(result).toEqual({
      structuredContent: {
        sessionId: 'vid-123',
        url: 'https://cdn/video.mp4',
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
      },
      context
    );

    const callArgs = mockGenerateVideo.mock.calls[0][0];
    expect(typeof callArgs.duration).toBe('number');
    expect(callArgs.duration).toBe(6);
  });
});
