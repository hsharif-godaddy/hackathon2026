/**
 * Single source of truth for the design-kit guided-flow analytics catalog
 * (AIROBUILD-2898). Thin typed wrappers over the shared CSP instrumentation
 * channel (`@/utils/instrumentation`) and the FullStory `JourneyTracker`
 * milestone API, so all ~20 events across the 7 flow files share one namespace
 * (`develop.design_kit.<widget>`). The wrappers only accept eids/milestone names
 * from the maps below, so a mistyped literal is a compile error rather than a
 * silently-dropped event.
 */
import { JourneyTracker } from '@/lib/journeyTracker';
import { logActionEvent, logClickEvent, logImpressionEvent } from '@/utils/instrumentation';

type EventProps = Record<string, boolean | string | number>;

/** action verbs the CSP channel accepts (mirrors logActionEvent's union). */
type ActionVerb = 'blur' | 'disabled' | 'drag' | 'focus' | 'hover' | 'load' | 'scroll';

/** Every design-kit eid. All are 3-part `develop.design_kit.<widget>` (the CSP
 *  channel requires exactly product.section.widget). */
export const DESIGN_KIT_EID = {
  view: 'develop.design_kit.view',
  vibeOption: 'develop.design_kit.vibe_option',
  vibeApply: 'develop.design_kit.vibe_apply',
  vibeSkip: 'develop.design_kit.vibe_skip',
  assembling: 'develop.design_kit.assembling',
  brandColor: 'develop.design_kit.brand_color',
  brandFonts: 'develop.design_kit.brand_fonts',
  brandLogo: 'develop.design_kit.brand_logo',
  brandImagery: 'develop.design_kit.brand_imagery',
  brandVoice: 'develop.design_kit.brand_voice',
  brandSummary: 'develop.design_kit.brand_summary',
  logoUpload: 'develop.design_kit.logo_upload',
  fontPicker: 'develop.design_kit.font_picker',
  fontFilter: 'develop.design_kit.font_filter',
  fontPairing: 'develop.design_kit.font_pairing',
  websiteHandoff: 'develop.design_kit.website_handoff',
  watchBuild: 'develop.design_kit.watch_build',
  websiteReady: 'develop.design_kit.website_ready',
} as const;

export type DesignKitEid = (typeof DESIGN_KIT_EID)[keyof typeof DESIGN_KIT_EID];

/** Coarse FullStory funnel milestones (snake_case, not eid-shaped). */
export const DESIGN_KIT_MILESTONE = {
  started: 'design_kit_started',
  vibeSelected: 'design_kit_vibe_selected',
  brandStarted: 'design_kit_brand_started',
  websiteStarted: 'design_kit_website_started',
  ready: 'design_kit_ready',
} as const;

export type DesignKitMilestone = (typeof DESIGN_KIT_MILESTONE)[keyof typeof DESIGN_KIT_MILESTONE];

/** Where the website-ready reveal was reached from. */
export type WebsiteReadySource = 'website_handoff' | 'build_complete';

export function fireDesignKitClick(eid: DesignKitEid, props?: EventProps): void {
  logClickEvent(eid, props)();
}

export function fireDesignKitImpression(eid: DesignKitEid, props?: EventProps): void {
  logImpressionEvent(eid, props)();
}

export function fireDesignKitAction(eid: DesignKitEid, action: ActionVerb, props?: EventProps): void {
  logActionEvent({ eid, action, customProperties: props })();
}

export function fireDesignKitMilestone(name: DesignKitMilestone, props?: Record<string, unknown>): void {
  JourneyTracker.current()?.trackMilestone(name, props);
}

// The website-ready celebration can be rendered by BOTH WebsiteReadyCelebration
// (inside WebsiteHandoff) and BuildCompleteCelebration for the same app in one
// session; this guard keeps the reveal impression to one fire per app.
const websiteReadyFired = new Set<string>();

export function fireWebsiteReadyOnce(appId: string, props: { source: WebsiteReadySource }): void {
  if (websiteReadyFired.has(appId)) return;
  websiteReadyFired.add(appId);
  fireDesignKitImpression(DESIGN_KIT_EID.websiteReady, props);
}

/** Test-only: clear the one-shot guard between cases. */
export function resetWebsiteReadyGuard(): void {
  websiteReadyFired.clear();
}
