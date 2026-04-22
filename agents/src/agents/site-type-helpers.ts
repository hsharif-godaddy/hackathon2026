import type { SiteType } from '../types/rebuild.js'

export const SITE_TYPES: readonly SiteType[] = ['content', 'app', 'commerce', 'dashboard']

export function normalizeSiteType(value: unknown): SiteType {
  if (typeof value !== 'string') {
    return 'content'
  }
  const lower = value.toLowerCase().trim()
  if ((SITE_TYPES as readonly string[]).includes(lower)) {
    return lower as SiteType
  }
  return 'content'
}

export function buildSiteTypeRules(siteType: SiteType, isFirstPage: boolean): string {
  if (siteType === 'content') {
    if (!isFirstPage) {
      return `Site-type: inner page of a CONTENT site — page-specific main content only; no forced homepage hero, spotlight strip, or full marketing section stack.`
    }
    return `Site-type: CONTENT site homepage—header, hero, sections, footer (system prompt).`
  }

  if (!isFirstPage) {
    return `Site-type (${siteType}): Inner page. Main surface for this route; shell, nav, and layout already set on homepage.`
  }

  if (siteType === 'dashboard') {
    return `Site-type: dashboard. Sidebar + top bar + main (metrics, tables, charts). No marketing hero, feature grid, testimonials, or sitewide footer; one dense scroll region in main. Quote real nav, KPIs, headers; sparse data → keep shell, light placeholders.`
  }

  if (siteType === 'commerce') {
    return `Site-type: storefront. Header (logo, nav, search, cart) + Product grid as primary; optional policy/help footer. No marketing hero that dominates—products first. Real names, prices, categories; imported product images when present.`
  }

  return `Site-type: FULL-VIEWPORT application. One primary surface (map/canvas/board/editor/chat/game) fills viewport; optional thin top bar. No marketing hero, feature grid, testimonials, CTA strip, or footer; side panels/fixed controls OK. Skip About/Features/Pricing/Testimonials/Contact unless clearly in source; contact in menu/modal. Shell + visible interactions only (no backend scope).`
}
