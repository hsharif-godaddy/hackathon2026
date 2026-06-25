/**
 * MarketingUtmRepository Integration Test
 *
 * Real in-memory SQLite. Verifies: non-campaign rows leave campaign columns null;
 * campaign rows get a salted utm_campaign and share one salt (so the campaign maps
 * to a single stable utm_campaign the warehouse can aggregate on); reverse lookup by
 * utm_campaign works. The encryption key is mocked so the HMAC is deterministic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema, UtmSource, UtmMedium } from '../../schema.js';
import type { UTMAttributionParams } from '../../schema.js';

vi.mock('../../../services/token-crypto.js', () => ({
  getEncryptionKey: () => Buffer.alloc(32, 9),
}));

import { MarketingUtmRepository } from '../MarketingUtmRepository.js';

const APP_ID = 'app1234567';
const CAMPAIGN_ID = 'camp_abc123abc1';

describe('MarketingUtmRepository Integration Tests', () => {
  let db: Database.Database;
  let repo: MarketingUtmRepository;

  beforeEach(async () => {
    db = new Database(':memory:');
    initializeSchema(db);
    db.prepare('INSERT INTO apps (id, name, path) VALUES (?, ?, ?)').run(APP_ID, 'Test App', '/tmp/test-app');
    // Seed a campaign so the marketing_utm.simple_campaign_id FK is satisfied.
    db.prepare(
      "INSERT INTO simple_campaign (id, app_id, name, status, created_at, updated_at) VALUES (?, ?, 'C', 'ready', '2026-01-01', '2026-01-01')",
    ).run(CAMPAIGN_ID, APP_ID);

    const connectionModule = await import('../../connection.js');
    vi.spyOn(connectionModule, 'getDatabase').mockReturnValue(db);

    repo = new MarketingUtmRepository();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  it('leaves campaign columns null for non-campaign content but still mints an act_ content token', () => {
    const row: UTMAttributionParams = repo.create({ contentRefId: 'sp_solo', utmSource: UtmSource.Instagram, utmMedium: UtmMedium.OrganicSocial });
    expect(row.utmSource).toBe('instagram');
    expect(row.utmMedium).toBe('organic_social');
    expect(row.simpleCampaignId).toBeNull();
    expect(row.utmCampaign).toBeNull();
    expect(row.utmContent).toMatch(/^act_/); // content token minted from contentRefId
    expect(row.utmContent).not.toContain('sp_solo');
  });

  it('derives one stable cmp_ utm_campaign per campaign from the global salt', () => {
    const a: UTMAttributionParams = repo.create({ contentRefId: 'sp_a', simpleCampaignId: CAMPAIGN_ID, utmSource: UtmSource.Instagram, utmMedium: UtmMedium.OrganicSocial });
    const b: UTMAttributionParams = repo.create({ contentRefId: 'bp_b', simpleCampaignId: CAMPAIGN_ID, utmSource: UtmSource.BlogAab, utmMedium: UtmMedium.Blog });

    expect(a.utmCampaign).toMatch(/^cmp_/);
    expect(a.utmCampaign).toBe(b.utmCampaign); // same campaign id + global salt → one stable value
    expect(a.utmCampaign).not.toContain(CAMPAIGN_ID); // obfuscated, not the raw id
  });

  it('mints a per-carrier act_ utm_content token, distinct per content id', () => {
    const a: UTMAttributionParams = repo.create({ contentRefId: 'sp_a', simpleCampaignId: CAMPAIGN_ID, utmSource: UtmSource.Facebook, utmMedium: UtmMedium.OrganicSocial });
    const b: UTMAttributionParams = repo.create({ contentRefId: 'bp_b', simpleCampaignId: CAMPAIGN_ID, utmSource: UtmSource.BlogAab, utmMedium: UtmMedium.Blog });

    expect(a.utmContent).toMatch(/^act_/);
    expect(a.utmContent).not.toBe(b.utmContent); // one token per carrier
    expect(a.utmContent).not.toContain('sp_a');
  });

  it('honors an explicitly provided utm_content over the derived token', () => {
    const row: UTMAttributionParams = repo.create({ contentRefId: 'sp_o', simpleCampaignId: CAMPAIGN_ID, utmContent: 'act_custom__cr_xyz', utmSource: UtmSource.Facebook, utmMedium: UtmMedium.OrganicSocial });
    expect(row.utmContent).toBe('act_custom__cr_xyz');
  });

  it('rejects an unknown utm_medium (app-layer enum validation)', () => {
    expect(() =>
      repo.create({ contentRefId: 'sp_bad', utmMedium: 'telepathy' as UtmMedium }),
    ).toThrow(/Invalid utm_medium/);
  });

  it('reverse-looks-up by utm_campaign', () => {
    const a: UTMAttributionParams = repo.create({ contentRefId: 'sp_x', simpleCampaignId: CAMPAIGN_ID, utmSource: UtmSource.Facebook, utmMedium: UtmMedium.OrganicSocial });
    const found: UTMAttributionParams[] = repo.findByUtmCampaign(a.utmCampaign!);
    expect(found.map((r: UTMAttributionParams): string => r.contentRefId)).toContain('sp_x');
  });

  it('reverse-looks-up by the composite (utm_source, utm_medium, utm_campaign)', () => {
    const fb: UTMAttributionParams = repo.create({ contentRefId: 'sp_fb', simpleCampaignId: CAMPAIGN_ID, utmSource: UtmSource.Facebook, utmMedium: UtmMedium.OrganicSocial });
    repo.create({ contentRefId: 'bp_blog', simpleCampaignId: CAMPAIGN_ID, utmSource: UtmSource.BlogAab, utmMedium: UtmMedium.Blog });

    const found: UTMAttributionParams[] = repo.findByComposite(UtmSource.Facebook, UtmMedium.OrganicSocial, fb.utmCampaign!);
    expect(found.map((r: UTMAttributionParams): string => r.contentRefId)).toEqual(['sp_fb']); // only the matching source/medium row
  });
});
