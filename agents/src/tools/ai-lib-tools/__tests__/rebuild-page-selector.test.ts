import { describe, it, expect, vi, beforeEach } from 'vitest';

// createTool wraps (desc, schema, fn) — expose the handler as `.execute` so we
// can invoke the tool directly (mirrors font-theme.test.ts).
vi.mock('@airo/ai-lib', () => ({
  createTool: (_desc: string, _schema: unknown, fn: any) => ({ execute: fn }),
}));

const mockFindById = vi.fn();
// `function` (not arrow) — these classes are instantiated with `new`, and arrows
// aren't constructors.
vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn(function (this: any) { this.findById = mockFindById; }),
}));

const mockBuildPage = vi.fn();
vi.mock('../../../services/RebuildOrchestrationService.js', () => ({
  RebuildOrchestrationService: vi.fn(function (this: any) { this.buildPage = mockBuildPage; }),
}));

const mockView = vi.fn();
const mockReadText = vi.fn();
vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(),
}));

vi.mock('../../../services/DevSupervisorClient.js', () => ({
  DevSupervisorError: class extends Error { code = 'unknown'; },
}));

import { createStubWorkspaceFiles } from '../../../workspace/__tests__/test-workspace-files.js'
import { createForWorkspace } from '../../../workspace/index.js'
vi.mocked(createForWorkspace).mockReturnValue({ files: createStubWorkspaceFiles({ view: mockView, readText: mockReadText }) } as any)

const { rebuildPageSelectorAITool } = await import('../rebuild-page-selector.js');

type WorkflowState = { pagesBuilt: string[]; sourceUrl?: string; currentPage?: string | null };
type Sitemap = { pages: Array<{ slug: string; title?: string; url?: string; scraped: boolean }>; totalPages?: number };

// Configure the workspace file reads. Passing `null` for either file makes its
// `view` throw, which `loadWorkflowState`/`loadSitemap` swallow into a null —
// the precondition for the "no workflow"/"no sitemap" early returns.
function setWorkspace(opts: { workflowState?: WorkflowState | null; sitemap?: Sitemap | null }) {
  const workflowState = opts.workflowState === undefined
    ? { pagesBuilt: ['homepage'], sourceUrl: 'https://x.com', currentPage: 'homepage' }
    : opts.workflowState;
  const sitemap = opts.sitemap === undefined
    ? { pages: [{ slug: 'about', title: 'About', url: 'https://x.com/about', scraped: true }], totalPages: 2 }
    : opts.sitemap;

  mockReadText.mockImplementation(({ path }: { path: string }) => {
    const data = path.includes('workflow-state') ? workflowState : sitemap;
    if (data === null) throw new Error('not_found');
    return JSON.stringify(data);
  });
}

const ctx = { metadata: { appId: 'app1' } };
const run = (input: Record<string, unknown>) => (rebuildPageSelectorAITool as any).execute(input, ctx);

describe('rebuildPageSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById.mockReturnValue({ id: 'app1', path: '/apps/app1' });
    mockBuildPage.mockResolvedValue('SOURCE PAGE PROMPT');
    setWorkspace({});
  });

  describe('build mode', () => {
    it('builds the page from source and returns the generated prompt', async () => {
      const result: any = await run({ mode: 'build', pageSlug: 'about' });

      expect(mockBuildPage).toHaveBeenCalledWith('app1', 'about');
      expect(result.success).toBe(true);
      expect(result.pagePrompt).toBe('SOURCE PAGE PROMPT');
    });

    it('throws when pageSlug is missing', async () => {
      await expect(run({ mode: 'build' })).rejects.toThrow('pageSlug is required');
      expect(mockBuildPage).not.toHaveBeenCalled();
    });

    it('returns failure when the page is not in the sitemap', async () => {
      const result: any = await run({ mode: 'build', pageSlug: 'contact' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Page not found: contact');
      expect(mockBuildPage).not.toHaveBeenCalled();
    });

    it('returns failure when the page was discovered but not scraped', async () => {
      setWorkspace({ sitemap: { pages: [{ slug: 'about', scraped: false }] } });

      const result: any = await run({ mode: 'build', pageSlug: 'about' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Page was not scraped: about');
      expect(mockBuildPage).not.toHaveBeenCalled();
    });

    it('re-delivers the prompt when the page prompt was already generated', async () => {
      setWorkspace({
        workflowState: { pagesBuilt: ['homepage', 'about'] },
        sitemap: { pages: [{ slug: 'about', scraped: true }] },
      });

      const result: any = await run({ mode: 'build', pageSlug: 'about' });

      expect(result.success).toBe(true);
      expect(result.pagePrompt).toBe('SOURCE PAGE PROMPT');
      expect(mockBuildPage).toHaveBeenCalledWith('app1', 'about');
    });
  });

  describe('show mode', () => {
    it('lists unbuilt scraped pages', async () => {
      const result: any = await run({ mode: 'show' });

      expect(result.success).toBe(true);
      expect(result.allPagesBuilt).toBeUndefined();
      expect(result.availablePages.map((p: any) => p.slug)).toEqual(['about']);
      expect(result.widget.widgetType).toBe('rebuild-page-selector');
    });

    it('reports allPagesBuilt when nothing is left to build', async () => {
      setWorkspace({
        workflowState: { pagesBuilt: ['homepage', 'about'] },
        sitemap: { pages: [{ slug: 'about', scraped: true }] },
      });

      const result: any = await run({ mode: 'show' });

      expect(result.success).toBe(true);
      expect(result.allPagesBuilt).toBe(true);
      expect(result.availablePages).toBeUndefined();
    });
  });

  describe('early returns', () => {
    it('returns failure when no rebuild workflow exists', async () => {
      setWorkspace({ workflowState: null });

      const result: any = await run({ mode: 'show' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No rebuild workflow found');
    });

    it('returns failure when the sitemap is missing', async () => {
      setWorkspace({ sitemap: null });

      const result: any = await run({ mode: 'show' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No sitemap found');
    });
  });
});
