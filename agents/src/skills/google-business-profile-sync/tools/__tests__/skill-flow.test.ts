/**
 * Skill-level walkthrough: drives the full google-business-profile-sync
 * conversation across all tools with mocked clients + attachments, asserting
 * each tool's output feeds the next. Per-tool behavior is covered in the
 * sibling unit tests; this guards the composition (the agent's tool sequence).
 *
 * Fully mocked (no real services), so it lives in the unit suite — the value is
 * the cross-tool wiring, not external integration.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockFindByAppAndPlatform = vi.fn();
const mockFindById = vi.fn();
const mockMemGet = vi.fn();
const mockScrape = vi.fn();
const mockSearch = vi.fn();
const mockView = vi.fn();
const mockReadText = vi.fn();
const mockEdit = vi.fn();
const mockCreateForWorkspace = vi.fn();

vi.mock('../../../../logging/index.js', () => {
  const instance = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => instance };
  return { logger: instance, Logger: { create: () => instance } };
});
vi.mock('../../../../database/repositories/SocialAssociationRepository.js', () => ({
  SocialAssociationRepository: class {
    findByAppAndPlatform(...args: unknown[]) {
      return mockFindByAppAndPlatform(...args);
    }
  },
}));
vi.mock('../../../../database/repositories/index.js', () => ({
  appRepository: { findById: (...args: unknown[]) => mockFindById(...args) },
}));
vi.mock('../../../../database/repositories/MemoryRepository.js', () => ({
  MemoryRepository: class {
    get(...args: unknown[]) {
      return mockMemGet(...args);
    }
  },
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
// Diff uses these only for free-text fields; this flow is fully structured, so they won't fire.
vi.mock('@airo/ai-lib', () => ({ getModel: vi.fn().mockResolvedValue({}) }));
vi.mock('@airo/ai-common', () => ({ llmMetadataContext: { run: (_m: unknown, fn: () => unknown) => fn() } }));
vi.mock('ai', () => ({ generateObject: vi.fn() }));

import {
  checkConnectionTool,
  getGbpProfileTool,
  getSiteBusinessInfoTool,
  diffBusinessInfoTool,
  syncFieldTool,
  verifySiteSyncTool,
} from '../index.js';
import { GBP_PROFILE_READY, GBP_UPDATE_DONE } from '../../../../types/social.js';

const APP_ID = 'app1';
const SOCIAL_ID = 'gbp-123';

// GBP listing: phone differs from the site; everything else matches.
const GBP_PROFILE = {
  name: 'Acme Plumbing',
  primaryPhone: '(555) 123-9999',
  websiteUri: 'https://acme-plumbing.com',
  storefrontAddress: { addressLines: ['123 Main St'], locality: 'Phoenix', administrativeArea: 'AZ', postalCode: '85001' },
  regularHours: { periods: [{ openDay: 'MONDAY', openTime: { hours: 9 }, closeDay: 'MONDAY', closeTime: { hours: 17 } }] },
};

const SITE_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  name: 'Acme Plumbing',
  telephone: '(555) 123-4567',
  url: 'https://acme-plumbing.com',
  address: { '@type': 'PostalAddress', streetAddress: '123 Main St', addressLocality: 'Phoenix', addressRegion: 'AZ', postalCode: '85001' },
  openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: 'Monday', opens: '09:00', closes: '17:00' }],
};
const SITE_HTML = `<html><head><script type="application/ld+json">${JSON.stringify(SITE_JSONLD)}</script></head><body>Call (555) 123-4567</body></html>`;

const ctx = (attachments: unknown[] = []) => ({ metadata: { appId: APP_ID }, contextAttachments: attachments });

describe('google-business-profile-sync — full flow composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindByAppAndPlatform.mockReturnValue([{ socialId: SOCIAL_ID }]);
    mockFindById.mockReturnValue({ id: APP_ID, path: '/x', previewUrl: 'https://preview.example.com', publishedUrl: null });
    mockMemGet.mockResolvedValue({ success: true, exists: true, value: [{ domainType: 'custom', status: 'active', fqdn: 'acme-plumbing.com' }] });
    // verifySiteSync still polls the rendered preview via the scraper.
    mockScrape.mockResolvedValue({ success: true, html: SITE_HTML, sanitizedContent: 'Call (555) 123-4567' });
    // Site read (getSiteBusinessInfo / diff) + gbp-to-site edit go through the workspace files client.
    mockSearch.mockResolvedValue([{ path: 'src/components/Footer.tsx', line: 1, column: 1, preview: '' }]);
    mockReadText.mockResolvedValue(SITE_HTML);
    mockView.mockResolvedValue({ path: 'src/components/Footer.tsx', content: SITE_HTML, encoding: 'utf-8', lines: 1, size: 1, truncated: false });
    mockEdit.mockResolvedValue({ applied: 1 });
    mockCreateForWorkspace.mockReturnValue({ files: { search: mockSearch, view: mockView, edit: mockEdit, readText: mockReadText } });
  });

  it('connects, reads both sides, diffs, and syncs the phone both directions', async () => {
    // 1. checkConnection → connected
    const conn = await checkConnectionTool.execute({}, ctx());
    expect(conn).toMatchObject({ connected: true, socialId: SOCIAL_ID });

    // 2a. getGbpProfile pass 1 → signal
    const gbpSignal = await getGbpProfileTool.execute({}, ctx());
    expect(gbpSignal).toMatchObject({ action: 'getGbpProfile', socialId: SOCIAL_ID });

    // 2b. getGbpProfile pass 2 → profile from the GBP_PROFILE_READY attachment
    const gbpRead = await getGbpProfileTool.execute({}, ctx([{ type: GBP_PROFILE_READY, data: { profile: GBP_PROFILE } }]));
    expect(gbpRead).toMatchObject({ success: true });

    // 3. getSiteBusinessInfo is optional now (diff self-reads) — confirm it still works standalone.
    const siteRead = await getSiteBusinessInfoTool.execute({}, ctx());
    expect(siteRead).toMatchObject({ success: true, source: 'source' });
    expect(((siteRead as { jsonLd: { telephone: string } }).jsonLd).telephone).toBe('(555) 123-4567');

    // 4. diff with NO args — pulls GBP from the in-turn attachment and reads the site itself.
    const diff = await diffBusinessInfoTool.execute({}, ctx([{ type: GBP_PROFILE_READY, data: { profile: GBP_PROFILE } }]));
    expect(diff.success).toBe(true);
    expect(diff.mismatches.map((f: { field: string }) => f.field)).toEqual(['phone']);
    const phoneDiff = diff.mismatches[0];
    expect(phoneDiff).toMatchObject({ field: 'phone', gbp: '(555) 123-9999', site: '(555) 123-4567' });

    // 5a. User picks "update GBP from site": site-to-gbp two-pass
    const toGbpSignal = await syncFieldTool.execute(
      { field: 'phone', direction: 'site-to-gbp', value: phoneDiff.site },
      ctx()
    );
    expect(toGbpSignal).toMatchObject({ action: 'updateGbp', field: 'phone', updates: { primaryPhone: '(555) 123-4567' } });

    const toGbpDone = await syncFieldTool.execute(
      { field: 'phone', direction: 'site-to-gbp', value: phoneDiff.site },
      ctx([{ type: GBP_UPDATE_DONE, data: { field: 'phone', updated: ['primaryPhone'] } }])
    );
    expect(toGbpDone).toMatchObject({ success: true, field: 'phone', updated: ['primaryPhone'] });

    // 5b. Alternatively "update the site from GBP": gbp-to-site edit + verify
    const toSite = await syncFieldTool.execute(
      { field: 'phone', direction: 'gbp-to-site', value: phoneDiff.gbp, previousValue: phoneDiff.site },
      ctx()
    );
    expect(toSite).toMatchObject({ success: true, direction: 'gbp-to-site', editedFiles: ['src/components/Footer.tsx'], occurrences: 1 });
    expect(mockEdit).toHaveBeenCalledWith(expect.objectContaining({ oldString: '(555) 123-4567', newString: '(555) 123-9999', replaceAll: true }));

    // 6. verify the preview now shows the new phone
    mockScrape.mockResolvedValue({ success: true, html: '<html><body>Call (555) 123-9999</body></html>', sanitizedContent: 'Call (555) 123-9999' });
    const verify = await verifySiteSyncTool.execute({ field: 'phone', expectedValue: phoneDiff.gbp, previousValue: phoneDiff.site }, ctx());
    expect(verify).toMatchObject({ success: true, ok: true, field: 'phone' });
  });

  it('produces no mismatches when the listing already matches the site', async () => {
    // Site source now carries a phone matching GBP.
    const matchingJsonLd = { ...SITE_JSONLD, telephone: '(555) 123-9999' };
    const matchingSource = `<script type="application/ld+json">${JSON.stringify(matchingJsonLd)}</script>`;
    mockReadText.mockResolvedValue(matchingSource);

    const diff = await diffBusinessInfoTool.execute({}, ctx([{ type: GBP_PROFILE_READY, data: { profile: GBP_PROFILE } }]));

    expect(diff.mismatches).toHaveLength(0);
    expect(diff.fields.map((f: { field: string }) => f.field).sort()).toEqual(['address', 'hours', 'name', 'phone', 'website']);
  });

  it('drops the website field from the diff when the site is not on a custom domain', async () => {
    mockMemGet.mockResolvedValue({ success: true, exists: true, value: [] });

    const diff = await diffBusinessInfoTool.execute({}, ctx([{ type: GBP_PROFILE_READY, data: { profile: GBP_PROFILE } }]));

    expect(diff.fields.map((f: { field: string }) => f.field)).not.toContain('website');
  });
});
