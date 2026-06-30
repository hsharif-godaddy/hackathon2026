import { getDatabase } from '../connection.js';
import type Database from 'better-sqlite3';
import { SimpleCampaignStatus, SimpleCampaignContentStatus, SimpleCampaignContentType } from '../schema.js';
import type { SimpleCampaign, SimpleCampaignContent, CampaignActor } from '../schema.js';
import { Logger } from '../../logging/index.js';
import { assertEnumValue } from '../../utils/enum-guard.js';
import { serializePlanRationale, parsePlanRationale, type PlanRationale } from '../plan-rationale.js';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);
const logger = Logger.create({ component: 'simple-campaign-repository' });

const VALID_TRANSITIONS: Record<SimpleCampaignStatus, SimpleCampaignStatus[]> = {
  [SimpleCampaignStatus.Draft]: [SimpleCampaignStatus.Ready, SimpleCampaignStatus.Archived],
  [SimpleCampaignStatus.Ready]: [SimpleCampaignStatus.Scheduled, SimpleCampaignStatus.Archived],
  [SimpleCampaignStatus.Scheduled]: [SimpleCampaignStatus.Active, SimpleCampaignStatus.Archived],
  [SimpleCampaignStatus.Active]: [SimpleCampaignStatus.Completed, SimpleCampaignStatus.Archived],
  [SimpleCampaignStatus.Completed]: [SimpleCampaignStatus.Archived],
  [SimpleCampaignStatus.Archived]: [],
};

export interface CreateSimpleCampaignParams {
  appId: string;
  name: string;
  offer?: string;
  goal?: string;
  /** Campaign-level plan rationale (one per campaign) for the feedback loop. */
  planRationale?: PlanRationale;
  startDate?: string;
  endDate?: string;
  /** Who created the campaign — a customer action or the agent. */
  createdBy?: CampaignActor;
}

export interface UpdateSimpleCampaignParams {
  name?: string;
  offer?: string;
  goal?: string;
  /** Campaign-level plan rationale (one per campaign) for the feedback loop. */
  planRationale?: PlanRationale;
  startDate?: string;
  endDate?: string;
  /** Who made this update — a customer action or the agent. */
  updatedBy?: CampaignActor;
}

export interface CreateSimpleCampaignContentParams {
  simpleCampaignId: string;
  assetType: SimpleCampaignContentType;
  title: string;
  contentRefId?: string;
  scheduledDate?: string;
  status?: SimpleCampaignContentStatus;
  contentPreview?: string;
  imageUrl?: string;
  /** Serialized JSON draft payload stored opaquely (social: {message, hashtags, callToAction, platform}). */
  rawContent?: string;
  /** Who created this content — a customer action or the agent. */
  createdBy?: CampaignActor;
}

export interface UpdateSimpleCampaignContentParams {
  title?: string;
  contentRefId?: string;
  scheduledDate?: string | null;
  status?: SimpleCampaignContentStatus;
  contentPreview?: string;
  imageUrl?: string;
  /** Serialized JSON draft payload stored opaquely (social: {message, hashtags, callToAction, platform}). */
  rawContent?: string;
}

interface SimpleCampaignRow {
  id: string;
  app_id: string;
  marketing_plan_id: string | null;
  name: string;
  status: string;
  offer: string | null;
  goal: string | null;
  plan_rationale: string | null;
  start_date: string | null;
  end_date: string | null;
  launched_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

interface SimpleCampaignContentRow {
  id: string;
  simple_campaign_id: string;
  asset_type: string;
  content_ref_id: string | null;
  title: string;
  scheduled_date: string | null;
  status: string;
  content_preview: string | null;
  image_url: string | null;
  raw_content: string | null;
  created_by: string | null;
  created_at: string;
}

export class SimpleCampaignRepository {
  private db: Database.Database = getDatabase();

