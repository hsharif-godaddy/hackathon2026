'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Play } from 'lucide-react'
import { useState } from 'react'
import ChevronDown from '@ux/icon/chevron-down'
import ImageIcon from '@ux/icon/image'
import PlusIcon from '@ux/icon/plus'
import SparklesIcon from '@ux/icon/sparkles'

import { formatSlotName, getPreviewOrigin } from '@/app/[market]/develop/components/media/MediaSlotDetail'
import type { MediaSlot } from '@/app/[market]/develop/components/media/types'
import { LogoShimmer, logoShimmerOrientation, LogoShimmerOverlay } from '@/app/[market]/develop/components/preview/brand-book/LogoShimmer'
import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID } from '@/utils/instrumentation'

export interface MediaSection {
  id: string
  title: string
  type: 'logo' | 'sitewide' | 'page'
  slots: string[]
  /** For page sections: the page slug */
  pageSlug?: string
}

interface MediaGridSectionProps {
  section: MediaSection
  manifest: Record<string, MediaSlot> | null
  appId: string
  previewBaseUrl: string | null
  thumbnailBustKey?: number
  /** Slot → ordered page titles it renders on. Used to caption Shared thumbnails. */
  slotPageUsage?: Record<string, string[]>
  onSelectSlot: (slotName: string) => void
  scrollPreviewToSlot: (name: string) => void
  onAddMedia?: (pageTitle: string) => void
  onDesignLogo?: () => void
}

