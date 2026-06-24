import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockSearch = vi.fn();
const mockView = vi.fn();
const mockCreateForWorkspace = vi.fn();

vi.mock('../../../../logging/index.js', () => {
  const instance = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => instance };
  return { logger: instance, Logger: { create: () => instance } };
});

vi.mock('../../../../workspace/index.js', () => ({
  createForWorkspace: (...args: unknown[]) => mockCreateForWorkspace(...args),
}));

// parseJsonLdBlocks / flattenSchemaNodes / extractKeyContent run for real (no mock).

import { getSiteBusinessInfoTool } from '../get-site-business-info.js';

const JSONLD_SOURCE = `export default function Layout() { return (<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  name: 'Acme Plumbing',
  telephone: '(555) 123-4567',
  url: 'https://acme-plumbing.com',
  address: { '@type': 'PostalAddress', streetAddress: '123 Main St', addressLocality: 'Phoenix', addressRegion: 'AZ', postalCode: '85001' },
})}</script>); }`;

const CONTACT_SOURCE =
  'export const Footer = () => (<footer>Call us at (555) 999-0000. Visit 100 Market Street, San Francisco, CA 94105. Hours: Mon-Fri 9:00 AM - 5:00 PM</footer>);';

function matches(...paths: string[]) {
  return paths.map((path) => ({ path, line: 1, column: 1, preview: '' }));
}

function viewOf(map: Record<string, string>) {
  return ({ path }: { path: string }) =>
    Promise.resolve({ path, content: map[path] ?? '', encoding: 'utf-8', lines: 1, size: 1, truncated: false });
}

const CTX = { metadata: { appId: 'app1' } };
function run(context: Record<string, unknown> = CTX) {
  return getSiteBusinessInfoTool.execute({}, context);
}

