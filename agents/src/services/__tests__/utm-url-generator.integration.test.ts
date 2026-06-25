/**
 * utm-url-generator Integration Test
 *
 * Exercises generateDecoratedCampaignUrl against a real in-memory SQLite + the real
 * MarketingUtmRepository, so the persisted row carries genuine cmp_/act_ tokens and the
 * emitted URL is built from that same row. The encryption key is mocked so the HMAC is
 * deterministic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../../database/schema.js';

vi.mock('../../services/token-crypto.js', () => ({
  getEncryptionKey: () => Buffer.alloc(32, 9),
}));

import type { UTMAttributionParams } from '../../database/schema.js';
import { MarketingUtmRepository } from '../../database/repositories/MarketingUtmRepository.js';
import { generateDecoratedCampaignUrl, type DecoratedUrlResult } from '../utm-url-generator.js';

const APP_ID = 'app1234567';
const CAMPAIGN_ID = 'camp_abc123abc1';
const BASE = 'https://example-bakery.com';

describe('utm-url-generator integration', () => {
  let db: Database.Database;
  let repo: MarketingUtmRepository;

  beforeEach(async () => {
    db = new Database(':memory:');
    initializeSchema(db);
    db.prepare('INSERT INTO apps (id, name, path) VALUES (?, ?, ?)').run(APP_ID, 'Test App', '/tmp/test-app');
    db.prepare(
      "INSERT INTO simple_campaign (id, app_id, name, status, created_at, updated_at) VALUES (?, ?, 'C', 'ready', '2026-01-01', '2026-01-01')",
    ).run(CAMPAIGN_ID, APP_ID);

    const connectionModule = await import('../../database/connection.js');
    vi.spyOn(connectionModule, 'getDatabase').mockReturnValue(db);

    repo = new MarketingUtmRepository();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  it('persists a marketing_utm row and builds a URL carrying the same cmp_/act_ tokens', () => {
    const result: DecoratedUrlResult = generateDecoratedCampaignUrl({
      publishedUrl: BASE,
      campaignSlug: 'summer-sale',
      resourceType: 'social',
      contentRefId: 'post-fb1',
      simpleCampaignId: CAMPAIGN_ID,
      platform: 'facebook',
      topicSlug: 'summer sale',
      utmWriter: repo,
    });

    // Row persisted with the right attribution + external id.
    const persisted: UTMAttributionParams[] = repo.findByContentRefId('post-fb1');
    expect(persisted).toHaveLength(1);
    expect(persisted[0].utmSource).toBe('facebook');
    expect(persisted[0].utmMedium).toBe('organic_social');
    expect(persisted[0].utmCampaign).toMatch(/^cmp_/);
    expect(persisted[0].utmContent).toMatch(/^act_/);
    expect(persisted[0].utmTerm).toBe('topic_summer-sale');

    // URL built from the persisted row — identical tokens.
    expect(result.absoluteUrl).toContain(`utm_campaign=${persisted[0].utmCampaign}`);
    expect(result.absoluteUrl).toContain(`utm_content=${persisted[0].utmContent}`);
    expect(result.absoluteUrl.startsWith('https://example-bakery.com/lp/summer-sale?')).toBe(true);
  });

  it('shares one utm_campaign across a campaign while utm_content differs per carrier', () => {
    const social: DecoratedUrlResult = generateDecoratedCampaignUrl({
      publishedUrl: BASE,
      campaignSlug: 'summer-sale',
      resourceType: 'social',
      contentRefId: 'post-fb2',
      simpleCampaignId: CAMPAIGN_ID,
      platform: 'instagram',
      utmWriter: repo,
    });
    const blog: DecoratedUrlResult = generateDecoratedCampaignUrl({
      publishedUrl: BASE,
      campaignSlug: 'summer-sale',
      resourceType: 'blog',
      contentRefId: 'post-blogA',
      simpleCampaignId: CAMPAIGN_ID,
      utmWriter: repo,
    });

    expect(social.utm.utmCampaign).toBe(blog.utm.utmCampaign); // one campaign token
    expect(social.utm.utmContent).not.toBe(blog.utm.utmContent); // one token per carrier
  });
});
