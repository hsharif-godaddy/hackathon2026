import { LOGO_DESIGNER_TEMPLATE } from '@/app/[market]/components/types'
import { shipAnalyticsLog } from '@/lib/logging'

/** How a customer entered logo-designer mode on a landing surface. */
export type LogoDesignerEntrySource = 'deeplink' | 'chip' | 'suggestion'

function isSelfReferral(referrer: string): boolean {
  if (!referrer) return true
  try {
    return new URL(referrer).origin === window.location.origin
  } catch {
    // An unparseable referrer is treated as external (false), not self —
    // the conservative default keeps malformed inbound referrers visible
    // as genuine deep links rather than silently excluding them.
    return false
  }
}

/**
 * Logs the unified `homepage.logo_designer.entry` analytics event so we can
 * attribute where logo-designer customers come from. `entrySource` distinguishes
 * the three landing-page pathways (inbound deep link, template chip, suggestion
 * button); the referrer/source params capture how they reached the page.
 *
 * NOTE: the key is `entrySource`, not `source`, on purpose — `shipAnalyticsLog`
 * unconditionally stamps `source: 'analytics'` onto every payload for channel
 * filtering, so a `source` key here would be silently clobbered at runtime.
 *
 * `selfReferral` is true when the referrer is empty or same-origin (e.g. a reload
 * after selecting the chip), letting analysts exclude in-app navigation from
 * genuine inbound deep links. An unparseable referrer falls to false (treated as
 * external). `page` is the pathname the entry happened on, since the
 * chip/suggestion also render on `/apps`, not just the homepage.
 */
export function logLogoDesignerEntry(entrySource: LogoDesignerEntrySource): void {
  if (typeof window === 'undefined') return

  const params = new URLSearchParams(window.location.search)
  const referrer = document.referrer

  shipAnalyticsLog('homepage.logo_designer.entry', {
    entrySource,
    template: LOGO_DESIGNER_TEMPLATE,
    page: window.location.pathname,
    referrer: referrer || undefined,
    selfReferral: isSelfReferral(referrer),
    siteLocation: params.get('site_location') || undefined,
    location: params.get('location') || undefined,
    itc: params.get('itc') || undefined,
    utmSource: params.get('utm_source') || undefined,
    utmMedium: params.get('utm_medium') || undefined,
    utmCampaign: params.get('utm_campaign') || undefined,
    utmTerm: params.get('utm_term') || undefined,
    utmContent: params.get('utm_content') || undefined,
  })
}
