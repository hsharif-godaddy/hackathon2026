import { randomUUID } from 'node:crypto';
import { getDatabase } from '../connection.js';
import type { SeoQualityScore, SeoQualityTriggeredBy } from '../schema.js';

interface SeoQualityScoreRow {
  id: string;
  app_id: string;
  score: number;
  page_scores: string;
  missing_elements: string;
  triggered_by: SeoQualityTriggeredBy;
  is_baseline: number; // SQLite stores booleans as 0/1
  created_at: string;
}

function rowToRecord(row: SeoQualityScoreRow): SeoQualityScore {
  return {
    id: row.id,
    appId: row.app_id,
    score: row.score,
    pageScores: row.page_scores,
    missingElements: row.missing_elements,
    triggeredBy: row.triggered_by,
    isBaseline: row.is_baseline === 1,
    createdAt: new Date(row.created_at),
  };
}

export class SeoQualityRepository {
  private db = getDatabase();

  /**
   * Persist a new quality snapshot. First snapshot for the app becomes the baseline.
   *
   * The SELECT + INSERT are wrapped in a transaction so two concurrent publishes
   * for the same app cannot both observe cnt=0 and both mark themselves baseline.
   * The UNIQUE partial index on (app_id) WHERE is_baseline = TRUE enforces the
   * invariant at the DB level as a second safety net.
   */
  save(params: {
    appId: string;
    score: number;
    pageScores: Record<string, number>;
    missingElements: Record<string, string[]>;
    triggeredBy: SeoQualityTriggeredBy;
  }): SeoQualityScore {
    const id = randomUUID();

    const insertSnapshot = this.db.transaction(() => {
      const hasBaseline = this.db
        .prepare<[string], { cnt: number }>(
          'SELECT COUNT(*) AS cnt FROM seo_quality_scores WHERE app_id = ? AND is_baseline = TRUE'
        )
        .get(params.appId);

      const isBaseline = !hasBaseline || hasBaseline.cnt === 0;

      this.db
        .prepare(
          `INSERT INTO seo_quality_scores
             (id, app_id, score, page_scores, missing_elements, triggered_by, is_baseline)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          params.appId,
          params.score,
          JSON.stringify(params.pageScores),
          JSON.stringify(params.missingElements),
          params.triggeredBy,
          isBaseline ? 1 : 0,
        );
    });

    insertSnapshot();
    return this.findById(id)!;
  }

  findById(id: string): SeoQualityScore | null {
    const row = this.db
      .prepare<[string], SeoQualityScoreRow>(
        'SELECT * FROM seo_quality_scores WHERE id = ?'
      )
      .get(id);
    return row ? rowToRecord(row) : null;
  }

  /** The first snapshot saved for this app (is_baseline = true). */
  findBaseline(appId: string): SeoQualityScore | null {
    const row = this.db
      .prepare<[string], SeoQualityScoreRow>(
        'SELECT * FROM seo_quality_scores WHERE app_id = ? AND is_baseline = TRUE ORDER BY created_at ASC LIMIT 1'
      )
      .get(appId);
    return row ? rowToRecord(row) : null;
  }

  /** Most recent snapshot for the app. */
  findLatest(appId: string): SeoQualityScore | null {
    const row = this.db
      .prepare<[string], SeoQualityScoreRow>(
        'SELECT * FROM seo_quality_scores WHERE app_id = ? ORDER BY created_at DESC LIMIT 1'
      )
      .get(appId);
    return row ? rowToRecord(row) : null;
  }

  /** Last N snapshots, newest first. */
  findRecent(appId: string, limit = 10): SeoQualityScore[] {
    const rows = this.db
      .prepare<[string, number], SeoQualityScoreRow>(
        'SELECT * FROM seo_quality_scores WHERE app_id = ? ORDER BY created_at DESC LIMIT ?'
      )
      .all(appId, limit);
    return rows.map(rowToRecord);
  }
}
