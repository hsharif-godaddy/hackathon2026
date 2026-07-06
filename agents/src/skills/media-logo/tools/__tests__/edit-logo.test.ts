import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../logging/index.js', () => ({
  Logger: { create: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockGenerate = vi.fn();
vi.mock('../../../../services/LogoService.js', () => ({
  logoService: { generate: mockGenerate },
}));

const mockFindById = vi.fn();
vi.mock('../../../../database/repositories/index.js', () => ({
  appRepository: { findById: mockFindById },
}));

const mockGetCurrentUserId = vi.fn();
vi.mock('@airo/ai-grants', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    grantSessionManager: { getCurrentUserId: mockGetCurrentUserId },
  };
});

const mockAppPlanExecute = vi.fn();
vi.mock('../../../../tools/app-plan-tool.js', () => ({
  appPlanTool: { execute: mockAppPlanExecute },
}));

const mockSetSlot = vi.fn();
const mockGetSlot = vi.fn();
vi.mock('../../../../services/MediaManifestService.js', () => ({
  mediaManifestService: { setSlot: mockSetSlot, getSlot: mockGetSlot },
}));

const mockMemoryGet = vi.fn();
vi.mock('../../../../memory/adapters/index.js', () => ({
  getKvMemoryStore: () => ({ get: mockMemoryGet }),
}));

const mockStart = vi.fn(async () => ({
  status: 'queued', jobId: 'job-1', slots: ['logo/horizontal'], done: Promise.resolve(),
}));
vi.mock('../../../../services/logo/LogoGenerationService.js', () => ({
  logoGenerationService: { start: mockStart },
}));

import { createStubWorkspaceFiles } from '../../../../workspace/__tests__/test-workspace-files.js';

const mockCreateForWorkspace = vi.fn(() => ({ files: createStubWorkspaceFiles() }));
vi.mock('../../../../workspace/index.js', () => ({
  createForWorkspace: mockCreateForWorkspace,
}));

const mockReadLogoJob = vi.fn(async () => ({ jobId: 'job-1', status: 'completed', logoId: 'logo-abc' }));
vi.mock('../../../../services/logo/logo-job-state.js', () => ({
  readLogoJob: mockReadLogoJob,
}));

