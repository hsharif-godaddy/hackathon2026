import type { CampaignAssetStatus, CampaignAssetType, CampaignStatus } from '@/app/[market]/develop/components/settings/Campaigns/types'
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
  status: 'builder_campaign_status',
  noContent: 'builder_campaign_no_content',
  delete: 'builder_campaign_delete',
  deleteConfirmTitle: 'builder_campaign_delete_confirm_title',
  deleteConfirmDescription: 'builder_campaign_delete_confirm_description',
  deleteConfirmCancel: 'builder_campaign_delete_confirm_cancel',
  close: 'builder_campaign_close',
  schedule: 'builder_campaign_schedule',
  listBack: 'builder_campaign_list_back',
  listPageDescription: 'builder_campaign_list_page_description',
  createNew: 'builder_campaign_create_new',
  reviewHeading: 'builder_campaign_review_heading',
  approveLaunch: 'builder_campaign_approve_launch',
  editAsset: 'builder_campaign_edit_asset',
  marketingTab: 'builder_campaign_marketing_tab',
  assetStatus: {
    draft: 'builder_campaign_asset_status_draft',
    scheduled: 'builder_campaign_asset_status_scheduled',
    published: 'builder_campaign_asset_status_published',
    sent: 'builder_campaign_asset_status_sent',
  } as Record<CampaignAssetStatus, string>,
  dateRange: 'builder_campaign_date_range',
  dateAt: 'builder_campaign_date_at',
  fetchError: 'builder_campaign_fetch_error',
  retry: 'builder_campaign_retry',
  notFound: 'builder_campaign_not_found',
  deleteFailed: 'builder_campaign_delete_failed',
  comingSoon: 'builder_campaign_coming_soon',
  disabledForAccount: 'builder_campaign_disabled_for_account',
  progress: 'builder_campaign_progress',
  summary: 'builder_campaign_summary',
  leadsGenerated: 'builder_campaign_leads_generated',
  leadsInsight: 'builder_campaign_leads_insight',
  leadsCount: 'builder_campaign_leads_count',
  totalLeads: 'builder_campaign_total_leads',
  statsLoading: 'builder_campaign_stats_loading',
  statsError: 'builder_campaign_stats_error',
  leadsEmpty: 'builder_campaign_leads_empty',
} as const

function campaignT(t: Translate, key: string, values?: Record<string, unknown>): string {
  const fallback = defaultMessageForCampaignKey(key)
  if (fallback !== undefined) {
    return t(key, values, fallback)
  }
  return t(key, values)
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

export function assetStatusLabel(t: Translate, status: CampaignAssetStatus): string {
  const key = CAMPAIGN_KEYS.assetStatus[status]
  if (key) return campaignT(t, key).toUpperCase()
  return status.toUpperCase()
}

export function translateCampaignKey(
  t: Translate,
  key: string,
  values?: Record<string, unknown>,
): string {
  return campaignT(t, key, values)
}

const LEAD_SOURCE_LABELS: Record<string, string> = {
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  BLOG_AAB: 'Blog',
}

const LEAD_MEDIUM_LABELS: Record<string, string> = {
  ORGANIC_SOCIAL: 'Organic Social',
  BLOG: 'Blog',
}

/** Title-case an UPPER_SNAKE_CASE enum value as a readable fallback label. */
function humanizeEnum(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((word: string): string => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** Friendly label for a leads breakdown `source` enum (e.g. FACEBOOK → Facebook). */
export function formatLeadSource(source: string): string {
  if (!source) return ''
  return LEAD_SOURCE_LABELS[source] ?? humanizeEnum(source)
}

/** Friendly label for a leads breakdown `medium` enum (e.g. ORGANIC_SOCIAL → Organic Social). */
export function formatLeadMedium(medium: string): string {
  if (!medium) return ''
  return LEAD_MEDIUM_LABELS[medium] ?? humanizeEnum(medium)
}
