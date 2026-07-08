export type CampaignAssetType = 'landing-page' | 'banner' | 'blog' | 'social' | 'email' | 'ad'
export type CampaignAssetStatus = 'draft' | 'scheduled' | 'published' | 'sent'
export type CampaignType = 'landing-page' | 'banner' | 'content-only'
export type CampaignStatus = 'draft' | 'ready' | 'launched' | 'active' | 'completed' | 'archived'

export interface CampaignAsset {
  id: string
  assetType: CampaignAssetType
  assetRef: string
  title: string
  scheduledDate?: string
  status: CampaignAssetStatus
  contentPreview?: string
  imageUrl?: string
}

export interface Campaign {
  id: string
  appId?: string
  name: string
  campaignType: CampaignType
  status: CampaignStatus
  offer: string
  startDate: string
  endDate: string
  landingPagePath?: string
  createdAt?: string
  updatedAt?: string
  assets?: CampaignAsset[]
  /**
   * Opaque `cmp_<hash>` UTM token used as the join key by the Customer Stats API.
   * Absent until the agents response has projected it; the list only fetches and keys
   * stats for campaigns that have a `campaignRefId`.
   */
  campaignRefId?: string
}

/** A single leads breakdown row from the Customer Stats API, keyed by source/medium. */
export interface CampaignLeadsRow {
  source: string
  medium: string
  leads: number
}

/** Normalized campaign performance metrics rendered in the detail view. */
export interface CampaignStats {
  totalLeads: number
  breakdown: CampaignLeadsRow[]
}
