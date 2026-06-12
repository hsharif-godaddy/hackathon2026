import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initializeTestDatabase } from '../../schema.js';

vi.mock('../../connection.js');
vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('SeoQualityRepository', () => {
  let testDb: Database.Database;
  let repo: InstanceType<typeof import('../SeoQualityRepository.js').SeoQualityRepository>;

  const APP_A = 'app-rubicon1';
  const APP_B = 'app-rubicon2';

  function createApp(appId: string): void {
    testDb
      .prepare(
        `INSERT INTO apps (id, name, path, port, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      )
      .run(appId, 'Test App', `/tmp/${appId}`, 3000, 'created');
  }

  const baseParams = {
    score: 85,
    pageScores: { '/': 100, '/about': 70 } as Record<string, number>,
    missingElements: { '/about': ['missing-title'] } as Record<string, string[]>,
    triggeredBy: 'publish' as const,
  };

  beforeEach(async () => {
    testDb = new Database(':memory:');
    initializeTestDatabase(testDb);

    const { getDatabase } = await import('../../connection.js');
    vi.mocked(getDatabase).mockReturnValue(testDb as any);

    const { SeoQualityRepository } = await import('../SeoQualityRepository.js');
    repo = new SeoQualityRepository();

    createApp(APP_A);
    createApp(APP_B);
  });

  afterEach(() => {
    try { testDb.close(); } catch { /* ignore */ }
    vi.resetModules();
  });

  describe('save() — baseline auto-marking', () => {
    it('marks the first snapshot for an app as the baseline', () => {
      const snap = repo.save({ appId: APP_A, ...baseParams });
      expect(snap.isBaseline).toBe(true);
    });

    it('does not mark the second snapshot as baseline', () => {
      repo.save({ appId: APP_A, ...baseParams });
      const second = repo.save({ appId: APP_A, ...baseParams, score: 90 });
      expect(second.isBaseline).toBe(false);
    });

    it('marks the first snapshot for a different app as its own baseline', () => {
      repo.save({ appId: APP_A, ...baseParams });
      const snapB = repo.save({ appId: APP_B, ...baseParams });
      expect(snapB.isBaseline).toBe(true);
    });

    it('persists pageScores and missingElements as JSON strings', () => {
      const snap = repo.save({ appId: APP_A, ...baseParams });
      const row = testDb
        .prepare<[string], { page_scores: string; missing_elements: string }>(
          'SELECT page_scores, missing_elements FROM seo_quality_scores WHERE id = ?'
        )
        .get(snap.id);
      expect(JSON.parse(row!.page_scores)).toEqual(baseParams.pageScores);
      expect(JSON.parse(row!.missing_elements)).toEqual(baseParams.missingElements);
    });

    it('UNIQUE partial index prevents a second baseline via direct SQL', () => {
      repo.save({ appId: APP_A, ...baseParams });
      expect(() =>
        testDb
          .prepare(
            `INSERT INTO seo_quality_scores
               (id, app_id, score, page_scores, missing_elements, triggered_by, is_baseline)
             VALUES ('x', ?, 100, '{}', '{}', 'publish', 1)`
          )
          .run(APP_A)
      ).toThrow();
    });
  });

  describe('findById()', () => {
    it('returns the saved snapshot by id', () => {
      const saved = repo.save({ appId: APP_A, ...baseParams });
      const found = repo.findById(saved.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(saved.id);
      expect(found!.score).toBe(baseParams.score);
    });

    it('returns null for an unknown id', () => {
      expect(repo.findById('does-not-exist')).toBeNull();
    });
  });

  describe('findBaseline()', () => {
    it('returns the baseline snapshot', () => {
      const baseline = repo.save({ appId: APP_A, ...baseParams });
      repo.save({ appId: APP_A, ...baseParams, score: 90 });
      const found = repo.findBaseline(APP_A);
      expect(found!.id).toBe(baseline.id);
      expect(found!.isBaseline).toBe(true);
    });

    it('returns null when no snapshots exist', () => {
      expect(repo.findBaseline(APP_A)).toBeNull();
    });

    it('is isolated per app', () => {
      repo.save({ appId: APP_A, ...baseParams });
      expect(repo.findBaseline(APP_B)).toBeNull();
    });
  });

  describe('findLatest()', () => {
    it('returns the most recent snapshot', () => {
      const first = repo.save({ appId: APP_A, ...baseParams, score: 70 });
      // Backdate the first row so the second is definitively newer (CURRENT_TIMESTAMP is second-precision)
      testDb
        .prepare(`UPDATE seo_quality_scores SET created_at = datetime('now', '-1 second') WHERE id = ?`)
        .run(first.id);
      const latest = repo.save({ appId: APP_A, ...baseParams, score: 90 });
      const found = repo.findLatest(APP_A);
      expect(found!.id).toBe(latest.id);
    });

    it('returns null when no snapshots exist', () => {
      expect(repo.findLatest(APP_A)).toBeNull();
    });
  });

  describe('findRecent()', () => {
    it('returns up to the requested limit, newest first', () => {
      for (let i = 1; i <= 5; i++) {
        repo.save({ appId: APP_A, ...baseParams, score: i * 10 });
      }
      const recent = repo.findRecent(APP_A, 3);
      expect(recent).toHaveLength(3);
      expect(recent[0]!.score).toBeGreaterThanOrEqual(recent[1]!.score);
    });

    it('returns all snapshots when count is below the limit', () => {
      repo.save({ appId: APP_A, ...baseParams });
      repo.save({ appId: APP_A, ...baseParams });
      expect(repo.findRecent(APP_A, 10)).toHaveLength(2);
    });

    it('returns an empty array when no snapshots exist', () => {
      expect(repo.findRecent(APP_A)).toHaveLength(0);
    });

    it('is isolated per app', () => {
      repo.save({ appId: APP_A, ...baseParams });
      expect(repo.findRecent(APP_B)).toHaveLength(0);
    });
  });
});
