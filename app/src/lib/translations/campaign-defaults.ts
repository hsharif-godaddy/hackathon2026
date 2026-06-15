/**
 * Default English copy for campaign UI keys (dev fallback until published in @airo-app-builder/aab).
 */
export const CAMPAIGN_DEFAULT_MESSAGES: Record<string, string> = {
  builder_campaign_label_plan_review: 'Plan Review',
  builder_campaign_label_ready: 'Ready to Launch',
  builder_campaign_label_launched: 'Launched',
  builder_campaign_label_active: 'Active',
  builder_campaign_label_completed: 'Completed',
  builder_campaign_label_archived: 'Archived',
  builder_campaign_see_details: 'See details',
  builder_campaign_content_pieces: '{count, plural, one {# content piece} other {# content pieces}}',
  builder_campaign_creating_plan: 'Creating campaign plan...',
  builder_campaigns_title: 'Marketing Campaigns',
  builder_campaigns_description: 'Track your marketing campaigns, content schedule, and performance',
  builder_campaigns_create: 'Create Campaign',
  builder_campaigns_loading: 'Loading campaigns...',
  builder_campaigns_empty_title: 'No campaigns yet',
  builder_campaigns_empty_description:
    'Ask Airo to create a marketing campaign. It will generate a plan with blog posts, social content, and ads tailored to your business.',
  builder_campaigns_no_app_title: 'No app selected',
  builder_campaigns_no_app_description: 'Select an app to view its campaigns.',
  builder_campaigns_go_to_apps: 'Go to Apps',
  builder_campaigns_create_prompt: 'create a marketing campaign',
  builder_campaign_goal: 'Campaign Goal',
  builder_campaign_landing_page: 'Landing page: {path}',
  builder_campaign_no_content: 'No content pieces in this campaign yet.',
  builder_campaign_delete: 'Delete Campaign',
  builder_campaign_close: 'Close',
  builder_campaign_asset_landing_page: 'Landing Page',
  builder_campaign_asset_banner: 'Banner',
  builder_campaign_asset_blog: 'Blog Post',
  builder_campaign_asset_social: 'Social Post',
  builder_campaign_asset_email: 'Email',
  builder_campaign_asset_ad: 'Ad Copy',
}

export function defaultMessageForCampaignKey(key: string): string | undefined {
  return CAMPAIGN_DEFAULT_MESSAGES[key]
}
