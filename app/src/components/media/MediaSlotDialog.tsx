'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import Card from '@ux/card'
import XThickIcon from '@ux/icon/x-thick'

import { dynamicApiConfigService } from '@/config/dynamic-api'
import { useMediaSlot } from '@/hooks/useMediaSlot'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { logger } from '@/lib/request-context'
import { useMediaSlotDialogStore } from '@/stores/useMediaSlotDialogStore'
import { postMessageToIframe } from '@/utils/postMessage'

/**
 * Format slot name for display
 * Converts "pages/home/hero" to "Home Hero"
 */
function formatSlotName(slot: string): string {
  return slot
    .split('/')
    .filter(
      (part) =>
        part && part !== 'pages' && part !== 'components' && part !== 'sections'
    )
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' '))
    .join(' ')
}

/**
 * Ensure URLs have proper protocol
 * Handles http/https URLs, protocol-relative URLs, and other URI schemes
 */
function ensureHttps(url: string): string {
  if (!url) return url
  // Already has a URI scheme (http:, https:, data:, blob:, etc.)
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url)) {
    return url
  }
  // Protocol-relative URL (//example.com)
  if (url.startsWith('//')) {
    return `https:${url}`
  }
  // No scheme - add https://
  return `https://${url}`
}

/**
 * MediaSlotDialog - Standalone dialog for browsing and swapping media slot images
 *
 * Opens from:
 * - MediaGroupRenderer thumbnails in chat
 * - Dev-tools ElementEditor "Swap Media" button (via postMessage)
 *
 * Fetches fresh data from the API instead of relying on stale tool call results.
 */
