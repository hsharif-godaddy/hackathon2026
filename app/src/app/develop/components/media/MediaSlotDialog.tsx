'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@ux/button'
import ChevronDownIcon from '@ux/icon/chevron-down'
import ChevronLeftIcon from '@ux/icon/chevron-left'
import ChevronRightIcon from '@ux/icon/chevron-right'
import ChevronUpIcon from '@ux/icon/chevron-up'
import CloudUploadIcon from '@ux/icon/cloud-upload'
import RefreshIcon from '@ux/icon/refresh'
import Skeleton from '@ux/skeleton'
import Tag from '@ux/tag'

import { UploadedImagesSection } from '@/app/develop/components/media/UploadedImagesSection'
import { Sheet } from '@/app/develop/components/Sheet'
import { dynamicApiConfigService } from '@/config/dynamic-api'
import { useMediaSlot } from '@/hooks/useMediaSlot'
import { useTranslations } from '@/hooks/useTranslations'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { logger } from '@/lib/request-context'
import { useMediaSlotDialogStore } from '@/stores/useMediaSlotDialogStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { generateClickEID } from '@/utils/instrumentation'
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
 * Constructs a URL for loading an image through the media slot proxy.
 */
function getSlotImageUrl(
  slotName: string | null,
  imageUrl: string,
  previewBaseUrl: string | null
): string {
  if (!imageUrl || !slotName || !previewBaseUrl) {
    return imageUrl || ''
  }
  const encodedSrc = encodeURIComponent(imageUrl)
  return `${previewBaseUrl}/airo-assets/images/${slotName}?src=${encodedSrc}`
}

// Upload validation constants
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

/**
 * MediaSlotDialog - Sheet-based dialog for browsing and swapping media slot images
 */
