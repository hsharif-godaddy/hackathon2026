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

// Used only by the synchronous (background:false) path to read the settled job.
const mockCreateForWorkspace = vi.fn(() => ({ files: createStubWorkspaceFiles() }));
vi.mock('../../../../workspace/index.js', () => ({
  createForWorkspace: mockCreateForWorkspace,
}));

const mockReadLogoJob = vi.fn(async () => ({ jobId: 'job-1', status: 'completed', logoId: 'logo-abc' }));
vi.mock('../../../../services/logo/logo-job-state.js', () => ({
  readLogoJob: mockReadLogoJob,
}));

describe('media-logo generate_logo tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFindById.mockReturnValue({ id: 'app-1', customerId: 'cust-1' });
    mockGetCurrentUserId.mockReturnValue('budget-user-1');

    mockAppPlanExecute.mockResolvedValue({ success: false });
    mockMemoryGet.mockResolvedValue({ success: true, exists: false });

    mockSetSlot.mockResolvedValue({ success: true });

    mockStart.mockResolvedValue({
      status: 'queued', jobId: 'job-1', slots: ['logo/horizontal'], done: Promise.resolve(),
    });

    mockCreateForWorkspace.mockReturnValue({ files: createStubWorkspaceFiles() });
    mockReadLogoJob.mockResolvedValue({ jobId: 'job-1', status: 'completed', logoId: 'logo-abc' });

    mockGenerate.mockResolvedValue({
      sessionId: 'sess-1',
      logo: {
        id: 'logo-abc',
        generatedAt: '2026-06-02T00:00:00Z',
        prompt: 'test',
        modelUsed: 'gpt-image-2',
        urls: {
          horizontal: {
            transparent: '/airo-assets/uploads/logo-sess-1-horizontal.png',
            solid: '/airo-assets/uploads/logo-sess-1-horizontal.png',
            mockup: '/airo-assets/uploads/logo-sess-1-horizontal.png',
            landscapeMockup: '/airo-assets/uploads/logo-sess-1-horizontal.png',
          },
        },
      },
    });
  });

  const baseContext = { socketId: 'sock-1', metadata: { appId: 'app-1' } };

  describe('input validation + context resolution', () => {
    it('returns an error when no appId is in context', async () => {
      const { generateLogoTool } = await import('../index.js');

      const result = await generateLogoTool.execute(
        { prompt: 'a logo', layout: 'horizontal' },
        { socketId: 'sock-1', metadata: {} },
      );

      expect(result.error).toMatch(/app id/i);
      expect(mockStart).not.toHaveBeenCalled();
    });

    it('returns an error when the app has no customerId', async () => {
      mockFindById.mockReturnValueOnce({ id: 'app-1' }); // no customerId

      const { generateLogoTool } = await import('../index.js');

      const result = await generateLogoTool.execute(
        { prompt: 'a logo', layout: 'horizontal' },
        baseContext,
      );

      expect(result.error).toMatch(/customer/i);
      expect(mockStart).not.toHaveBeenCalled();
    });

    it('returns an error when grants are exhausted', async () => {
      mockGetCurrentUserId.mockReturnValueOnce(undefined);

      const { generateLogoTool } = await import('../index.js');

      const result = await generateLogoTool.execute(
        { prompt: 'a logo', layout: 'horizontal' },
        baseContext,
      );

      expect(result.error).toMatch(/credit/i);
      expect(mockStart).not.toHaveBeenCalled();
    });
  });

  describe('palette suffix injection', () => {
    it('appends only present palette tokens from app plan', async () => {
      mockAppPlanExecute.mockResolvedValueOnce({
        success: true,
        data: {
          colorPalette: {
            primary: '#B96B3C',
            secondary: '#2A4D3E',
            accent: '#F2C94C',
            background: '#FAF8F5',
            foreground: '#1F1F1F',
          },
        },
      });

      const { generateLogoTool } = await import('../index.js');

      await generateLogoTool.execute(
        { prompt: 'a coffee cup logo', layout: 'horizontal' },
        baseContext,
      );

      const callArg = mockStart.mock.calls[0][0];
      expect(callArg.prompt).toContain('a coffee cup logo');
      expect(callArg.prompt).toContain('Brand colors');
      expect(callArg.prompt).toContain('primary #B96B3C');
      expect(callArg.prompt).toContain('secondary #2A4D3E');
      expect(callArg.prompt).toContain('accent #F2C94C');
      expect(callArg.prompt).toContain('background #FAF8F5');
      expect(callArg.prompt).toContain('foreground #1F1F1F');
    });

    it('falls back to memory.brand.colors.palette when app plan lacks colors', async () => {
      mockAppPlanExecute.mockResolvedValueOnce({ success: true, data: {} });
      mockMemoryGet.mockImplementation(async (_scope, key) => {
        if (key === 'brand.colors.palette') {
          return {
            success: true,
            exists: true,
            value: { primary: { value: '#000' }, accent: { value: '#FFF' } },
          };
        }
        return { success: true, exists: false };
      });

      const { generateLogoTool } = await import('../index.js');

      await generateLogoTool.execute(
        { prompt: 'a logo', layout: 'horizontal' },
        baseContext,
      );

      const callArg = mockStart.mock.calls[0][0];
      expect(callArg.prompt).toContain('primary #000');
      expect(callArg.prompt).toContain('accent #FFF');
    });

    it('skips the suffix entirely when no palette is available', async () => {
      const { generateLogoTool } = await import('../index.js');

      await generateLogoTool.execute(
        { prompt: 'a logo', layout: 'horizontal' },
        baseContext,
      );

      const callArg = mockStart.mock.calls[0][0];
      expect(callArg.prompt).toBe('a logo');
      expect(callArg.prompt).not.toContain('Brand colors');
    });

    it('drops the suffix when it would push the prompt past 2000 chars', async () => {
      mockAppPlanExecute.mockResolvedValueOnce({
        success: true,
        data: { colorPalette: { primary: '#000', secondary: '#111' } },
      });

      const longPrompt = 'x'.repeat(1990);
      const { generateLogoTool } = await import('../index.js');

      await generateLogoTool.execute(
        { prompt: longPrompt, layout: 'horizontal' },
        baseContext,
      );

      const callArg = mockStart.mock.calls[0][0];
      expect(callArg.prompt.length).toBeLessThanOrEqual(2000);
    });
  });

  describe('structured colors', () => {
    const paletteData = {
      success: true,
      data: {
        colorPalette: {
          primary: '#B96B3C',
          secondary: '#2A4D3E',
          accent: '#F2C94C',
          background: '#FAF8F5',
          foreground: '#1F1F1F',
        },
      },
    };

    it('passes background + brand colors (no foreground) when palette available', async () => {
      mockAppPlanExecute.mockResolvedValueOnce(paletteData);

      const { generateLogoTool } = await import('../index.js');

      await generateLogoTool.execute(
        { prompt: 'a coffee cup logo', layout: 'horizontal' },
        baseContext,
      );

      const callArg = mockStart.mock.calls[0][0];
      expect(callArg.colors).toEqual({
        primary: '#B96B3C',
        secondary: '#2A4D3E',
        accent: '#F2C94C',
        background: '#FAF8F5',
      });
      expect(callArg.colors).not.toHaveProperty('foreground');
      expect(callArg.prompt).toContain('Brand colors');
      expect(callArg.prompt).toContain('foreground #1F1F1F');
    });

    it('omits colors when no palette resolved', async () => {
      const { generateLogoTool } = await import('../index.js');

      await generateLogoTool.execute(
        { prompt: 'a logo', layout: 'horizontal' },
        baseContext,
      );

      const callArg = mockStart.mock.calls[0][0];
      expect(callArg).not.toHaveProperty('colors');
    });
  });

  describe('layout expansion', () => {
    it('expands layout: "all" into [square, horizontal, vertical]', async () => {
      const { generateLogoTool } = await import('../index.js');

      await generateLogoTool.execute(
        { prompt: 'logo', layout: 'all' },
        baseContext,
      );

      expect(mockStart).toHaveBeenCalledWith(
        expect.objectContaining({ layouts: ['square', 'horizontal', 'vertical'] }),
      );
    });

    it('passes a single layout through verbatim', async () => {
      const { generateLogoTool } = await import('../index.js');

      await generateLogoTool.execute(
        { prompt: 'logo', layout: 'vertical' },
        baseContext,
      );

      expect(mockStart).toHaveBeenCalledWith(
        expect.objectContaining({ layouts: ['vertical'] }),
      );
    });
  });

  describe('inspiration from context attachments', () => {
    const contextWithUploads = {
      ...baseContext,
      contextAttachments: [{
        type: 'selected_assets',
        data: [
          { mediaType: 'IMAGE', sourceType: 'upload', imageUrl: 'https://app-1.agent.c4.test-airoapp.ai/files/uploads/app-1/badge.png?sig=x' },
          { mediaType: 'IMAGE', sourceType: 'upload', imageUrl: 'https://app-1.agent.c4.test-airoapp.ai/files/uploads/app-1/lettering.png?sig=y' },
        ],
      }],
    };

    it('resolves uploaded images from context and passes as references.inspiration', async () => {
      const { generateLogoTool } = await import('../index.js');

      await generateLogoTool.execute(
        { prompt: 'a logo', layout: 'horizontal' },
        contextWithUploads,
      );

      expect(mockStart).toHaveBeenCalledWith(
        expect.objectContaining({
          references: {
            inspiration: [
              'https://app-1.agent.c4.test-airoapp.ai/files/uploads/app-1/badge.png?sig=x',
              'https://app-1.agent.c4.test-airoapp.ai/files/uploads/app-1/lettering.png?sig=y',
            ],
          },
        }),
      );
    });

    it('does not set references when no uploads in context', async () => {
      const { generateLogoTool } = await import('../index.js');

      await generateLogoTool.execute(
        { prompt: 'a logo', layout: 'horizontal' },
        baseContext,
      );

      const callArg: Record<string, unknown> = mockStart.mock.calls[0][0];
      expect(callArg).not.toHaveProperty('references');
    });

    it('ignores non-IMAGE and non-upload assets', async () => {
      const contextWithMixed = {
        ...baseContext,
        contextAttachments: [{
          type: 'selected_assets',
          data: [
            { mediaType: 'IMAGE', sourceType: 'upload', imageUrl: 'https://example.com/real.png' },
            { mediaType: 'PDF', sourceType: 'upload', imageUrl: 'https://example.com/doc.pdf' },
            { mediaType: 'IMAGE', sourceType: 'stock', imageUrl: 'https://example.com/stock.png' },
          ],
        }],
      };

      const { generateLogoTool } = await import('../index.js');

      await generateLogoTool.execute(
        { prompt: 'a logo', layout: 'horizontal' },
        contextWithMixed,
      );

      expect(mockStart).toHaveBeenCalledWith(
        expect.objectContaining({
          references: { inspiration: ['https://example.com/real.png'] },
        }),
      );
    });
  });

  describe('async kickoff', () => {
    beforeEach(() => {
      mockStart.mockResolvedValue({ status: 'queued', jobId: 'job-1', slots: ['logo/horizontal'], done: Promise.resolve() });
    });

    it('returns a started ack (does not block on generation)', async () => {
      const { generateLogoTool } = await import('../index.js');
      const result = await generateLogoTool.execute({ prompt: 'logo', layout: 'horizontal' }, baseContext);
      expect(result.structuredContent).toMatchObject({
        started: true, jobId: 'job-1', slots: ['logo/horizontal'], status: 'queued',
      });
      expect(result.text).toBeTruthy();
    });

    it('starts the job with the resolved prompt, layouts, customer and budget user', async () => {
      const { generateLogoTool } = await import('../index.js');
      await generateLogoTool.execute({ prompt: 'logo', layout: 'horizontal' }, baseContext);
      expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({
        appId: 'app-1',
        layouts: ['horizontal'],
        customerId: expect.any(String),
        budgetUserId: expect.any(String),
        searchQuery: expect.any(String),
      }));
    });

    it('surfaces a start error', async () => {
      mockStart.mockResolvedValueOnce({ status: 'error', error: 'Workspace unavailable for logo generation' });
      const { generateLogoTool } = await import('../index.js');
      const result = await generateLogoTool.execute({ prompt: 'logo', layout: 'horizontal' }, baseContext);
      expect(result.error).toBe('Workspace unavailable for logo generation');
    });
  });

  describe('synchronous mode (background: false)', () => {
    // The sync path reports THIS job's outcome via the `done` promise, not a
    // per-app job-file read — so a supersede can't make it report a newer job.
    const withOutcome = (outcome: unknown) =>
      mockStart.mockResolvedValue({
        status: 'queued', jobId: 'job-1', slots: ['logo/horizontal'], done: Promise.resolve(outcome),
      });

    it('waits for the run to settle and returns the completed result', async () => {
      const mockLogo = { id: 'logo-xyz', urls: { horizontal: { transparent: 'https://cdn/t.png' } } };
      withOutcome({ status: 'completed', jobId: 'job-1', logoId: 'logo-xyz', logo: mockLogo, sessionId: 'sess-1', slotSaveFailed: false, failedLayouts: [] });
      const { generateLogoTool } = await import('../index.js');
      const result = await generateLogoTool.execute(
        { prompt: 'logo', layout: 'horizontal', background: false }, baseContext,
      );
      expect(result.error).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        started: true, jobId: 'job-1', slots: ['logo/horizontal'], status: 'completed', logoId: 'logo-xyz', logo: mockLogo, sessionId: 'sess-1',
      });
    });

    it('surfaces a partial slot-save failure instead of reporting clean success', async () => {
      const mockLogo = { id: 'logo-xyz', urls: { horizontal: { transparent: 'https://cdn/t.png' } } };
      withOutcome({ status: 'completed', jobId: 'job-1', logoId: 'logo-xyz', logo: mockLogo, sessionId: 'sess-1', slotSaveFailed: true, failedLayouts: ['vertical'] });
      const { generateLogoTool } = await import('../index.js');
      const result = await generateLogoTool.execute(
        { prompt: 'logo', layout: 'all', background: false }, baseContext,
      );
      expect(result.error).toBeUndefined();
      expect(result.text).toMatch(/failed to save/i);
      expect(result.structuredContent).toMatchObject({ status: 'completed', slotSaveFailed: true, failedLayouts: ['vertical'] });
    });

    it('returns an error when the synchronous run failed', async () => {
      withOutcome({ status: 'failed', jobId: 'job-1' });
      const { generateLogoTool } = await import('../index.js');
      const result = await generateLogoTool.execute(
        { prompt: 'logo', layout: 'horizontal', background: false }, baseContext,
      );
      expect(result.error).toBeTruthy();
      expect(result.structuredContent).toMatchObject({ status: 'failed' });
    });

    it('reports cancellation distinctly', async () => {
      withOutcome({ status: 'cancelled', jobId: 'job-1' });
      const { generateLogoTool } = await import('../index.js');
      const result = await generateLogoTool.execute(
        { prompt: 'logo', layout: 'horizontal', background: false }, baseContext,
      );
      expect(result.error).toContain('cancelled');
      expect(result.structuredContent).toMatchObject({ status: 'cancelled' });
    });

    it('reports supersede distinctly (does not misreport a newer job as this call)', async () => {
      withOutcome({ status: 'superseded', jobId: 'job-1' });
      const { generateLogoTool } = await import('../index.js');
      const result = await generateLogoTool.execute(
        { prompt: 'logo', layout: 'horizontal', background: false }, baseContext,
      );
      expect(result.error).toMatch(/superseded/i);
      expect(result.structuredContent).toMatchObject({ status: 'superseded' });
    });
  });

  describe('#toModelOutput', () => {
    it('is defined on the tool', async () => {
      const { generateLogoTool } = await import('../index.js');
      expect(typeof generateLogoTool.toModelOutput).toBe('function');
    });

    it('projects a completed result to a lean model view (status + slots, no internal ids)', async () => {
      const { generateLogoTool } = await import('../index.js');

      // Representative completed execute() output (async job model on main).
      const full = {
        text: 'Logo generated and saved to the brand slots.',
        structuredContent: {
          started: true,
          jobId: 'job-1',
          slots: ['logo/horizontal'],
          status: 'completed',
          logoId: 'logo-xyz',
        },
      };

      const projected = generateLogoTool.toModelOutput!({
        toolCallId: '1',
        input: { prompt: 'logo', layout: 'horizontal' },
        output: full,
      });

      expect(projected.type).toBe('text');
      const lean = JSON.parse(projected.value);

      expect(lean).toMatchObject({
        text: 'Logo generated and saved to the brand slots.',
        status: 'completed',
        slots: ['logo/horizontal'],
        slotSaveFailed: false,
      });

      // Internal job/logo bookkeeping never reaches the model.
      expect(lean.jobId).toBeUndefined();
      expect(lean.logoId).toBeUndefined();
      expect(lean.started).toBeUndefined();
      expect(projected.value).not.toContain('job-1');
      expect(projected.value).not.toContain('logo-xyz');
    });

    it('passes an error result through unchanged', async () => {
      const { generateLogoTool } = await import('../index.js');

      const projected = generateLogoTool.toModelOutput!({
        toolCallId: '1',
        input: { prompt: 'logo', layout: 'horizontal' },
        output: { error: 'Logo generation failed' },
      });

      expect(JSON.parse(projected.value)).toEqual({ error: 'Logo generation failed' });
    });
  });
});