export function MediaGridSection({
  section,
  manifest,
  previewBaseUrl,
  thumbnailBustKey,
  slotPageUsage,
  onSelectSlot,
  scrollPreviewToSlot,
  onAddMedia,
  onDesignLogo,
}: MediaGridSectionProps) {
  const slotCount = section.slots.length
  // Expand any section that has media to show; collapsed-by-default only for
  // empty sections (e.g. a built page awaiting its first image).
  const [expanded, setExpanded] = useState(slotCount > 0)
  const t = useTranslations()

  // Translate special section titles; page titles pass through as-is.
  // The sitewide ("Shared") section uses its own title verbatim — its label is
  // set deterministically when the section is built.
  const displayTitle = section.type === 'logo'
    ? t('builder_mediaslot_section_logo')
    : section.title

  return (
    <div data-testid={`media-section-${section.id}`}>
      {/* Section header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between py-2 px-1 hover:cursor-pointer group"
        data-eid={generateClickEID(`develop.media_panel.section.${section.id}`)}
        aria-expanded={expanded}
        aria-label={displayTitle}
      >
        <span className="text-base font-semibold text-foreground flex items-center gap-1.5">
          {displayTitle}
          {section.type !== 'logo' && (
            <span className="text-xs text-muted-foreground font-normal">
              ({slotCount})
            </span>
          )}
        </span>
        <ChevronDown
          className={`size-2.5 text-muted-foreground transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Section body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key={`section-body-${section.id}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            {/* Sitewide ("Shared") sublabel — clarifies why these slots are grouped. */}
            {section.type === 'sitewide' && (
              <p className="text-xs text-muted-foreground mb-2 px-1">
                Media used in more than one place.
              </p>
            )}
            {slotCount === 0 ? (
              <div className="grid grid-cols-2 gap-3 pb-2">
                <SectionZeroState section={section} onAddMedia={onAddMedia} onDesignLogo={onDesignLogo} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 pb-2">
                {section.slots.map((name) => (
                  <SlotThumbnail
                    key={name}
                    name={name}
                    slot={manifest?.[name] ?? null}
                    previewBaseUrl={previewBaseUrl}
                    thumbnailBustKey={thumbnailBustKey}
                    isLogo={section.type === 'logo'}
                    usageLabel={
                      section.type === 'sitewide' && (slotPageUsage?.[name]?.length ?? 0) > 1
                        ? slotPageUsage?.[name]?.join(' · ')
                        : undefined
                    }
                    onClick={() => {
                      scrollPreviewToSlot(name)
                      onSelectSlot(name)
                    }}
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Zero States ────────────────────────────────────────────────────────────

function SectionZeroState({ section, onAddMedia, onDesignLogo }: { section: MediaSection; onAddMedia?: (pageTitle: string) => void; onDesignLogo?: () => void }) {
  const t = useTranslations()

  if (section.type === 'logo') {
    return (
      <button
        type="button"
        onClick={() => onDesignLogo?.()}
        className="flex flex-col items-center justify-center aspect-square px-2 md:px-4 text-center border-2 border-dashed border-muted-foreground/40 rounded-md hover:border-intents-ux-link-textColor hover:bg-intents-ux-box-backgroundColor transition-colors cursor-pointer"
        data-eid={generateClickEID('develop.media_panel.logo_zero_state.design')}
      >
        <SparklesIcon className="size-4 md:size-5 text-muted-foreground mb-1 md:mb-2" />
        <p className="hidden md:block text-sm text-muted-foreground mb-2">{t('builder_mediaslot_no_logo')}</p>
        <span className="text-xs md:text-sm text-intents-ux-link-textColor font-medium">
          {t('builder_mediaslot_add_logo')}
        </span>
      </button>
    )
  }

  // Built page with no images — entire square is clickable
  return (
    <button
      type="button"
      onClick={() => onAddMedia?.(section.title)}
      className="flex flex-col items-center justify-center aspect-square px-2 md:px-4 text-center border-2 border-dashed border-muted-foreground/40 rounded-md hover:border-intents-ux-link-textColor hover:bg-intents-ux-box-backgroundColor transition-colors cursor-pointer"
      data-eid={generateClickEID('develop.media_panel.page_zero_state.add')}
    >
      <PlusIcon className="size-4 md:size-6 text-muted-foreground mb-1 md:mb-2" />
      <p className="hidden md:block text-sm text-muted-foreground mb-2">{t('builder_mediaslot_no_media')}</p>
      <span className="text-xs md:text-sm text-intents-ux-link-textColor font-medium">{t('builder_mediaslot_add_media')}</span>
    </button>
  )
}

// ─── Slot Thumbnail ─────────────────────────────────────────────────────────

interface SlotThumbnailProps {
  name: string
  slot: MediaSlot | null
  previewBaseUrl: string | null
  thumbnailBustKey?: number
  isLogo: boolean
  /** Optional caption shown under the slot name (e.g. "Home · Menu" for shared slots). */
  usageLabel?: string
  onClick: () => void
}

export function SlotThumbnail({
  name,
  slot,
  previewBaseUrl,
  thumbnailBustKey,
  isLogo,
  usageLabel,
  onClick,
}: SlotThumbnailProps) {
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
  const displayUrl = isVideo ? slot.currentUrl : (slot.thumbnailUrl || slot.currentUrl)
  const assetPrefix = isVideo ? '/airo-assets/videos/' : '/airo-assets/images/'
  const proxiedUrl = previewBaseUrl && displayUrl
    ? displayUrl.startsWith('http://') || displayUrl.startsWith('https://')
      ? displayUrl
      : displayUrl.startsWith('/airo-assets/uploads/')
        ? `${getPreviewOrigin(previewBaseUrl)}${displayUrl}${thumbnailBustKey ? `?_t=${thumbnailBustKey}` : ''}`
        : `${getPreviewOrigin(previewBaseUrl)}${assetPrefix}${name}?src=${encodeURIComponent(displayUrl)}`
    : displayUrl
  const posterUrl = isVideo && slot.thumbnailUrl ? slot.thumbnailUrl : undefined

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-0.5 text-start group hover:cursor-pointer"
      data-eid={generateClickEID('develop.media_panel.slot')}
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
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={proxiedUrl}
              alt={formatSlotName(name)}
              className={`w-full h-full ${isLogo || slot.mediaType === 'logo' ? 'object-contain' : 'object-cover'}`}
              loading="lazy"
              onError={(e) => {
                const target = e.currentTarget
                target.style.display = 'none'
                const placeholder = target.nextElementSibling as HTMLElement | null
                if (placeholder) placeholder.style.display = 'flex'
              }}
            />
            <div className="absolute inset-0 items-center justify-center hidden">
              <ImageIcon className="size-6 text-muted-foreground" />
            </div>
          </>
        )}
      </div>
      <span className="text-sm text-intents-ux-textSubtle-textColor truncate w-full">
        {formatSlotName(name)}
      </span>
      {usageLabel && (
        <span className="text-xs text-muted-foreground truncate w-full">
          {usageLabel}
        </span>
      )}
    </button>
  )
}