export function MediaSlotDialog() {
  const t = useTranslations()
  const { isOpen, slotName, appId, allSlotNames, closeDialog } = useMediaSlotDialogStore()

  // Carousel mode: track which slot we're viewing
  const [currentSlotIndex, setCurrentSlotIndex] = useState(0)
  const isCarouselMode = allSlotNames && allSlotNames.length > 0
  const activeSlotName = isCarouselMode ? allSlotNames[currentSlotIndex] : slotName

  const { slot, isLoading, error } = useMediaSlot({
    appId,
    slotName: activeSlotName,
    enabled: isOpen,
  })

  const [selectedImageIndex, setSelectedImageIndex] = useState(0)
  const [isSwapping, setIsSwapping] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [alternativesOpen, setAlternativesOpen] = useState(true)
  const [uploadsOpen, setUploadsOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)

  // Get preview URL from server polling store
  const getServerState = useServerPollingStore((state) => state.getServerState)
  const serverState = appId ? getServerState(appId) : null
  const previewBaseUrl = serverState?.url || null

  // Reset selection when slot changes
  useEffect(() => {
    if (isOpen) {
      setSelectedImageIndex(0)
      // Initialize carousel index based on initial slotName
      if (isCarouselMode && slotName && allSlotNames) {
        const initialIndex = allSlotNames.indexOf(slotName)
        setCurrentSlotIndex(initialIndex >= 0 ? initialIndex : 0)
      } else {
        setCurrentSlotIndex(0)
      }
    }
  }, [isOpen, slotName, isCarouselMode, allSlotNames])

  // Carousel navigation handlers
  const goToPreviousSlot = useCallback(() => {
    if (isCarouselMode && allSlotNames) {
      setCurrentSlotIndex((prev) => (prev > 0 ? prev - 1 : allSlotNames.length - 1))
      setSelectedImageIndex(0)
    }
  }, [isCarouselMode, allSlotNames])

  const goToNextSlot = useCallback(() => {
    if (isCarouselMode && allSlotNames) {
      setCurrentSlotIndex((prev) => (prev < allSlotNames.length - 1 ? prev + 1 : 0))
      setSelectedImageIndex(0)
    }
  }, [isCarouselMode, allSlotNames])

  // Touch handlers for swipe gestures
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isCarouselMode) return
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }, [isCarouselMode])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!isCarouselMode || touchStartX.current === null || touchStartY.current === null) return

    const touchEndX = e.changedTouches[0].clientX
    const touchEndY = e.changedTouches[0].clientY
    const deltaX = touchEndX - touchStartX.current
    const deltaY = touchEndY - touchStartY.current

    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
      if (deltaX > 0) {
        goToPreviousSlot()
      } else {
        goToNextSlot()
      }
    }

    touchStartX.current = null
    touchStartY.current = null
  }, [isCarouselMode, goToPreviousSlot, goToNextSlot])

  // Handle Escape and arrow keys
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDialog()
      } else if (isCarouselMode) {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          goToPreviousSlot()
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          goToNextSlot()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, closeDialog, isCarouselMode, goToPreviousSlot, goToNextSlot])

  const handleSwapImage = useCallback(async () => {
    if (!slot || !appId || !activeSlotName || selectedImageIndex === 0) return

    const allImages = [slot.currentUrl, ...slot.alternatives]
    const selectedUrl = allImages[selectedImageIndex]

    if (!selectedUrl) {
      logger.error('media_slot_dialog.swap_failed', {
        appId,
        slotName: activeSlotName,
        error: 'Selected image URL not found',
      })
      return
    }

    logger.info('media_slot_dialog.swap_requested', {
      appId,
      slotName: activeSlotName,
      newUrl: selectedUrl,
    })

    setIsSwapping(true)

    try {
      const tokenResult = await regenerateToken({ siteId: appId, force: true })
      const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)

      if (!apiConfig.agentUrl) {
        throw new Error('Agent URL not available')
      }

      const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '')

      const response = await fetch(
        `${baseAgentUrl}/media/${appId}/slots/${activeSlotName}`,
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
        slotName: activeSlotName,
        newUrl: selectedUrl,
      })

      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
      if (iframe) {
        postMessageToIframe(iframe, {
          type: 'RELOAD_MEDIA_SLOT',
          slotPath: activeSlotName,
        })
        postMessageToIframe(iframe, {
          type: 'CLEAR_SELECTION',
        })
      }

      // Don't close dialog - keep it open so user can continue selecting images
    } catch (err) {
      logger.error('media_slot_dialog.swap_failed', {
        appId,
        slotName: activeSlotName,
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setIsSwapping(false)
    }
  }, [appId, activeSlotName, slot, selectedImageIndex])

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      if (!appId || !activeSlotName) {
        setUploadError(t('builder_mediaslot_error_missing'))
        return
      }

      event.target.value = ''

      if (!ALLOWED_TYPES.includes(file.type)) {
        setUploadError(t('builder_mediaslot_error_type'))
        return
      }

      if (file.size > MAX_FILE_SIZE) {
        setUploadError(t('builder_mediaslot_error_size'))
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

        const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '')

        const formData = new FormData()
        formData.append('image', file)

        const response = await fetch(
          `${baseAgentUrl}/media/${appId}/slots/${activeSlotName}/upload`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${tokenResult.token}`,
            },
            body: formData,
          }
        )

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: t('builder_mediaslot_error_failed') }))
          throw new Error(errorData.error || `${t('builder_mediaslot_error_failed')}: ${response.status}`)
        }

        const result = await response.json()

        logger.info('media_slot_dialog.upload_success', {
          appId,
          slotName: activeSlotName,
          uploadedUrl: result.uploadedUrl,
        })

        const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
        if (iframe) {
          postMessageToIframe(iframe, {
            type: 'RELOAD_MEDIA_SLOT',
            slotPath: activeSlotName,
          })
          postMessageToIframe(iframe, {
            type: 'CLEAR_SELECTION',
          })
        }

        closeDialog()
      } catch (error) {
        logger.error('media_slot_dialog.upload_failed', {
          appId,
          slotName: activeSlotName,
          error: error instanceof Error ? error.message : String(error),
        })
        setUploadError(error instanceof Error ? error.message : t('builder_mediaslot_error_failed'))
      } finally {
        setIsUploading(false)
      }
    },
    [appId, activeSlotName, closeDialog, t]
  )

  const handleSelectFromUploads = useCallback(
    async (file: { filename: string; signedUrl?: string }) => {
      if (!appId || !activeSlotName) return

      setIsUploading(true)
      setUploadError(null)

      try {
        const tokenResult = await regenerateToken({ siteId: appId, force: true })
        const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)

        if (!apiConfig.agentUrl) {
          throw new Error('Agent URL not available')
        }

        const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '')

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

        const uploadResponse = await fetch(
          `${baseAgentUrl}/media/${appId}/slots/${activeSlotName}/upload`,
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
          slotName: activeSlotName,
          filename: file.filename,
        })

        const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
        if (iframe) {
          postMessageToIframe(iframe, {
            type: 'RELOAD_MEDIA_SLOT',
            slotPath: activeSlotName,
          })
          postMessageToIframe(iframe, {
            type: 'CLEAR_SELECTION',
          })
        }

        closeDialog()
      } catch (error) {
        logger.error('media_slot_dialog.upload_from_chat_failed', {
          appId,
          slotName: activeSlotName,
          error: error instanceof Error ? error.message : String(error),
        })
        setUploadError(
          error instanceof Error ? error.message : t('builder_mediaslot_error_fail_use')
        )
      } finally {
        setIsUploading(false)
      }
    },
    [appId, activeSlotName, closeDialog, t]
  )

  const allImages = slot ? [slot.currentUrl, ...slot.alternatives] : []

  const SkeletonContent = () => (
    <div className="flex flex-col gap-2">
      {/* Title skeleton */}
      <div>
        <Skeleton width="180px" height="28px" className="mb-1" />
        {/* Tags skeleton */}
        <div className="flex items-center gap-1.5 mt-0.5">
          <Skeleton width="60px" height="20px" rounding="full" />
          <Skeleton width="80px" height="20px" rounding="full" />
        </div>
        {/* Description skeleton */}
        <Skeleton width="100%" height="16px" className="mt-1" />
      </div>

      {/* Main image skeleton */}
      <Skeleton width="100%" height="250px" className="aspect-video" />

      {/* Image options skeleton */}
      <div className="space-y-2">
        <Skeleton width="140px" height="20px" />
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height="100px" className="aspect-square" />
          ))}
        </div>
      </div>

      {/* Your Uploads skeleton */}
      <Skeleton width="120px" height="20px" />
    </div>
  )

  return (
    <>
      <Sheet
        isOpen={isOpen}
        onClose={closeDialog}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        title={t('builder_mediaslot_title')}
        buttons={
          <>
            <Button
              onClick={() => fileInputRef.current?.click()}
              design="secondary"
              icon={<CloudUploadIcon className="w-4 h-4" />}
              disabled={isUploading}
              className="flex-1"
              text={isUploading ? t('builder_mediaslot_uploading') : t('builder_mediaslot_upload')}
              size="sm"
              data-eid={generateClickEID("develop.media_slot_dialog.upload")}
            />
            <Button
              onClick={handleSwapImage}
              design="primary"
              icon={<RefreshIcon className={`w-4 h-4 ${isSwapping ? 'animate-spin' : ''}`} />}
              disabled={selectedImageIndex === 0 || isSwapping}
              className="flex-1"
              size="sm"
              text={isSwapping ? t('builder_mediaslot_swapping') : t('builder_mediaslot_use_image')}
              data-eid={generateClickEID("develop.media_slot_dialog.use")}
            />
          </>
        }
      >
        <>
          {isCarouselMode && allSlotNames && (
            <div className="flex items-center justify-between gap-1 mb-4">
              <Button
                onClick={goToPreviousSlot}
                icon={<ChevronLeftIcon className="h-4 w-4" />}
                design="control"
                aria-label={t('builder_mediaslot_controls_prev')}
                size="sm"
                data-eid={generateClickEID("develop.media_slot_dialog.prev")}
              />
              <span className="text-sm text-intents-ux-textSubtle-textColor px-2">
                {currentSlotIndex + 1} / {allSlotNames.length}
              </span>
              <Button
                onClick={goToNextSlot}
                icon={<ChevronRightIcon className="h-4 w-4" />}
                design="control"
                aria-label={t('builder_mediaslot_controls_next')}
                size="sm"
                data-eid={generateClickEID("develop.media_slot_dialog.next")}
              />
            </div>
          )}
          {isLoading ? (
            <SkeletonContent />
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <p className="text-intents-ux-textSubtle-textColor">
                {t('builder_mediaslot_error_fail_load')}
              </p>
              <p className="text-sm text-intents-ux-textSubtle-textColor mt-1">
                {error}
              </p>
            </div>
          ) : slot && allImages.length > 0 ? (
            <div className="flex flex-col gap-2">
              {/* Image Title */}
              <div>
                <h3 className="font-semibold text-lg">
                  {activeSlotName ? formatSlotName(activeSlotName) : t('builder_common_loading')}
                </h3>

                {/* Image Labels/Pills */}
                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                  {slot?.mediaType && slot.mediaType !== 'image' && (
                    <Tag emphasis="neutral" size="sm">
                      {slot.mediaType}
                    </Tag>
                  )}
                  {slot?.orientations && (
                    <Tag emphasis="neutral" size="sm">
                      {slot.orientations}
                    </Tag>
                  )}
                  {slot?.compositions && (
                    <Tag emphasis="neutral" size="sm">
                      {slot.compositions}
                    </Tag>
                  )}
                  {slot?.requestedSize && (
                    <Tag emphasis="neutral" size="sm">
                      {`${slot.requestedSize.width}x${slot.requestedSize.height}`}
                    </Tag>
                  )}
                </div>

                {/* Image Description */}
                {slot?.searchQuery && (
                  <p className="text-sm italic mt-1">
                    {slot.searchQuery}
                  </p>
                )}
              </div>

              {/* Full Width Selected Image */}
              <div className="w-full overflow-hidden aspect-video flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getSlotImageUrl(activeSlotName, allImages[selectedImageIndex] || allImages[0] || '', previewBaseUrl)}
                  alt={t('builder_mediaslot_selected_image')}
                  className="w-full h-auto max-h-[250px]"
                />
              </div>

              {/* Collapsible: Image options */}
              {allImages.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setAlternativesOpen(!alternativesOpen)
                      if (!alternativesOpen) setUploadsOpen(false)
                    }}
                    className="w-full flex items-center py-1 justify-between hover:cursor-pointer"
                  >
                    <span className="font-medium">
                      {t('builder_mediaslot_image_options', { count: allImages.length })}
                    </span>
                    {alternativesOpen ? (
                      <ChevronUpIcon className="size-2.5" />
                    ) : (
                      <ChevronDownIcon className="size-2.5" />
                    )}
                  </button>
                  {alternativesOpen && (
                    <div className="grid grid-cols-3 gap-2">
                      {allImages.map((url, index) => {
                        const isSelected = selectedImageIndex === index

                        return (
                          <button
                            type="button"
                            key={index}
                            onClick={() => setSelectedImageIndex(index)}
                            aria-pressed={isSelected}
                            aria-label={t('builder_mediaslot_image_option', { index: (index + 1) })}
                            className={`aspect-square rounded-md overflow-hidden ${
                              isSelected
                                ? 'ring-2 ring-intents-ux-ring-borderColor'
                                : 'hover:opacity-80'
                            }`}
                            data-eid={generateClickEID("develop.media_slot_dialog.image_option")}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={getSlotImageUrl(activeSlotName, url, previewBaseUrl)}
                              alt={t('builder_mediaslot_image_option', { index: (index + 1) })}
                              className="w-full h-full object-cover"
                            />
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Collapsible: Your Uploads */}
              {appId && (
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadsOpen(!uploadsOpen)
                      if (!uploadsOpen) setAlternativesOpen(false)
                    }}
                    className="w-full flex items-center justify-between py-1 hover:cursor-pointer"
                  >
                    <span className="font-medium">{t('builder_mediaslot_uploads')}</span>
                    {uploadsOpen ? (
                      <ChevronUpIcon className="size-2.5" />
                    ) : (
                      <ChevronDownIcon className="size-2.5" />
                    )}
                  </button>
                  {uploadsOpen && (
                    <div className="p-3 pt-0">
                      <UploadedImagesSection
                        appId={appId}
                        onSelectImage={handleSelectFromUploads}
                        isDisabled={isUploading}
                        layout="grid"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-48">
              <p className="text-intents-ux-textSubtle-textColor">
                {t('builder_mediaslot_no_images')}
              </p>
            </div>
          )}

          {/* Upload error */}
          {uploadError && (
            <p className="text-sm text-intents-ux-error-textColor mb-2">
              {uploadError}
            </p>
          )}
        </>
      </Sheet>

      <input
        type="file"
        ref={fileInputRef}
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
        aria-hidden="true"
      />
    </>
  )
}
