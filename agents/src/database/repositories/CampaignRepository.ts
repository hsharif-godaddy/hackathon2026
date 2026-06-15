import { getDatabase } from '../connection.js'
import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'

export type CampaignStatus = 'draft' | 'ready' | 'launched' | 'active' | 'completed' | 'archived'
export type ArtifactType = 'landing-page' | 'banner' | 'content-only'
export type AssetType = 'landing-page' | 'banner' | 'blog' | 'social' | 'email' | 'ad'
export type AssetStatus = 'draft' | 'scheduled' | 'published' | 'sent'

export interface Campaign {
  id: string
  appId: string
  name: string
  campaignType: ArtifactType
  status: CampaignStatus
  offer: string
  startDate: string
  endDate: string
  landingPagePath?: string
  createdAt: string
  updatedAt: string
  assets?: CampaignAsset[]
}

export interface CampaignAsset {
  id: string
  campaignId: string
  assetType: AssetType
  assetRef: string
  title: string
  scheduledDate?: string
  status: AssetStatus
  contentPreview?: string
  imageUrl?: string
  createdAt: string
}

export interface CreateCampaignInput {
  appId: string
  name: string
  campaignType: ArtifactType
  status?: CampaignStatus
  offer: string
  startDate: string
  endDate: string
  landingPagePath?: string
}

export interface CreateAssetInput {
  campaignId: string
  assetType: AssetType
  assetRef: string
  title: string
  scheduledDate?: string
  status?: AssetStatus
  contentPreview?: string
  imageUrl?: string
}

export class CampaignRepository {
  private db: Database

  constructor() {
    this.db = getDatabase()
    this.initializeSchema()
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        name TEXT NOT NULL,
        campaign_type TEXT NOT NULL DEFAULT 'landing-page',
        status TEXT NOT NULL DEFAULT 'draft',
        offer TEXT NOT NULL DEFAULT '',
        start_date TEXT,
        end_date TEXT,
        landing_page_path TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_campaigns_app_id ON campaigns(app_id)
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS campaign_assets (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        asset_ref TEXT NOT NULL,
        title TEXT NOT NULL,
        scheduled_date TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        content_preview TEXT,
        image_url TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
      )
    `)

    try {
      this.db.exec('ALTER TABLE campaign_assets ADD COLUMN image_url TEXT')
    } catch {
      // Column already exists
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_campaign_assets_campaign_id ON campaign_assets(campaign_id)
    `)
  }

  listByApp(appId: string): Campaign[] {
    const rows = this.db.prepare(
      'SELECT * FROM campaigns WHERE app_id = ? ORDER BY created_at DESC'
    ).all(appId) as any[]

    return rows.map(this.mapCampaignRow)
  }

  getById(id: string): Campaign | null {
    const row = this.db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as any
    if (!row) return null

    const campaign = this.mapCampaignRow(row)
    campaign.assets = this.getAssets(id)
    return campaign
  }

  create(input: CreateCampaignInput): Campaign {
    const id = randomUUID()
    const now = new Date().toISOString()

    this.db.prepare(`
      INSERT INTO campaigns (id, app_id, name, campaign_type, status, offer, start_date, end_date, landing_page_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.appId,
      input.name,
      input.campaignType,
      input.status || 'draft',
      input.offer,
      input.startDate,
      input.endDate,
      input.landingPagePath || null,
      now,
      now
    )

    return this.getById(id)!
  }

  update(id: string, updates: Partial<Pick<Campaign, 'name' | 'status' | 'offer' | 'startDate' | 'endDate' | 'landingPagePath'>>): Campaign | null {
    const fields: string[] = []
    const values: any[] = []

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
    if (updates.offer !== undefined) { fields.push('offer = ?'); values.push(updates.offer) }
    if (updates.startDate !== undefined) { fields.push('start_date = ?'); values.push(updates.startDate) }
    if (updates.endDate !== undefined) { fields.push('end_date = ?'); values.push(updates.endDate) }
    if (updates.landingPagePath !== undefined) { fields.push('landing_page_path = ?'); values.push(updates.landingPagePath) }

    if (fields.length === 0) return this.getById(id)

    fields.push('updated_at = ?')
    values.push(new Date().toISOString())
    values.push(id)

    this.db.prepare(`UPDATE campaigns SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return this.getById(id)
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM campaigns WHERE id = ?').run(id)
    return result.changes > 0
  }

  addAsset(input: CreateAssetInput): CampaignAsset {
    const id = randomUUID()
    const now = new Date().toISOString()

    this.db.prepare(`
      INSERT INTO campaign_assets (id, campaign_id, asset_type, asset_ref, title, scheduled_date, status, content_preview, image_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.campaignId,
      input.assetType,
      input.assetRef,
      input.title,
      input.scheduledDate || null,
      input.status || 'draft',
      input.contentPreview || null,
      input.imageUrl || null,
      now
    )

    return {
      id,
      campaignId: input.campaignId,
      assetType: input.assetType as AssetType,
      assetRef: input.assetRef,
      title: input.title,
      scheduledDate: input.scheduledDate,
      status: (input.status || 'draft') as AssetStatus,
      contentPreview: input.contentPreview,
      imageUrl: input.imageUrl,
      createdAt: now
    }
  }

  deleteAsset(assetId: string): boolean {
    const result = this.db.prepare('DELETE FROM campaign_assets WHERE id = ?').run(assetId)
    return result.changes > 0
  }

  deleteAssetsByCampaign(campaignId: string): number {
    const result = this.db.prepare('DELETE FROM campaign_assets WHERE campaign_id = ?').run(campaignId)
    return result.changes
  }

  getAssets(campaignId: string): CampaignAsset[] {
    const rows = this.db.prepare(
      'SELECT * FROM campaign_assets WHERE campaign_id = ? ORDER BY scheduled_date ASC, created_at ASC'
    ).all(campaignId) as any[]

    return rows.map(this.mapAssetRow)
  }

  private mapCampaignRow(row: any): Campaign {
    return {
      id: row.id,
      appId: row.app_id,
      name: row.name,
      campaignType: row.campaign_type as ArtifactType,
      status: (row.status === 'active' ? 'launched' : row.status) as CampaignStatus,
      offer: row.offer,
      startDate: row.start_date,
      endDate: row.end_date,
      landingPagePath: row.landing_page_path || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private mapAssetRow(row: any): CampaignAsset {
    return {
      id: row.id,
      campaignId: row.campaign_id,
      assetType: row.asset_type as AssetType,
      assetRef: row.asset_ref,
      title: row.title,
      scheduledDate: row.scheduled_date || undefined,
      status: row.status as AssetStatus,
      contentPreview: row.content_preview || undefined,
      imageUrl: row.image_url || undefined,
      createdAt: row.created_at,
    }
  }
}
