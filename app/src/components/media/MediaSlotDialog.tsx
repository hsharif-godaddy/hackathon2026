'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, RefreshCw, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Button from '@ux/button'
import XThickIcon from '@ux/icon/x-thick'

import { dynamicApiConfigService } from '@/config/dynamic-api'
import { useMediaSlot } from '@/hooks/useMediaSlot'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { logger } from '@/lib/request-context'
import { useMediaSlotDialogStore } from '@/stores/useMediaSlotDialogStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { postMessageToIframe } from '@/utils/postMessage'
import { UploadedImagesSection } from './UploadedImagesSection'

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
 * Constructs a URL for loading an image through the media slot proxy.
 * Uses the /airo-assets/images/{slotName}?src={url} endpoint which:
 * - Validates the URL is associated with the slot (currentUrl or in alternatives)
 * - Handles both external URLs (redirect) and local uploads (serve directly)
 * - Is excluded from JWT auth so <img> tags can load without Authorization headers
 *
 * @param slotName - The slot name (e.g., "pages/home/hero")
 * @param imageUrl - The image URL to serve (currentUrl or alternative)
 * @param previewBaseUrl - The preview site URL where dev-supervisor proxy runs
 */
function getSlotImageUrl(
  slotName: string | null,
  imageUrl: string,
  previewBaseUrl: string | null
): string {
  if (!imageUrl || !slotName || !previewBaseUrl) {
    return imageUrl || ''
  }
  // Use the proxy endpoint with src parameter
  const encodedSrc = encodeURIComponent(imageUrl)
  return `${previewBaseUrl}/airo-assets/images/${slotName}?src=${encodedSrc}`
}

