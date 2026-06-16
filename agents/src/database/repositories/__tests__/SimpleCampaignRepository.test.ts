import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SimpleCampaignRepository } from '../SimpleCampaignRepository.js';
import { SimpleCampaignStatus } from '../../schema.js';

vi.mock('../../connection.js');
vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

// A simple_campaign row as it comes back from the DB (snake_case columns).
function makeCampaignRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'camp_t1',
    app_id: 'app-1',
    marketing_plan_id: null,
    name: 'Test',
    status: 'draft',
    offer: null,
    goal: null,
    start_date: null,
    end_date: null,
    launched_at: null,
    completed_at: null,
    created_by: null,
    updated_by: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  };
}

describe('SimpleCampaignRepository', function campaignRepoTests() {
  let repo: SimpleCampaignRepository;
  let mockDb: any;
  let mockStatement: any;

  beforeEach(async function setup() {
    mockStatement = {
      run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
      get: vi.fn(),
      all: vi.fn().mockReturnValue([]),
    };
    mockDb = {
      prepare: vi.fn().mockReturnValue(mockStatement),
    };

    const { getDatabase } = await import('../../connection.js');
    vi.mocked(getDatabase).mockReturnValue(mockDb);

    repo = new SimpleCampaignRepository();
  });

  describe('#create', function createTests() {
    it('returns the in-memory campaign it persisted, without a read-back', function createDraft() {
      const campaign = repo.create({
        appId: 'app-test',
        name: 'Summer Sale',
        offer: '25% off',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
      });

      expect(campaign.name).toBe('Summer Sale');
      expect(campaign.status).toBe(SimpleCampaignStatus.Draft);
      expect(campaign.offer).toBe('25% off');
      expect(campaign.id).toMatch(/^camp_[0-9a-z]{12}$/);
      expect(mockStatement.run).toHaveBeenCalled();
      expect(mockStatement.get).not.toHaveBeenCalled(); // no SELECT round-trip
    });

    it('throws when the insert affects no rows', function createFail() {
      mockStatement.run.mockReturnValue({ changes: 0 });

      expect(() => repo.create({ appId: 'app-test', name: 'Test' })).toThrow('affected 0 rows');
    });
  });

  describe('#findById', function findByIdTests() {
    it('should return campaign when found', function found() {
      mockStatement.get.mockReturnValue(makeCampaignRow({ id: 'camp_123', app_id: 'app-1', status: 'active', goal: 'awareness' }));

      const result = repo.findById('camp_123');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('camp_123');
      expect(result!.appId).toBe('app-1');
      expect(result!.status).toBe('active');
      expect(result!.goal).toBe('awareness');
    });

    it('should return null when not found', function notFound() {
      mockStatement.get.mockReturnValue(undefined);

      const result = repo.findById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('#findByAppId', function findByAppIdTests() {
    it('should return campaigns for an app', function found() {
      mockStatement.all.mockReturnValue([
        makeCampaignRow({ id: 'camp_1', name: 'A', status: 'draft' }),
        makeCampaignRow({ id: 'camp_2', name: 'B', status: 'active' }),
      ]);

      const results = repo.findByAppId('app-1');

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('camp_1');
      expect(results[1].id).toBe('camp_2');
    });

    it('should return empty array when no campaigns', function empty() {
      mockStatement.all.mockReturnValue([]);

      const results = repo.findByAppId('app-none');
      expect(results).toHaveLength(0);
    });
  });

  describe('#transition', function transitionTests() {
    it('allows draft → ready, returning the updated row from the guarded UPDATE', function draftToReady() {
      // UPDATE ... RETURNING * matches and returns the updated row in one call.
      mockStatement.get.mockReturnValueOnce(makeCampaignRow({ status: 'ready' }));

      const result = repo.transition('camp_t1', SimpleCampaignStatus.Ready);
      expect(result.status).toBe('ready');
      expect(mockStatement.get).toHaveBeenCalledTimes(1); // no read-before-write
    });

    it('allows active → completed', function activeToCompleted() {
      mockStatement.get.mockReturnValueOnce(makeCampaignRow({ status: 'completed', completed_at: '2026-06-04' }));

      const result = repo.transition('camp_t1', SimpleCampaignStatus.Completed);
      expect(result.status).toBe('completed');
      expect(result.completedAt).toBe('2026-06-04');
    });

    it('allows active → archived', function anyToArchived() {
      mockStatement.get.mockReturnValueOnce(makeCampaignRow({ status: 'archived' }));

      const result = repo.transition('camp_t1', SimpleCampaignStatus.Archived);
      expect(result.status).toBe('archived');
    });

    it('throws on an invalid transition (guarded UPDATE matches nothing → one read to disambiguate)', function invalidTransition() {
      // UPDATE matches no row (current status is not a valid predecessor); the follow-up
      // read returns the current draft row, so we report an invalid transition.
      mockStatement.get
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(makeCampaignRow({ status: 'draft' }));

      expect(() => repo.transition('camp_t1', SimpleCampaignStatus.Active)).toThrow('Invalid transition: draft → active');
    });

    it('throws when transitioning to a status nothing leads to (e.g. draft) without an UPDATE', function noValidPrev() {
      mockStatement.get.mockReturnValueOnce(makeCampaignRow({ status: 'ready' }));

      expect(() => repo.transition('camp_t1', SimpleCampaignStatus.Draft)).toThrow('Invalid transition: ready → draft');
    });

    it('throws when campaign not found', function notFound() {
      mockStatement.get.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);

      expect(() => repo.transition('nonexistent', SimpleCampaignStatus.Ready)).toThrow('Campaign not found: nonexistent');
    });
  });

  describe('#update', function updateTests() {
    it('should update campaign fields', function updateFields() {
      mockStatement.get.mockReturnValue(makeCampaignRow({ id: 'camp_u1', name: 'Updated', offer: 'new offer' }));

      const result = repo.update('camp_u1', { name: 'Updated', offer: 'new offer' });

      expect(result.name).toBe('Updated');
      expect(result.offer).toBe('new offer');
    });

    it('should return existing campaign when no fields to update', function noUpdate() {
      mockStatement.get.mockReturnValue(makeCampaignRow({ id: 'camp_u2', name: 'Same' }));

      const result = repo.update('camp_u2', {});
      expect(result.name).toBe('Same');
    });

    it('should throw when campaign not found', function notFound() {
      mockStatement.get.mockReturnValue(undefined);

      expect(() => repo.update('nonexistent', { name: 'X' })).toThrow('Campaign not found: nonexistent');
    });
  });

  describe('#delete', function deleteTests() {
    it('should return true when campaign deleted', function deleted() {
      mockStatement.run.mockReturnValue({ changes: 1 });
      expect(repo.delete('camp_d1')).toBe(true);
    });

    it('should return false when campaign not found', function notDeleted() {
      mockStatement.run.mockReturnValue({ changes: 0 });
      expect(repo.delete('nonexistent')).toBe(false);
    });
  });

  describe('#launch', function launchTests() {
    it('launches a ready campaign (status decided in SQL), returning the updated row', function launchActive() {
      mockStatement.get.mockReturnValueOnce(makeCampaignRow({ id: 'camp_l1', status: 'active', launched_at: '2026-06-04T00:00:00.000Z' }));

      const result = repo.launch('camp_l1');
      expect(result.status).toBe('active');
      expect(result.launchedAt).toBeTruthy();
      expect(mockStatement.get).toHaveBeenCalledTimes(1); // no read-before-write
    });

    it('throws when the campaign is not launchable (guarded UPDATE matches nothing)', function cantLaunchDraft() {
      mockStatement.get
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(makeCampaignRow({ id: 'camp_l3', status: 'draft' }));

      expect(() => repo.launch('camp_l3')).toThrow('Cannot launch campaign in status: draft');
    });
  });

  describe('#addContent', function addContentTests() {
    it('returns the in-memory content it persisted, without a read-back', function createContent() {
      const content = repo.addContent({
        simpleCampaignId: 'camp_1',
        assetType: 'blog',
        title: 'Summer Sale Blog Post',
        contentRefId: '/blog/summer-sale',
        scheduledDate: '2026-07-01',
        contentPreview: 'Check out our summer sale...',
      });

      expect(content.simpleCampaignId).toBe('camp_1');
      expect(content.assetType).toBe('blog');
      expect(content.title).toBe('Summer Sale Blog Post');
      expect(content.contentRefId).toBe('/blog/summer-sale');
      expect(content.id).toMatch(/^cont_[0-9a-z]{12}$/);
      expect(mockStatement.run).toHaveBeenCalled();
      expect(mockStatement.get).not.toHaveBeenCalled();
    });
  });

  describe('#getContent', function getContentTests() {
    it('should return content for a campaign', function found() {
      mockStatement.all.mockReturnValue([
        { id: 'cont_1', simple_campaign_id: 'camp_1', asset_type: 'blog', content_ref_id: null, title: 'Blog', scheduled_date: null, status: 'draft', content_preview: null, image_url: null, created_by: null, created_at: '2026-01-01' },
        { id: 'cont_2', simple_campaign_id: 'camp_1', asset_type: 'social', content_ref_id: null, title: 'Post', scheduled_date: null, status: 'scheduled', content_preview: null, image_url: null, created_by: null, created_at: '2026-01-02' },
      ]);

      const content = repo.getContent('camp_1');

      expect(content).toHaveLength(2);
      expect(content[0].assetType).toBe('blog');
      expect(content[1].assetType).toBe('social');
      expect(content[0].simpleCampaignId).toBe('camp_1');
    });
  });

  describe('#deleteContentByCampaign', function deleteContentTests() {
    it('should return number of deleted content rows', function deleteMultiple() {
      mockStatement.run.mockReturnValue({ changes: 3 });
      expect(repo.deleteContentByCampaign('camp_1')).toBe(3);
    });

    it('should return 0 when no content to delete', function deleteNone() {
      mockStatement.run.mockReturnValue({ changes: 0 });
      expect(repo.deleteContentByCampaign('camp_empty')).toBe(0);
    });
  });

  describe('#findActive', function findActiveTests() {
    it('should return only active campaigns for an app', function activeOnly() {
      mockStatement.all.mockReturnValue([makeCampaignRow({ id: 'camp_a1', name: 'Active One', status: 'active' })]);

      const results = repo.findActive('app-1');
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('active');
    });
  });

  describe('#findDueForCompletion', function findDueTests() {
    it('should return active campaigns past their end_date', function pastEnd() {
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      mockStatement.all.mockReturnValue([makeCampaignRow({ id: 'camp_d1', name: 'Overdue', status: 'active', end_date: pastDate })]);

      const results = repo.findDueForCompletion();
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Overdue');
    });
  });
});
