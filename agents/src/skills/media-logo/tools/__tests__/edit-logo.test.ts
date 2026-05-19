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
const mockEditLogos = vi.fn();
vi.mock('../../../../services/LogoService.js', () => ({
  logoService: {
    generateLogos: vi.fn(),
    editLogos: mockEditLogos,
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
    },
  };
});

// Mock AppPlanTool
vi.mock('../../../../tools/app-plan-tool.js', () => ({
  appPlanTool: {
    execute: vi.fn(),
  },
}));

// Mock MediaManifestService
const mockSetSlot = vi.fn();
const mockGetSlot = vi.fn();
vi.mock('../../../../services/MediaManifestService.js', () => ({
  mediaManifestService: {
    setSlot: mockSetSlot,
    getSlot: mockGetSlot,
  },
}));

describe('editLogoTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFindById.mockReturnValue({
      id: 'app-123',
      customerId: 'cust-abc',
    });

    mockGetCurrentUserId.mockReturnValue('budget-user-111');

    mockEditLogos.mockResolvedValue({
      sessionId: 'edit-sess-456',
      logos: [
        {
          id: 'edited-logo-1',
          transparentUrl: 'https://cdn/et1.png',
          solidUrl: 'https://cdn/es1.png',
          mockupUrl: 'https://cdn/em1.png',
        },
      ],
    });

    mockSetSlot.mockResolvedValue({ success: true });
    mockGetSlot.mockResolvedValue({ success: false });
  });

  it('should call logoService.editLogos with correct parameters', async () => {
    const { editLogoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    await editLogoTool.execute(
      {
        sourceSessionId: 'sess-123',
        sourceLogoId: 'logo-1',
        prompt: 'Make the logo blue',
      },
      context
    );

    expect(mockEditLogos).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSessionId: 'sess-123',
        sourceLogoId: 'logo-1',
        prompt: 'Make the logo blue',
        appId: 'app-123',
        customerId: 'cust-abc',
        budgetUserId: 'budget-user-111',
      })
    );
  });

  it('should return structured content with slotUrl on success', async () => {
    const { editLogoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    const result = await editLogoTool.execute(
      {
        sourceSessionId: 'sess-123',
        sourceLogoId: 'logo-1',
        prompt: 'Make the logo blue',
      },
      context
    );

    expect(result).toEqual({
      text: expect.stringContaining('Edited logo and generated 1 variation(s)'),
      structuredContent: {
        sessionId: 'edit-sess-456',
        logos: expect.arrayContaining([
          expect.objectContaining({ id: 'edited-logo-1' }),
        ]),
        slotUrl: '/airo-assets/images/logo/primary',
        slotPath: 'logo/primary',
        savedSlots: { square: '/airo-assets/images/logo/primary' },
      },
    });
  });

  it('should auto-save edited logos into the media slot system', async () => {
    const { editLogoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    await editLogoTool.execute(
      {
        sourceSessionId: 'sess-123',
        sourceLogoId: 'logo-1',
        prompt: 'Make the logo blue',
      },
      context
    );

    expect(mockSetSlot).toHaveBeenCalledWith('app-123', 'logo/primary', expect.objectContaining({
      mediaType: 'logo',
      currentUrl: 'https://cdn/et1.png',
      solidUrlMap: {
        'https://cdn/et1.png': 'https://cdn/es1.png',
      },
      userModified: false,
    }));
  });

  it('should merge with existing logos when slot already exists', async () => {
    mockGetSlot.mockResolvedValue({
      success: true,
      slot: {
        mediaType: 'logo',
        currentUrl: 'https://cdn/old-t1.png',
        searchQuery: 'My Brand',
        alternatives: ['https://cdn/old-t2.png'],
        solidUrlMap: {
          'https://cdn/old-t1.png': 'https://cdn/old-s1.png',
          'https://cdn/old-t2.png': 'https://cdn/old-s2.png',
        },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });

    const { editLogoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    await editLogoTool.execute(
      {
        sourceSessionId: 'sess-123',
        sourceLogoId: 'logo-1',
        prompt: 'Make the logo blue',
      },
      context
    );

    expect(mockSetSlot).toHaveBeenCalledWith('app-123', 'logo/primary', expect.objectContaining({
      currentUrl: 'https://cdn/et1.png',
      searchQuery: 'My Brand',
      alternatives: ['https://cdn/old-t1.png', 'https://cdn/old-t2.png'],
      solidUrlMap: {
        'https://cdn/old-t1.png': 'https://cdn/old-s1.png',
        'https://cdn/old-t2.png': 'https://cdn/old-s2.png',
        'https://cdn/et1.png': 'https://cdn/es1.png',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
    }));
  });

  it('should persist landscapeMockupUrlMap when edit result includes landscapeMockupUrl', async () => {
    mockEditLogos.mockResolvedValue({
      sessionId: 'edit-sess-456',
      logos: [
        {
          id: 'edited-logo-1',
          transparentUrl: 'https://cdn/et1.png',
          solidUrl: 'https://cdn/es1.png',
          mockupUrl: 'https://cdn/em1.png',
          landscapeMockupUrl: 'https://cdn/elm1.png',
        },
      ],
    });

    const { editLogoTool } = await import('../index.js');

    await editLogoTool.execute(
      {
        sourceSessionId: 'sess-123',
        sourceLogoId: 'logo-1',
        prompt: 'Make the logo blue',
      },
      { socketId: 'socket-1', metadata: { appId: 'app-123' } }
    );

    expect(mockSetSlot).toHaveBeenCalledWith('app-123', 'logo/primary', expect.objectContaining({
      mockupUrlMap: { 'https://cdn/et1.png': 'https://cdn/em1.png' },
      landscapeMockupUrlMap: { 'https://cdn/et1.png': 'https://cdn/elm1.png' },
    }));
  });

  it('should return error when appId is missing from context metadata', async () => {
    const { editLogoTool } = await import('../index.js');

    const result = await editLogoTool.execute(
      {
        sourceSessionId: 'sess-123',
        sourceLogoId: 'logo-1',
        prompt: 'Make it blue',
      },
      { socketId: 'socket-1' }
    );

    expect(result).toEqual({
      error: 'Unable to determine app id for logo editing',
    });
    expect(mockFindById).not.toHaveBeenCalled();
    expect(mockEditLogos).not.toHaveBeenCalled();
  });

  it('should return error when customerId not found', async () => {
    mockFindById.mockReturnValue(null);

    const { editLogoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'unknown-app' },
    };

    const result = await editLogoTool.execute(
      {
        sourceSessionId: 'sess-123',
        sourceLogoId: 'logo-1',
        prompt: 'Make it blue',
      },
      context
    );

    expect(result).toEqual({
      error: 'Unable to determine customer identity for logo editing',
    });
    expect(mockEditLogos).not.toHaveBeenCalled();
  });

  it('should return error when grants exhausted', async () => {
    mockGetCurrentUserId.mockReturnValue(undefined);

    const { editLogoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    const result = await editLogoTool.execute(
      {
        sourceSessionId: 'sess-123',
        sourceLogoId: 'logo-1',
        prompt: 'Make it blue',
      },
      context
    );

    expect(result).toEqual({
      error: 'All credit grants have been exhausted. Please purchase additional credits to edit logos.',
    });
    expect(mockEditLogos).not.toHaveBeenCalled();
  });

  it('should propagate error when logoService throws', async () => {
    mockEditLogos.mockRejectedValue(new Error('Logo API error: 500 Internal Server Error'));

    const { editLogoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    await expect(
      editLogoTool.execute(
        {
          sourceSessionId: 'sess-123',
          sourceLogoId: 'logo-1',
          prompt: 'Make it blue',
        },
        context
      )
    ).rejects.toThrow('Logo API error: 500 Internal Server Error');
  });

  it('should still return result when slot save fails', async () => {
    mockSetSlot.mockRejectedValue(new Error('Manifest write failed'));

    const { editLogoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    const result = await editLogoTool.execute(
      {
        sourceSessionId: 'sess-123',
        sourceLogoId: 'logo-1',
        prompt: 'Make it blue',
      },
      context
    );

    expect(result).toHaveProperty('structuredContent.logos');
    expect(result).toHaveProperty('structuredContent.slotUrl');
  });

  it('should auto-resolve sourceSessionId and sourceLogoId from slot when not provided', async () => {
    mockGetSlot.mockResolvedValue({
      success: true,
      slot: {
        mediaType: 'logo',
        currentUrl: 'https://cdn/et1.png',
        alternatives: [],
        logoSourceMap: {
          'https://cdn/et1.png': { sessionId: 'auto-sess-789', logoId: 'auto-logo-1' },
        },
      },
    });

    const { editLogoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    await editLogoTool.execute(
      {
        prompt: 'Make the logo red',
      },
      context
    );

    expect(mockEditLogos).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSessionId: 'auto-sess-789',
        sourceLogoId: 'auto-logo-1',
        prompt: 'Make the logo red',
      })
    );
  });

  it('should return error when auto-resolving with no saved logo', async () => {
    mockGetSlot.mockResolvedValue({ success: false });

    const { editLogoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    const result = await editLogoTool.execute(
      {
        prompt: 'Make the logo red',
      },
      context
    );

    expect(result).toEqual({
      error: 'No saved logo found to edit. Generate a logo first with media-logo__generate_logo, then edit it.',
    });
    expect(mockEditLogos).not.toHaveBeenCalled();
  });

  it('should return error when customerId not found and no source IDs for auto-resolve', async () => {
    mockFindById.mockReturnValue(null);

    const { editLogoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'unknown-app' },
    };

    const result = await editLogoTool.execute(
      {
        prompt: 'Make the logo red',
      },
      context
    );

    expect(result).toEqual({
      error: 'Unable to determine customer identity for logo editing',
    });
    expect(mockEditLogos).not.toHaveBeenCalled();
  });

  it('should persist logoSourceMap when saving to slot', async () => {
    const { editLogoTool } = await import('../index.js');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    await editLogoTool.execute(
      {
        sourceSessionId: 'sess-123',
        sourceLogoId: 'logo-1',
        prompt: 'Make it blue',
      },
      context
    );

    expect(mockSetSlot).toHaveBeenCalledWith('app-123', 'logo/primary', expect.objectContaining({
      logoSourceMap: expect.objectContaining({
        'https://cdn/et1.png': { sessionId: 'edit-sess-456', logoId: 'edited-logo-1' },
      }),
    }));
  });
});
