/**
 * Default English copy for rebuild intake form keys (dev fallback when i18n API is stale).
 * Keys are published in @airo-app-builder/aab — see app/src/lib/translations/README.md.
 */
export const REBUILD_INTAKE_DEFAULT_MESSAGES: Record<string, string> = {
  builder_rebuild_intake_title: 'Customize your rebuild',
  builder_rebuild_intake_subtitle:
    'Choose how much of {url} to rebuild and the design direction before we start.',
  builder_rebuild_intake_scope_heading: 'How much should we rebuild?',
  builder_rebuild_intake_scope_homepage_label: 'Homepage only',
  builder_rebuild_intake_scope_homepage_description:
    'Import and rebuild your homepage. Fastest way to get a new site live.',
  builder_rebuild_intake_scope_small_label: 'Small site (~5 pages)',
  builder_rebuild_intake_scope_small_description:
    'Homepage plus key inner pages (about, contact, services, etc.).',
  builder_rebuild_intake_scope_large_label: 'Large site (~10 pages)',
  builder_rebuild_intake_scope_large_description:
    'Homepage and more inner pages for a broader first pass.',
  builder_rebuild_intake_estimate_time: '{min}–{max} min estimated',
  // Reserved for AIROBUILD-1902 — UI hidden in AIROBUILD-2307 until telemetry-backed estimates ship
  builder_rebuild_intake_estimate_tokens: '~{band} tokens estimated',
  builder_rebuild_intake_design_heading: 'Design direction',
  builder_rebuild_intake_design_airo_decide: 'Let Airo decide',
  builder_rebuild_intake_design_keep_similar: 'Keep a similar look',
  builder_rebuild_intake_design_modernize: 'Modernize the design',
  builder_rebuild_intake_design_simplify: 'Simplify the design',
  builder_rebuild_intake_design_bold: 'Bold, standout design',
  builder_rebuild_intake_submit: 'Start rebuild',
  builder_rebuild_intake_use_defaults: 'Use recommended defaults',
  builder_rebuild_intake_timeout_notice:
    'No response received — using recommended defaults to continue your rebuild.',
  builder_rebuild_design_modal_title: 'How should we rebuild your site?',
  builder_rebuild_design_option_modernize_label: 'Reimagine my site',
  builder_rebuild_design_option_modernize_description: 'A fresh, modern redesign',
  builder_rebuild_design_option_keep_similar_label: 'Clone my existing site',
  builder_rebuild_design_option_keep_similar_description: 'A faithful copy of my design & content',
  builder_rebuild_design_url_invalid: 'Enter a valid website URL',
  builder_rebuild_bring_over_logo: 'Keep logo',
  builder_rebuild_bring_over_images: 'Keep images',
  builder_rebuild_bring_over_colors: 'Keep colors',
  builder_rebuild_bring_over_fonts: 'Keep fonts',
};

export const SEO_GSC_DEFAULT_MESSAGES: Record<string, string> = {
  builder_seo_gsc_title: 'Google Search Console',
  builder_seo_gsc_connected_label: 'Connected to Google Search Console',
  builder_seo_gsc_site_label: 'Site: {url}',
  builder_seo_gsc_last_submitted: 'Sitemap last submitted: {date}',
  builder_seo_gsc_dashboard_link: 'View in Google Search Console',
  builder_seo_gsc_resubmit_button: 'Re-submit sitemap',
  builder_seo_gsc_pending_description:
    'A Google verification tag has been added to your site. Publish your site so Google can confirm ownership, then click "Verify with Google" below.',
  builder_seo_gsc_verifying_label: 'Verifying with Google...',
  builder_seo_gsc_verify_button: 'Verify with Google',
  builder_seo_gsc_unpublished_description:
    'Publish your site first to connect Google Search Console. Once your site is live, you can submit your sitemap to help Google discover and index your pages faster.',
  builder_seo_gsc_connect_description:
    'Connect Google Search Console to automatically submit your sitemap when you publish, helping Google discover and index your pages faster.',
  builder_seo_gsc_connecting_label: 'Connecting to Google Search Console...',
  builder_seo_gsc_cancel_button: 'Cancel',
  builder_seo_gsc_connect_button: 'Connect Google Search Console',
  builder_seo_gsc_error_no_published_url: 'Publish your site first so Google can verify it.',
  builder_seo_gsc_error_connect_failed: 'Failed to set up verification. Please try again.',
  builder_seo_gsc_error_auth_failed: 'Authentication failed. Please try again.',
  builder_seo_gsc_error_verify_failed:
    'Verification failed. Make sure you published your site and try again.',
  builder_seo_gsc_error_publish_failed: 'Publish failed. Please try again.',
  builder_seo_gsc_retry_button: 'Try again',
  builder_seo_gsc_publish_button: 'Publish site',
  builder_seo_gsc_publishing_label: 'Publishing...',
  builder_seo_gsc_chat_publish_description:
    'Verification tag added. Publish your site so Google can find it, then verify ownership.',
  builder_seo_gsc_property_list_warning:
    'Your site is verified but could not be added to the Google Search Console property list. You may need to add it manually at search.google.com/search-console.',
};

export const DISPLAY_ADS_DEFAULT_MESSAGES: Record<string, string> = {
  builder_settings_display_ads_save_field_errors: "Couldn't save. Check the highlighted fields.",
  builder_settings_display_ads_saved: 'Saved!',
};

export function defaultMessageForRebuildIntakeKey(key: string): string | undefined {
  return REBUILD_INTAKE_DEFAULT_MESSAGES[key];
}
