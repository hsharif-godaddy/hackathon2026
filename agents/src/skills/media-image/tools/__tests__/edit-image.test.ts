import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockEditImage = vi.fn();
vi.mock('../../../../services/ImagegenService.js', () => ({
  imagegenService: {
    generateImages: vi.fn(),
    editImage: mockEditImage,
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

vi.mock('../../../../services/MediaManifestService.js', () => ({
  mediaManifestService: {
    getManifest: vi.fn(),
    setSlot: vi.fn(),
  },
}));

describe('editImageTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFindById.mockReturnValue({
      id: 'app-123',
      customerId: 'cust-abc',
      subscriptionId: 'sub-xyz',
      path: '/tmp/airo-app-builder/app-123/preview',
    });

    mockGetCurrentUserId.mockReturnValue('budget-user-111');

    mockEditImage.mockResolvedValue({
      sessionId: 'sess-edit-123',
      url: 'https://cdn/edited.png',
    });
  });

  it('should call imagegenService with mapped params', async () => {
    const { editImageTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    await editImageTool.execute(
      {
        prompt: 'Remove the background',
        imageUrl: 'https://example.com/original.png',
      },
      context
    );

    expect(mockEditImage).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Remove the background',
        imageUrl: 'https://example.com/original.png',
        customerId: 'cust-abc',
        budgetUserId: 'budget-user-111',
      })
    );
  });

  it('should return structured content on success', async () => {
    const { editImageTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    const result = await editImageTool.execute(
      {
        prompt: 'Make the sky blue',
        imageUrl: 'https://example.com/img.png',
      },
      context
    );

    expect(result).toEqual({
      structuredContent: {
        sessionId: 'sess-edit-123',
        url: 'https://cdn/edited.png',
      },
    });
  });

  it('should return error when customerId not found', async () => {
    mockFindById.mockReturnValue(null);

    const { editImageTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'unknown-app' },
    };

    const result = await editImageTool.execute(
      {
        prompt: 'Test',
        imageUrl: 'https://example.com/img.png',
      },
      context
    );

    expect(result).toEqual({
      error: 'Unable to determine customer identity for image editing',
    });
    expect(mockEditImage).not.toHaveBeenCalled();
  });

  it('should return error when grants exhausted', async () => {
    mockGetCurrentUserId.mockReturnValue(undefined);

    const { editImageTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    const result = await editImageTool.execute(
      {
        prompt: 'Test',
        imageUrl: 'https://example.com/img.png',
      },
      context
    );

    expect(result).toEqual({
      error: 'All credit grants have been exhausted. Please purchase additional credits to edit images.',
    });
    expect(mockEditImage).not.toHaveBeenCalled();
  });

  it('should propagate error when imagegenService throws', async () => {
    mockEditImage.mockRejectedValue(new Error('Imagegen API error (image.edit): 500 Internal Server Error'));

    const { editImageTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    await expect(
      editImageTool.execute(
        {
          prompt: 'Test',
          imageUrl: 'https://example.com/img.png',
        },
        context
      )
    ).rejects.toThrow('Imagegen API error (image.edit): 500 Internal Server Error');
  });

  describe('logo URL guardrail', function logoGuardrail() {
    it('should reject logo CDN URLs via config.validate', async function rejectLogo() {
      const { editImageTool } = await import('../index.js');

      expect(editImageTool.config?.validate).toBeDefined();

      expect(() =>
        editImageTool.config!.validate!({
          prompt: 'Make the background transparent',
          imageUrl: 'https://isteam.wsimg.com/genai-assistant/mcp/generated_logos/abc123-transparent.png',
        })
      ).toThrow('This URL is a generated logo');
    });

    it('should allow non-logo URLs through config.validate', async function allowNonLogo() {
      const { editImageTool } = await import('../index.js');

      expect(() =>
        editImageTool.config!.validate!({
          prompt: 'Remove the background',
          imageUrl: 'https://example.com/photo.png',
        })
      ).not.toThrow();
    });
  });
});
