'use client'

import { useMemo } from 'react'

import { MediaGridSection, type MediaSection, SlotThumbnail } from '@/app/[market]/develop/components/media/MediaGridSection'
import { getRouteForSlot } from '@/app/[market]/develop/components/media/slot-routing'
import type { MediaSlot } from '@/app/[market]/develop/components/media/types'
import PanelSkeleton from '@/app/[market]/develop/components/PanelSkeleton'
import { ChatTab } from '@/app/[market]/develop/components/types'
import { SWITCHBOARD_APPBUILDER_MEDIA_GRID_SLOT_ORGANIZATION } from '@/config/switchboard-flags'
import type { AppPage } from '@/hooks/useAppPages'
import { useMediaSlotUsage } from '@/hooks/useMediaSlotUsage'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { postMessageToIframe } from '@/utils/postMessage'

/** Wait for SPA route transition before sending scroll message to iframe */
const NAV_SETTLE_DELAY_MS = 600

/** Re-exported for existing consumers/tests; canonical definition lives in slot-routing. */
export { getRouteForSlot }

export interface MediaSlotsGridProps {
  manifest: Record<string, MediaSlot> | null
  slotNames: string[]
  appId: string
  isLoading: boolean
  error: string | null
  onSelectSlot: (slotName: string) => void
  /** Increment to bust browser cache for upload thumbnails (e.g. after an overwrite edit) */
  thumbnailBustKey?: number
  /** List of available pages for the app (from useAppPages hook) */
  pages?: AppPage[]
  /** Called when user clicks "Add media" on a built page with no images */
  onAddMedia?: (pageTitle: string) => void
  /** Called when user clicks "Add Logo" on the logo zero state */
  onDesignLogo?: () => void
}

/**
 * Derive the preview route from a media slot path.
 * Slot paths encode their page: "pages/home/hero" → "/", "pages/about/hero" → "/about",
 * "projects/foo" → "/projects". Returns null for layout/logo slots (present on all pages).
 */

/**
 * Derive the page slug from a slot path.
 * "pages/home/hero" → "home", "pages/about/banner" → "about"
 */
function getPageSlugForSlot(slotPath: string): string | null {
  if (slotPath.startsWith('pages/')) {
    const parts = slotPath.split('/')
    if (parts.length >= 3) {
      // "pages/about/hero" → "about", "pages/blog/post/hero" → "blog/post"
      return parts.slice(1, -1).join('/')
    }
  }
  return null
}

/**
 * Group media slots into ordered sections:
 * 1. Logo section (always first)
 * 2. One section per page (ordered by page list, then any extras from the manifest).
 *    A slot appears in EVERY page it actually renders on, per the deterministic
 *    usage map (a menu item featured on Home and listed on Menu shows in both).
 * 3. Shared section: slots shared across pages — inherently-shared slots
 *    (layouts/components/sections) and any slot observed rendering on more than one
 *    page. Shared slots also appear in each page section they render on; editing
 *    from Shared makes clear every instance changes.
 *
 * `usageByRoute` maps a page route ("/", "/about") → the ordered list of slot
 * paths that page renders, computed deterministically by backend static source
 * analysis (see useMediaSlotUsage). It is used to (a) place each slot in every
 * page it renders on, (b) detect shared (multi-page) slots, and (c) order a
 * page's slots by source position. When empty, categorization falls back to the
 * path/name convention.
 */
export type SlotUsageByRoute = Record<string, string[]>

