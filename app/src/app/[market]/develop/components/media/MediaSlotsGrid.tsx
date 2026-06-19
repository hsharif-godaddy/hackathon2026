'use client'

import { Play } from 'lucide-react'

import { MediaLoadError } from '@/app/[market]/develop/components/media/MediaLoadError'
import { formatSlotName, getPreviewOrigin } from '@/app/[market]/develop/components/media/MediaSlotDetail'
import type { MediaSlot } from '@/app/[market]/develop/components/media/types'
import PanelSkeleton from '@/app/[market]/develop/components/PanelSkeleton'
import { LogoShimmer, logoShimmerOrientation, LogoShimmerOverlay } from '@/app/[market]/develop/components/preview/brand-book/LogoShimmer'
import { ChatTab } from '@/app/[market]/develop/components/types'
import { useTranslations } from '@/hooks/useTranslations'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { generateClickEID } from '@/utils/instrumentation'
import { postMessageToIframe } from '@/utils/postMessage'

/** Wait for SPA route transition before sending scroll message to iframe */
const NAV_SETTLE_DELAY_MS = 600

interface MediaSlotsGridProps {
  manifest: Record<string, MediaSlot> | null
  slotNames: string[]
  appId: string
  isLoading: boolean
  error: string | null
  onRetry: () => void
  onSelectSlot: (slotName: string) => void
  /** Increment to bust browser cache for upload thumbnails (e.g. after an overwrite edit) */
  thumbnailBustKey?: number
}

/**
 * Derive the preview route from a media slot path.
 * Slot paths encode their page: "pages/home/hero" → "/", "pages/about/hero" → "/about",
 * "projects/foo" → "/projects". Returns null for layout/logo slots (present on all pages).
 */
/** @internal Exported for testing */
export function getRouteForSlot(slotPath: string): string | null {
  if (slotPath.startsWith('pages/home/')) return '/'
  if (slotPath.startsWith('pages/')) {
    // "pages/about/hero" → "/about", "pages/blog/post/hero" → "/blog/post"
    const parts = slotPath.split('/')
    // Slots always have at least 3 segments (pages/<route>/<slotName>).
    // A 2-segment "pages/x" would be malformed — treat as home.
    if (parts.length < 3) return '/'
    // Everything between "pages/" and the last segment (the slot name) is the route
    return `/${parts.slice(1, -1).join('/')}`
  }
  // Component-level slots like "projects/foo" map to "/<first-segment>"
  if (!slotPath.startsWith('logo/') && !slotPath.startsWith('layouts/') && !slotPath.startsWith('components/')) {
    const parts = slotPath.split('/')
    return `/${parts[0]}`
  }
  // Logo/layout slots are on every page — no navigation needed
  return null
}

export function MediaSlotsGrid({
  manifest,
  slotNames,
  appId,
  isLoading,
  error,
  onRetry,
  onSelectSlot,
  thumbnailBustKey,
}: MediaSlotsGridProps) {
  const t = useTranslations()
  const previewBaseUrl = useServerPollingStore((state) => state.getServerState(appId))?.url || null

  function scrollPreviewToSlot(name: string) {
    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
    if (!iframe) return
    const targetRoute = getRouteForSlot(name)

    if (targetRoute) {
      // Navigate without scrollPosition so the iframe doesn't scroll to top
      // when already on the correct page. SCROLL_TO_MEDIA_SLOT handles positioning.
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
    return <MediaLoadError onRetry={onRetry} />
  }

  if (!manifest || slotNames.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center px-4">
        <p className="text-intents-ux-textSubtle-textColor">
          {t('builder_mediaslot_no_images')}
        </p>
      </div>
    )
  }

  const logoSlots = slotNames.filter(n => n.startsWith('logo/'))
  const otherSlots = slotNames.filter(n => !n.startsWith('logo/'))

  return (
    <div className="grid grid-cols-2 gap-3 px-2 md:px-0 md:pt-0 pb-2">
      {[...logoSlots, ...otherSlots].map(function renderSlot(name) {
        const slot = manifest[name]
        if (!slot) return null

        // In-flight async logo job. SHARED CONTRACT: when currentUrl is a real hosted https logo
        // this is a regeneration — show the existing logo (dimmed) under an animated overlay. When
        // currentUrl is the /airo-assets/* shimmer placeholder (not http, does not resolve on the
        // builder origin), it's a fresh generation — render a bare shimmer and skip URL resolution.
        const isPending = !!slot.pendingJobId
        const priorLogoUrl =
          isPending && slot.currentUrl &&
          (slot.currentUrl.startsWith('http://') || slot.currentUrl.startsWith('https://'))
            ? slot.currentUrl
            : undefined

        const isVideo = slot.mediaType === 'video'
        // For videos: thumbnailUrl is a static poster image, currentUrl is the actual video MP4
        const displayUrl = isVideo ? slot.currentUrl : (slot.thumbnailUrl || slot.currentUrl)
        const assetPrefix = isVideo ? '/airo-assets/videos/' : '/airo-assets/images/'
        const proxiedUrl = previewBaseUrl && displayUrl
          ? displayUrl.startsWith('http://') || displayUrl.startsWith('https://')
            ? displayUrl
            : displayUrl.startsWith('/airo-assets/uploads/')
              ? `${getPreviewOrigin(previewBaseUrl)}${displayUrl}${thumbnailBustKey ? `?_t=${thumbnailBustKey}` : ''}`
              : `${getPreviewOrigin(previewBaseUrl)}${assetPrefix}${name}?src=${encodeURIComponent(displayUrl)}`
          : displayUrl
        // Video poster: use thumbnailUrl directly (always an absolute CDN URL)
        const posterUrl = isVideo && slot.thumbnailUrl ? slot.thumbnailUrl : undefined

        return (
          <button
            type="button"
            key={name}
            onClick={() => {
              scrollPreviewToSlot(name)
              onSelectSlot(name)
            }}
            className="flex flex-col gap-0.5 text-start group hover:cursor-pointer"
            data-eid={generateClickEID("develop.media_panel.slot")}
          >
            <div className="relative aspect-square w-full overflow-hidden rounded-md bg-intents-ux-box-backgroundColor border border-intents-ux-box-borderColor group-hover:border-intents-ux-ring-borderColor transition-colors">
              {isPending ? (
                priorLogoUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={priorLogoUrl}
                      alt={formatSlotName(name)}
                      className="w-full h-full object-contain opacity-60"
                      loading="lazy"
                    />
                    <LogoShimmerOverlay data-testid={`media-slot-shimmer-overlay-${name}`} />
                  </>
                ) : (
                  <LogoShimmer className="w-full h-full" orientation={logoShimmerOrientation(name)} data-testid={`media-slot-shimmer-${name}`} />
                )
              ) : isVideo ? (
                <>
                  <video
                    src={proxiedUrl}
                    poster={posterUrl}
                    className="w-full h-full object-cover"
                    muted
                    autoPlay
                    loop
                    playsInline
                    preload="metadata"
                  />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-7 h-7 rounded-full bg-black/50 flex items-center justify-center">
                      <Play className="w-3.5 h-3.5 text-white" fill="white" />
                    </div>
                  </div>
                </>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={proxiedUrl}
                  alt={formatSlotName(name)}
                  className={`w-full h-full ${slot.mediaType === 'logo' ? 'object-contain' : 'object-cover'}`}
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              )}
            </div>
            <span className="text-sm text-intents-ux-textSubtle-textColor truncate w-full">
              {formatSlotName(name)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
