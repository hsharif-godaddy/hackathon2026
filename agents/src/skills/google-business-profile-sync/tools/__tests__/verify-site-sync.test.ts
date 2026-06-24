import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockFindById = vi.fn();
const mockScrape = vi.fn();
const mockSearch = vi.fn();
const mockCreateForWorkspace = vi.fn();

vi.mock('../../../../logging/index.js', () => {
  const instance = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => instance };
  return { logger: instance, Logger: { create: () => instance } };
});

vi.mock('../../../../database/repositories/index.js', () => ({
  appRepository: { findById: (...args: unknown[]) => mockFindById(...args) },
}));

vi.mock('../../../../workspace/index.js', () => ({
  createForWorkspace: (...args: unknown[]) => mockCreateForWorkspace(...args),
}));

vi.mock('../../../../tools/ai-lib-tools/drivers/website-scraper-driver.js', () => ({
  WebsiteScraperDriver: class {
    scrapeAndScreenshot(...args: unknown[]) {
      return mockScrape(...args);
    }
  },
}));

import { verifySiteSyncTool } from '../verify-site-sync.js';

const CTX = { metadata: { appId: 'app1' } };

function run(input: Record<string, unknown>, context: Record<string, unknown> = CTX) {
  return verifySiteSyncTool.execute(input, context);
}