/** Map a preview route back to a page slug using the pages list (fallback: derive from route). */
function slugForRoute(route: string, pages: AppPage[]): string {
  const page = pages.find((p) => p.route === route)
  if (page) return page.slug
  return route === '/' ? 'home' : route.replace(/^\//, '')
}

/** Map a page slug to its preview route (inverse of slugForRoute). */
function routeForSlug(slug: string, pages: AppPage[]): string {
  const page = pages.find((p) => p.slug === slug)
  if (page) return page.route
  return slug === 'home' ? '/' : `/${slug}`
}

export function groupSlotsIntoSections(
  manifest: Record<string, MediaSlot>,
  slotNames: string[],
  pages: AppPage[],
  usageByRoute: SlotUsageByRoute = {},
): MediaSection[] {
  const sections: MediaSection[] = []
  const logoSlots: string[] = []
  const globalSlots: string[] = []
  const pageSlotMap = new Map<string, string[]>()

  // Build slot → set-of-routes from observed preview DOM scans.
  const slotToRoutes = new Map<string, Set<string>>()
  for (const [route, slots] of Object.entries(usageByRoute)) {
    for (const slot of slots) {
      const set = slotToRoutes.get(slot) ?? new Set<string>()
      set.add(route)
      slotToRoutes.set(slot, set)
    }
  }

  const addToPage = (slug: string, name: string) => {
    const existing = pageSlotMap.get(slug) ?? []
    existing.push(name)
    pageSlotMap.set(slug, existing)
  }

  // Determine the single page a slot "belongs to" for its page-section placement.
  // Priority: (1) the pages/<route>/… path convention, (2) the slot-name's first
  // segment matching a known page slug (e.g. "menu/honey-hot" → the Menu page) —
  // preferred so themed slots stay with their page even when reused elsewhere,
  // (3) the single route it was observed on. Returns null when none apply.
  const knownPageSlugs = new Set(pages.map((p) => p.slug))
  const belongingPageSlug = (name: string, routes: Set<string> | undefined): string | null => {
    const fromPath = getPageSlugForSlot(name)
    if (fromPath) return fromPath
    const firstSegment = name.split('/')[0]
    if (knownPageSlugs.has(firstSegment)) return firstSegment
    if (routes && routes.size === 1) return slugForRoute([...routes][0], pages)
    return null
  }

  // Categorize each slot into the page section(s) it renders on and/or Shared.
  //  - Logo slots → Logo section.
  //  - Inherently-shared slots (layouts/components/sections) → Shared only.
  //  - A slot observed in the deterministic usage map renders in EVERY page
  //    section it appears on (a featured menu item shown on Home and Menu shows
  //    in both). If it appears on more than one page it ALSO appears in Shared,
  //    where editing it makes clear every instance updates.
  //  - A slot with no observed usage falls back to the name/path convention for
  //    a single page home; if none applies it lands in Shared.
  for (const name of slotNames) {
    if (name.startsWith('logo/') || name.startsWith('logo-')) {
      logoSlots.push(name)
      continue
    }

    const isInherentlyShared =
      name.startsWith('layouts/') || name.startsWith('components/') || name.startsWith('sections/')
    if (isInherentlyShared) {
      globalSlots.push(name)
      continue
    }

    const routes = slotToRoutes.get(name)
    if (routes && routes.size > 0) {
      // Deterministic placement: show the slot on each page it actually renders.
      for (const route of routes) {
        addToPage(slugForRoute(route, pages), name)
      }
      if (routes.size > 1) globalSlots.push(name)
    } else {
      // No observed usage — fall back to the name/path convention.
      const slug = belongingPageSlug(name, routes)
      if (slug) {
        addToPage(slug, name)
      } else {
        globalSlots.push(name)
      }
    }
  }

  // Order a page's slots by their visual DOM position when we have a scan for it.
  const orderPageSlots = (slug: string, slots: string[]): string[] => {
    const domOrder = usageByRoute[routeForSlug(slug, pages)]
    if (!domOrder || domOrder.length === 0) return slots
    const indexOf = (s: string) => {
      const i = domOrder.indexOf(s)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    return [...slots].sort((a, b) => indexOf(a) - indexOf(b))
  }

  // 1. Logo section (always first)
  sections.push({
    id: 'logo',
    title: 'Logo',
    type: 'logo',
    slots: logoSlots,
  })

  // 2. Page sections — ordered by the pages list, then any extras from the manifest.
  const processedSlugs = new Set<string>()
  for (const page of pages) {
    processedSlugs.add(page.slug)
    const pageOwnSlots = pageSlotMap.get(page.slug) ?? []
    sections.push({
      id: `page-${page.slug}`,
      title: page.title,
      type: 'page',
      slots: orderPageSlots(page.slug, pageOwnSlots),
      pageSlug: page.slug,
    })
  }
  for (const [slug, slots] of pageSlotMap) {
    if (processedSlugs.has(slug)) continue
    processedSlugs.add(slug)
    const title = slug
      .split('/')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' '))
      .join(' / ')
    sections.push({
      id: `page-${slug}`,
      title,
      type: 'page',
      slots: orderPageSlots(slug, slots),
      pageSlug: slug,
    })
  }

  // 3. Shared section — slots shared across pages. Editing one changes every instance.
  if (globalSlots.length > 0) {
    sections.push({
      id: 'sitewide',
      title: 'Shared',
      type: 'sitewide',
      slots: globalSlots,
    })
  }

  return sections
}

