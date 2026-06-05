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

describe('media-logo generate_logo tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFindById.mockReturnValue({ id: 'app-1', customerId: 'cust-1' });
    mockGetCurrentUserId.mockReturnValue('budget-user-1');

    mockAppPlanExecute.mockResolvedValue({ success: false });
    mockMemoryGet.mockResolvedValue({ success: true, exists: false });

    mockGetSlot.mockResolvedValue({ success: false });
    mockSetSlot.mockResolvedValue({ success: true });

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
            reversed: '/airo-assets/uploads/logo-sess-1-horizontal.png',
            reversedSolid: '/airo-assets/uploads/logo-sess-1-horizontal.png',
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
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('returns an error when the app has no customerId', async () => {
      mockFindById.mockReturnValueOnce({ id: 'app-1' }); // no customerId

      const { generateLogoTool } = await import('../index.js');

      const result = await generateLogoTool.execute(
        { prompt: 'a logo', layout: 'horizontal' },
        baseContext,
      );

      expect(result.error).toMatch(/customer/i);
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('returns an error when grants are exhausted', async () => {
      mockGetCurrentUserId.mockReturnValueOnce(undefined);

      const { generateLogoTool } = await import('../index.js');

      const result = await generateLogoTool.execute(
        { prompt: 'a logo', layout: 'horizontal' },
        baseContext,
      );

      expect(result.error).toMatch(/credit/i);
      expect(mockGenerate).not.toHaveBeenCalled();
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

      const callArg = mockGenerate.mock.calls[0][0];
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

      const callArg = mockGenerate.mock.calls[0][0];
      expect(callArg.prompt).toContain('primary #000');
      expect(callArg.prompt).toContain('accent #FFF');
    });

    it('skips the suffix entirely when no palette is available', async () => {
      const { generateLogoTool } = await import('../index.js');

      await generateLogoTool.execute(
        { prompt: 'a logo', layout: 'horizontal' },
        baseContext,
      );

      const callArg = mockGenerate.mock.calls[0][0];
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

      const callArg = mockGenerate.mock.calls[0][0];
      expect(callArg.prompt.length).toBeLessThanOrEqual(2000);
    });
  });

  describe('layout expansion', () => {
    it('expands layout: "all" into [square, horizontal, vertical]', async () => {
      mockGenerate.mockResolvedValueOnce({
        sessionId: 'sess-1',
        logo: {
          id: 'l-1', generatedAt: 'now', prompt: 'p', modelUsed: 'gpt-image-2',
          urls: {
            square: stubVariants('s.png'),
            horizontal: stubVariants('h.png'),
            vertical: stubVariants('v.png'),
          },
        },
      });

      const { generateLogoTool } = await import('../index.js');

      await generateLogoTool.execute(
        { prompt: 'logo', layout: 'all' },
        baseContext,
      );

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ layout: ['square', 'horizontal', 'vertical'] }),
      );
    });

    it('passes a single layout through verbatim', async () => {
      const { generateLogoTool } = await import('../index.js');

      await generateLogoTool.execute(
        { prompt: 'logo', layout: 'vertical' },
        baseContext,
      );

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ layout: ['vertical'] }),
      );
    });
  });

  describe('referenceUrl resolution', () => {
    it('passes caller-provided referenceUrl through unchanged', async () => {
      const { generateLogoTool } = await import('../index.js');

      await generateLogoTool.execute(
        {
          prompt: 'iterate',
          layout: 'horizontal',
          referenceUrl: 'https://app-1.agent.c4.test-airoapp.ai/files/uploads/app-1/foo.png?sig=x',
        },
        baseContext,
      );

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          referenceUrl: 'https://app-1.agent.c4.test-airoapp.ai/files/uploads/app-1/foo.png?sig=x',
        }),
      );
    });

    it('auto-resolves referenceUrl from the saved logo slot when omitted', async () => {
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

      const { generateLogoTool } = await import('../index.js');

      await generateLogoTool.execute(
        { prompt: 'make it blue', layout: 'horizontal' },
        baseContext,
      );

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ referenceUrl: '/airo-assets/uploads/existing-logo.png' }),
      );
    });

    it('falls back to the horizontal logo when reformatting to square and no square slot exists yet', async () => {
      // "Set as my logo" flow: the user has only generated a horizontal logo
      // (slot logo/horizontal). The square slot (logo/primary) is still empty.
      // Reformatting to square must seed from the existing horizontal logo.
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
        // square (logo/primary) and vertical slots have not been generated yet
        return { success: false };
      });

      const { generateLogoTool } = await import('../index.js');

      await generateLogoTool.execute(
        {
          prompt: 'Reformat for a square layout, preserving the existing icon design and arranging the text as required',
          layout: 'square',
        },
        baseContext,
      );

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ referenceUrl: '/airo-assets/uploads/horizontal-logo.png' }),
      );
    });

    it('prefers the horizontal slot over other orientations as the cross-layout fallback', async () => {
      // Square requested, square slot empty, but BOTH horizontal and vertical
      // logos exist. The canonical (horizontal) logo should win.
      const makeSlot = (currentUrl: string) => ({
        success: true,
        slot: {
          mediaType: 'logo',
          currentUrl,
          alternatives: [],
          searchQuery: '',
          userModified: false,
          createdAt: '',
          lastUpdated: '',
          logoSourceMap: { [currentUrl]: { sessionId: 's', logoId: 'l' } },
        },
      });
      mockGetSlot.mockImplementation(async (_appId: string, path: string) => {
        if (path === 'logo/horizontal') return makeSlot('/airo-assets/uploads/horizontal-logo.png');
        if (path === 'logo/vertical') return makeSlot('/airo-assets/uploads/vertical-logo.png');
        return { success: false }; // square (logo/primary) empty
      });

      const { generateLogoTool } = await import('../index.js');

      await generateLogoTool.execute(
        { prompt: 'Reformat for a square layout', layout: 'square' },
        baseContext,
      );

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ referenceUrl: '/airo-assets/uploads/horizontal-logo.png' }),
      );
    });

    it('falls through to no referenceUrl when slot has no logoSourceMap entry', async () => {
      mockGetSlot.mockResolvedValue({
        success: true,
        slot: {
          mediaType: 'logo',
          currentUrl: '/airo-assets/uploads/orphan.png',
          alternatives: [],
          searchQuery: '',
          userModified: false,
          createdAt: '',
          lastUpdated: '',
          // logoSourceMap absent
        },
      });

      const { generateLogoTool } = await import('../index.js');

      const result = await generateLogoTool.execute(
        { prompt: 'logo', layout: 'horizontal' },
        baseContext,
      );

      const callArg = mockGenerate.mock.calls[0][0];
      expect(callArg.referenceUrl).toBeUndefined();
      // An intended edit silently became a fresh design — the result text must
      // tell the agent so it can warn the user (not pretend it was a tweak).
      expect(result.text).toMatch(/brand-new design/i);
    });

    it('rejects an http (non-https) referenceUrl', async () => {
      const { generateLogoTool } = await import('../index.js');

      const result = await generateLogoTool.execute(
        { prompt: 'logo', layout: 'horizontal', referenceUrl: 'http://example.com/x.png' },
        baseContext,
      );

      expect(result.error).toMatch(/https/);
      expect(mockGenerate).not.toHaveBeenCalled();
    });
  });

  describe('slot save', () => {
    it('writes a slot per generated layout', async () => {
      mockGenerate.mockResolvedValueOnce({
        sessionId: 'sess-1',
        logo: {
          id: 'l-1', generatedAt: 'now', prompt: 'p', modelUsed: 'gpt-image-2',
          urls: {
            square: stubVariants('s.png'),
            horizontal: stubVariants('h.png'),
          },
        },
      });

      const { generateLogoTool } = await import('../index.js');

      await generateLogoTool.execute(
        { prompt: 'logo', layout: 'all' },
        baseContext,
      );

      const slotCalls = mockSetSlot.mock.calls.map(([appId, path]) => ({ appId, path }));
      expect(slotCalls).toEqual(
        expect.arrayContaining([
          { appId: 'app-1', path: 'logo/primary' },
          { appId: 'app-1', path: 'logo/horizontal' },
        ]),
      );
    });

    it('records logoSourceMap so a later edit can auto-resolve', async () => {
      const { generateLogoTool } = await import('../index.js');

      await generateLogoTool.execute(
        { prompt: 'logo', layout: 'horizontal' },
        baseContext,
      );

      const slotPayload = mockSetSlot.mock.calls[0][2];
      expect(slotPayload.logoSourceMap).toBeDefined();
      expect(Object.values(slotPayload.logoSourceMap)).toEqual([
        { sessionId: 'sess-1', logoId: 'logo-abc' },
      ]);
    });

    it('returns slotSaveFailed: true when the slot write throws', async () => {
      mockSetSlot.mockRejectedValueOnce(new Error('disk full'));

      const { generateLogoTool } = await import('../index.js');

      const result = await generateLogoTool.execute(
        { prompt: 'logo', layout: 'horizontal' },
        baseContext,
      );

      expect(result.structuredContent?.slotSaveFailed).toBe(true);
      expect(result.text).toMatch(/slot save failed/i);
    });
  });

  describe('output shape', () => {
    it('returns text + structuredContent on success', async () => {
      const { generateLogoTool } = await import('../index.js');

      const result = await generateLogoTool.execute(
        { prompt: 'logo', layout: 'horizontal' },
        baseContext,
      );

      expect(result.structuredContent).toMatchObject({
        sessionId: 'sess-1',
        slotUrl: '/airo-assets/images/logo/horizontal',
        slotPath: 'logo/horizontal',
        savedSlots: { horizontal: '/airo-assets/images/logo/horizontal' },
        slotSaveFailed: false,
      });
      expect(result.structuredContent?.logo).toMatchObject({ id: 'logo-abc' });
      expect(result.text).toBeTruthy();
    });
  });
});

function stubVariants(base: string) {
  const url = `/airo-assets/uploads/${base}`;
  return {
    transparent: url, solid: url, reversed: url,
    reversedSolid: url, mockup: url, landscapeMockup: url,
  };
}
