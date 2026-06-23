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

export function defaultMessageForRebuildIntakeKey(key: string): string | undefined {
  return REBUILD_INTAKE_DEFAULT_MESSAGES[key];
}