// Upload validation constants
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

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
  const [isMobileLayout, setIsMobileLayout] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [activeRightTab, setActiveRightTab] = useState<'alternatives' | 'uploads'>('alternatives')
  const modalRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Get preview URL from server polling store (where dev-supervisor proxy runs)
  const getServerState = useServerPollingStore((state) => state.getServerState)
  const serverState = appId ? getServerState(appId) : null
  const previewBaseUrl = serverState?.url || null

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

      // Get base agent URL (remove app-specific path if present) since /media is not under /apps
      const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '')

      const response = await fetch(
        `${baseAgentUrl}/media/${appId}/slots/${slotName}`,
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

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      // Guard against null appId/slotName (should not happen in practice)
      if (!appId || !slotName) {
        setUploadError('Missing app or slot context')
        return
      }

      // Reset input for re-selection
      event.target.value = ''

      // Client-side validation
      if (!ALLOWED_TYPES.includes(file.type)) {
        setUploadError('Only JPEG, PNG, WebP, and GIF images are supported')
        return
      }

      if (file.size > MAX_FILE_SIZE) {
        setUploadError('Image exceeds 10MB limit')
        return
      }

      setUploadError(null)
      setIsUploading(true)

      try {
        const tokenResult = await regenerateToken({ siteId: appId, force: true })
        const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)

        if (!apiConfig.agentUrl) {
          throw new Error('Agent URL not available')
        }

        // Get base agent URL (remove app-specific path if present) since /media is not under /apps
        const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '')

        const formData = new FormData()
        formData.append('image', file)

        const response = await fetch(
          `${baseAgentUrl}/media/${appId}/slots/${slotName}/upload`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${tokenResult.token}`,
            },
            body: formData,
          }
        )

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Upload failed' }))
          throw new Error(errorData.error || `Upload failed: ${response.status}`)
        }

        const result = await response.json()

        logger.info('media_slot_dialog.upload_success', {
          appId,
          slotName,
          uploadedUrl: result.uploadedUrl,
        })

        // Reload the slot in the preview iframe and clear selection
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

        // Close dialog on success (slot data will refresh when reopened)
        closeDialog()
      } catch (error) {
        logger.error('media_slot_dialog.upload_failed', {
          appId,
          slotName,
          error: error instanceof Error ? error.message : String(error),
        })
        setUploadError(error instanceof Error ? error.message : 'Upload failed')
      } finally {
        setIsUploading(false)
      }
    },
    [appId, slotName, closeDialog]
  )

  const handleSelectFromUploads = useCallback(
    async (file: { filename: string; signedUrl?: string }) => {
      if (!appId || !slotName) return

      setIsUploading(true)
      setUploadError(null)

      try {
        const tokenResult = await regenerateToken({ siteId: appId, force: true })
        const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)

        if (!apiConfig.agentUrl) {
          throw new Error('Agent URL not available')
        }

        // Get base agent URL (remove app-specific path if present)
        const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '')

        // Fetch the file from uploads using signed URL (no JWT needed for public endpoint).
        // If the signed URL fails (e.g. expired → 404), fall back to JWT-protected endpoint.
        let fileResponse: Response | undefined

        if (file.signedUrl) {
          const signedFileUrl = `${baseAgentUrl}${file.signedUrl}`
          fileResponse = await fetch(signedFileUrl)

          if (!fileResponse.ok) {
            logger.debug('media_slot_dialog.signed_url_fallback', {
              appId,
              filename: file.filename,
              status: fileResponse.status,
              message: 'Signed URL failed, falling back to JWT auth',
            })
            fileResponse = undefined
          }
        }

        if (!fileResponse) {
          const jwtFileUrl = `${baseAgentUrl}/files/uploads/${appId}/${file.filename}`
          fileResponse = await fetch(jwtFileUrl, {
            headers: {
              Authorization: `Bearer ${tokenResult.token}`,
            },
          })
        }

        if (!fileResponse.ok) {
          throw new Error('Failed to fetch uploaded file')
        }

        const blob = await fileResponse.blob()
        const formData = new FormData()
        formData.append('image', blob, file.filename)

        // Upload to media slot (use baseAgentUrl since /media is not under /apps)
        const uploadResponse = await fetch(
          `${baseAgentUrl}/media/${appId}/slots/${slotName}/upload`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${tokenResult.token}`,
            },
            body: formData,
          }
        )

        if (!uploadResponse.ok) {
          const errorData = await uploadResponse
            .json()
            .catch(() => ({ error: 'Upload failed' }))
          throw new Error(errorData.error || 'Upload failed')
        }

        logger.info('media_slot_dialog.upload_from_chat_success', {
          appId,
          slotName,
          filename: file.filename,
        })

        // Reload the slot in the preview iframe and clear selection
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
      } catch (error) {
        logger.error('media_slot_dialog.upload_from_chat_failed', {
          appId,
          slotName,
          error: error instanceof Error ? error.message : String(error),
        })
        setUploadError(
          error instanceof Error ? error.message : 'Failed to use uploaded image'
        )
      } finally {
        setIsUploading(false)
      }
    },
    [appId, slotName, closeDialog]
  )

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
                          src={getSlotImageUrl(slotName, allImages[selectedImageIndex] || allImages[0] || '', previewBaseUrl)}
                          alt="Selected image"
                          className="max-w-full max-h-full object-contain rounded-lg"
                        />
                      </button>
                    </div>

                    {/* Scrollable area for alternatives and uploads */}
                    <div className="flex-shrink-0 overflow-y-auto max-h-48 px-4 py-3">
                      {/* Alternatives - horizontal scroll */}
                      <div className="flex gap-2 overflow-x-auto p-1">
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
                                src={getSlotImageUrl(slotName, url, previewBaseUrl)}
                                alt={index === 0 ? 'Current' : `Option ${index + 1}`}
                                className="max-w-full max-h-full object-contain rounded-md"
                              />
                            </button>
                          )
                        })}
                      </div>

                      {/* Chat uploads section */}
                      {appId && (
                        <UploadedImagesSection
                          appId={appId}
                          onSelectImage={handleSelectFromUploads}
                          isDisabled={isUploading}
                        />
                      )}
                    </div>

                    {/* Bottom action buttons */}
                    <div className="px-4 pb-4 pt-2 border-t border-intents-ux-boxLowContrast-backgroundColor">
                      {uploadError && (
                        <p className="text-sm text-intents-ux-error-textColor mb-2">{uploadError}</p>
                      )}
                      <div className="flex gap-2">
                        <Button
                          onClick={() => fileInputRef.current?.click()}
                          design="secondary"
                          icon={<Upload className={`w-4 h-4 ${isUploading ? 'animate-pulse' : ''}`} />}
                          disabled={isUploading}
                          className="flex-1"
                        >
                          {isUploading ? 'Uploading...' : 'Upload'}
                        </Button>
                        <Button
                          onClick={handleSwapImage}
                          design="primary"
                          icon={<RefreshCw className={`w-4 h-4 ${isSwapping ? 'animate-spin' : ''}`} />}
                          disabled={selectedImageIndex === 0 || isSwapping}
                          className="flex-1"
                        >
                          {isSwapping ? 'Swapping...' : 'Use this image'}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Desktop Layout: Side by side with button in header */
                  <div className="h-full flex flex-col overflow-hidden">
                    <div className="p-4 h-full flex flex-col overflow-hidden bg-intents-ux-box-backgroundColor rounded-lg border border-intents-ux-box-borderColor">
                      {/* Slot title, search query, pills, and action button */}
                      <div className="flex items-start justify-between mb-4 flex-shrink-0">
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
                        <div className="flex gap-2 flex-shrink-0 ml-4">
                          <Button
                            onClick={() => fileInputRef.current?.click()}
                            design="secondary"
                            icon={<Upload className={`w-4 h-4 ${isUploading ? 'animate-pulse' : ''}`} />}
                            disabled={isUploading}
                          >
                            {isUploading ? 'Uploading...' : 'Upload'}
                          </Button>
                          <Button
                            onClick={handleSwapImage}
                            design="primary"
                            icon={<RefreshCw className={`w-4 h-4 ${isSwapping ? 'animate-spin' : ''}`} />}
                            disabled={selectedImageIndex === 0 || isSwapping}
                          >
                            {isSwapping ? 'Swapping...' : 'Use this image'}
                          </Button>
                        </div>
                      </div>
                      {uploadError && (
                        <p className="text-sm text-intents-ux-error-textColor mb-4 flex-shrink-0">{uploadError}</p>
                      )}

                      {/* Two-column layout: Left preview, Right tabs */}
                      <div className="flex-1 h-0 flex gap-4">
                        {/* Left: Current/selected image (large) - clickable to reset to original */}
                        <button
                          type="button"
                          onClick={() => setSelectedImageIndex(0)}
                          className={`w-1/2 max-h-full rounded-md transition-all ${
                            selectedImageIndex === 0
                              ? 'ring-2 ring-intents-ux-ring-borderColor'
                              : 'hover:opacity-80 cursor-pointer'
                          }`}
                          aria-label="Current image - click to select"
                          aria-pressed={selectedImageIndex === 0}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={getSlotImageUrl(slotName, allImages[selectedImageIndex] || allImages[0] || '', previewBaseUrl)}
                            alt="Current selection"
                            className="w-full max-h-full object-contain rounded-md bg-intents-ux-boxLowContrast-backgroundColor p-2"
                          />
                        </button>

                        {/* Right: Tabbed view */}
                        <div className="w-1/2 h-full overflow-visible">
                          <div className="max-h-full flex flex-col">
                            {/* Tab buttons */}
                            <div className="flex gap-1 mb-3 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => setActiveRightTab('alternatives')}
                              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                                activeRightTab === 'alternatives'
                                  ? 'bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-text-textColor'
                                  : 'text-intents-ux-textSubtle-textColor hover:text-intents-ux-text-textColor'
                              }`}
                            >
                              Alternatives ({allImages.length - 1})
                            </button>
                            {appId && (
                              <button
                                type="button"
                                onClick={() => setActiveRightTab('uploads')}
                                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                                  activeRightTab === 'uploads'
                                    ? 'bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-text-textColor'
                                    : 'text-intents-ux-textSubtle-textColor hover:text-intents-ux-text-textColor'
                                }`}
                              >
                                Your Uploads
                              </button>
                            )}
                          </div>

                          {/* Tab content with scroll */}
                          <div className="flex-1 h-0 overflow-y-auto p-1">
                            {activeRightTab === 'alternatives' ? (
                              <div className="grid grid-cols-2 gap-2 content-start">
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
                                      className={`rounded-md transition-all ${
                                        isSelected
                                          ? 'ring-2 ring-intents-ux-ring-borderColor'
                                          : 'hover:opacity-80'
                                      }`}
                                    >
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={getSlotImageUrl(slotName, url, previewBaseUrl)}
                                        alt={`Option ${actualIndex + 1}`}
                                        className="w-full object-contain rounded-md bg-intents-ux-boxLowContrast-backgroundColor p-2"
                                      />
                                    </button>
                                  )
                                })}
                              </div>
                            ) : (
                              <UploadedImagesSection
                                appId={appId!}
                                onSelectImage={handleSelectFromUploads}
                                isDisabled={isUploading}
                                layout="grid"
                              />
                            )}
                          </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
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

  return createPortal(
    <>
      {modalContent}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
        aria-hidden="true"
      />
    </>,
    document.body
  )
}