describe('google-business-profile-sync getSiteBusinessInfo tool (source-first)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateForWorkspace.mockReturnValue({ files: { search: mockSearch, view: mockView } });
    mockSearch.mockResolvedValue(matches('src/Layout.tsx'));
    mockView.mockImplementation(viewOf({ 'src/Layout.tsx': JSONLD_SOURCE }));
  });

  describe('execute', () => {
    it('returns error when appId is missing', async () => {
      const result = await run({ metadata: {} });
      expect(result).toMatchObject({ success: false, error: 'App ID is required' });
    });

    it('errors when the workspace is unavailable', async () => {
      mockCreateForWorkspace.mockReturnValue(null);
      const result = await run();
      expect(result).toMatchObject({ success: false });
      expect(result.error).toContain('Workspace');
    });

    it('returns an empty (non-error) read when the site has no business info, so the diff can offer to add it from Google', async () => {
      mockSearch.mockResolvedValue([]);
      const result = await run();
      // Not an error: empty success → diff surfaces every GBP field as gbp-only ("add to site").
      expect(result).toMatchObject({ success: true, source: 'source', jsonLd: null, textBlob: '', filesScanned: [] });
      expect(mockView).not.toHaveBeenCalled();
    });

    it('searches the source for business-info signals and reports source=source', async () => {
      const result = await run();
      expect(result).toMatchObject({ success: true, source: 'source' });
      expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ includeGlobs: expect.arrayContaining(['**/*.tsx']) }));
      expect(result.filesScanned).toContain('src/Layout.tsx');
    });

    it('extracts a LocalBusiness JSON-LD node from the source when present', async () => {
      const result = await run();
      expect(result.success).toBe(true);
      expect(result.jsonLd).toMatchObject({ name: 'Acme Plumbing', telephone: '(555) 123-4567', url: 'https://acme-plumbing.com' });
      expect((result.jsonLd.address as Record<string, unknown>).streetAddress).toBe('123 Main St');
    });

    it('falls back to a text blob (Phone/Address) when the source has no JSON-LD', async () => {
      mockSearch.mockResolvedValue(matches('src/Footer.tsx'));
      mockView.mockImplementation(viewOf({ 'src/Footer.tsx': CONTACT_SOURCE }));
      const result = await run();
      expect(result.success).toBe(true);
      expect(result.jsonLd).toBeNull();
      expect(result.textBlob).toContain('(555) 999-0000');
      expect(result.textBlob).toContain('Phone:');
    });

    it('concatenates multiple matched files and dedupes paths across patterns', async () => {
      // Every pattern search returns the same two files → deduped to two views.
      mockSearch.mockResolvedValue(matches('src/Footer.tsx', 'src/Layout.tsx'));
      mockView.mockImplementation(viewOf({ 'src/Footer.tsx': CONTACT_SOURCE, 'src/Layout.tsx': JSONLD_SOURCE }));
      const result = await run();
      expect(result.success).toBe(true);
      expect(result.filesScanned.sort()).toEqual(['src/Footer.tsx', 'src/Layout.tsx']);
      // JSON-LD from Layout + phone text from Footer both available
      expect(result.jsonLd?.name).toBe('Acme Plumbing');
      expect(result.textBlob).toContain('(555) 999-0000');
    });

    it('caps files read at MAX_SOURCE_FILES and truncates deterministically (#6)', async () => {
      const paths = Array.from({ length: 17 }, (_, i) => `src/f${String(i).padStart(2, '0')}.tsx`);
      mockSearch.mockResolvedValue(matches(...paths));
      mockView.mockImplementation(viewOf({ 'src/f00.tsx': JSONLD_SOURCE }));

      const result = await run();

      expect(result.success).toBe(true);
      // Sorted, so the first 15 (f00..f14) are read; f15/f16 dropped (logged).
      expect(result.filesScanned).toEqual(paths.slice(0, 15));
      expect(mockView).toHaveBeenCalledTimes(15);
    });

    it('merges fields across Organization + LocalBusiness JSON-LD nodes (#3)', async () => {
      // Templates split: Organization carries url, LocalBusiness carries address/phone.
      const orgNode = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme Plumbing', url: 'https://acme-plumbing.com' });
      const localNode = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        name: 'Acme Plumbing',
        telephone: '(555) 123-4567',
        address: { '@type': 'PostalAddress', streetAddress: '123 Main St', addressLocality: 'Phoenix', addressRegion: 'AZ', postalCode: '85001' },
      });
      const source = `<script type="application/ld+json">${orgNode}</script><script type="application/ld+json">${localNode}</script>`;
      mockSearch.mockResolvedValue(matches('src/Layout.tsx'));
      mockView.mockImplementation(viewOf({ 'src/Layout.tsx': source }));

      const result = await run();

      expect(result.success).toBe(true);
      // url borrowed from Organization, address/phone from LocalBusiness — neither dropped.
      expect(result.jsonLd?.url).toBe('https://acme-plumbing.com');
      expect(result.jsonLd?.telephone).toBe('(555) 123-4567');
      expect(result.jsonLd?.address).toBeDefined();
    });

    it('reads description from JSON-LD (#description)', async () => {
      const src = `<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        name: 'Acme Plumbing',
        telephone: '(555) 123-4567',
        description: 'Family-owned plumbing since 1990.',
      })}</script>`;
      mockSearch.mockResolvedValue(matches('src/Layout.tsx'));
      mockView.mockImplementation(viewOf({ 'src/Layout.tsx': src }));

      const result = await run();

      expect(result.jsonLd?.description).toBe('Family-owned plumbing since 1990.');
    });

    it('falls back to the meta description when JSON-LD has none (#description)', async () => {
      const src = '<meta name="description" content="Best tacos in town."><footer>Call (555) 999-0000</footer>'
      mockSearch.mockResolvedValue(matches('src/index.html'));
      mockView.mockImplementation(viewOf({ 'src/index.html': src }));

      const result = await run();

      expect(result.textBlob).toContain('Description: Best tacos in town.');
    });

    it('tolerates a per-file view failure', async () => {
      mockSearch.mockResolvedValue(matches('src/Footer.tsx'));
      mockView.mockRejectedValue(new Error('locked'));
      const result = await run();
      // No content read, but it still returns ok with an empty extraction rather than throwing.
      expect(result).toMatchObject({ success: true, source: 'source' });
      expect(result.jsonLd).toBeNull();
    });
  });

  describe('computeState', () => {
    it('returns site-info-read with hasJsonLd on success', () => {
      const state = getSiteBusinessInfoTool.computeState?.(
        {},
        { success: true, source: 'source', jsonLd: { name: 'X' }, textBlob: '', filesScanned: ['a'] }
      );
      expect(state).toMatchObject({ workflowState: 'site-info-read', nextStep: 'diff-business-info', siteSource: 'source', hasJsonLd: true });
    });

    it('returns site-read-failed on error', () => {
      const state = getSiteBusinessInfoTool.computeState?.({}, { success: false, error: 'boom' });
      expect(state).toMatchObject({ workflowState: 'site-read-failed', nextStep: 'retry-site-read' });
    });
  });
});
