"use client";

import clsx from 'clsx';
import { useCallback, useRef, useState } from "react";
import CheckboxFilledIcon from '@ux/icon/checkbox-filled';
import PlusIcon from '@ux/icon/plus';
import Spinner from '@ux/spinner';

import { dynamicApiConfigService } from "@/config/dynamic-api";
import { SWITCHBOARD_APPBUILDER_UPLOADED_IMAGE_DELETION } from '@/config/switchboard-flags'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from "@/hooks/useTranslations";
import { regenerateToken } from "@/lib/jwt-regeneration";
import { logger } from "@/lib/request-context";
import { compressImageFile } from "@/utils/image-compression";
import { logImpressionEvent } from "@/utils/instrumentation";
import { UploadDeleteButton } from './UploadDeleteButton'
import { UploadDeleteConfirmationModal } from './UploadDeleteConfirmationModal'
import { useUploadDeleteOverlayBounds } from './useUploadDeleteOverlayBounds'
import { type UploadedFile,useUploadedMedia } from './useUploadedMedia'

export type { UploadedFile }

export interface DeleteUploadResult {
  success: boolean
  affectedSlots?: string[]
  removedUrls?: string[]
  chatUploadDeleted?: boolean
  uploadId?: string
}

type DeleteUploadResponse = DeleteUploadResult & { error?: string }
type DeleteUploadScope = 'current-slot' | 'everywhere'

interface PendingUploadDelete {
  filename: string
  isVideo: boolean
  otherUsageLocations: string[]
  canRemoveFromCurrentSlot: boolean
}

/** Slot upload that may need to be shown as a fallback when the chat copy expires */
export interface SlotUploadItem {
  /** Persistent upload URL (e.g., /airo-assets/uploads/pages-home-hero-abc.jpg) */
  url: string;
  /** Display URL for the img src (proxied through preview) */
  displayUrl: string;
  /** Original chat upload filename — used to dedup against active chat uploads */
  sourceFilename?: string;
}

function mediaSlotUsesUpload(slot: any, filename: string): boolean {
  if (!slot) return false
  const uploadPrefix = '/airo-assets/uploads/'
  const urls = [slot.currentUrl, ...(slot.alternatives || [])].filter(Boolean)
  return urls.some((url: string) => url.startsWith(uploadPrefix) && url.endsWith(filename))
}

