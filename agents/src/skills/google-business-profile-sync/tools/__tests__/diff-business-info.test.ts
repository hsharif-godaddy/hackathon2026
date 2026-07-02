import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockGenerateObject = vi.fn();
const mockMemGet = vi.fn();
const mockSearch = vi.fn();
const mockView = vi.fn();
const mockCreateForWorkspace = vi.fn();

vi.mock('../../../../logging/index.js', () => {
  const instance = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => instance };
  return { logger: instance, Logger: { create: () => instance } };
});

vi.mock('../../../../database/repositories/MemoryRepository.js', () => ({
  MemoryRepository: class {
    get(...args: unknown[]) {
      return mockMemGet(...args);
    }
  },
}));

// diff's no-arg path self-reads the site via get-site-business-info, which uses
// the workspace files client — mock it so that path is drivable.
vi.mock('../../../../workspace/index.js', () => ({
  createForWorkspace: (...args: unknown[]) => mockCreateForWorkspace(...args),
}));

vi.mock('@airo/ai-lib', () => ({ getModel: vi.fn().mockResolvedValue({}) }));
vi.mock('@airo/ai-common', () => ({
  llmMetadataContext: { run: (_metadata: unknown, fn: () => unknown) => fn() },
}));
vi.mock('ai', () => ({ generateObject: (...args: unknown[]) => mockGenerateObject(...args) }));

import {
  diffBusinessInfoTool,
  normalizeName,
  normalizePhone,
  normalizeUrl,
  canonicalizeAddress,
  canonicalizeGbpHours,
  canonicalizeSchemaHours,
  formatGbpAddress,
  formatSchemaAddress,
  fieldFromBlob,
  hoursFromBlob,
  type FieldDiff,
} from '../diff-business-info.js';
import { GBP_PROFILE_READY } from '../../../../types/social.js';

const SITE_HTML_PHONE_MISMATCH = `<html><head><script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  name: 'Acme Plumbing',
  telephone: '(555) 999-0000',
  url: 'https://www.acme-plumbing.com',
  address: { '@type': 'PostalAddress', streetAddress: '123 Main St', addressLocality: 'Phoenix', addressRegion: 'AZ', postalCode: '85001' },
  openingHours: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: 'Monday', opens: '09:00', closes: '17:00' }],
})}</script></head><body></body></html>`;

const GBP = {
  name: 'Acme Plumbing',
  primaryPhone: '(555) 123-4567',
  websiteUri: 'https://acme-plumbing.com/',
  storefrontAddress: { addressLines: ['123 Main St'], locality: 'Phoenix', administrativeArea: 'AZ', postalCode: '85001' },
  regularHours: { periods: [{ openDay: 'MONDAY', openTime: { hours: 9, minutes: 0 }, closeDay: 'MONDAY', closeTime: { hours: 17, minutes: 0 } }] },
};

const SITE_STRUCTURED_MATCH = {
  jsonLd: {
    name: 'Acme Plumbing',
    telephone: '555-123-4567',
    url: 'https://www.acme-plumbing.com',
    address: { streetAddress: '123 Main St', addressLocality: 'Phoenix', addressRegion: 'AZ', postalCode: '85001' },
    openingHours: [{ dayOfWeek: 'Monday', opens: '09:00', closes: '17:00' }],
  },
};

function field(fields: FieldDiff[], name: string): FieldDiff | undefined {
  return fields.find((f) => f.field === name);
}

