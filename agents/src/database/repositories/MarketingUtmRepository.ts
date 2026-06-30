import { getDatabase } from '../connection.js';
import type Database from 'better-sqlite3';
import { UtmMedium } from '../schema.js';
import type { UTMAttributionParams, UtmSource } from '../schema.js';
import { Logger } from '../../logging/index.js';
import { customAlphabet } from 'nanoid';
import { buildCampaignToken, buildContentToken } from '../../utils/campaign-utm-signer.js';
import { assertEnumValue } from '../../utils/enum-guard.js';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);
const logger = Logger.create({ component: 'marketing-utm-repository' });

export interface CreateUTMAttributionParams {
  /** Id of the target content row (social_posts.id, …). */
  contentRefId: string;
  utmSource?: UtmSource;
  utmMedium?: UtmMedium;
  /**
   * Id of the owning simple campaign — present ONLY when the target belongs to a
   * campaign. It is intentionally optional: content created outside a marketing
   * campaign (e.g. a one-off blog post) still gets utm_source/utm_medium attribution
   * but no campaign linkage, so simple_campaign_id / utm_campaign stay null.
   */
  simpleCampaignId?: string;
  utmContent?: string;
  utmTerm?: string;
}

interface UTMAttributionParamsRow {
  id: string;
  content_ref_id: string;
  simple_campaign_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  created_at: string;
  updated_at: string;
}

export class MarketingUtmRepository {
  private db: Database.Database = getDatabase();

  /**
   * Record UTM attribution for a target. When simpleCampaignId is provided, utm_campaign
   * is the opaque `cmp_<hash>` token (campaign id hashed with the global UTM_SALT) — so
   * every row of the same campaign resolves to one stable utm_campaign (what the
   * warehouse aggregates on, and what the Customer Stats API call reproduces for
   * reverse lookups). Without a simpleCampaignId, utm_campaign stays null.
   *
   * utm_content is the opaque `act_<hash>` token of the target content id — one stable
   * token per carrier (RUBICON-500). It is derived here by default; a caller may pass an
   * explicit utmContent to override (e.g. a richer act_/cr_ form in a future milestone).
   *
   * The row is constructed in memory and returned directly: id/timestamps live in the
   * app layer and run().changes is the authoritative success check — no read-back.
   * utm_medium is validated against its enum here (no DB constraint).
   */
  create(params: CreateUTMAttributionParams): UTMAttributionParams {
    if (params.utmMedium !== undefined) {
      assertEnumValue(UtmMedium, params.utmMedium, 'utm_medium');
    }

    const id: string = nanoid();
    const now: string = new Date().toISOString();
    const utmCampaign: string | null = params.simpleCampaignId
      ? buildCampaignToken(params.simpleCampaignId)
      : null;
    const utmContent: string = params.utmContent ?? buildContentToken(params.contentRefId);

    const utm: UTMAttributionParams = {
      id,
      contentRefId: params.contentRefId,
      simpleCampaignId: params.simpleCampaignId ?? null,
      utmSource: params.utmSource ?? null,
      utmMedium: params.utmMedium ?? null,
      utmCampaign,
      utmContent,
      utmTerm: params.utmTerm ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const info: Database.RunResult = this.db
      .prepare(
        `INSERT INTO marketing_utm (id, content_ref_id, simple_campaign_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        utm.id,
        utm.contentRefId,
        utm.simpleCampaignId,
        utm.utmSource,
        utm.utmMedium,
        utm.utmCampaign,
        utm.utmContent,
        utm.utmTerm,
        utm.createdAt,
        utm.updatedAt,
      );
    if (info.changes !== 1) {
      throw new Error(`marketing_utm insert affected ${info.changes} rows`);
    }

    logger.info('marketingUtm.created', {
      id,
      contentRefId: params.contentRefId,
      simpleCampaignId: params.simpleCampaignId ?? null,
    });
    return utm;
  }

  findById(id: string): UTMAttributionParams | null {
    const row: UTMAttributionParamsRow | undefined = this.db
      .prepare(`SELECT * FROM marketing_utm WHERE id = ?`)
      .get(id) as UTMAttributionParamsRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  findByContentRefId(contentRefId: string): UTMAttributionParams[] {
    const rows: UTMAttributionParamsRow[] = this.db
      .prepare(`SELECT * FROM marketing_utm WHERE content_ref_id = ? ORDER BY created_at DESC`)
      .all(contentRefId) as UTMAttributionParamsRow[];

    return rows.map((row: UTMAttributionParamsRow): UTMAttributionParams => this.mapRow(row));
  }

  /** Remove all UTM rows for a content ref. Used when a campaign social draft is deleted so
   *  its attribution does not outlive the post it pointed at. Returns rows deleted. */
  deleteByContentRefId(contentRefId: string): number {
    const result = this.db
      .prepare(`DELETE FROM marketing_utm WHERE content_ref_id = ?`)
      .run(contentRefId);
    return result.changes;
  }

  findBySimpleCampaignId(simpleCampaignId: string): UTMAttributionParams[] {
    const rows: UTMAttributionParamsRow[] = this.db
      .prepare(`SELECT * FROM marketing_utm WHERE simple_campaign_id = ? ORDER BY created_at DESC`)
      .all(simpleCampaignId) as UTMAttributionParamsRow[];

    return rows.map((row: UTMAttributionParamsRow): UTMAttributionParams => this.mapRow(row));
  }

  /**
   * Canonical reverse lookup for attribution. utm_campaign alone is NOT unique across
   * platforms — the same campaign fans out to many (utm_source, utm_medium) pairs — so
   * the warehouse join key is the composite (utm_source, utm_medium, utm_campaign).
   */
  findByComposite(utmSource: UtmSource, utmMedium: UtmMedium, utmCampaign: string): UTMAttributionParams[] {
    const rows: UTMAttributionParamsRow[] = this.db
      .prepare(
        `SELECT * FROM marketing_utm
         WHERE utm_source = ? AND utm_medium = ? AND utm_campaign = ?
         ORDER BY created_at DESC`,
      )
      .all(utmSource, utmMedium, utmCampaign) as UTMAttributionParamsRow[];

    return rows.map((row: UTMAttributionParamsRow): UTMAttributionParams => this.mapRow(row));
  }

  /**
   * Reverse lookup by utm_campaign alone. Retained for callers that only have the
   * campaign token; prefer findByComposite where source/medium are known, since
   * utm_campaign is not unique across platforms.
   */
  findByUtmCampaign(utmCampaign: string): UTMAttributionParams[] {
    const rows: UTMAttributionParamsRow[] = this.db
      .prepare(`SELECT * FROM marketing_utm WHERE utm_campaign = ? ORDER BY created_at DESC`)
      .all(utmCampaign) as UTMAttributionParamsRow[];

    return rows.map((row: UTMAttributionParamsRow): UTMAttributionParams => this.mapRow(row));
  }

  private mapRow(row: UTMAttributionParamsRow): UTMAttributionParams {
    return {
      id: row.id,
      contentRefId: row.content_ref_id,
      simpleCampaignId: row.simple_campaign_id,
      utmSource: row.utm_source as UtmSource | null,
      utmMedium: row.utm_medium as UtmMedium | null,
      utmCampaign: row.utm_campaign,
      utmContent: row.utm_content,
      utmTerm: row.utm_term,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