function getOtherUploadUsageLocationNames({ mediaManifest, filename, currentSlotName }: { mediaManifest?: Record<string, any> | null; filename: string; currentSlotName?: string }): string[] {
  if (!mediaManifest) return []
  const uploadPrefix = '/airo-assets/uploads/'
  const locations: string[] = []
  for (const [name, slot] of Object.entries(mediaManifest)) {
    if (name === currentSlotName) continue
    const urls = [slot.currentUrl, ...(slot.alternatives || [])].filter(Boolean)
    if (urls.some((url: string) => url.startsWith(uploadPrefix) && url.endsWith(filename))) {
      locations.push(name)
    }
  }
  return locations
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']
const MAX_IMAGE_SIZE = 25 * 1024 * 1024 // 25MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024 // 50MB

interface UploadedMediaSectionProps {
  appId: string;
  slotName?: string;
  onSelectImage: (file: UploadedFile) => void;
  onUploadSuccess?: (opts?: { isVideo?: boolean }) => void;
  isDisabled?: boolean;
  selectedFilename?: string | null;
  /** Increment to trigger a refetch (e.g., after a device upload) */
  refreshKey?: number;
  /** Slot upload URLs to show as fallback when chat copies expire */
  slotUploads?: SlotUploadItem[];
  /** Currently selected slot upload URL (for highlight) */
  selectedSlotUploadUrl?: string | null;
  /** Called when a slot upload is selected */
  onSelectSlotUpload?: (url: string) => void;
  /** Whether this is a video slot (affects upload types and display) */
  isVideoSlot?: boolean;
  /** Called when an upload is successfully deleted */
  onDeleteSuccess?: (result: DeleteUploadResult) => void;
  /** Media manifest for determining upload usage across slots */
  mediaManifest?: Record<string, any> | null;
}

export function UploadedMediaSection({
  appId,
  slotName,
  onSelectImage,
  onUploadSuccess,
  isDisabled,
  selectedFilename,
  refreshKey,
  slotUploads,
  selectedSlotUploadUrl,
  onSelectSlotUpload,
  isVideoSlot,
  onDeleteSuccess,
  mediaManifest,
}: UploadedMediaSectionProps) {
  const t = useTranslations()
  const { uploads, setUploads, isLoading, error, handleImageError } = useUploadedMedia(appId, refreshKey)
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null)

  const isUploadDeletionEnabled = useSwitchboard(SWITCHBOARD_APPBUILDER_UPLOADED_IMAGE_DELETION) === true
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deletingFilename, setDeletingFilename] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingUploadDelete | null>(null)
  const {
    deleteDialogBounds,
    deleteOverlayBounds,
    deleteTargetBounds,
    resetDeleteOverlayBounds,
    updateDeleteOverlayBounds,
  } = useUploadDeleteOverlayBounds({
    isActive: pendingDelete !== null,
    sectionRef,
  })
  const uploadFile = useCallback(
    async (file: File) => {
      const isVideo = file.type.startsWith('video/')
      const allowedTypes = isVideoSlot
        ? [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES]
        : ALLOWED_IMAGE_TYPES
      const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE

      if (!allowedTypes.includes(file.type)) {
        const supported = isVideo
          ? ALLOWED_VIDEO_TYPES.map(t => t.replace('video/', '').toUpperCase()).join(', ')
          : ALLOWED_IMAGE_TYPES.map(t => t.replace('image/', '').toUpperCase()).join(', ')
        setUploadError(`Only ${supported} ${isVideo ? 'videos' : 'images'} are supported`)
        return
      }

      if (file.size > maxSize) {
        const limitMB = maxSize / (1024 * 1024)
        setUploadError(`${isVideo ? 'Video' : 'Image'} must be under ${limitMB}MB`)
        return
      }

      setUploadError(null)
      setIsUploading(true)

      try {
        // Skip compression for video files
        const [fileToUpload, tokenResult, apiConfig] = await Promise.all([
          isVideo ? Promise.resolve(file) : compressImageFile(file),
          regenerateToken({ siteId: appId, force: true }),
          dynamicApiConfigService.getConfigForSite(appId),
        ])

        if (!apiConfig.agentUrl) {
          throw new Error('Agent URL not available')
        }

        const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '')

        const formData = new FormData()
        formData.append('image', fileToUpload)

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

        logger.info('uploaded_images_section.upload_success', { appId, slotName })
        logImpressionEvent('uploads.mediaslot.success')()
        onUploadSuccess?.({ isVideo })
      } catch (err) {
        logger.error('uploaded_images_section.upload_failed', {
          appId,
          slotName,
          error: err instanceof Error ? err.message : String(err),
        })
        logImpressionEvent('uploads.mediaslot.failed')()
        setUploadError(err instanceof Error ? err.message : t('builder_mediaslot_error_failed'))
      } finally {
        setIsUploading(false)
      }
    },
    [appId, slotName, onUploadSuccess, isVideoSlot, t]
  )

  const handleDeleteUpload = useCallback(
    async (filename: string, scope: DeleteUploadScope): Promise<boolean> => {
      if (!isUploadDeletionEnabled) return false
      setDeleteError(null)
      setDeletingFilename(filename)
      try {
        const [tokenResult, apiConfig] = await Promise.all([
          regenerateToken({ siteId: appId, force: true }),
          dynamicApiConfigService.getConfigForSite(appId),
        ])
        if (!apiConfig.agentUrl) throw new Error('Agent URL not available')
        const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '')
        const deleteUrl = scope === 'current-slot' && slotName
          ? `${baseAgentUrl}/media/${appId}/slots/${slotName}/uploads/${encodeURIComponent(filename)}`
          : `${baseAgentUrl}/media/${appId}/uploads/${encodeURIComponent(filename)}`
        const response = await fetch(deleteUrl, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${tokenResult.token}` },
        })
        const data = (await response.json().catch(() => ({}))) as DeleteUploadResponse
        if (!response.ok) throw new Error(data.error || t('builder_mediaslot_error_failed'))
        if (scope === 'everywhere') {
          setUploads((currentUploads) => currentUploads.filter((file) => file.filename !== filename))
        }
        onDeleteSuccess?.(data)
        return true
      } catch (err) {
        logger.error('uploaded_media_section.delete_failed', { appId, filename, error: err instanceof Error ? err.message : String(err) })
        setDeleteError(err instanceof Error ? err.message : t('builder_mediaslot_error_failed'))
        return false
      } finally {
        setDeletingFilename(null)
      }
    },
    [appId, isUploadDeletionEnabled, onDeleteSuccess, slotName, t]
  )

  const handleRequestDeleteUpload = useCallback(
    (filename: string) => {
      if (!isUploadDeletionEnabled) return
      setDeleteError(null)
      updateDeleteOverlayBounds()
      const currentSlot = slotName ? mediaManifest?.[slotName] : undefined
      const file = uploads.find((f) => f.filename === filename)
      setPendingDelete({
        filename,
        isVideo: file?.mimeType?.startsWith('video/') ?? false,
        canRemoveFromCurrentSlot: mediaSlotUsesUpload(currentSlot, filename),
        otherUsageLocations: getOtherUploadUsageLocationNames({ mediaManifest, filename, currentSlotName: slotName }),
      })
    },
    [isUploadDeletionEnabled, mediaManifest, slotName, updateDeleteOverlayBounds, uploads]
  )

  const handleCancelDelete = useCallback(() => {
    if (deletingFilename) return
    setPendingDelete(null)
    resetDeleteOverlayBounds()
  }, [deletingFilename, resetDeleteOverlayBounds])

  const handleConfirmDelete = useCallback(
    async (scope: DeleteUploadScope) => {
      if (!pendingDelete) return
      const ok = await handleDeleteUpload(pendingDelete.filename, scope)
      if (ok) {
        setPendingDelete(null)
        resetDeleteOverlayBounds()
      }
    },
    [pendingDelete, handleDeleteUpload, resetDeleteOverlayBounds]
  )

  const handleRemoveFromCurrentSlot = useCallback(() => {
    handleConfirmDelete('current-slot')
  }, [handleConfirmDelete])

  const handleDeleteEverywhere = useCallback(() => {
    handleConfirmDelete('everywhere')
  }, [handleConfirmDelete])

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return
      event.target.value = ''
      await uploadFile(file)
    },
    [uploadFile]
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return null; // Silently hide on error
  }

  // Compute slot uploads that don't have a matching active chat upload (dedup).
  // These are persistent fallbacks shown when the original chat upload has expired.
  // Only show slot uploads as fallbacks when:
  // 1. They have a sourceFilename mapping (we know which chat upload produced them)
  // 2. That chat upload is no longer in the active list (expired/deleted)
  // Without sourceFilename, we can't dedup → don't show (avoids duplicates)
  const chatFilenames = new Set(uploads.map((f) => f.filename));
  const dedupedSlotUploads = (slotUploads || []).filter(
    (su) => su.sourceFilename && !chatFilenames.has(su.sourceFilename)
  );

  return (
    <div ref={sectionRef}>
      {uploadError && (
        <p className="text-sm text-intents-ux-error-textColor mb-2">{uploadError}</p>
      )}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isDisabled || isUploading}
          className={clsx(
            'relative aspect-square rounded-md overflow-hidden border border-dashed border-intents-ux-boxHighContrast-borderColor flex items-center justify-center hover:cursor-pointer',
            (isDisabled || isUploading) ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80'
          )}
        >
          {isUploading ? (
            <Spinner />
          ) : (
            <span className="flex flex-col items-center gap-1">
              <PlusIcon className="size-2.5 text-intents-ux-textSubtle-textColor" />
              <span className="text-xs text-intents-ux-textSubtle-textColor">{t('builder_mediaslot_upload')}</span>
            </span>
          )}
        </button>
        {uploads.map((file) => {
          const isSelected = selectedFilename === file.filename;
          return (
            <div key={file.id} className="relative">
            <button
              type="button"
              onClick={() => onSelectImage(file)}
              disabled={isDisabled || isUploading}
              aria-pressed={isSelected}
              data-upload-filename={file.filename}
              onContextMenu={isUploadDeletionEnabled ? (e) => { e.preventDefault(); handleRequestDeleteUpload(file.filename) } : undefined}
              className={clsx(
                'relative aspect-square rounded-md overflow-hidden transition-opacity hover:cursor-pointer w-full',
                !isSelected && !(isDisabled || isUploading) && 'hover:opacity-80',
                (isDisabled || isUploading) && 'opacity-50 cursor-not-allowed'
              )}
            >
              {file.fullSignedUrl ? (
                file.mimeType?.startsWith('video/') ? (
                  <video
                    src={file.fullSignedUrl}
                    className="w-full h-full object-cover"
                    muted
                    autoPlay
                    loop
                    playsInline
                    preload="auto"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={file.fullSignedUrl}
                    alt={file.originalName}
                    onError={handleImageError}
                    className="w-full h-full object-cover"
                  />
                )
              ) : (
                <span className="text-xs text-intents-ux-textSubtle-textColor truncate px-1 block p-2 bg-intents-ux-boxLowContrast-backgroundColor rounded-md">
                  {file.originalName}
                </span>
              )}
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
            {isUploadDeletionEnabled && (
              <UploadDeleteButton
                filename={file.filename}
                disabled={isDisabled || isUploading || deletingFilename !== null}
                onDelete={handleRequestDeleteUpload}
              />
            )}
            </div>
          );
        })}
        {dedupedSlotUploads.map((su) => {
          const isSelected = selectedSlotUploadUrl === su.url;
          const deleteFilename = su.sourceFilename || su.url.split('/').pop() || '';
          return (
            <div key={su.url} className="relative">
            <button
              type="button"
              onClick={() => onSelectSlotUpload?.(su.url)}
              disabled={isDisabled || isUploading}
              aria-pressed={isSelected}
              className={clsx(
                'relative aspect-square rounded-md overflow-hidden transition-opacity w-full',
                !isSelected && !(isDisabled || isUploading) && 'hover:opacity-80',
                (isDisabled || isUploading) && 'opacity-50 cursor-not-allowed'
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={su.displayUrl}
                alt=""
                onError={(e) => { e.currentTarget.style.display = 'none' }}
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
            {isUploadDeletionEnabled && deleteFilename && (
              <UploadDeleteButton
                filename={deleteFilename}
                disabled={isDisabled || isUploading || deletingFilename !== null}
                onDelete={handleRequestDeleteUpload}
              />
            )}
            </div>
          );
        })}
      </div>
      <input
        type="file"
        ref={fileInputRef}
        accept={isVideoSlot ? 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime' : 'image/jpeg,image/png,image/webp,image/gif'}
        onChange={handleFileSelect}
        style={{ display: 'none' }}
        aria-hidden="true"
      />
      {pendingDelete && (
        <UploadDeleteConfirmationModal
          otherUsageLocations={pendingDelete.otherUsageLocations}
          canRemoveFromCurrentSlot={pendingDelete.canRemoveFromCurrentSlot}
          isDeleting={deletingFilename === pendingDelete.filename}
          isVideo={pendingDelete.isVideo}
          error={deleteError}
          onCancel={handleCancelDelete}
          onRemoveFromCurrentSlot={handleRemoveFromCurrentSlot}
          onDeleteEverywhere={handleDeleteEverywhere}
          bounds={deleteDialogBounds}
          overlayBounds={deleteOverlayBounds}
          targetBounds={deleteTargetBounds}
        />
      )}
    </div>
  );
}