describe('diff-business-info normalization helpers', () => {
  it('normalizePhone canonicalizes to E.164 so cross-format/national numbers compare equal', () => {
    // Explicit country code, or a seeded country, both → E.164.
    expect(normalizePhone('+1 415-555-0132')).toBe('+14155550132');
    expect(normalizePhone('(415) 555-0132', 'US')).toBe('+14155550132');
    // UK national format seeded with GB resolves to the same E.164 as the +44 form.
    expect(normalizePhone('020 7946 0958', 'GB')).toBe('+442079460958');
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
  });

  it('normalizePhone falls back to bare digits when it cannot parse (no country)', () => {
    expect(normalizePhone('(555) 123-4567')).toBe('5551234567');
    expect(normalizePhone('555.123.4567')).toBe('5551234567');
  });

  it('normalizeUrl lowercases host, drops www and trailing slash', () => {
    expect(normalizeUrl('https://www.Acme-Plumbing.com/')).toBe('acme-plumbing.com');
    expect(normalizeUrl('acme-plumbing.com')).toBe('acme-plumbing.com');
    expect(normalizeUrl('https://acme-plumbing.com/contact/')).toBe('acme-plumbing.com/contact');
  });

  it('normalizeName trims, collapses whitespace, lowercases', () => {
    expect(normalizeName('  Acme   Plumbing ')).toBe('acme plumbing');
  });

  it('canonicalizeAddress expands street-suffix/direction abbreviations', () => {
    expect(canonicalizeAddress('123 Main St')).toBe('123 main street');
    expect(canonicalizeAddress('123 Main Street')).toBe('123 main street');
    expect(canonicalizeAddress('45 N Oak Ave, Ste 200')).toBe('45 north oak avenue suite 200');
    // A genuine difference is preserved (not collapsed).
    expect(canonicalizeAddress('123 Main St')).not.toBe(canonicalizeAddress('124 Main St'));
  });

  it('canonicalizeGbpHours and canonicalizeSchemaHours agree on the same hours', () => {
    const gbp = canonicalizeGbpHours(GBP.regularHours);
    const schema = canonicalizeSchemaHours(SITE_STRUCTURED_MATCH.jsonLd.openingHours);
    expect(gbp).toBe('MON 0900-1700');
    expect(schema).toBe('MON 0900-1700');
  });

  it('canonicalizeGbpHours handles overnight and genuine next-day close (#4)', () => {
    // close < open → implicit overnight, kept in schema-compatible "DAY open-close" form
    const overnight = canonicalizeGbpHours({
      periods: [{ openDay: 'MONDAY', openTime: { hours: 20 }, closeDay: 'TUESDAY', closeTime: { hours: 2 } }],
    });
    expect(overnight).toBe('MON 2000-0200');

    // close >= open on a later day → made explicit so it isn't conflated with a same-day MON 0900-0900
    const nextDayClose = canonicalizeGbpHours({
      periods: [{ openDay: 'MONDAY', openTime: { hours: 9 }, closeDay: 'TUESDAY', closeTime: { hours: 9 } }],
    });
    expect(nextDayClose).toBe('MON 0900-TUE 0900');

    // same-day close is unchanged
    const sameDay = canonicalizeGbpHours({
      periods: [{ openDay: 'MONDAY', openTime: { hours: 9 }, closeDay: 'MONDAY', closeTime: { hours: 17 } }],
    });
    expect(sameDay).toBe('MON 0900-1700');
  });

  it('canonicalizeSchemaHours handles schema.org URL day + array dayOfWeek', () => {
    const canonical = canonicalizeSchemaHours([
      { dayOfWeek: ['https://schema.org/Saturday', 'https://schema.org/Sunday'], opens: '10:00', closes: '14:00' },
    ]);
    expect(canonical).toBe('SUN 1000-1400; SAT 1000-1400');
  });

  it('formatGbpAddress and formatSchemaAddress produce comparable strings', () => {
    expect(formatGbpAddress(GBP.storefrontAddress)).toBe('123 Main St, Phoenix AZ 85001');
    expect(formatSchemaAddress(SITE_STRUCTURED_MATCH.jsonLd.address)).toBe('123 Main St, Phoenix AZ 85001');
    expect(formatSchemaAddress('456 Oak Ave')).toBe('456 Oak Ave');
  });

  it('fieldFromBlob / hoursFromBlob extract labeled values', () => {
    const blob = 'CONTACT INFORMATION (for footer):\n- Phone: (555) 123-9999\n- Address: 456 Oak Ave, Phoenix, AZ 85002\nHours:\n  - Mon-Fri 8am-6pm\n  - Sat 9am-2pm';
    expect(fieldFromBlob(blob, 'Phone')).toBe('(555) 123-9999');
    expect(fieldFromBlob(blob, 'Address')).toBe('456 Oak Ave, Phoenix, AZ 85002');
    expect(hoursFromBlob(blob)).toBe('Mon-Fri 8am-6pm; Sat 9am-2pm');
  });
});

const CTX = { metadata: { appId: 'app1' } };
function runDiff(args: { gbp: unknown; site: unknown }) {
  return diffBusinessInfoTool.execute(args, CTX);
}