/**
 * Collapse the per-page layout for apps that aren't multi-page sites.
 *
 * Not every app is a "site with pages" — a single-page site, a game, or a tool may have
 * zero or one page section. Splitting those into "Home" + "Shared" adds section chrome
 * without value. When there is at most one page section, merge every non-logo slot into a
 * single "Shared" bucket so the user sees just Logo + everything-else. Multi-page apps
 * (2+ page sections) keep the full per-page organization.
 *
 * @internal Exported for testing
 */
export function maybeCollapseSimpleApp(sections: MediaSection[]): MediaSection[] {
  const pageSectionCount = sections.filter((s) => s.type === 'page').length
  if (pageSectionCount > 1) {
    return sections
  }

  const logoSection = sections.find((s) => s.type === 'logo')
  // Deduplicate slots when collapsing (sitewide slots may appear in both page and global sections)
  const seen = new Set<string>()
  const otherSlots = sections
    .filter((s) => s.type !== 'logo')
    .flatMap((s) => s.slots)
    .filter((slot) => {
      if (seen.has(slot)) return false
      seen.add(slot)
      return true
    })

  const collapsed: MediaSection[] = []
  if (logoSection) {
    collapsed.push(logoSection)
  }
  if (otherSlots.length > 0) {
    collapsed.push({
      id: 'sitewide',
      title: 'Shared',
      type: 'sitewide',
      slots: otherSlots,
    })
  }
  return collapsed
}

