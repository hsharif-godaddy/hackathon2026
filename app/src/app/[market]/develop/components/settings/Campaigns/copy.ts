import type { CampaignAssetType, CampaignStatus } from '@/app/[market]/develop/components/settings/Campaigns/types'
import type { useTranslations } from '@/hooks/useTranslations'
import { defaultMessageForCampaignKey } from '@/lib/translations/campaign-defaults'

type Translate = ReturnType<typeof useTranslations>

export const CAMPAIGN_KEYS = {
  statusLabel: {
    draft: 'builder_campaign_label_plan_review',
    ready: 'builder_campaign_label_ready',
    launched: 'builder_campaign_label_launched',
    active: 'builder_campaign_label_active',
    completed: 'builder_campaign_label_completed',
    archived: 'builder_campaign_label_archived',
  },
  assetType: {
    'landing-page': 'builder_campaign_asset_landing_page',
    banner: 'builder_campaign_asset_banner',
    blog: 'builder_campaign_asset_blog',
    social: 'builder_campaign_asset_social',
    email: 'builder_campaign_asset_email',
    ad: 'builder_campaign_asset_ad',
  },
  seeDetails: 'builder_campaign_see_details',
  contentPieces: 'builder_campaign_content_pieces',
  creatingPlan: 'builder_campaign_creating_plan',
  campaignsTitle: 'builder_campaigns_title',
  campaignsDescription: 'builder_campaigns_description',
  campaignsCreate: 'builder_campaigns_create',
  campaignsLoading: 'builder_campaigns_loading',
  campaignsEmptyTitle: 'builder_campaigns_empty_title',
  campaignsEmptyDescription: 'builder_campaigns_empty_description',
  campaignsNoAppTitle: 'builder_campaigns_no_app_title',
  campaignsNoAppDescription: 'builder_campaigns_no_app_description',
  campaignsGoToApps: 'builder_campaigns_go_to_apps',
  campaignsCreatePrompt: 'builder_campaigns_create_prompt',
  goal: 'builder_campaign_goal',
  landingPage: 'builder_campaign_landing_page',
  noContent: 'builder_campaign_no_content',
  delete: 'builder_campaign_delete',
  close: 'builder_campaign_close',
} as const

function campaignT(t: Translate, key: string, values?: Record<string, unknown>): string {
  return t(key, values, defaultMessageForCampaignKey(key))
}

export function statusBadgeLabel(t: Translate, status: CampaignStatus): string {
  const key = CAMPAIGN_KEYS.statusLabel[status] ?? CAMPAIGN_KEYS.statusLabel.draft
  return campaignT(t, key).toUpperCase()
}

export function statusModalLabel(t: Translate, status: CampaignStatus): string {
  const key = CAMPAIGN_KEYS.statusLabel[status]
  if (key) return campaignT(t, key)
  return status
}

export function assetTypeLabel(t: Translate, assetType: CampaignAssetType | string): string {
  const key = CAMPAIGN_KEYS.assetType[assetType as CampaignAssetType]
  if (key) return campaignT(t, key)
  return assetType
}

export function translateCampaignKey(
  t: Translate,
  key: string,
  values?: Record<string, unknown>,
): string {
  return campaignT(t, key, values)
}