describe('google-business-profile-sync verifySiteSync tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById.mockReturnValue({ id: 'app1', previewUrl: 'https://preview.example.com' });
    mockSearch.mockResolvedValue([]);
    mockCreateForWorkspace.mockReturnValue({ files: { search: mockSearch } });
  });

  describe('execute', () => {
    it('returns error when appId is missing', async () => {
      const result = await run({ field: 'phone', expectedValue: '(555) 123-9999' }, { metadata: {} });
      expect(result).toMatchObject({ success: false, error: 'App ID is required' });
    });

    it('skips the scrape and verifies via source when there is no preview URL (#1)', async () => {
      mockFindById.mockReturnValue({ id: 'app1', previewUrl: undefined, publishedUrl: undefined });
      // Old value gone, new value present → confirmed via source despite no URL to scrape.
      mockSearch.mockImplementation(({ pattern }: { pattern: string }) =>
        Promise.resolve(pattern.includes('Old') ? [] : [{ path: 'src/Footer.tsx', line: 1, column: 1, preview: '' }])
      );

      const result = await run({ field: 'address', expectedValue: '123 New St', previousValue: '123 Old St' });

      expect(result).toMatchObject({ success: true, ok: true, verifiedVia: 'source' });
      expect(mockScrape).not.toHaveBeenCalled();
    });

    it('falls back to publishedUrl when previewUrl is absent', async () => {
      mockFindById.mockReturnValue({ id: 'app1', previewUrl: undefined, publishedUrl: 'https://published.example.com' });
      mockScrape.mockResolvedValue({ success: true, sanitizedContent: 'Acme Plumbing', html: '' });

      const result = await run({ field: 'name', expectedValue: 'Acme Plumbing', pollMs: 1, timeoutMs: 50 });

      expect(result).toMatchObject({ ok: true, verifiedVia: 'preview', sourceUrl: 'https://published.example.com' });
    });

    it('cannot verify (ok:false) when there is no URL and no previousValue to check source', async () => {
      mockFindById.mockReturnValue({ id: 'app1', previewUrl: undefined, publishedUrl: undefined });
      const result = await run({ field: 'name', expectedValue: 'Acme' });
      expect(result).toMatchObject({ success: true, ok: false, leftoverFiles: [] });
      expect(mockScrape).not.toHaveBeenCalled();
    });

    it('verifies on the first poll when the value is present (phone by digits)', async () => {
      mockScrape.mockResolvedValue({ success: true, sanitizedContent: 'Call us at (555) 123-9999 today', html: '' });
      const result = await run({ field: 'phone', expectedValue: '+1 (555) 123-9999', pollMs: 1, timeoutMs: 50 });
      expect(result).toMatchObject({ success: true, ok: true, field: 'phone', attempts: 1, sourceUrl: 'https://preview.example.com' });
      expect(mockScrape).toHaveBeenCalledTimes(1);
    });

    it('verifies a non-phone field by case-insensitive substring', async () => {
      mockScrape.mockResolvedValue({ success: true, sanitizedContent: 'Welcome to ACME PLUMBING', html: '' });
      const result = await run({ field: 'name', expectedValue: 'Acme Plumbing', pollMs: 1, timeoutMs: 50 });
      expect(result).toMatchObject({ ok: true });
    });

    it('times out and reports leftover source files when the value never appears', async () => {
      mockScrape.mockResolvedValue({ success: true, sanitizedContent: 'old content (555) 123-4567', html: '' });
      mockSearch.mockResolvedValue([
        { path: 'src/components/Footer.tsx', line: 10, column: 1, preview: '' },
        { path: 'src/components/Footer.tsx', line: 12, column: 1, preview: '' },
      ]);

      const result = await run(
        { field: 'phone', expectedValue: '(555) 123-9999', previousValue: '(555) 123-4567', pollMs: 1, timeoutMs: 5 }
      );

      expect(result).toMatchObject({ success: true, ok: false, leftoverFiles: ['src/components/Footer.tsx'] });
      expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ pattern: '\\(555\\) 123-4567' }));
    });

    it('confirms via source when the old value is gone AND the new value is present (#3)', async () => {
      mockScrape.mockRejectedValue(new Error('preview unreachable')); // scraper can never confirm
      // Old value gone, new value present in source → edit applied.
      mockSearch.mockImplementation(({ pattern }: { pattern: string }) =>
        Promise.resolve(pattern.includes('Old') ? [] : [{ path: 'src/Footer.tsx', line: 1, column: 1, preview: '' }])
      );

      const result = await run(
        { field: 'address', expectedValue: '123 New St', previousValue: '123 Old St', pollMs: 1, timeoutMs: 5 }
      );

      expect(result).toMatchObject({ success: true, ok: true, field: 'address', verifiedVia: 'source' });
      expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ pattern: '123 Old St' }));
      expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ pattern: '123 New St' }));
    });

    it('does NOT confirm via source when the old value is gone but the new value is absent (#1)', async () => {
      mockScrape.mockRejectedValue(new Error('preview unreachable'));
      mockSearch.mockResolvedValue([]); // old gone, but new value also not found (mangled edit / deleted line)

      const result = await run(
        { field: 'address', expectedValue: '123 New St', previousValue: '123 Old St', pollMs: 1, timeoutMs: 5 }
      );

      expect(result).toMatchObject({ success: true, ok: false, leftoverFiles: [] });
    });

    it('times out with empty leftoverFiles when no previousValue is given', async () => {
      mockScrape.mockResolvedValue({ success: true, sanitizedContent: 'nope', html: '' });
      const result = await run({ field: 'name', expectedValue: 'Acme', pollMs: 1, timeoutMs: 5 });
      expect(result).toMatchObject({ ok: false, leftoverFiles: [] });
      expect(mockSearch).not.toHaveBeenCalled();
    });

    it('keeps polling through scrape errors', async () => {
      mockScrape
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValue({ success: true, sanitizedContent: 'Acme Plumbing', html: '' });
      const result = await run({ field: 'name', expectedValue: 'Acme Plumbing', pollMs: 1, timeoutMs: 50 });
      expect(result).toMatchObject({ ok: true });
      expect(mockScrape.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('computeState', () => {
    it('returns site-verified on ok', () => {
      const state = verifySiteSyncTool.computeState?.({}, { success: true, ok: true, field: 'phone', attempts: 1, sourceUrl: 'u' });
      expect(state).toMatchObject({ workflowState: 'site-verified', verifiedField: 'phone', nextStep: 'sync-next-field' });
    });

    it('returns site-verify-incomplete with leftover count on timeout', () => {
      const state = verifySiteSyncTool.computeState?.(
        {},
        { success: true, ok: false, field: 'phone', attempts: 3, sourceUrl: 'u', leftoverFiles: ['a.tsx'] }
      );
      expect(state).toMatchObject({ workflowState: 'site-verify-incomplete', leftoverCount: 1, nextStep: 'report-leftovers' });
    });

    it('returns site-verify-failed on error', () => {
      const state = verifySiteSyncTool.computeState?.({}, { success: false, error: 'no preview' });
      expect(state).toMatchObject({ workflowState: 'site-verify-failed', nextStep: 'retry-verify' });
    });
  });
});
