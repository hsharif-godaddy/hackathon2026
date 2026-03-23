'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { FormattedMessage } from 'react-intl'
import Button from '@ux/button'
import CheckboxFilledIcon from '@ux/icon/checkbox-filled'
import ChevronDownIcon from '@ux/icon/chevron-down'
import ChevronUpIcon from '@ux/icon/chevron-up'
import CloudUploadIcon from '@ux/icon/cloud-upload'
import RefreshIcon from '@ux/icon/refresh'
import Skeleton from '@ux/skeleton'
import Tag from '@ux/tag'

import { UploadedImagesSection } from '@/app/develop/components/media/UploadedImagesSection'
import { dynamicApiConfigService } from '@/config/dynamic-api'
import { useMediaManifest } from '@/hooks/useMediaManifest'
import { useMediaSlot } from '@/hooks/useMediaSlot'
import { useTranslations } from '@/hooks/useTranslations'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { logger } from '@/lib/request-context'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { compressImageFile } from '@/utils/image-compression'
import { generateClickEID } from '@/utils/instrumentation'
import { postMessageToIframe } from '@/utils/postMessage'
import { GettyImagesLogo } from './icons/GettyImagesLogo'

export function formatSlotName(slot: string): string {
  return slot
    .split('/')
    .filter(
      (part) =>
        part && part !== 'pages' && part !== 'components' && part !== 'sections'
    )
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' '))
    .join(' ')
}