describe('media-logo edit_logo tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFindById.mockReturnValue({ id: 'app-1', customerId: 'cust-1' });
    mockGetCurrentUserId.mockReturnValue('budget-user-1');

    mockAppPlanExecute.mockResolvedValue({ success: false });
    mockMemoryGet.mockResolvedValue({ success: true, exists: false });

    mockGetSlot.mockResolvedValue({
      success: true,
      slot: {
        mediaType: 'logo',
        currentUrl: '/airo-assets/uploads/existing-logo.png',
        alternatives: [],
        searchQuery: '',
        userModified: false,
        createdAt: '',
        lastUpdated: '',
        logoSourceMap: {
          '/airo-assets/uploads/existing-logo.png': { sessionId: 'old-sess', logoId: 'old-logo' },
        },
      },
    });
    mockSetSlot.mockResolvedValue({ success: true });

    mockStart.mockResolvedValue({
      status: 'queued', jobId: 'job-1', slots: ['logo/horizontal'], done: Promise.resolve(),
    });

    mockCreateForWorkspace.mockReturnValue({ files: createStubWorkspaceFiles() });
    mockReadLogoJob.mockResolvedValue({ jobId: 'job-1', status: 'completed', logoId: 'logo-abc' });
  });

  const baseContext = { socketId: 'sock-1', metadata: { appId: 'app-1' } };

  describe('input validation + context resolution', () => {
    it('returns an error when no appId is in context', async () => {
      const { editLogoTool } = await import('../index.js');

      const result = await editLogoTool.execute(
        { prompt: 'make it blue', layout: 'horizontal' },
        { socketId: 'sock-1', metadata: {} },
      );

      expect(result.error).toMatch(/app id/i);
      expect(mockStart).not.toHaveBeenCalled();
    });

    it('returns an error when the app has no customerId', async () => {
      mockFindById.mockReturnValueOnce({ id: 'app-1' }); // no customerId

      const { editLogoTool } = await import('../index.js');

      const result = await editLogoTool.execute(
        { prompt: 'make it blue', layout: 'horizontal' },
        baseContext,
      );

      expect(result.error).toMatch(/customer/i);
      expect(mockStart).not.toHaveBeenCalled();
    });

    it('returns an error when grants are exhausted', async () => {
      mockGetCurrentUserId.mockReturnValueOnce(undefined);

      const { editLogoTool } = await import('../index.js');

      const result = await editLogoTool.execute(
        { prompt: 'make it blue', layout: 'horizontal' },
        baseContext,
      );

      expect(result.error).toMatch(/credit/i);
      expect(mockStart).not.toHaveBeenCalled();
    });
  });

  describe('auto-resolves current logo from slot', () => {
    it('resolves the existing logo URL from the horizontal slot and passes it as references.logo', async () => {
      const { editLogoTool } = await import('../index.js');

      await editLogoTool.execute(
        { prompt: 'make it blue', layout: 'horizontal' },
        baseContext,
      );

      expect(mockStart).toHaveBeenCalledWith(
        expect.objectContaining({
          references: expect.objectContaining({ logo: '/airo-assets/uploads/existing-logo.png' }),
        }),
      );
    });

    it('returns an error when no logo exists in the slot', async () => {
      mockGetSlot.mockResolvedValue({ success: false });

      const { editLogoTool } = await import('../index.js');

      const result = await editLogoTool.execute(
        { prompt: 'make it blue', layout: 'horizontal' },
        baseContext,
      );

      expect(result.error).toMatch(/generate_logo/);
      expect(mockStart).not.toHaveBeenCalled();
    });

    it('falls back to the horizontal logo when editing square and no square slot exists', async () => {
      mockGetSlot.mockImplementation(async (_appId: string, path: string) => {
        if (path === 'logo/horizontal') {
          return {
            success: true,
            slot: {
              mediaType: 'logo',
              currentUrl: '/airo-assets/uploads/horizontal-logo.png',
              alternatives: [],
              searchQuery: '',
              userModified: false,
              createdAt: '',
              lastUpdated: '',
              logoSourceMap: {
                '/airo-assets/uploads/horizontal-logo.png': { sessionId: 'h-sess', logoId: 'h-logo' },
              },
            },
          };
        }
        return { success: false };
      });

      const { editLogoTool } = await import('../index.js');

      await editLogoTool.execute(
        { prompt: 'Reformat for a square layout, preserving the existing icon design', layout: 'square' },
        baseContext,
      );

      expect(mockStart).toHaveBeenCalledWith(
        expect.objectContaining({
          references: expect.objectContaining({ logo: '/airo-assets/uploads/horizontal-logo.png' }),
        }),
      );
    });

    it('passes uploaded inspiration images from context alongside the resolved logo', async () => {
      const contextWithUpload = {
        ...baseContext,
        contextAttachments: [{
          type: 'selected_assets',
          data: [
            { mediaType: 'IMAGE', sourceType: 'upload', imageUrl: 'https://example.com/ref.png' },
          ],
        }],
      };

      const { editLogoTool } = await import('../index.js');

      await editLogoTool.execute(
        { prompt: 'make it blue', layout: 'horizontal' },
        contextWithUpload,
      );

      expect(mockStart).toHaveBeenCalledWith(
        expect.objectContaining({
          references: {
            logo: '/airo-assets/uploads/existing-logo.png',
            inspiration: ['https://example.com/ref.png'],
          },
        }),
      );
    });
  });

  describe('async kickoff', () => {
    beforeEach(() => {
      mockStart.mockResolvedValue({ status: 'queued', jobId: 'job-1', slots: ['logo/horizontal'], done: Promise.resolve() });
    });

    it('returns a started ack (does not block on generation)', async () => {
      const { editLogoTool } = await import('../index.js');
      const result = await editLogoTool.execute({ prompt: 'make it blue', layout: 'horizontal' }, baseContext);
      expect(result.structuredContent).toMatchObject({
        started: true, jobId: 'job-1', slots: ['logo/horizontal'], status: 'queued',
      });
      expect(result.text).toBeTruthy();
    });

    it('surfaces a start error', async () => {
      mockStart.mockResolvedValueOnce({ status: 'error', error: 'Workspace unavailable for logo generation' });
      const { editLogoTool } = await import('../index.js');
      const result = await editLogoTool.execute({ prompt: 'make it blue', layout: 'horizontal' }, baseContext);
      expect(result.error).toBe('Workspace unavailable for logo generation');
    });
  });
});
