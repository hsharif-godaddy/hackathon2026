'use client'

import { CheckCircle, ExternalLink, FileText, Image } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isEmployeeAuthType } from '@airo/shared/auth'
import Box from '@ux/box'
import Button from '@ux/button'
import Spinner from '@ux/spinner'
import text from '@ux/text'

import { useAuthContext } from '@/components/providers/AuthProvider'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { appService } from '@/services/AppService'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'
import { cleanCapturedText } from './cleanCapturedText'
import type { DefaultToolRendererProps } from './DefaultToolRenderer'
import { imageMatchesPage } from './imageMatchesPage'
import { thumbUrl } from './thumbUrl'
import ToolModal from './ToolModal'

type FetchStatus = 'idle' | 'loading' | 'done'

interface NavItem {
  label: string
  url: string
  isExternal: boolean
}

interface PageJson {
  sanitizedContent?: string
  content?: string
  metadata?: { description?: string }
  structure?: { navigation?: NavItem[] }
}

interface AssetItem {
  url: string
  altText?: string
  description?: string
  type: string
  sourcePages?: string[]
}

interface ManifestJson {
  assets?: AssetItem[]
}

// Max images to show in the grid before showing "+N more" note
const MAX_GRID_IMAGES = 12

/**
 * Custom renderer for the rebuildBuildPage tool.
 *
 * The deterministic inner-page rebuild emits a tool_result whose `output` carries
 * the page that will be rebuilt from the scraped source: `{ pageSlug, pageTitle,
 * sourceUrl, imageCount }`. The synthetic lifecycle fires at prompt-substitution
 * time (before the develop turn writes the page), so we show an in-progress card
 * while the last assistant stream is active and switch to the completed card once
 * the turn finishes. A "View source" modal lazily loads the scraped page snapshot.
 */
