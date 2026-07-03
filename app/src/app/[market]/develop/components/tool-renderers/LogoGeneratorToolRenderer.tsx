'use client'

import { Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import MediaModal from '@/app/[market]/develop/components/tool-renderers/MediaModal'
import ToolHeader from '@/app/[market]/develop/components/tool-renderers/ToolHeader'
import { extractLogosFromToolResult, getLogoDisplayUrl, type LogoData, mapLogoSessionToLogoData } from '@/app/[market]/develop/components/widgets/logo-utils'
import LogoGridWidget from '@/app/[market]/develop/components/widgets/LogoGridWidget'
import { useBrandData } from '@/hooks/useBrandData'
import { useMediaSlot } from '@/hooks/useMediaSlot'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { useToolDetailsModal } from '@/stores/useToolDetailsModalStore'

type LogoResult = LogoData

function safeJsonParse(s: string): Record<string, unknown> | undefined {
  try { return JSON.parse(s) as Record<string, unknown> } catch { return undefined }
}

/**
 * Custom renderer for media-logo__generate_logo tool
 *
 * Displays generated logos in a selectable grid format.
 * Users can click to select a logo, which opens a modal with larger view.
 */
export default function LogoGeneratorToolRenderer({
  toolName,
  toolStatus,
  toolId,
  input: _input,
  result
}: DefaultToolRendererProps) {
  const currentAppId = useStreamingConversationStore((s) => s.currentAppId)
  const { data: brandData } = useBrandData(currentAppId)
  const logoBgColor: string = brandData?.palette?.background ?? '#ffffff'

  // New async shape: { started: true, jobId, slots }. Pure derivation (no hooks) —
  // computed BEFORE the store selector so the selector can key off THIS card's jobId.
  const asyncResultObj = typeof result === 'string' ? safeJsonParse(result) : (result as Record<string, unknown> | undefined)
  const structured = asyncResultObj?.structuredContent as { started?: boolean; jobId?: string; slots?: string[] } | undefined
  const startedJobId = structured?.started ? structured.jobId : undefined

  // Look up THIS card's job by jobId so an older card keeps reading its own result
  // when a second job arrives (logoJobResults is keyed appId -> jobId -> result).
  const logoJobResult = useDevelopPageStore((s) =>
    currentAppId ? s.logoJobResults[currentAppId]?.[startedJobId ?? ''] : undefined,
  )

  // Fallback: after reload the in-memory store is gone but the slot has the real URL.
  const asyncSlotPath: string | null = structured?.slots?.[0] ?? null
  const needsSlotFallback: boolean = !!startedJobId && !logoJobResult
  const { slot: fallbackSlot, refetch: refetchSlot } = useMediaSlot({
    appId: currentAppId,
    slotName: asyncSlotPath,
    enabled: needsSlotFallback,
  })

  // When a new job starts, the react-query cache may still hold stale slot data
  // (from before placeShimmerSlots set pendingJobId). Force a refetch so the
  // renderer sees the pending marker and shows shimmer instead of the old logo.
  const prevJobIdRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (startedJobId && startedJobId !== prevJobIdRef.current && needsSlotFallback) {
      prevJobIdRef.current = startedJobId
      refetchSlot()
    }
  }, [startedJobId, needsSlotFallback, refetchSlot])

  const t = useTranslations()

  const [isModalOpen, setIsModalOpen] = useToolDetailsModal(toolId)
  const [selectedLogoIndex, setSelectedLogoIndex] = useState(0)
  const thumbnailRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Parse result - expects structuredContent from REST API or MCP response
  const logos: LogoResult[] = []

  // Parse input to get brand name for display
  let brandName = 'Logo'
  if (_input) {
    try {
      const inputObj = typeof _input === 'string' ? JSON.parse(_input) : _input
      brandName = inputObj?.brandName || inputObj?.businessName || inputObj?.name || 'Logo'
    } catch {
      // Keep default
    }
  }

  if (result) {
    try {
      let resultObj: any = null

      if (typeof result === 'string') {
        try {
          resultObj = JSON.parse(result)
        } catch {
          // Not JSON string
        }
      } else if (typeof result === 'object') {
        resultObj = result
      }

      // Normalize across all tool-result shapes (new nested logo, legacy array,
      // direct logos, MCP content) in one tested place.
      logos.push(...extractLogosFromToolResult(resultObj))
    } catch (e) {
      logger.error('tool.logo_generator.parse.failed', {
        error: e instanceof Error ? e.message : String(e),
        resultLength: typeof result === 'string' ? result.length : undefined
      })
    }
  }

  const logoCount = logos.length
  const hasLogos = logoCount > 0
  const hasDetails = hasLogos

  const handleModalClose = () => {
    setIsModalOpen(false)
  }

  // Keyboard navigation in modal
  useEffect(() => {
    if (!isModalOpen || logos.length <= 1) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setSelectedLogoIndex((prev) => (prev > 0 ? prev - 1 : logos.length - 1))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setSelectedLogoIndex((prev) => (prev < logos.length - 1 ? prev + 1 : 0))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isModalOpen, logos.length])

  // Scroll selected thumbnail into view
  useEffect(() => {
    if (isModalOpen && thumbnailRefs.current[selectedLogoIndex]) {
      thumbnailRefs.current[selectedLogoIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center'
      })
    }
  }, [selectedLogoIndex, isModalOpen])

  // Async logo (started ack { started, jobId, slots }) — rendered AFTER all hooks
  // above so hook order is stable across renders (react-hooks/rules-of-hooks).
  if (startedJobId) {
    // The selector already returned the entry for THIS jobId (or undefined), so no
    // jobId-match guard is needed here.
    const matched = logoJobResult ?? null

    if (!matched || matched.status === undefined) {
      // After reload: prefer per-job cached URL (each card shows its own logo)
      // over the slot (which only has the LATEST logo).
      const cachedUrl: string | null = (() => {
        try { return localStorage.getItem(`logo-result-${startedJobId}`) } catch { return null }
      })()
      const resolvedUrl: string | undefined = cachedUrl
        ?? (fallbackSlot && !fallbackSlot.pendingJobId ? fallbackSlot.currentUrl : undefined)

      if (resolvedUrl) {
        return (
          <div data-testid="logo-result">
            <ToolHeader icon={<Sparkles className="w-2 h-2" />} displayName={t('builder_logo_ready_title')} toolStatus="completed" hasDetails={false} />
            <div className="mt-2 w-full overflow-hidden rounded-md border-2 border-intents-ux-boxHighContrast-borderColor shadow-md p-2" style={{ backgroundColor: logoBgColor }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img data-testid="logo-result-image" src={resolvedUrl} alt="Generated logo" />
            </div>
          </div>
        )
      }
      return (
        <div data-testid="logo-generating-placeholder">
          <ToolHeader icon={<Sparkles className="w-2 h-2" />} displayName={t('builder_logo_generating')} toolStatus="running" hasDetails={false} />
        </div>
      )
    }

    if (matched.status === 'completed') {
      const displayUrl = matched.logo ? getLogoDisplayUrl(mapLogoSessionToLogoData(matched.logo)) : undefined
      const slotSaveFailed = matched.slotSaveFailed === true
      const failedLayouts = matched.failedLayouts ?? []
      return (
        <div data-testid="logo-result">
          <ToolHeader
            icon={<Sparkles className="w-2 h-2" />}
            displayName={slotSaveFailed ? (t('builder_logo_partial_title') || 'Logo partially applied') : t('builder_logo_ready_title')}
            toolStatus="completed"
            hasDetails={false}
          />
          {slotSaveFailed && (
            <p data-testid="logo-result-warning" className="text-xs text-intents-ux-warning-textColor mt-1">
              {t('builder_logo_partial_description', { layouts: failedLayouts.join(', ') }) || 'Some logo layouts could not be applied.'}
            </p>
          )}
          {displayUrl && (
            <div className="mt-2 w-full overflow-hidden rounded-md border-2 border-intents-ux-boxHighContrast-borderColor shadow-md p-2" style={{ backgroundColor: logoBgColor }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img data-testid="logo-result-image" src={displayUrl} alt="Generated logo" />
            </div>
          )}
        </div>
      )
    }

    if (matched.status === 'failed') {
      return (
        <div data-testid="logo-error">
          <ToolHeader icon={<Sparkles className="w-2 h-2" />} displayName={t('builder_logo_failed_title')} toolStatus="error" hasDetails={false} />
          <p className="text-xs text-foreground/60 mt-1">{matched.error || t('builder_logo_failed_default_error')}</p>
        </div>
      )
    }

    if (matched.status === 'cancelled') {
      return (
        <div data-testid="logo-cancelled">
          <ToolHeader icon={<Sparkles className="w-2 h-2" />} displayName={t('builder_logo_cancelled')} toolStatus="completed" hasDetails={false} />
        </div>
      )
    }
  }

  const selectedLogo = logos[selectedLogoIndex]

  // Build display name based on state and tool type
  const isEdit = toolName === 'media-logo__edit_logo'
  const displayName = toolStatus === 'completed' && hasLogos
    ? isEdit
      ? `Edited logo — ${logoCount} variation${logoCount !== 1 ? 's' : ''}`
      : `Generated ${logoCount} logo${logoCount !== 1 ? 's' : ''} for "${brandName}"`
    : isEdit
      ? 'Editing logo...'
      : 'Generating logos...'

  return (
    <div>
      <ToolHeader
        icon={<Sparkles className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={hasDetails ? () => setIsModalOpen(true) : undefined}
      />

      {/* Logo selection grid with action buttons */}
      {toolStatus === 'completed' && hasLogos && (
        <div className="mt-2 mb-2">
          <LogoGridWidget logos={logos} />
        </div>
      )}

      <MediaModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        title="Generated Logos"
      >
        {/* Logo thumbnails navigation */}
        {logos.length > 1 && (
          <div className="flex flex-nowrap gap-2 mb-3 overflow-x-auto pb-2 w-full">
            {logos.map((logo, index) => (
              <button
                key={logo.id || index}
                ref={(el) => { thumbnailRefs.current[index] = el }}
                onClick={() => setSelectedLogoIndex(index)}
                className={`flex-shrink-0 w-16 h-16 rounded-lg border-4 overflow-hidden transition-all hover:cursor-pointer hover:opacity-100 bg-intents-ux-boxLowContrast-backgroundColor ${selectedLogoIndex === index ? 'border-primary ring-2 ring-primary/30' : 'border-border opacity-70'
                  }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getLogoDisplayUrl(logo)}
                  alt={`Logo ${index + 1}`}
                  className="w-full h-full object-contain"
                />
              </button>
            ))}
          </div>
        )}

        {/* Logo counter */}
        {logos.length > 1 && (
          <div className="w-full text-center mb-3 pb-2 border-b border-border">
            <p className="text-sm text-foreground/60">
              {selectedLogoIndex + 1} of {logos.length}
            </p>
          </div>
        )}

        <div className="flex flex-col items-center">
          {/* Color palette display */}
          {selectedLogo?.palette && selectedLogo.palette.length > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm text-foreground/70">Colors:</span>
              <div className="flex gap-1">
                {selectedLogo.palette.map((color, i) => (
                  <div
                    key={i}
                    className="w-6 h-6 rounded-full border border-border shadow-sm"
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Main logo image */}
          <div className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-4 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selectedLogo ? getLogoDisplayUrl(selectedLogo) : undefined}
              alt={`Logo ${selectedLogoIndex + 1}`}
              className="max-w-full max-h-[50vh] object-contain"
            />
          </div>

          {/* Mockup preview if available */}
          {(selectedLogo?.landscapeMockupUrl || selectedLogo?.horizontalLandscapeMockupUrl || selectedLogo?.verticalLandscapeMockupUrl || selectedLogo?.mockupUrl || selectedLogo?.horizontalMockupUrl || selectedLogo?.verticalMockupUrl) && (
            <div className="mt-4 bg-intents-ux-boxLowContrast-backgroundColor rounded-lg p-4 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selectedLogo.landscapeMockupUrl || selectedLogo.horizontalLandscapeMockupUrl || selectedLogo.verticalLandscapeMockupUrl || selectedLogo.mockupUrl || selectedLogo.horizontalMockupUrl || selectedLogo.verticalMockupUrl}
                alt="Logo mockup"
                className="max-w-full max-h-[30vh] object-contain rounded"
              />
            </div>
          )}
        </div>
      </MediaModal>
    </div>
  )
}