describe('diffBusinessInfoTool.execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateObject.mockResolvedValue({ object: { equivalent: true, confidence: 0.95, rationale: 'same' } });
    // Default: site is on a real custom domain, so the website field IS compared.
    mockMemGet.mockResolvedValue({ success: true, exists: true, value: [{ domainType: 'custom', status: 'active', fqdn: 'acme-plumbing.com' }] });
    // Defaults for the self-read path (only exercised when site/gbp aren't passed explicitly):
    // the site read scans the source via the workspace files client.
    mockCreateForWorkspace.mockReturnValue({ files: { search: mockSearch, view: mockView, readText: vi.fn().mockResolvedValue('') } });
    mockSearch.mockResolvedValue([{ path: 'src/Footer.tsx', line: 1, column: 1, preview: '' }]);
    mockView.mockResolvedValue({ path: 'src/Footer.tsx', content: SITE_HTML_PHONE_MISMATCH, encoding: 'utf-8', lines: 1, size: 1, truncated: false });
  });

  describe('self-sufficient (no-arg) path', () => {
    it('reads GBP from the GBP_PROFILE_READY attachment and the site source internally', async () => {
      const ctx = { metadata: { appId: 'app1' }, contextAttachments: [{ type: GBP_PROFILE_READY, data: { profile: GBP } }] };
      const result = await diffBusinessInfoTool.execute({}, ctx);

      expect(result.success).toBe(true);
      expect(mockSearch).toHaveBeenCalled(); // site read scanned the source
      // GBP phone (555) 123-4567 vs site (555) 999-0000 → mismatch found with no args passed
      expect(field(result.fields, 'phone')?.equivalent).toBe(false);
    });

    it('uses the latest GBP_PROFILE_READY attachment when several are present', async () => {
      const stale = { ...GBP, name: 'Stale Name' };
      const ctx = {
        metadata: { appId: 'app1' },
        contextAttachments: [
          { type: GBP_PROFILE_READY, data: { profile: stale } },
          { type: GBP_PROFILE_READY, data: { profile: GBP } },
        ],
      };
      const result = await diffBusinessInfoTool.execute({}, ctx);
      expect(field(result.fields, 'name')?.gbp).toBe('Acme Plumbing');
    });

    it('errors with a getGbpProfile hint when no GBP data is available', async () => {
      const result = await diffBusinessInfoTool.execute({}, { metadata: { appId: 'app1' }, contextAttachments: [] });
      expect(result).toMatchObject({ success: false });
      expect(result.error).toContain('getGbpProfile');
      expect(mockSearch).not.toHaveBeenCalled(); // bails before the site read
    });

    it('surfaces every GBP field as gbp-only when the site has no business info (so the agent can offer to add it)', async () => {
      mockSearch.mockResolvedValue([]); // no business-info source files → empty site read
      const ctx = { metadata: { appId: 'app1' }, contextAttachments: [{ type: GBP_PROFILE_READY, data: { profile: GBP } }] };
      const result = await diffBusinessInfoTool.execute({}, ctx);
      // Not an error: the site has nothing, so each present GBP field is a 'gbp-only'
      // mismatch the agent can offer to add to the site.
      expect(result.success).toBe(true);
      expect(result.mismatches.length).toBeGreaterThan(0);
      expect(result.mismatches.every((m: FieldDiff) => m.presence === 'gbp-only')).toBe(true);
      expect(mockGenerateObject).not.toHaveBeenCalled();
    });
  });

  it('reports all fields equivalent for a matching structured site (no LLM calls)', async () => {
    const result = await runDiff({ gbp: GBP, site: SITE_STRUCTURED_MATCH });

    expect(result.success).toBe(true);
    expect(result.mismatches).toHaveLength(0);
    expect(result.fields.map((f: FieldDiff) => f.field).sort()).toEqual(['address', 'hours', 'name', 'phone', 'website']);
    expect(field(result.fields, 'address')?.strategy).toBe('jsonld-structured');
    expect(field(result.fields, 'hours')?.strategy).toBe('jsonld-structured');
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('flags a structured phone/website/name mismatch via normalization', async () => {
    const site = {
      jsonLd: {
        name: 'Acme Plumbing & Drains',
        telephone: '(555) 123-9999',
        url: 'https://different-site.com',
        address: SITE_STRUCTURED_MATCH.jsonLd.address,
        openingHours: SITE_STRUCTURED_MATCH.jsonLd.openingHours,
      },
    };
    const result = await runDiff({ gbp: GBP, site });

    const mismatchFields = result.mismatches.map((f: FieldDiff) => f.field).sort();
    expect(mismatchFields).toEqual(['name', 'phone', 'website']);
    expect(field(result.fields, 'address')?.equivalent).toBe(true);
  });

  it('matches a structured address differing only by street-suffix abbreviation WITHOUT an LLM call (#6)', async () => {
    // GBP "123 Main St" vs site "123 Main Street" → canonicalized equal, no model needed.
    const site = {
      jsonLd: {
        ...SITE_STRUCTURED_MATCH.jsonLd,
        address: { streetAddress: '123 Main Street', addressLocality: 'Phoenix', addressRegion: 'AZ', postalCode: '85001' },
      },
    };

    const result = await runDiff({ gbp: GBP, site });

    const addr = field(result.fields, 'address');
    expect(addr?.strategy).toBe('jsonld-structured');
    expect(addr?.equivalent).toBe(true);
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('falls back to LLM for a structured address suffix-canon cannot resolve (#10)', async () => {
    mockGenerateObject.mockResolvedValue({ object: { equivalent: true, confidence: 0.95, rationale: 'AZ == Arizona' } });
    // "AZ" vs "Arizona" is not a street-suffix alias → goes to the model.
    const site = {
      jsonLd: {
        ...SITE_STRUCTURED_MATCH.jsonLd,
        address: { streetAddress: '123 Main St', addressLocality: 'Phoenix', addressRegion: 'Arizona', postalCode: '85001' },
      },
    };

    const result = await runDiff({ gbp: GBP, site });

    const addr = field(result.fields, 'address');
    expect(addr?.strategy).toBe('llm-equivalence');
    expect(addr?.equivalent).toBe(true);
    expect(result.mismatches.map((f: FieldDiff) => f.field)).not.toContain('address');
    expect(mockGenerateObject).toHaveBeenCalled();
  });

  it('compares description by MEANING via the LLM, not exact text (#description)', async () => {
    // Differently-worded descriptions of the same business → LLM says equivalent.
    mockGenerateObject.mockResolvedValue({ object: { equivalent: true, confidence: 0.9, rationale: 'same business, different phrasing' } });
    const gbp = { ...GBP, description: 'Family-owned plumbing serving Phoenix since 1990.' };
    const site = { jsonLd: { ...SITE_STRUCTURED_MATCH.jsonLd, description: 'Phoenix plumbers you can trust — a family business for 30+ years.' } };

    const result = await runDiff({ gbp, site });

    const desc = field(result.fields, 'description');
    expect(desc).toMatchObject({ equivalent: true, strategy: 'llm-equivalence', presence: 'both' });
    expect(mockGenerateObject).toHaveBeenCalled();
  });

  it('flags a description with conflicting facts as a mismatch (#description)', async () => {
    mockGenerateObject.mockResolvedValue({ object: { equivalent: false, confidence: 0.9, rationale: 'different services' } });
    const gbp = { ...GBP, description: 'Emergency plumbing and drain cleaning.' };
    const site = { jsonLd: { ...SITE_STRUCTURED_MATCH.jsonLd, description: 'We are a family law firm.' } };

    const result = await runDiff({ gbp, site });

    expect(field(result.fields, 'description')?.equivalent).toBe(false);
    expect(result.mismatches.map((f: FieldDiff) => f.field)).toContain('description');
  });

  it('surfaces description as gbp-only when the site has none, with no LLM call (#description)', async () => {
    const gbp = { ...GBP, description: 'Great plumbing.' };
    const result = await runDiff({ gbp, site: { jsonLd: { ...SITE_STRUCTURED_MATCH.jsonLd } } });
    expect(field(result.fields, 'description')?.presence).toBe('gbp-only');
  });

  it('treats a UK national-format site phone as equivalent to the +44 GBP phone (international)', async () => {
    const ukGbp = {
      ...GBP,
      primaryPhone: '+44 20 7946 0958',
      storefrontAddress: { ...GBP.storefrontAddress, regionCode: 'GB' }, // seeds the parser country
    };
    const site = { jsonLd: { ...SITE_STRUCTURED_MATCH.jsonLd, telephone: '020 7946 0958' } };

    const result = await runDiff({ gbp: ukGbp, site });

    expect(field(result.fields, 'phone')?.equivalent).toBe(true);
  });

  it('uses LLM equivalence for free-text address/hours and respects an "equivalent" verdict', async () => {
    mockGenerateObject.mockResolvedValue({ object: { equivalent: true, confidence: 0.9, rationale: 'same place, different formatting' } });
    const site = {
      jsonLd: null,
      textBlob: 'CONTACT INFORMATION (for footer):\n- Phone: 555-123-4567\n- Address: 123 Main Street, Phoenix, AZ 85001\nHours:\n  - Mon 9:00 AM - 5:00 PM',
    };

    const result = await runDiff({ gbp: GBP, site });

    expect(mockGenerateObject).toHaveBeenCalledTimes(2); // address + hours
    expect(field(result.fields, 'address')?.strategy).toBe('llm-equivalence');
    expect(field(result.fields, 'address')?.equivalent).toBe(true);
    expect(field(result.fields, 'phone')?.equivalent).toBe(true); // 555-123-4567 == (555) 123-4567
    // name/website are on GBP but absent from the blob → surfaced as gbp-only mismatches (#5)
    expect(field(result.fields, 'name')?.presence).toBe('gbp-only');
    expect(field(result.fields, 'name')?.equivalent).toBe(false);
    expect(field(result.fields, 'website')?.presence).toBe('gbp-only');
  });

  it('treats a low-confidence LLM verdict as a mismatch', async () => {
    mockGenerateObject.mockResolvedValue({ object: { equivalent: true, confidence: 0.4, rationale: 'unsure' } });
    const site = { jsonLd: null, textBlob: '- Address: somewhere ambiguous' };

    const result = await runDiff({ gbp: GBP, site });

    expect(field(result.fields, 'address')?.equivalent).toBe(false);
  });

  it('treats an LLM error as a mismatch (fail-safe)', async () => {
    mockGenerateObject.mockRejectedValue(new Error('model unavailable'));
    const site = { jsonLd: null, textBlob: '- Address: 999 Elsewhere Rd, Town, AZ 80000' };

    const result = await runDiff({ gbp: GBP, site });

    const addr = field(result.fields, 'address');
    expect(addr?.equivalent).toBe(false);
    expect(addr?.rationale).toMatch(/Could not verify/);
  });

  it('surfaces a field present on only one side as a mismatch (#5)', async () => {
    const result = await runDiff({ gbp: { name: 'Acme' }, site: { jsonLd: {} } });
    // GBP has name, site doesn't → gbp-only mismatch (AC#3: missing-on-one-side IS a mismatch).
    const name = field(result.fields, 'name');
    expect(name?.presence).toBe('gbp-only');
    expect(name?.equivalent).toBe(false);
    expect(name?.gbp).toBe('Acme');
    expect(name?.site).toBeNull();
    expect(result.mismatches.map((f: FieldDiff) => f.field)).toContain('name');
  });

  it('omits a field when NEITHER side has a value', async () => {
    const result = await runDiff({ gbp: { name: 'Acme' }, site: { jsonLd: { name: 'Acme' } } });
    // Only name on both sides (equal); phone/address/hours/website absent on both → omitted.
    expect(result.fields.map((f: FieldDiff) => f.field)).toEqual(['name']);
  });

  describe('website domain-gating', () => {
    const siteWithUrl = {
      jsonLd: { url: 'https://different-site.com', telephone: '(555) 123-4567' },
    };

    it('omits the website field when the site is NOT on a custom domain', async () => {
      mockMemGet.mockResolvedValue({ success: true, exists: true, value: [] });
      const result = await runDiff({ gbp: GBP, site: siteWithUrl });
      expect(field(result.fields, 'website')).toBeUndefined();
      // other fields still compared
      expect(field(result.fields, 'phone')).toBeDefined();
    });

    it('omits the website field when the domain lookup fails or is absent', async () => {
      mockMemGet.mockResolvedValue({ success: true, exists: false });
      const result = await runDiff({ gbp: GBP, site: siteWithUrl });
      expect(field(result.fields, 'website')).toBeUndefined();
    });

    it('treats a prefix-only domain as not custom (website omitted)', async () => {
      mockMemGet.mockResolvedValue({ success: true, exists: true, value: [{ domainType: 'prefix', status: 'active' }] });
      const result = await runDiff({ gbp: GBP, site: siteWithUrl });
      expect(field(result.fields, 'website')).toBeUndefined();
    });

    it('compares the website field on a real custom domain', async () => {
      // default beforeEach mock = active custom domain
      const result = await runDiff({ gbp: GBP, site: siteWithUrl });
      expect(field(result.fields, 'website')?.equivalent).toBe(false);
    });
  });
});

describe('diffBusinessInfoTool.computeState', () => {
  it('reports present-mismatches when there are mismatches', () => {
    const state = diffBusinessInfoTool.computeState?.(
      {},
      { success: true, fields: [{ field: 'phone' }, { field: 'name' }], mismatches: [{ field: 'phone' }] }
    );
    expect(state).toMatchObject({ workflowState: 'diff-complete', comparedCount: 2, mismatchCount: 1, nextStep: 'present-mismatches' });
  });

  it('reports no-mismatches when everything matches', () => {
    const state = diffBusinessInfoTool.computeState?.({}, { success: true, fields: [{ field: 'phone' }], mismatches: [] });
    expect(state).toMatchObject({ nextStep: 'no-mismatches', mismatchCount: 0 });
  });

  it('returns null when output is not successful', () => {
    expect(diffBusinessInfoTool.computeState?.({}, { success: false })).toBeNull();
  });
});