export function getSlotImageUrl(
  slotName: string | null,
  imageUrl: string,
  previewBaseUrl: string | null
): string {
  if (!imageUrl || !slotName || !previewBaseUrl) {
    return imageUrl || ''
  }
  if (imageUrl.startsWith('/airo-assets/uploads/')) {
    return `${previewBaseUrl}${imageUrl}`
  }
  return `${previewBaseUrl}/airo-assets/images/${slotName}?src=${encodeURIComponent(imageUrl)}`
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

interface MediaSlotDetailProps {
  appId: string
  slotName: string
  enabled?: boolean
  onDone?: () => void
}

export function MediaSlotDetail({
  appId,
  slotName,
  enabled = true,
  onDone,
}: MediaSlotDetailProps) {
  const t = useTranslations()

  const { slot, isLoading, error, refetch } = useMediaSlot({
    appId,
    slotName,
    enabled,
  })

  const { manifest, refetch: refetchManifest } = useMediaManifest({ appId, enabled })

  const [selectedUrl, setSelectedUrl] = useState<string | null>(null)
  const [isSwapping, setIsSwapping] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [alternativesOpen, setAlternativesOpen] = useState(true)
  const [uploadsOpen, setUploadsOpen] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(function resetStateOnSlotChange() {
    setSelectedUrl(null)
    setUploadError(null)
    setAlternativesOpen(true)
    setUploadsOpen(true)
  }, [slotName])

  const getServerState = useServerPollingStore((state) => state.getServerState)
  const previewBaseUrl = getServerState(appId)?.url || null

  const isUploadUrl = (url: string) => url.startsWith('/airo-assets/uploads/')

  const reloadPreviewSlot = useCallback((activeSlot: string) => {
    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
    if (iframe) {
      postMessageToIframe(iframe, { type: 'RELOAD_MEDIA_SLOT', slotPath: activeSlot })
      postMessageToIframe(iframe, { type: 'CLEAR_SELECTION' })
    }
  }, [])

  const handleSwapImage = useCallback(async () => {
    const effectiveUrl = selectedUrl ?? slot?.currentUrl
    if (!slot || !effectiveUrl || effectiveUrl === slot.currentUrl) return

    logger.info('media_slot_detail.swap_requested', { appId, slotName, newUrl: effectiveUrl })
    setIsSwapping(true)

    try {
      const tokenResult = await regenerateToken({ siteId: appId, force: true })
      const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)

      if (!apiConfig.agentUrl) {
        throw new Error('Agent URL not available')
      }

      const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '')

      const response = await fetch(
        `${baseAgentUrl}/media/${appId}/slots/${slotName}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tokenResult.token}`,
          },
          body: JSON.stringify({ newUrl: effectiveUrl }),
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(errorData.error || `Failed to swap image: ${response.status}`)
      }

      logger.info('media_slot_detail.swap_success', { appId, slotName, newUrl: effectiveUrl })
      reloadPreviewSlot(slotName)
      setSelectedUrl(null)
      await refetch()
      await refetchManifest()
    } catch (err) {
      logger.error('media_slot_detail.swap_failed', {
        appId,
        slotName,
        error: err instanceof Error ? err.message : String(err),
      })
      setUploadError(err instanceof Error ? err.message : t('builder_mediaslot_error_fail_use'))
    } finally {
      setIsSwapping(false)
    }
  }, [appId, slotName, slot, selectedUrl, reloadPreviewSlot, refetch, refetchManifest, t])

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

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
        const [compressed, tokenResult, apiConfig] = await Promise.all([
          compressImageFile(file),
          regenerateToken({ siteId: appId, force: true }),
          dynamicApiConfigService.getConfigForSite(appId),
        ])

        if (!apiConfig.agentUrl) {
          throw new Error('Agent URL not available')
        }

        const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '')

        const formData = new FormData()
        formData.append('image', compressed)

        const response = await fetch(
          `${baseAgentUrl}/media/${appId}/slots/${slotName}/upload`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${tokenResult.token}` },
            body: formData,
          }
        )

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: t('builder_mediaslot_error_failed') }))
          throw new Error(errorData.error || `${t('builder_mediaslot_error_failed')}: ${response.status}`)
        }

        logger.info('media_slot_detail.upload_success', { appId, slotName })
        reloadPreviewSlot(slotName)
        onDone?.()
      } catch (err) {
        logger.error('media_slot_detail.upload_failed', {
          appId,
          slotName,
          error: err instanceof Error ? err.message : String(err),
        })
        setUploadError(err instanceof Error ? err.message : t('builder_mediaslot_error_failed'))
      } finally {
        setIsUploading(false)
      }
    },
    [appId, slotName, onDone, reloadPreviewSlot, t]
  )

  const handleSelectFromUploads = useCallback(
    async (file: { filename: string; signedUrl?: string }) => {
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
          fileResponse = await fetch(`${baseAgentUrl}${file.signedUrl}`)
          if (!fileResponse.ok) {
            logger.debug('media_slot_detail.signed_url_fallback', {
              appId,
              filename: file.filename,
              status: fileResponse.status,
            })
            fileResponse = undefined
          }
        }

        if (!fileResponse) {
          fileResponse = await fetch(`${baseAgentUrl}/files/uploads/${appId}/${file.filename}`, {
            headers: { Authorization: `Bearer ${tokenResult.token}` },
          })
        }

        if (!fileResponse.ok) {
          throw new Error('Failed to fetch uploaded file')
        }

        const blob = await fileResponse.blob()
        const formData = new FormData()
        formData.append('image', blob, file.filename)

        const uploadResponse = await fetch(
          `${baseAgentUrl}/media/${appId}/slots/${slotName}/upload`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${tokenResult.token}` },
            body: formData,
          }
        )

        if (!uploadResponse.ok) {
          const errorData = await uploadResponse.json().catch(() => ({ error: 'Upload failed' }))
          throw new Error(errorData.error || 'Upload failed')
        }

        logger.info('media_slot_detail.upload_from_chat_success', { appId, slotName, filename: file.filename })
        reloadPreviewSlot(slotName)
        onDone?.()
      } catch (err) {
        logger.error('media_slot_detail.upload_from_chat_failed', {
          appId,
          slotName,
          error: err instanceof Error ? err.message : String(err),
        })
        setUploadError(err instanceof Error ? err.message : t('builder_mediaslot_error_fail_use'))
      } finally {
        setIsUploading(false)
      }
    },
    [appId, slotName, onDone, reloadPreviewSlot, t]
  )

  const allImages = slot ? [...new Set([slot.currentUrl, ...slot.alternatives])] : []
  const gettyImages = allImages.filter((url) => !isUploadUrl(url)).sort()

  const allUploadedImages = manifest
    ? [...new Set(
        Object.values(manifest).flatMap((s) =>
          [s.currentUrl, ...s.alternatives].filter(isUploadUrl)
        )
      )].sort()
    : []

  const effectiveSelectedUrl = selectedUrl ?? slot?.currentUrl ?? null
  const isCurrentImage = effectiveSelectedUrl === slot?.currentUrl

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto">
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
            <div>
              <h3 className="font-semibold text-lg">
                {formatSlotName(slotName)}
              </h3>

              <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                {slot.mediaType && slot.mediaType !== 'image' && (
                  <Tag emphasis="neutral" size="sm">{slot.mediaType}</Tag>
                )}
                {slot.orientations && (
                  <Tag emphasis="neutral" size="sm">{slot.orientations}</Tag>
                )}
                {slot.compositions && (
                  <Tag emphasis="neutral" size="sm">{slot.compositions}</Tag>
                )}
                {slot.requestedSize && (
                  <Tag emphasis="neutral" size="sm">
                    {`${slot.requestedSize.width}x${slot.requestedSize.height}`}
                  </Tag>
                )}
              </div>

              {slot.searchQuery && (
                <p className="text-sm italic mt-1">{slot.searchQuery}</p>
              )}
            </div>

            {uploadError && (
              <p className="text-sm text-intents-ux-error-textColor mb-2">
                {uploadError}
              </p>
            )}

            <div className="flex gap-2">
              <Button
                onClick={() => fileInputRef.current?.click()}
                design="secondary"
                icon={<CloudUploadIcon className="w-4 h-4" />}
                disabled={isUploading}
                className="flex-1"
                text={isUploading ? t('builder_mediaslot_uploading') : t('builder_mediaslot_upload')}
                size="sm"
                data-eid={generateClickEID("develop.media_slot_detail.upload")}
              />
              <Button
                onClick={handleSwapImage}
                design="primary"
                icon={<RefreshIcon className={`w-4 h-4 ${isSwapping ? 'animate-spin' : ''}`} />}
                disabled={isCurrentImage || isSwapping}
                className="flex-1"
                size="sm"
                text={isSwapping ? t('builder_mediaslot_swapping') : t('builder_mediaslot_use_image')}
                data-eid={generateClickEID("develop.media_slot_detail.use")}
              />
            </div>

            {gettyImages.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setAlternativesOpen(!alternativesOpen)}
                  className="w-full flex items-center py-2 justify-between hover:cursor-pointer"
                >
                  <span className="font-medium flex items-center">
                    <FormattedMessage
                      id="builder_mediaslot_options_getty"
                      defaultMessage="Options by <getty></getty>"
                      values={{
                        getty: () => <span style={{ marginLeft: '4px' }}><GettyImagesLogo className="inline-block h-2 w-auto" /></span>
                      }}
                    />
                  </span>
                  {alternativesOpen ? (
                    <ChevronUpIcon className="size-2.5" />
                  ) : (
                    <ChevronDownIcon className="size-2.5" />
                  )}
                </button>
                {alternativesOpen && (
                  <ImageGrid
                    images={gettyImages}
                    selectedUrl={effectiveSelectedUrl}
                    slotName={slotName}
                    previewBaseUrl={previewBaseUrl}
                    onSelect={setSelectedUrl}
                  />
                )}
              </div>
            )}

            <div>
              <button
                type="button"
                onClick={() => setUploadsOpen(!uploadsOpen)}
                className="w-full flex items-center justify-between py-2 hover:cursor-pointer"
              >
                <span className="font-medium">{t('builder_mediaslot_uploads')}</span>
                {uploadsOpen ? (
                  <ChevronUpIcon className="size-2.5" />
                ) : (
                  <ChevronDownIcon className="size-2.5" />
                )}
              </button>
              {uploadsOpen && (
                <div className="flex flex-col gap-2">
                  {allUploadedImages.length > 0 && (
                    <ImageGrid
                      images={allUploadedImages}
                      selectedUrl={effectiveSelectedUrl}
                      slotName={slotName}
                      previewBaseUrl={previewBaseUrl}
                      onSelect={setSelectedUrl}
                    />
                  )}
                  <UploadedImagesSection
                    appId={appId}
                    onSelectImage={handleSelectFromUploads}
                    isDisabled={isUploading}
                    layout="grid"
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-48">
            <p className="text-intents-ux-textSubtle-textColor">
              {t('builder_mediaslot_no_images')}
            </p>
          </div>
        )}
      </div>

      <input
        type="file"
        ref={fileInputRef}
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
        aria-hidden="true"
      />
    </div>
  )
}