  /**
   * Construct the row in memory, persist it, and return that object — no read-back.
   * The DB is treated as raw persistence: id/status/timestamps are assigned in the app
   * layer (not via DB defaults), and run().changes is the authoritative success check.
   */
  create(params: CreateSimpleCampaignParams): SimpleCampaign {
    const id: string = nanoid();
    const now: string = new Date().toISOString();
    const campaign: SimpleCampaign = {
      id,
      appId: params.appId,
      marketingPlanId: null,
      name: params.name,
      status: SimpleCampaignStatus.Draft,
      offer: params.offer ?? null,
      goal: params.goal ?? null,
      planRationale: params.planRationale ?? null,
      startDate: params.startDate ?? null,
      endDate: params.endDate ?? null,
      launchedAt: null,
      completedAt: null,
      createdBy: params.createdBy ?? null,
      updatedBy: params.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const info: Database.RunResult = this.db
      .prepare(
        `INSERT INTO simple_campaign (id, app_id, marketing_plan_id, name, status, offer, goal, plan_rationale, start_date, end_date, launched_at, completed_at, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        campaign.id,
        campaign.appId,
        campaign.marketingPlanId,
        campaign.name,
        campaign.status,
        campaign.offer,
        campaign.goal,
        campaign.planRationale ? serializePlanRationale(campaign.planRationale) : null,
        campaign.startDate,
        campaign.endDate,
        campaign.launchedAt,
        campaign.completedAt,
        campaign.createdBy,
        campaign.updatedBy,
        campaign.createdAt,
        campaign.updatedAt,
      );
    if (info.changes !== 1) {
      throw new Error(`simple_campaign insert affected ${info.changes} rows`);
    }

    logger.info('simpleCampaign.created', { id, appId: params.appId });
    return campaign;
  }

  findById(id: string): SimpleCampaign | null {
    const row: SimpleCampaignRow | undefined = this.db
      .prepare(`SELECT * FROM simple_campaign WHERE id = ?`)
      .get(id) as SimpleCampaignRow | undefined;

    return row ? this.mapRowToCampaign(row) : null;
  }

  findByAppId(appId: string): SimpleCampaign[] {
    const rows: SimpleCampaignRow[] = this.db
      .prepare(`SELECT * FROM simple_campaign WHERE app_id = ? ORDER BY created_at DESC`)
      .all(appId) as SimpleCampaignRow[];

    return rows.map((row: SimpleCampaignRow): SimpleCampaign => this.mapRowToCampaign(row));
  }

  findActive(appId: string): SimpleCampaign[] {
    const rows: SimpleCampaignRow[] = this.db
      .prepare(`SELECT * FROM simple_campaign WHERE app_id = ? AND status = ? ORDER BY created_at DESC`)
      .all(appId, SimpleCampaignStatus.Active) as SimpleCampaignRow[];

    return rows.map((row: SimpleCampaignRow): SimpleCampaign => this.mapRowToCampaign(row));
  }

  findDueForCompletion(): SimpleCampaign[] {
    const now: string = new Date().toISOString();
    const rows: SimpleCampaignRow[] = this.db
      .prepare(`SELECT * FROM simple_campaign WHERE status = ? AND end_date IS NOT NULL AND end_date <= ?`)
      .all(SimpleCampaignStatus.Active, now) as SimpleCampaignRow[];

    return rows.map((row: SimpleCampaignRow): SimpleCampaign => this.mapRowToCampaign(row));
  }

  /**
   * Apply a partial update and return the updated row in a single statement
   * (UPDATE ... RETURNING). No read-before-write; a missing row surfaces as 0 rows.
   */
  update(id: string, params: UpdateSimpleCampaignParams): SimpleCampaign {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (params.name !== undefined) { fields.push('name = ?'); values.push(params.name); }
    if (params.offer !== undefined) { fields.push('offer = ?'); values.push(params.offer); }
    if (params.goal !== undefined) { fields.push('goal = ?'); values.push(params.goal); }
    if (params.planRationale !== undefined) { fields.push('plan_rationale = ?'); values.push(serializePlanRationale(params.planRationale)); }
    if (params.startDate !== undefined) { fields.push('start_date = ?'); values.push(params.startDate); }
    if (params.endDate !== undefined) { fields.push('end_date = ?'); values.push(params.endDate); }
    if (params.updatedBy !== undefined) { fields.push('updated_by = ?'); values.push(params.updatedBy); }

    if (fields.length === 0) {
      const existing: SimpleCampaign | null = this.findById(id);
      if (!existing) {
        throw new Error(`Campaign not found: ${id}`);
      }
      return existing;
    }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    const row: SimpleCampaignRow | undefined = this.db
      .prepare(`UPDATE simple_campaign SET ${fields.join(', ')} WHERE id = ? RETURNING *`)
      .get(...values) as SimpleCampaignRow | undefined;
    if (!row) {
      throw new Error(`Campaign not found: ${id}`);
    }

    logger.info('simpleCampaign.updated', { id });
    return this.mapRowToCampaign(row);
  }

  delete(id: string): boolean {
    const info: Database.RunResult = this.db.prepare(`DELETE FROM simple_campaign WHERE id = ?`).run(id);
    if (info.changes > 0) {
      logger.info('simpleCampaign.deleted', { id });
    }
    return info.changes > 0;
  }

  /**
   * Move a campaign to newStatus, enforcing the FSM in the WHERE clause: the update only
   * succeeds when the current status is one that legally transitions to newStatus. No
   * read-before-write; on 0 rows we do a single read to distinguish not-found from an
   * invalid transition for a precise error.
   */
  transition(id: string, newStatus: SimpleCampaignStatus): SimpleCampaign {
    const validPrev: SimpleCampaignStatus[] = (Object.values(SimpleCampaignStatus) as SimpleCampaignStatus[]).filter(
      (from: SimpleCampaignStatus): boolean => VALID_TRANSITIONS[from].includes(newStatus),
    );

    if (validPrev.length === 0) {
      this.throwTransitionError(id, newStatus);
    }

    const now: string = new Date().toISOString();
    const setCompleted: boolean = newStatus === SimpleCampaignStatus.Completed;
    const placeholders: string = validPrev.map((): string => '?').join(', ');
    const sql: string = `UPDATE simple_campaign
       SET status = ?, updated_at = ?${setCompleted ? ', completed_at = ?' : ''}
       WHERE id = ? AND status IN (${placeholders})
       RETURNING *`;
    const values: unknown[] = setCompleted
      ? [newStatus, now, now, id, ...validPrev]
      : [newStatus, now, id, ...validPrev];

    const row: SimpleCampaignRow | undefined = this.db.prepare(sql).get(...values) as SimpleCampaignRow | undefined;
    if (!row) {
      this.throwTransitionError(id, newStatus);
    }

    logger.info('simpleCampaign.transitioned', { id, to: newStatus });
    return this.mapRowToCampaign(row as SimpleCampaignRow);
  }

  /**
   * Launch a campaign: valid only from ready/scheduled. A future start_date lands it in
   * scheduled, otherwise active — decided in SQL so we never read first. 0 rows means it
   * was missing or not in a launchable status.
   */
  launch(id: string): SimpleCampaign {
    const now: string = new Date().toISOString();
    const row: SimpleCampaignRow | undefined = this.db
      .prepare(
        `UPDATE simple_campaign
         SET status = CASE WHEN start_date IS NOT NULL AND start_date > ? THEN '${SimpleCampaignStatus.Scheduled}' ELSE '${SimpleCampaignStatus.Active}' END,
             launched_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('${SimpleCampaignStatus.Ready}', '${SimpleCampaignStatus.Scheduled}')
         RETURNING *`,
      )
      .get(now, now, now, id) as SimpleCampaignRow | undefined;

    if (!row) {
      const current: SimpleCampaign | null = this.findById(id);
      if (!current) {
        throw new Error(`Campaign not found: ${id}`);
      }
      throw new Error(`Cannot launch campaign in status: ${current.status}`);
    }

    logger.info('simpleCampaign.launched', { id, status: row.status });
    return this.mapRowToCampaign(row);
  }

  /** One read, only on the failure path, to produce a precise transition error. */
  private throwTransitionError(id: string, newStatus: SimpleCampaignStatus): never {
    const current: SimpleCampaign | null = this.findById(id);
    if (!current) {
      throw new Error(`Campaign not found: ${id}`);
    }
    throw new Error(`Invalid transition: ${current.status} → ${newStatus}`);
  }

  // Campaign content methods (the thin tracking/projection layer)

  addContent(params: CreateSimpleCampaignContentParams): SimpleCampaignContent {
    // Enum columns have no DB constraint; validate against the TS enums here. This is
    // the boundary untrusted input reaches (e.g. the POST /assets route body).
    assertEnumValue(SimpleCampaignContentType, params.assetType, 'asset_type');
    if (params.status !== undefined) {
      assertEnumValue(SimpleCampaignContentStatus, params.status, 'status');
    }

    const id: string = nanoid();
    const now: string = new Date().toISOString();
    const content: SimpleCampaignContent = {
      id,
      simpleCampaignId: params.simpleCampaignId,
      assetType: params.assetType,
      contentRefId: params.contentRefId ?? null,
      title: params.title,
      scheduledDate: params.scheduledDate ?? null,
      status: params.status ?? SimpleCampaignContentStatus.Draft,
      contentPreview: params.contentPreview ?? null,
      imageUrl: params.imageUrl ?? null,
      rawContent: params.rawContent ?? null,
      createdBy: params.createdBy ?? null,
      createdAt: now,
    };

    const info: Database.RunResult = this.db
      .prepare(
        `INSERT INTO simple_campaign_content (id, simple_campaign_id, asset_type, content_ref_id, title, scheduled_date, status, content_preview, image_url, raw_content, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        content.id,
        content.simpleCampaignId,
        content.assetType,
        content.contentRefId,
        content.title,
        content.scheduledDate,
        content.status,
        content.contentPreview,
        content.imageUrl,
        content.rawContent,
        content.createdBy,
        content.createdAt,
      );
    if (info.changes !== 1) {
      throw new Error(`simple_campaign_content insert affected ${info.changes} rows`);
    }

    logger.info('simpleCampaign.content.created', {
      id,
      simpleCampaignId: params.simpleCampaignId,
      type: params.assetType,
    });
    return content;
  }

  getContent(simpleCampaignId: string): SimpleCampaignContent[] {
    const rows: SimpleCampaignContentRow[] = this.db
      .prepare(`SELECT * FROM simple_campaign_content WHERE simple_campaign_id = ? ORDER BY created_at DESC`)
      .all(simpleCampaignId) as SimpleCampaignContentRow[];

    return rows.map((row: SimpleCampaignContentRow): SimpleCampaignContent => this.mapRowToContent(row));
  }

  findContentById(id: string): SimpleCampaignContent | null {
    const row: SimpleCampaignContentRow | undefined = this.db
      .prepare(`SELECT * FROM simple_campaign_content WHERE id = ?`)
      .get(id) as SimpleCampaignContentRow | undefined;

    return row ? this.mapRowToContent(row) : null;
  }

  updateContent(contentId: string, params: UpdateSimpleCampaignContentParams): SimpleCampaignContent {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (params.title !== undefined) { fields.push('title = ?'); values.push(params.title); }
    if (params.contentRefId !== undefined) { fields.push('content_ref_id = ?'); values.push(params.contentRefId); }
    if (params.scheduledDate !== undefined) { fields.push('scheduled_date = ?'); values.push(params.scheduledDate); }
    if (params.status !== undefined) { fields.push('status = ?'); values.push(params.status); }
    if (params.contentPreview !== undefined) { fields.push('content_preview = ?'); values.push(params.contentPreview); }
    if (params.imageUrl !== undefined) { fields.push('image_url = ?'); values.push(params.imageUrl); }
    if (params.rawContent !== undefined) { fields.push('raw_content = ?'); values.push(params.rawContent); }

    if (fields.length === 0) {
      const existing: SimpleCampaignContent | null = this.findContentById(contentId);
      if (!existing) {
        throw new Error(`Campaign content not found: ${contentId}`);
      }
      return existing;
    }

    values.push(contentId);

    const row: SimpleCampaignContentRow | undefined = this.db
      .prepare(`UPDATE simple_campaign_content SET ${fields.join(', ')} WHERE id = ? RETURNING *`)
      .get(...values) as SimpleCampaignContentRow | undefined;
    if (!row) {
      throw new Error(`Campaign content not found: ${contentId}`);
    }

    logger.info('simpleCampaign.content.updated', { contentId });
    return this.mapRowToContent(row);
  }

  deleteContent(contentId: string): boolean {
    const info: Database.RunResult = this.db.prepare(`DELETE FROM simple_campaign_content WHERE id = ?`).run(contentId);
    return info.changes > 0;
  }

  deleteContentByCampaign(simpleCampaignId: string): number {
    const info: Database.RunResult = this.db
      .prepare(`DELETE FROM simple_campaign_content WHERE simple_campaign_id = ?`)
      .run(simpleCampaignId);
    return info.changes;
  }

  private mapRowToCampaign(row: SimpleCampaignRow): SimpleCampaign {
    return {
      id: row.id,
      appId: row.app_id,
      marketingPlanId: row.marketing_plan_id,
      name: row.name,
      status: row.status as SimpleCampaignStatus,
      offer: row.offer,
      goal: row.goal,
      planRationale: parsePlanRationale(row.plan_rationale),
      startDate: row.start_date,
      endDate: row.end_date,
      launchedAt: row.launched_at,
      completedAt: row.completed_at,
      createdBy: row.created_by as CampaignActor | null,
      updatedBy: row.updated_by as CampaignActor | null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapRowToContent(row: SimpleCampaignContentRow): SimpleCampaignContent {
    return {
      id: row.id,
      simpleCampaignId: row.simple_campaign_id,
      assetType: row.asset_type as SimpleCampaignContentType,
      contentRefId: row.content_ref_id,
      title: row.title,
      scheduledDate: row.scheduled_date,
      status: row.status as SimpleCampaignContentStatus,
      contentPreview: row.content_preview,
      imageUrl: row.image_url,
      rawContent: row.raw_content,
      createdBy: row.created_by as CampaignActor | null,
      createdAt: row.created_at,
    };
  }
}
