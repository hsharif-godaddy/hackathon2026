'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getFilenameFromUploadUrl } from '@airo/shared/media';
import CheckboxFilledIcon from '@ux/icon/checkbox-filled';
import PlusIcon from '@ux/icon/plus';
import Spinner from '@ux/spinner';

import { dynamicApiConfigService } from '@/config/dynamic-api';
import { SWITCHBOARD_APPBUILDER_UPLOADED_IMAGE_DELETION } from '@/config/switchboard-flags';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { regenerateToken } from '@/lib/jwt-regeneration';
import { logger } from '@/lib/request-context';
import { compressImageFile } from '@/utils/image-compression';
import { logImpressionEvent } from '@/utils/instrumentation';
import { getOtherUploadUsageLocationNames, mediaSlotUsesUpload } from './mediaSlotUsage';
import type { MediaSlot } from './types';
import { UploadDeleteButton } from './UploadDeleteButton';
import { UploadDeleteConfirmationModal } from './UploadDeleteConfirmationModal';
import { useUploadDeleteOverlayBounds } from './useUploadDeleteOverlayBounds';

interface UploadedFile {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string | null;
  size: number;
  signedUrl?: string;
  /** Full signed URL for browser access (base agent URL + signedUrl path) */
  fullSignedUrl?: string;
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

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export interface DeleteUploadResult {
  success: boolean;
  affectedSlots?: string[];
  removedUrls?: string[];
  chatUploadDeleted?: boolean;
  uploadId?: string;
}

type DeleteUploadResponse = DeleteUploadResult & { error?: string };
type MediaManifest = Record<string, MediaSlot>;
type DeleteUploadScope = 'current-slot' | 'everywhere';

interface PendingUploadDelete {
  filename: string;
  otherUsageLocations: string[];
  canRemoveFromCurrentSlot: boolean;
}

interface UploadedImagesSectionProps {
  appId: string;
  slotName?: string;
  onSelectImage: (file: UploadedFile) => void;
  onUploadSuccess?: () => void;
  isDisabled?: boolean;
  selectedFilename?: string | null;
  /** Increment to trigger a refetch (e.g., after a device upload) */
  refreshKey?: number;
  /** Slot upload URLs to show as fallback when chat copies expire */
  slotUploads?: SlotUploadItem[];
  /** Media manifest used to warn when an upload is referenced by other slots */
  mediaManifest?: MediaManifest | null;
  /** Currently selected slot upload URL (for highlight) */
  selectedSlotUploadUrl?: string | null;
  /** Called when a slot upload is selected */
  onSelectSlotUpload?: (url: string) => void;
  /** Called after an upload is deleted and manifest references are refreshed */
  onDeleteSuccess?: (result: DeleteUploadResult) => void;
}

export function UploadedImagesSection({
  appId,
  slotName,
  onSelectImage,
  onUploadSuccess,
  isDisabled,
  selectedFilename,
  refreshKey,
  slotUploads,
  mediaManifest,
  selectedSlotUploadUrl,
  onSelectSlotUpload,
  onDeleteSuccess,
}: UploadedImagesSectionProps) {
  const t = useTranslations();
  const isUploadDeletionEnabled =
    useSwitchboard(SWITCHBOARD_APPBUILDER_UPLOADED_IMAGE_DELETION) === true;
  const [uploads, setUploads] = useState<UploadedFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingFilename, setDeletingFilename] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingUploadDelete | null>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    deleteDialogBounds,
    deleteOverlayBounds,
    deleteTargetBounds,
    resetDeleteOverlayBounds,
    updateDeleteOverlayBounds,
  } = useUploadDeleteOverlayBounds({
    isActive: pendingDelete !== null,
    sectionRef,
  });
  // Stable timestamp at mount time — busts browser cache for upload thumbnails when the
  // component remounts after an image editor save (file overwritten in-place, same URL).
  const [cacheBustTs] = useState(() => Date.now());

  // Track whether we've already attempted a refetch after image errors
  // to avoid infinite refetch loops when files are genuinely missing.
  const hasRefetchedForErrorRef = useRef(false);

  const fetchUploads = useCallback(async () => {
    try {
      const tokenResult = await regenerateToken({ siteId: appId, force: true });
      const apiConfig = await dynamicApiConfigService.getConfigForSite(appId);

      if (!apiConfig.agentUrl) {
        throw new Error('Agent URL not available');
      }

      // Get base agent URL (remove app-specific path if present)
      const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '');

      const response = await fetch(`${baseAgentUrl}/files/${appId}/list`, {
        headers: {
          Authorization: `Bearer ${tokenResult.token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch uploads');
      }

      const data = await response.json();

      // Filter to only image files and compute full signed URLs.
      // Append the mount-time cache-bust param so that thumbnails for files that were
      // overwritten in-place (same URL, new content) always load fresh.
      const imageFiles = (data.files || [])
        .filter((file: UploadedFile) => file.mimeType?.startsWith('image/'))
        .map((file: UploadedFile) => {
          if (!file.signedUrl) return { ...file, fullSignedUrl: undefined };
          const fullUrl = `${baseAgentUrl}${file.signedUrl}`;
          const sep = fullUrl.includes('?') ? '&' : '?';
          return { ...file, fullSignedUrl: `${fullUrl}${sep}_t=${cacheBustTs}` };
        });

      setUploads(imageFiles);
      setError(null);
    } catch (err) {
      logger.error('uploaded_images_section.fetch_failed', {
        appId,
        error: err instanceof Error ? err.message : String(err),
      });
      setError('Failed to load uploads');
    } finally {
      setIsLoading(false);
    }
  }, [appId]);

  // Reset refetch guard and re-fetch when appId or refreshKey changes
  useEffect(() => {
    hasRefetchedForErrorRef.current = false;
    fetchUploads();
  }, [fetchUploads, refreshKey]);

  // When a thumbnail fails to load (e.g. expired signed URL returning 404),
  // refetch the file list once to get fresh signed URLs.
  const handleImageError = useCallback(() => {
    if (hasRefetchedForErrorRef.current) return;
    hasRefetchedForErrorRef.current = true;

    logger.info('uploaded_images_section.signed_url_expired', {
      appId,
      message: 'Image failed to load, refetching signed URLs',
    });

    fetchUploads();
  }, [fetchUploads, appId]);

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      event.target.value = '';

      if (!ALLOWED_TYPES.includes(file.type)) {
        setUploadError(t('builder_mediaslot_error_type'));
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        setUploadError(t('builder_mediaslot_error_size'));
        return;
      }

      setUploadError(null);
      setIsUploading(true);

      try {
        const [compressed, tokenResult, apiConfig] = await Promise.all([
          compressImageFile(file),
          regenerateToken({ siteId: appId, force: true }),
          dynamicApiConfigService.getConfigForSite(appId),
        ]);

        if (!apiConfig.agentUrl) {
          throw new Error('Agent URL not available');
        }

        const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '');

        const formData = new FormData();
        formData.append('image', compressed);

        const response = await fetch(`${baseAgentUrl}/media/${appId}/slots/${slotName}/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenResult.token}` },
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response
            .json()
            .catch(() => ({ error: t('builder_mediaslot_error_failed') }));
          throw new Error(
            errorData.error || `${t('builder_mediaslot_error_failed')}: ${response.status}`
          );
        }

        logger.info('uploaded_images_section.upload_success', { appId, slotName });
        logImpressionEvent('uploads.mediaslot.success')();
        onUploadSuccess?.();
      } catch (err) {
        logger.error('uploaded_images_section.upload_failed', {
          appId,
          slotName,
          error: err instanceof Error ? err.message : String(err),
        });
        logImpressionEvent('uploads.mediaslot.failed')();
        setUploadError(err instanceof Error ? err.message : t('builder_mediaslot_error_failed'));
      } finally {
        setIsUploading(false);
      }
    },
    [appId, slotName, onUploadSuccess, t]
  );

  const handleDeleteUpload = useCallback(
    async (filename: string, scope: DeleteUploadScope): Promise<boolean> => {
      if (!isUploadDeletionEnabled) {
        return false;
      }

      setDeleteError(null);
      setDeletingFilename(filename);

      try {
        const [tokenResult, apiConfig] = await Promise.all([
          regenerateToken({ siteId: appId, force: true }),
          dynamicApiConfigService.getConfigForSite(appId),
        ]);

        if (!apiConfig.agentUrl) {
          throw new Error('Agent URL not available');
        }

        const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '');
        const deleteUrl =
          scope === 'current-slot' && slotName
            ? `${baseAgentUrl}/media/${appId}/slots/${slotName}/uploads/${encodeURIComponent(filename)}`
            : `${baseAgentUrl}/media/${appId}/uploads/${encodeURIComponent(filename)}`;

        const response = await fetch(deleteUrl, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${tokenResult.token}` },
        });
        const data = (await response.json().catch(() => ({}))) as DeleteUploadResponse;

        if (!response.ok) {
          throw new Error(data.error || t('builder_mediaslot_error_failed'));
        }

        if (scope === 'everywhere') {
          setUploads((currentUploads) =>
            currentUploads.filter((file) => file.filename !== filename)
          );
        }
        onDeleteSuccess?.(data);
        return true;
      } catch (err) {
        logger.error('uploaded_images_section.delete_failed', {
          appId,
          filename,
          error: err instanceof Error ? err.message : String(err),
        });
        setDeleteError(err instanceof Error ? err.message : t('builder_mediaslot_error_failed'));
        return false;
      } finally {
        setDeletingFilename(null);
      }
    },
    [appId, isUploadDeletionEnabled, onDeleteSuccess, slotName, t]
  );

  const handleRequestDeleteUpload = useCallback(
    (filename: string) => {
      if (!isUploadDeletionEnabled) {
        return;
      }

      setDeleteError(null);
      updateDeleteOverlayBounds();
      const currentSlot = slotName ? mediaManifest?.[slotName] : undefined;
      setPendingDelete({
        filename,
        canRemoveFromCurrentSlot: mediaSlotUsesUpload(currentSlot, filename),
        otherUsageLocations: getOtherUploadUsageLocationNames({
          mediaManifest,
          filename,
          currentSlotName: slotName,
        }),
      });
    },
    [isUploadDeletionEnabled, mediaManifest, slotName, updateDeleteOverlayBounds]
  );

  const handleCancelDelete = useCallback(() => {
    if (deletingFilename) return;
    setDeleteError(null);
    setPendingDelete(null);
    resetDeleteOverlayBounds();
  }, [deletingFilename, resetDeleteOverlayBounds]);

  const handleRemoveFromCurrentSlot = useCallback(async () => {
    if (!pendingDelete || !pendingDelete.canRemoveFromCurrentSlot) return;

    const didDelete = await handleDeleteUpload(pendingDelete.filename, 'current-slot');
    if (didDelete) {
      setPendingDelete(null);
    }
  }, [handleDeleteUpload, pendingDelete]);

  const handleDeleteEverywhere = useCallback(async () => {
    if (!pendingDelete) return;

    const didDelete = await handleDeleteUpload(pendingDelete.filename, 'everywhere');
    if (didDelete) {
      setPendingDelete(null);
    }
  }, [handleDeleteUpload, pendingDelete]);

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
  const isUploadInteractionDisabled = isDisabled || isUploading || pendingDelete !== null;

  return (
    <div ref={sectionRef} className="relative">
      {uploadError && <p className="text-sm text-intents-ux-error-textColor mb-2">{uploadError}</p>}
      {deleteError && !pendingDelete && (
        <p role="alert" className="text-sm text-intents-ux-error-textColor mb-2">
          {deleteError}
        </p>
      )}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploadInteractionDisabled}
          className={clsx(
            'relative aspect-square rounded-md overflow-hidden border border-dashed border-intents-ux-boxHighContrast-borderColor flex items-center justify-center hover:cursor-pointer',
            isUploadInteractionDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80'
          )}
        >
          {isUploading ? (
            <Spinner />
          ) : (
            <span className="flex flex-col items-center gap-1">
              <PlusIcon className="size-2.5 text-intents-ux-textSubtle-textColor" />
              <span className="text-xs text-intents-ux-textSubtle-textColor">
                {t('builder_mediaslot_upload')}
              </span>
            </span>
          )}
        </button>
        {uploads.map((file) => {
          const isSelected = selectedFilename === file.filename;
          const isPendingDeleteTarget = pendingDelete?.filename === file.filename;
          return (
            <div
              key={file.id}
              data-testid={`uploaded-image-tile-${file.filename}`}
              data-delete-target={isPendingDeleteTarget ? 'true' : undefined}
              className={clsx(
                'relative aspect-square rounded-md overflow-hidden transition-all hover:cursor-pointer',
                !isSelected && !isUploadInteractionDisabled && 'hover:opacity-80',
                isUploadInteractionDisabled && !isPendingDeleteTarget && 'opacity-50',
                isUploadInteractionDisabled && 'cursor-not-allowed',
                isPendingDeleteTarget &&
                  'z-40 scale-[1.03] shadow-xl ring-2 ring-intents-ux-box-backgroundColor'
              )}
            >
              <button
                type="button"
                onClick={() => onSelectImage(file)}
                disabled={isUploadInteractionDisabled || deletingFilename === file.filename}
                aria-pressed={isSelected}
                className="absolute inset-0"
              >
                {file.fullSignedUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={file.fullSignedUrl}
                    alt={file.originalName}
                    onError={handleImageError}
                    className="w-full h-full object-cover"
                  />
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
                      <div
                        className="w-2 h-2 absolute bottom-0.5 right-0.5"
                        style={{ backgroundColor: 'var(--background)' }}
                      />
                      <CheckboxFilledIcon className="w-3 h-3 absolute inset-0 text-black" />
                    </span>
                  </>
                )}
              </button>
              {isUploadDeletionEnabled && (
                <UploadDeleteButton
                  filename={file.filename}
                  disabled={isUploadInteractionDisabled || deletingFilename !== null}
                  onDelete={handleRequestDeleteUpload}
                />
              )}
            </div>
          );
        })}
        {dedupedSlotUploads.map((su) => {
          const isSelected = selectedSlotUploadUrl === su.url;
          const deleteFilename = su.sourceFilename || getFilenameFromUploadUrl(su.url);
          const isPendingDeleteTarget = pendingDelete?.filename === deleteFilename;
          return (
            <div
              key={su.url}
              data-testid={deleteFilename ? `uploaded-image-tile-${deleteFilename}` : undefined}
              data-delete-target={isPendingDeleteTarget ? 'true' : undefined}
              className={clsx(
                'relative aspect-square rounded-md overflow-hidden transition-all hover:cursor-pointer',
                !isSelected && !isUploadInteractionDisabled && 'hover:opacity-80',
                isUploadInteractionDisabled && !isPendingDeleteTarget && 'opacity-50',
                isUploadInteractionDisabled && 'cursor-not-allowed',
                isPendingDeleteTarget &&
                  'z-40 scale-[1.03] shadow-xl ring-2 ring-intents-ux-box-backgroundColor'
              )}
            >
              <button
                type="button"
                onClick={() => onSelectSlotUpload?.(su.url)}
                disabled={isUploadInteractionDisabled || deletingFilename === deleteFilename}
                aria-pressed={isSelected}
                className="absolute inset-0"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={su.displayUrl}
                  alt=""
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
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
                      <div
                        className="w-2 h-2 absolute bottom-0.5 right-0.5"
                        style={{ backgroundColor: 'var(--background)' }}
                      />
                      <CheckboxFilledIcon className="w-3 h-3 absolute inset-0 text-black" />
                    </span>
                  </>
                )}
              </button>
              {isUploadDeletionEnabled && deleteFilename && (
                <UploadDeleteButton
                  filename={deleteFilename}
                  disabled={isUploadInteractionDisabled || deletingFilename !== null}
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
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
        aria-hidden="true"
      />
      {pendingDelete && (
        <UploadDeleteConfirmationModal
          otherUsageLocations={pendingDelete.otherUsageLocations}
          canRemoveFromCurrentSlot={pendingDelete.canRemoveFromCurrentSlot}
          isDeleting={deletingFilename === pendingDelete.filename}
          error={deleteError}
          overlayBounds={deleteOverlayBounds}
          bounds={deleteDialogBounds}
          targetBounds={deleteTargetBounds}
          onCancel={handleCancelDelete}
          onRemoveFromCurrentSlot={handleRemoveFromCurrentSlot}
          onDeleteEverywhere={handleDeleteEverywhere}
        />
      )}
    </div>
  );
}