export default function RebuildBuildPageToolRenderer({
  result,
  isLastAssistantMessage = false,
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isBuilding = isLastAssistantMessage && (isStreaming || isLoading)
  const appId = useDevelopPageStore((state) => state.currentAppId)
  const { tokenAuthType } = useAuthContext()
  const isInternal = isEmployeeAuthType(tokenAuthType)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [pageData, setPageData] = useState<PageJson | null>(null)
  const [pageImages, setPageImages] = useState<AssetItem[]>([])
  const [status, setStatus] = useState<FetchStatus>('idle')
  // Distinguishes a real load failure (500/network/parse error) from an expected
  // absence (404 — snapshot not written). Absence → benign empty state; failure →
  // an explicit error message, so the two are never conflated.
  const [fetchFailed, setFetchFailed] = useState(false)

  const output = (typeof result === 'object' && result !== null ? result : {}) as {
    pageSlug?: string
    pageTitle?: string
    sourceUrl?: string
    imageCount?: number
  }
  const pageSlug = output.pageSlug ?? ''
  const pageTitle = output.pageTitle ?? pageSlug
  const sourceUrl = output.sourceUrl ?? ''
  const imageCount = output.imageCount ?? 0

  useEffect(() => {
    if (!isModalOpen || status !== 'idle' || !appId || !pageSlug) return

    // cancelled flag guards against setState after modal closes (handleClose resets
    // status→idle, which would re-trigger this effect; the in-flight fetch must not
    // call setState if it wins the race against the cleanup)
    let cancelled = false
    // Transition synchronously so the guard above blocks any re-entry on the next render
    setStatus('loading')

    // Each fetch resolves to `{ value, errored }`: `errored` is true only for a
    // real failure (non-404 status, or a JSON parse throw), never for an expected
    // 404. A 404 is benign absence and is NOT logged.
    const pagePromise = appService
      .readFile(appId, `.source-site/pages/${pageSlug}.json`)
      .then(({ content }): { value: PageJson | null; errored: boolean } => ({
        value: JSON.parse(content) as PageJson,
        errored: false,
      }))
      .catch((err: unknown): { value: PageJson | null; errored: boolean } => {
        const errStatus = (err as { status?: number })?.status
        if (errStatus === 404) return { value: null, errored: false }
        logger.warn('rebuild_build_page.page_fetch_failed', {
          pageSlug,
          status: errStatus,
          error: err instanceof Error ? err.message : String(err),
        })
        return { value: null, errored: true }
      })

    const manifestPromise = appService
      .readFile(appId, `.source-site/assets/manifest.json`)
      .then(({ content }): { value: ManifestJson; errored: boolean } => ({
        value: JSON.parse(content) as ManifestJson,
        errored: false,
      }))
      .catch((err: unknown): { value: ManifestJson; errored: boolean } => {
        const errStatus = (err as { status?: number })?.status
        if (errStatus === 404) return { value: { assets: [] }, errored: false }
        logger.warn('rebuild_build_page.manifest_fetch_failed', {
          status: errStatus,
          error: err instanceof Error ? err.message : String(err),
        })
        return { value: { assets: [] }, errored: true }
      })

    void Promise.all([pagePromise, manifestPromise]).then(([page, manifest]) => {
      if (cancelled) return
      setPageData(page.value)
      const matched = (manifest.value.assets ?? []).filter(a => imageMatchesPage(a, sourceUrl))
      setPageImages(matched)
      setFetchFailed(page.errored || manifest.errored)
      setStatus('done')
    })

    return () => {
      cancelled = true
    }
    // status intentionally omitted: we only want to run when the modal opens (isModalOpen
    // flips true) or when appId/pageSlug change. status is managed internally by this
    // effect and we use the idle check as a one-shot guard — not as a trigger.

  }, [isModalOpen, appId, pageSlug, sourceUrl])

  const handleClose = (): void => {
    setIsModalOpen(false)
    setStatus('idle')
    setPageData(null)
    setPageImages([])
    setFetchFailed(false)
  }

  // No page yet (running / pre-result) — nothing to confirm.
  if (!pageSlug) return null

  const rawText = pageData?.sanitizedContent || pageData?.content || ''
  const description = pageData?.metadata?.description || ''
  const navigation = pageData?.structure?.navigation ?? []

  // A real load failure surfaces an explicit error — never the benign "no snapshot"
  // copy, which would hide that the agent server actually errored.
  const showError = status === 'done' && fetchFailed
  // Genuine absence (everything resolved, nothing there, and no failure) → benign empty state.
  const showEmptyState =
    (status === 'done' && !fetchFailed && !pageData && pageImages.length === 0) ||
    (!appId && isModalOpen)

  // Show content when we have something useful from the page JSON (at minimum the raw text)
  const hasPageContent = status === 'done' && !!pageData

  const displayedImages = pageImages.slice(0, MAX_GRID_IMAGES)
  const extraImageCount = pageImages.length - displayedImages.length

  return (
    <>
      <Box
        orientation="vertical"
        gap="sm"
        className="ml-1 mt-1 pl-2 border-l-1 border-intents-ux-box-borderColor"
        data-testid="rebuild-build-page-confirmation"
        data-phase={isBuilding ? 'building' : 'completed'}
      >
        <Box orientation="horizontal" gap="sm">
          {isBuilding ? (
            <Spinner size="sm" />
          ) : (
            <CheckCircle className="w-2 h-2" />
          )}
          <text.p size={-1}>
            {isBuilding
              ? t('builder_rebuild_building_page', { pageTitle })
              : t('builder_rebuild_inner_confirmation_title', { pageTitle })}
          </text.p>
        </Box>
        {imageCount > 0 && (
          <Box orientation="horizontal" gap="sm">
            <Image className="w-2 h-2" />{/* eslint-disable-line jsx-a11y/alt-text */}
            <text.p size={-1}>
              {t('builder_rebuild_inner_confirmation_detail', { count: imageCount })}
            </text.p>
          </Box>
        )}
        {sourceUrl && (
          <Button
            text={t('builder_rebuild_view_source')}
            design="inline"
            size="sm"
            onClick={() => setIsModalOpen(true)}
            icon={<FileText className="!w-2 !h-2" />}
          />
        )}
      </Box>

      <ToolModal
        isOpen={isModalOpen}
        onClose={handleClose}
        title={t('builder_rebuild_source_modal_title', { pageTitle })}
      >
        <Box gap="md" className="flex-1 overflow-y-auto">
          {/* ── Section 1: Page identity header ──────────────────────────────── */}
          <Box gap="sm">
            <text.p size={0}>{pageTitle}</text.p>
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-intents-ux-link-foregroundColor text-sm"
            >
              {t('builder_rebuild_view_original_page')}
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
            {hasPageContent && description && (
              <text.p size={-1} emphasis="passive">
                {description}
              </text.p>
            )}
          </Box>

          {/* ── Loading ───────────────────────────────────────────────────────── */}
          {status === 'loading' && (
            <div className="flex items-center justify-center py-8">
              <Spinner size="sm" />
            </div>
          )}

          {/* ── Section 2: Images carried over ───────────────────────────────── */}
          {/* Images are gated on displayedImages.length alone — independent of whether
              page JSON loaded. If the page-JSON fetch fails but the manifest succeeds
              with matched images, we still want to show them. */}
          {displayedImages.length > 0 && (
            <Box gap="sm">
              {/* This labels what the grid actually shows — the manifest images that
                  list this page (imageMatchesPage). It deliberately does NOT reuse the
                  card's "carried over" wording: the card's `imageCount` is the build-time
                  per-page `byType.image`, a different stage, so echoing "carried over (N)"
                  here would read as a contradiction when the two counts differ. */}
              <text.p size={-1} className="font-semibold">
                {t('builder_rebuild_count_images', { count: displayedImages.length })}
              </text.p>
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))' }}
              >
                {displayedImages.map((img, i) => {
                  const caption = img.altText || img.description || ''
                  const filename = img.url.split('/').pop()?.split('?')[0] ?? ''
                  const alt = caption || filename
                  return (
                    <div key={i} className="flex flex-col gap-1">
                      <img // eslint-disable-line @next/next/no-img-element
                        src={thumbUrl(img.url)}
                        alt={alt}
                        loading="lazy"
                        className="w-full rounded border border-intents-ux-box-borderColor bg-intents-ux-boxLowContrast-backgroundColor"
                        style={{ height: 64, objectFit: 'cover' }}
                      />
                      {caption && (
                        <text.p size={-2} emphasis="passive" className="truncate text-center">
                          {caption}
                        </text.p>
                      )}
                    </div>
                  )
                })}
              </div>
              {extraImageCount > 0 && (
                <text.p size={-2} emphasis="passive">
                  {t('builder_analytics_more_items', { count: extraImageCount })}
                </text.p>
              )}
            </Box>
          )}

          {/* ── Section 3: Navigation chips ──────────────────────────────────── */}
          {hasPageContent && navigation.length > 0 && (
            <Box gap="sm">
              <text.p size={-1} className="font-semibold">
                {t('builder_rebuild_navigation_label', { count: navigation.length })}
              </text.p>
              <div className="flex flex-wrap gap-1">
                {navigation.map((item, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border border-intents-ux-box-borderColor bg-intents-ux-boxLowContrast-backgroundColor"
                  >
                    {item.label}
                  </span>
                ))}
              </div>
            </Box>
          )}

          {/* ── Section 4: Collapsible full captured text (internal only) ──────── */}
          {isInternal && hasPageContent && rawText && (
            <details className="group">
              <summary className="cursor-pointer list-none inline-flex items-center gap-1 text-intents-ux-link-foregroundColor text-sm select-none">
                {t('builder_rebuild_show_full_text')}
              </summary>
              <Box className="mt-2 bg-intents-ux-boxLowContrast-backgroundColor p-3 rounded border border-intents-ux-box-borderColor max-h-96 overflow-y-auto">
                <text.p size={-1} className="leading-relaxed whitespace-pre-wrap">
                  {cleanCapturedText(rawText)}
                </text.p>
              </Box>
            </details>
          )}

          {/* ── Load failure (distinct from absence) ──────────────────────────── */}
          {showError && (
            <text.p size={-1} emphasis="critical">
              {t('builder_status_error')}
            </text.p>
          )}

          {/* ── Empty state (genuine absence) ─────────────────────────────────── */}
          {showEmptyState && (
            <text.p size={-1} emphasis="passive">
              {t('builder_rebuild_no_snapshot_available')}
            </text.p>
          )}
        </Box>
      </ToolModal>
    </>
  )
}
