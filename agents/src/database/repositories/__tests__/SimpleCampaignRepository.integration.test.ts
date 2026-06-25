/**
 * SimpleCampaignRepository Integration Test
 *
 * Runs against a real in-memory SQLite database (not the mocked better-sqlite3 used by
 * the unit test) so it actually exercises the lookup-table foreign keys (status,
 * asset_type), the FK ON DELETE CASCADE from simple_campaign → simple_campaign_content,
 * and id-prefix round-tripping. Foreign keys are left ON and a parent `apps` row is
 * seeded so campaign inserts pass the app_id FK.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SimpleCampaignRepository } from '../SimpleCampaignRepository.js';
import { initializeSchema, SimpleCampaignStatus } from '../../schema.js';
import type { SimpleCampaign } from '../../schema.js';
import type { PlanRationale } from '../../plan-rationale.js';

const APP_ID = 'app1234567';

describe('SimpleCampaignRepository Integration Tests', () => {
  let db: Database.Database;
  let repo: SimpleCampaignRepository;

  beforeEach(async () => {
    db = new Database(':memory:');
    initializeSchema(db);
    // Seed the parent app so the simple_campaign.app_id FK is satisfied.
    db.prepare('INSERT INTO apps (id, name, path) VALUES (?, ?, ?)').run(APP_ID, 'Test App', '/tmp/test-app');

    const connectionModule = await import('../../connection.js');
    vi.spyOn(connectionModule, 'getDatabase').mockReturnValue(db);

    repo = new SimpleCampaignRepository();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  describe('id prefixes', () => {
    it('mints camp_ ids for campaigns and cont_ ids for content, round-tripping through find', () => {
      const campaign = repo.create({ appId: APP_ID, name: 'Launch' });
      expect(campaign.id).toMatch(/^camp_[0-9a-z]{12}$/);
      expect(repo.findById(campaign.id)).not.toBeNull();

      const content = repo.addContent({ simpleCampaignId: campaign.id, assetType: 'blog', title: 'Post' });
      expect(content.id).toMatch(/^cont_[0-9a-z]{12}$/);
      expect(repo.findContentById(content.id)).not.toBeNull();
    });
  });

  describe('created_by / updated_by actor', () => {
    it('records the creating actor and tracks the updating actor', () => {
      const campaign = repo.create({ appId: APP_ID, name: 'By Agent', createdBy: 'agent' });
      expect(campaign.createdBy).toBe('agent');
      expect(campaign.updatedBy).toBe('agent');

      const updated = repo.update(campaign.id, { name: 'Edited by user', updatedBy: 'user' });
      expect(updated.createdBy).toBe('agent'); // unchanged
      expect(updated.updatedBy).toBe('user');

      const content = repo.addContent({ simpleCampaignId: campaign.id, assetType: 'blog', title: 'Post', createdBy: 'agent' });
      expect(content.createdBy).toBe('agent');
    });

    it('leaves actor columns null when not provided', () => {
      const campaign = repo.create({ appId: APP_ID, name: 'No Actor' });
      expect(campaign.createdBy).toBeNull();
      expect(campaign.updatedBy).toBeNull();
    });
  });

  describe('lifecycle', () => {
    it('transitions and launches via guarded UPDATEs', () => {
      const campaign = repo.create({ appId: APP_ID, name: 'Lifecycle' });
      expect(campaign.status).toBe('draft');

      const ready = repo.transition(campaign.id, SimpleCampaignStatus.Ready);
      expect(ready.status).toBe('ready');

      // No future start_date → launches active.
      const launched = repo.launch(campaign.id);
      expect(launched.status).toBe('active');
      expect(launched.launchedAt).toBeTruthy();
    });

    it('rejects an invalid transition with a precise error', () => {
      const campaign = repo.create({ appId: APP_ID, name: 'Bad FSM' });
      expect(() => repo.transition(campaign.id, SimpleCampaignStatus.Active)).toThrow(/Invalid transition: draft → active/);
    });
  });

  describe('FK ON DELETE CASCADE', () => {
    it('deletes a campaign and cascades to its content', () => {
      const campaign = repo.create({ appId: APP_ID, name: 'Cascade' });
      repo.addContent({ simpleCampaignId: campaign.id, assetType: 'blog', title: 'Blog' });
      repo.addContent({ simpleCampaignId: campaign.id, assetType: 'social', title: 'Social' });

      expect(repo.getContent(campaign.id)).toHaveLength(2);

      repo.delete(campaign.id);

      expect(repo.findById(campaign.id)).toBeNull();
      const remaining = db
        .prepare('SELECT COUNT(*) AS count FROM simple_campaign_content WHERE simple_campaign_id = ?')
        .get(campaign.id) as { count: number };
      expect(remaining.count).toBe(0);
    });

    // No app→campaign cascade by design: the SQLite DB is per-app, so deleting the app
    // drops the whole file. The app_id FK is plain (no ON DELETE action).
  });

  describe('plan rationale (RUBICON-504)', () => {
    const rationale: PlanRationale = {
      assumptions: ['Owners want more local foot traffic', 'Audience skews local + mobile'],
      mixRationale: 'Landing page converts, blog builds SEO, social reaches followers',
      expectedOutcome: 'A small first wave of visitors and a handful of early sales',
    };

    it('persists the plan_rationale JSON object on create and round-trips it through SQLite', () => {
      const campaign: SimpleCampaign = repo.create({ appId: APP_ID, name: 'Rationale', planRationale: rationale });
      expect(campaign.planRationale).toEqual(rationale);

      const reloaded: SimpleCampaign | null = repo.findById(campaign.id);
      expect(reloaded?.planRationale).toEqual(rationale); // parsed back from the JSON column
      expect(reloaded?.planRationale?.assumptions).toHaveLength(2); // array preserved natively
    });

    it('defaults plan_rationale to null when not provided', () => {
      const campaign: SimpleCampaign = repo.create({ appId: APP_ID, name: 'No Rationale' });
      expect(campaign.planRationale).toBeNull();
      expect(repo.findById(campaign.id)?.planRationale).toBeNull();
    });

    it('updates plan_rationale independently of other columns', () => {
      const campaign: SimpleCampaign = repo.create({ appId: APP_ID, name: 'To Update' });
      const updated: SimpleCampaign = repo.update(campaign.id, { planRationale: rationale });
      expect(updated.planRationale).toEqual(rationale);
      expect(updated.name).toBe('To Update');
    });

    it('treats a malformed stored blob as null rather than failing the campaign load', () => {
      const campaign: SimpleCampaign = repo.create({ appId: APP_ID, name: 'Corrupt' });
      db.prepare(`UPDATE simple_campaign SET plan_rationale = ? WHERE id = ?`).run('{not valid json', campaign.id);
      expect(repo.findById(campaign.id)?.planRationale).toBeNull();
    });
  });

  describe('app-layer enum validation', () => {
    it('rejects an invalid content asset_type', () => {
      const campaign = repo.create({ appId: APP_ID, name: 'Bad Type' });
      expect(() =>
        repo.addContent({ simpleCampaignId: campaign.id, assetType: 'not-a-type' as never, title: 'X' }),
      ).toThrow(/Invalid asset_type/);
    });

    it('rejects an invalid content status', () => {
      const campaign = repo.create({ appId: APP_ID, name: 'Bad Status' });
      expect(() =>
        repo.addContent({ simpleCampaignId: campaign.id, assetType: 'blog', title: 'X', status: 'bogus' as never }),
      ).toThrow(/Invalid status/);
    });
  });
});