interface ImageGridProps {
  images: string[]
  selectedUrl: string | null
  slotName: string
  previewBaseUrl: string | null
  onSelect: (url: string) => void
}

function ImageGrid({ images, selectedUrl, slotName, previewBaseUrl, onSelect }: ImageGridProps) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {images.map(function renderImage(url) {
        const isSelected = selectedUrl === url
        return (
          <button
            type="button"
            key={url}
            onClick={() => onSelect(url)}
            aria-pressed={isSelected}
            className={`relative aspect-square rounded-md overflow-hidden ${
              isSelected ? '' : 'hover:opacity-80'
            }`}
            data-eid="develop.media_slot_detail.image_option.click"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getSlotImageUrl(slotName, url, previewBaseUrl)}
              alt=""
              className="w-full h-full object-cover"
            />
            {isSelected && (
              <>
                <div
                  className="absolute inset-0 rounded-md pointer-events-none"
                  style={{
                    backgroundColor: 'rgba(128, 90, 213, 0.2)',
                    boxShadow: 'inset 0 0 0 3px black',
                  }}
                />
                <span className="absolute bottom-1 right-1 w-3 h-3">
                  <div className="w-2 h-2 absolute bottom-0.5 right-0.5" style={{ backgroundColor: 'var(--background)' }} />
                  <CheckboxFilledIcon className="w-3 h-3 absolute inset-0 text-black" />
                </span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}

function SkeletonContent() {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Skeleton width="180px" height="28px" className="mb-1" />
        <div className="flex items-center gap-1.5 mt-0.5">
          <Skeleton width="60px" height="20px" rounding="full" />
          <Skeleton width="80px" height="20px" rounding="full" />
        </div>
        <Skeleton width="100%" height="16px" className="mt-1" />
      </div>
      <div className="space-y-2">
        <Skeleton width="140px" height="20px" />
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height="100px" className="aspect-square" />
          ))}
        </div>
      </div>
      <Skeleton width="120px" height="20px" />
    </div>
  )
}