export function MediaSlotDialog() {
  const { isOpen, slotName, appId, closeDialog } = useMediaSlotDialogStore()

  const { slot, isLoading, error } = useMediaSlot({
    appId,
    slotName,
    enabled: isOpen,
  })

  const [selectedImageIndex, setSelectedImageIndex] = useState(0)
  const [isSwapping, setIsSwapping] = useState(false)
  const [modalStyle, setModalStyle] = useState<React.CSSProperties>({})
  const [imageHeight, setImageHeight] = useState(120)
  const [isMobileLayout, setIsMobileLayout] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // Reset selection when slot changes
  useEffect(() => {
    if (isOpen) {
      setSelectedImageIndex(0)
    }
  }, [isOpen, slotName])

  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDialog()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, closeDialog])

  // Focus management: focus close button when modal opens
  useEffect(() => {
    if (isOpen && closeButtonRef.current) {
      // Small delay to ensure animation has started
      const timer = setTimeout(() => {
        closeButtonRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  // Get modal position and image sizes - responsive to screen size
  useEffect(() => {
    const updateLayout = () => {
      const previewContainer = document.getElementById('preview-pane-container')
      const width = window.innerWidth
      const isMobile = width < 700

      setIsMobileLayout(isMobile)

      // Set image height based on screen width
      if (width >= 2560) {
        setImageHeight(360)
      } else if (width >= 1920) {
        setImageHeight(240)
      } else if (width >= 1280) {
        setImageHeight(180)
      } else if (width >= 768) {
        setImageHeight(150)
      } else {
        setImageHeight(120)
      }

      if (previewContainer && !isMobile) {
        // Desktop: align to preview pane
        const rect = previewContainer.getBoundingClientRect()
        setModalStyle({
          top: rect.top,
          left: rect.left,
          width: Math.min(rect.width * 0.95, 1200),
          height: rect.height,
          transform: 'none',
          borderRadius: undefined,
        })
      } else {
        // Mobile: full screen below header (64px)
        setModalStyle({
          top: 64,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          height: 'calc(100% - 64px)',
          transform: 'none',
          borderRadius: 0,
        })
      }
    }

    if (isOpen) {
      updateLayout()
      window.addEventListener('resize', updateLayout)
      return () => window.removeEventListener('resize', updateLayout)
    }
  }, [isOpen])

  const handleSwapImage = useCallback(async () => {
    if (!slot || !appId || !slotName || selectedImageIndex === 0) return

    const allImages = [slot.currentUrl, ...slot.alternatives]
    const selectedUrl = allImages[selectedImageIndex]

    if (!selectedUrl) {
      logger.error('media_slot_dialog.swap_failed', {
        appId,
        slotName,
        error: 'Selected image URL not found',
      })
      return
    }

    logger.info('media_slot_dialog.swap_requested', {
      appId,
      slotName,
      newUrl: selectedUrl,
    })

    setIsSwapping(true)

    try {
      const tokenResult = await regenerateToken({ siteId: appId, force: true })
      const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)

      if (!apiConfig.agentUrl) {
        throw new Error('Agent URL not available')
      }

      const response = await fetch(
        `${apiConfig.agentUrl}/media/${appId}/slots/${slotName}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tokenResult.token}`,
          },
          body: JSON.stringify({ newUrl: selectedUrl }),
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(errorData.error || `Failed to swap image: ${response.status}`)
      }

      logger.info('media_slot_dialog.swap_success', {
        appId,
        slotName,
        newUrl: selectedUrl,
      })

      // Reload the image in the preview iframe and clear ElementEditor selection
      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
      if (iframe) {
        postMessageToIframe(iframe, {
          type: 'RELOAD_MEDIA_SLOT',
          slotPath: slotName,
        })
        // Clear the ElementEditor selection so the overlay goes away
        postMessageToIframe(iframe, {
          type: 'CLEAR_SELECTION',
        })
      }

      // Close dialog on success
      closeDialog()
    } catch (err) {
      logger.error('media_slot_dialog.swap_failed', {
        appId,
        slotName,
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setIsSwapping(false)
    }
  }, [appId, slotName, slot, selectedImageIndex, closeDialog])

  // Build images list
  const allImages = slot ? [slot.currentUrl, ...slot.alternatives] : []

  // Don't render anything if not in browser
  if (typeof document === 'undefined') {
    return null
  }

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-40 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={closeDialog}
          />

          {/* Modal */}
          <motion.div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="media-slot-dialog-title"
            className="fixed z-50 bg-intents-ux-box-backgroundColor rounded-lg shadow-xl overflow-hidden flex flex-col"
            style={modalStyle}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-intents-ux-boxLowContrast-backgroundColor">
              <h2 id="media-slot-dialog-title" className="font-semibold text-lg">
                Image Manager
              </h2>
              <Button
                ref={closeButtonRef}
                onClick={closeDialog}
                icon={<XThickIcon className="h-4 w-4" />}
                design="control"
                aria-label="Close media slot dialog"
                size="sm"
                className="flex-shrink-0 ml-2"
              />
            </div>

            {/* Content */}
            <div className={`flex-1 overflow-hidden flex flex-col ${isMobileLayout ? '' : 'p-4'}`}>
              {isLoading ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="w-8 h-8 animate-spin text-intents-ux-textSubtle-textColor" />
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center h-48 text-center">
                  <p className="text-intents-ux-textSubtle-textColor">
                    Failed to load media slot
                  </p>
                  <p className="text-sm text-intents-ux-textSubtle-textColor mt-1">
                    {error}
                  </p>
                </div>
              ) : slot && allImages.length > 0 ? (
                isMobileLayout ? (
                  /* Mobile Layout: Vertical stack with bottom button */
                  <div className="flex flex-col h-full">
                    {/* Header info */}
                    <div className="px-4 pt-2 pb-3">
                      <h3 className="font-semibold text-base">
                        {slotName ? formatSlotName(slotName) : 'Loading...'}
                      </h3>
                      <div className="flex items-center gap-1.5 flex-wrap mt-1">
                        {slot?.mediaType && slot.mediaType !== 'image' && (
                          <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-textSubtle-textColor">
                            {slot.mediaType}
                          </span>
                        )}
                        {slot?.orientations && (
                          <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-textSubtle-textColor">
                            {slot.orientations}
                          </span>
                        )}
                        {slot?.compositions && (
                          <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-textSubtle-textColor">
                            {slot.compositions}
                          </span>
                        )}
                        {slot?.requestedSize && (
                          <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-textSubtle-textColor">
                            {slot.requestedSize.width}x{slot.requestedSize.height}
                          </span>
                        )}
                      </div>
                      {slot?.searchQuery && (
                        <p className="text-sm text-intents-ux-textSubtle-textColor mt-1 line-clamp-2">
                          &ldquo;{slot.searchQuery}&rdquo;
                        </p>
                      )}
                    </div>

                    {/* Selected image - takes available space */}
                    <div className="flex-1 px-4 min-h-0">
                      <button
                        type="button"
                        onClick={() => setSelectedImageIndex(0)}
                        aria-pressed={selectedImageIndex === 0}
                        aria-label="Current image selection"
                        className={`flex items-center justify-center w-full h-full rounded-lg bg-intents-ux-boxLowContrast-backgroundColor ${
                          selectedImageIndex === 0
                            ? 'ring-2 ring-intents-ux-ring-borderColor'
                            : ''
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={ensureHttps(allImages[selectedImageIndex] || allImages[0] || '')}
                          alt="Selected image"
                          className="max-w-full max-h-full object-contain rounded-lg"
                        />
                      </button>
                    </div>

                    {/* Alternatives - horizontal scroll */}
                    <div className="px-4 py-3">
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {allImages.map((url, index) => {
                          const isSelected = selectedImageIndex === index
                          return (
                            <button
                              type="button"
                              key={index}
                              onClick={() => setSelectedImageIndex(index)}
                              aria-pressed={isSelected}
                              aria-label={index === 0 ? 'Current image' : `Alternative ${index}`}
                              className={`flex-shrink-0 w-16 h-16 flex items-center justify-center rounded-md bg-intents-ux-boxLowContrast-backgroundColor ${
                                isSelected
                                  ? 'ring-2 ring-intents-ux-ring-borderColor'
                                  : 'opacity-70'
                              }`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={ensureHttps(url)}
                                alt={index === 0 ? 'Current' : `Option ${index + 1}`}
                                className="max-w-full max-h-full object-contain rounded-md"
                              />
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Bottom action button */}
                    <div className="px-4 pb-4 pt-2 border-t border-intents-ux-boxLowContrast-backgroundColor">
                      <Button
                        onClick={handleSwapImage}
                        design="primary"
                        icon={<RefreshCw className={`w-4 h-4 ${isSwapping ? 'animate-spin' : ''}`} />}
                        disabled={selectedImageIndex === 0 || isSwapping}
                        className="w-full"
                      >
                        {isSwapping ? 'Swapping...' : 'Use this image'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* Desktop Layout: Side by side with button in header */
                  <Card className="p-4 overflow-y-auto">
                    {/* Slot title, search query, pills, and action button */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-base">
                            {slotName ? formatSlotName(slotName) : 'Loading...'}
                          </h3>
                          {/* Attribute pills */}
                          {slot?.mediaType && slot.mediaType !== 'image' && (
                            <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-textSubtle-textColor">
                              {slot.mediaType}
                            </span>
                          )}
                          {slot?.orientations && (
                            <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-textSubtle-textColor">
                              {slot.orientations}
                            </span>
                          )}
                          {slot?.compositions && (
                            <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-textSubtle-textColor">
                              {slot.compositions}
                            </span>
                          )}
                          {slot?.requestedSize && (
                            <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-textSubtle-textColor">
                              {slot.requestedSize.width}x{slot.requestedSize.height}
                            </span>
                          )}
                        </div>
                        {slot?.searchQuery && (
                          <p className="text-sm text-intents-ux-textSubtle-textColor mt-1">
                            &ldquo;{slot.searchQuery}&rdquo;
                          </p>
                        )}
                      </div>
                      <Button
                        onClick={handleSwapImage}
                        design="primary"
                        icon={<RefreshCw className={`w-4 h-4 ${isSwapping ? 'animate-spin' : ''}`} />}
                        disabled={selectedImageIndex === 0 || isSwapping}
                        className="flex-shrink-0 ml-4"
                      >
                        {isSwapping ? 'Swapping...' : 'Use this image'}
                      </Button>
                    </div>

                    {/* Images */}
                    <div className="flex gap-3">
                      {/* Left: Current/selected image (large) */}
                      <div className="flex-shrink-0" style={{ width: '50%' }}>
                        <button
                          type="button"
                          onClick={() => setSelectedImageIndex(0)}
                          aria-pressed={selectedImageIndex === 0}
                          aria-label="Current image selection"
                          className={`flex items-center justify-center w-full rounded-md transition-all bg-intents-ux-boxLowContrast-backgroundColor ${
                            selectedImageIndex === 0
                              ? 'ring-2 ring-intents-ux-ring-borderColor'
                              : 'hover:opacity-80'
                          }`}
                          style={{ height: imageHeight * 2 }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={ensureHttps(allImages[0] || '')}
                            alt="Current selection"
                            className="max-w-full max-h-full object-contain rounded-md"
                          />
                        </button>
                      </div>

                      {/* Right: Alternatives grid (2 columns) */}
                      <div className="flex-1 grid grid-cols-2 gap-2 content-start">
                        {allImages.slice(1).map((url, index) => {
                          const actualIndex = index + 1
                          const isSelected = selectedImageIndex === actualIndex

                          return (
                            <button
                              type="button"
                              key={actualIndex}
                              onClick={() => setSelectedImageIndex(actualIndex)}
                              aria-pressed={isSelected}
                              aria-label={`Alternative image ${actualIndex}`}
                              className={`flex items-center justify-center rounded-md transition-all bg-intents-ux-boxLowContrast-backgroundColor ${
                                isSelected
                                  ? 'ring-2 ring-intents-ux-ring-borderColor'
                                  : 'hover:opacity-80'
                              }`}
                              style={{ height: imageHeight }}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={ensureHttps(url)}
                                alt={`Option ${actualIndex + 1}`}
                                className="max-w-full max-h-full object-contain rounded-md"
                              />
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </Card>
                )
              ) : (
                <div className="flex items-center justify-center h-48">
                  <p className="text-intents-ux-textSubtle-textColor">
                    No images available
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )

  return createPortal(modalContent, document.body)
}
