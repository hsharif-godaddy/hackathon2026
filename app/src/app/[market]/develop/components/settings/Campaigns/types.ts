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
}