export function MediaSlotsGrid({
  manifest,
  slotNames,
  appId,
  isLoading,
  error,
  onSelectSlot,
  thumbnailBustKey,
  pages = [],
  onAddMedia,
  onDesignLogo,
}: MediaSlotsGridProps) {
  const t = useTranslations()
  const previewBaseUrl = useServerPollingStore((state) => state.getServerState(appId))?.url || null
  const isSectionOrganizationEnabled = useSwitchboard(SWITCHBOARD_APPBUILDER_MEDIA_GRID_SLOT_ORGANIZATION) === true;

  // Deterministic `route → slot[]` usage map from backend static analysis. This
  // is stable and complete on first load (no preview navigation required), so the
  // grid never re-buckets as the user navigates. Used to tell page-specific slots
  // from shared/global ones and to order a page's slots by source position.
  const { usageByRoute, error: usageError, refetch: refetchUsage } = useMediaSlotUsage({ appId, enabled: isSectionOrganizationEnabled })

  // Slots observed rendering anywhere in the preview. Used to hide unused logo
  // variants (the manifest may contain logo orientations the site never renders).
  const renderedSlots = useMemo(() => {
    const all = new Set<string>()
    for (const slots of Object.values(usageByRoute)) {
      for (const s of slots) all.add(s)
    }
    return all.size > 0 ? all : null
  }, [usageByRoute])

  const sections = useMemo(
    () => {
      const localizeTitle = (section: MediaSection): MediaSection => {
        if (section.type === 'logo') return { ...section, title: t('builder_mediaslot_section_logo') }
        if (section.type === 'sitewide') return { ...section, title: t('builder_mediaslot_section_shared') }
        return section
      }
      const raw = maybeCollapseSimpleApp(groupSlotsIntoSections(manifest ?? {}, slotNames, pages, usageByRoute))
      return raw.map((section) => {
        // Filter logo section to only show slots rendered in the preview
        if (section.type === 'logo' && renderedSlots) {
          const filtered = section.slots.filter((s) => renderedSlots.has(s))
          return localizeTitle({ ...section, slots: filtered.length > 0 ? filtered : section.slots })
        }
        return localizeTitle(section)
      })
    },
    [manifest, slotNames, pages, renderedSlots, usageByRoute, t],
  )

  // Per-slot list of page titles the slot renders on, ordered by the pages list.
  // Used to caption Shared-section thumbnails (e.g. "Home · Menu") so it's clear
  // which pages an image appears on and that editing it updates every instance.
  const slotPageUsage = useMemo(() => {
    const titleForRoute = (route: string): string => {
      const page = pages.find((p) => p.route === route)
      if (page) return page.title
      const slug = route === '/' ? 'home' : route.replace(/^\//, '')
      return slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, ' ')
    }
    // Pages list first (friendly order), then any extra observed routes.
    const orderedRoutes = [
      ...pages.map((p) => p.route).filter((r) => usageByRoute[r]),
      ...Object.keys(usageByRoute).filter((r) => !pages.some((p) => p.route === r)),
    ]
    const map: Record<string, string[]> = {}
    for (const route of orderedRoutes) {
      for (const slot of usageByRoute[route] ?? []) {
        ;(map[slot] ??= []).push(titleForRoute(route))
      }
    }
    return map
  }, [pages, usageByRoute])

  function scrollPreviewToSlot(name: string) {
    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
    if (!iframe) return
    const targetRoute = getRouteForSlot(name)

    if (targetRoute) {
      postMessageToIframe(iframe, {
        type: 'RESTORE_STATE_AFTER_REFRESH',
        url: targetRoute,
      })
      setTimeout(() => {
        postMessageToIframe(iframe, { type: 'SCROLL_TO_MEDIA_SLOT', slotPath: name, index: 0 })
      }, NAV_SETTLE_DELAY_MS)
    } else {
      postMessageToIframe(iframe, { type: 'SCROLL_TO_MEDIA_SLOT', slotPath: name, index: 0 })
    }
  }

  if (isLoading) {
    return (
      <PanelSkeleton panelType={ChatTab.MEDIAS} />
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center px-4">
        <p className="text-intents-ux-textSubtle-textColor">
          {t('builder_mediaslot_error_fail_load')}
        </p>
        <p className="text-sm text-intents-ux-textSubtle-textColor mt-1">{error}</p>
      </div>
    )
  }

  if (!manifest || slotNames.length === 0) {
    // Even with no slots, show sections with zero states if we have page info
    if (pages.length === 0 || !isSectionOrganizationEnabled) {
      return (
        <div className="flex flex-col items-center justify-center h-48 text-center px-4">
          <p className="text-intents-ux-textSubtle-textColor">
            {t('builder_mediaslot_no_images')}
          </p>
        </div>
      )
    }
    // Pages exist but manifest is null/empty — render sections using empty manifest
    // so zero-state CTAs still appear for each page
  }

  // ─── Flat grid (FF off OR single-page app) ─────────────────────────────────
  // For single-page apps, skip the collapsible sections and show a flat grid
  // with logos first — same experience as FF-off but with logo priority.
  const isMultiPage = pages.length > 1
  if (!isSectionOrganizationEnabled || !isMultiPage) {
    // Sort slots: logos first, then everything else (preserves relative order within each group)
    const sortedSlotNames = [...slotNames].sort((a, b) => {
      const aIsLogo = a.startsWith('logo/') || a.startsWith('logo-')
      const bIsLogo = b.startsWith('logo/') || b.startsWith('logo-')
      if (aIsLogo && !bIsLogo) return -1
      if (!aIsLogo && bIsLogo) return 1
      return 0
    })
    // Filter logo slots to only those rendered in the preview (if detection succeeded)
    const filteredSlotNames = renderedSlots
      ? sortedSlotNames.filter((name) => {
          const isLogo = name.startsWith('logo/') || name.startsWith('logo-')
          return !isLogo || renderedSlots.has(name)
        })
      : sortedSlotNames

    return (
      <div className="grid grid-cols-2 gap-3 px-2 md:px-0 md:pt-0 pb-2">
        {filteredSlotNames.map((name) => (
          <SlotThumbnail
            key={name}
            name={name}
            slot={manifest?.[name] ?? null}
            previewBaseUrl={previewBaseUrl}
            thumbnailBustKey={thumbnailBustKey}
            isLogo={name.startsWith('logo/') || name.startsWith('logo-')}
            onClick={() => {
              scrollPreviewToSlot(name)
              onSelectSlot(name)
            }}
          />
        ))}
      </div>
    )
  }

  // ─── Sectioned grid (FF on) ───────────────────────────────────────────────
  return (
    <div className="flex flex-col px-2 md:px-0 md:pt-0 pb-2 divide-y-2 divide-neutral-300 dark:divide-neutral-600">
      {usageError && (
        <div className="flex items-center gap-2 px-1 py-1.5 text-xs text-intents-ux-textSubtle-textColor">
          <span>{t('builder_mediaslot_error_fail_load')}</span>
          <button
            type="button"
            onClick={() => void refetchUsage()}
            className="text-intents-ux-link-textColor hover:underline font-medium"
          >
            {t('builder_common_retry')}
          </button>
        </div>
      )}
      {sections.map((section) => (
        <MediaGridSection
          key={section.id}
          section={section}
          manifest={manifest}
          appId={appId}
          previewBaseUrl={previewBaseUrl}
          thumbnailBustKey={thumbnailBustKey}
          slotPageUsage={slotPageUsage}
          onSelectSlot={onSelectSlot}
          scrollPreviewToSlot={scrollPreviewToSlot}
          onAddMedia={onAddMedia}
          onDesignLogo={onDesignLogo}
        />
      ))}
    </div>
  )
}

