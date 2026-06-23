"use client";

import { useCallback, useRef, useState } from "react";

import { dynamicApiConfigService } from "@/config/dynamic-api";
import { SWITCHBOARD_APPBUILDER_UPLOADED_IMAGE_DELETION } from '@/config/switchboard-flags';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from "@/hooks/useTranslations";
import { regenerateToken } from "@/lib/jwt-regeneration";
import { logger } from "@/lib/request-context";
import { UploadDeleteButton } from './UploadDeleteButton';
import { UploadDeleteConfirmationModal } from './UploadDeleteConfirmationModal';
import { useUploadDeleteOverlayBounds } from './useUploadDeleteOverlayBounds';
import { useUploadedMedia } from './useUploadedMedia';

interface PendingDelete {
  filename: string;
  isVideo: boolean;
  otherUsageLocations: string[];
}

/** Slots (other than the current one — N/A here) that still reference this upload. */
function getUploadUsageLocationNames(
  mediaManifest: Record<string, { currentUrl?: string; alternatives?: string[] }> | null | undefined,
  filename: string,
): string[] {
  if (!mediaManifest) return [];
  const uploadPrefix = '/airo-assets/uploads/';
  const locations: string[] = [];
  for (const [name, slot] of Object.entries(mediaManifest)) {
    const urls = [slot.currentUrl, ...(slot.alternatives || [])].filter(Boolean) as string[];
    if (urls.some((url) => url.startsWith(uploadPrefix) && url.endsWith(filename))) {
      locations.push(name);
    }
  }
  return locations;
}

interface SourceImagesLibraryProps {
  appId: string;
  /** Media manifest, used to warn when a deleted image is still placed on pages. */
  mediaManifest?: Record<string, { currentUrl?: string; alternatives?: string[] }> | null;
  /** Increment to force a refetch (e.g. after an image editor save elsewhere). */
  refreshKey?: number;
}

/**
 * Top-level gallery of crawled source-site images (registered as uploads during
 * a rebuild). Makes the Media tab non-empty after a rebuild and lets customers
 * browse — and optionally delete — their imported images. Reuse into placements
 * happens through each slot's Uploads section and the preview "Swap Image" flow,
 * where these same uploads also appear.
 *
 * Renders nothing when there are no crawled images (e.g. a normal AI build).
 */
export function SourceImagesLibrary({ appId, mediaManifest, refreshKey }: SourceImagesLibraryProps) {
  const t = useTranslations();
  const { uploads, setUploads, isLoading, error, handleImageError } = useUploadedMedia(appId, refreshKey);
  const sectionRef = useRef<HTMLDivElement>(null);

  const isDeletionEnabled = useSwitchboard(SWITCHBOARD_APPBUILDER_UPLOADED_IMAGE_DELETION) === true;
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deletingFilename, setDeletingFilename] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const {
    deleteDialogBounds,
    deleteOverlayBounds,
    deleteTargetBounds,
    resetDeleteOverlayBounds,
    updateDeleteOverlayBounds,
  } = useUploadDeleteOverlayBounds({ isActive: pendingDelete !== null, sectionRef });

  // Show only crawled images that are NOT already placed into a media slot. The
  // rebuild's initial build (AIROBUILD-2104) fills slots with the best-matching
  // scraped photos, which then appear in the grid; excluding those here keeps the
  // gallery to the leftover, un-placed source images (no double-surfacing). If a
  // slot is later cleared/swapped, the freed image reappears here automatically.
  const sourceImages = uploads.filter(
    (file) =>
      file.source === 'crawled' &&
      getUploadUsageLocationNames(mediaManifest, file.filename).length === 0,
  );

  const handleRequestDelete = useCallback(
    (filename: string) => {
      if (!isDeletionEnabled) return;
      setDeleteError(null);
      updateDeleteOverlayBounds();
      const file = sourceImages.find((f) => f.filename === filename);
      setPendingDelete({
        filename,
        isVideo: file?.mimeType?.startsWith('video/') ?? false,
        otherUsageLocations: getUploadUsageLocationNames(mediaManifest, filename),
      });
    },
    [isDeletionEnabled, mediaManifest, sourceImages, updateDeleteOverlayBounds],
  );

  const handleCancelDelete = useCallback(() => {
    if (deletingFilename) return;
    setPendingDelete(null);
    resetDeleteOverlayBounds();
  }, [deletingFilename, resetDeleteOverlayBounds]);

  const handleDeleteEverywhere = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    setDeletingFilename(pendingDelete.filename);
    try {
      const [tokenResult, apiConfig] = await Promise.all([
        regenerateToken({ siteId: appId, force: true }),
        dynamicApiConfigService.getConfigForSite(appId),
      ]);
      if (!apiConfig.agentUrl) throw new Error('Agent URL not available');
      const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '');
      const response = await fetch(
        `${baseAgentUrl}/media/${appId}/uploads/${encodeURIComponent(pendingDelete.filename)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${tokenResult.token}` } },
      );
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || t('builder_mediaslot_error_failed'));
      setUploads((current) => current.filter((file) => file.filename !== pendingDelete.filename));
      setPendingDelete(null);
      resetDeleteOverlayBounds();
    } catch (err) {
      logger.error('source_images_library.delete_failed', {
        appId,
        filename: pendingDelete.filename,
        error: err instanceof Error ? err.message : String(err),
      });
      setDeleteError(err instanceof Error ? err.message : t('builder_mediaslot_error_failed'));
    } finally {
      setDeletingFilename(null);
    }
  }, [pendingDelete, appId, t, setUploads, resetDeleteOverlayBounds]);

  if (isLoading || error || sourceImages.length === 0) {
    // Hide entirely when loading, on error, or when there are no crawled images
    // (e.g. a normal AI build) — the slots grid renders below regardless.
    return null;
  }

  return (
    <div ref={sectionRef} className="mb-4" data-testid="source-images-library">
      <h3 className="text-sm font-semibold text-intents-ux-text-textColor mb-2">
        {t('builder_media_sourceimages_title', undefined, 'Source images')}
      </h3>
      <div className="grid grid-cols-3 gap-2" data-testid="source-images-grid">
        {sourceImages.map((file) => {
          const isPendingTarget = pendingDelete?.filename === file.filename;
          return (
            <div
              key={file.id}
              className="relative"
              data-source-image-tile
              data-filename={file.filename}
              data-delete-target={isPendingTarget ? 'true' : undefined}
            >
              <div className="relative aspect-square rounded-md overflow-hidden bg-intents-ux-box-backgroundColor border border-intents-ux-box-borderColor">
                {file.fullSignedUrl ? (
                  file.mimeType?.startsWith('video/') ? (
                    <video
                      src={file.fullSignedUrl}
                      className="w-full h-full object-cover"
                      muted
                      loop
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={file.fullSignedUrl}
                      alt={file.originalName}
                      onError={handleImageError}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  )
                ) : (
                  <span className="text-xs text-intents-ux-textSubtle-textColor truncate px-1 block p-2">
                    {file.originalName}
                  </span>
                )}
              </div>
              {isDeletionEnabled && (
                <UploadDeleteButton
                  filename={file.filename}
                  disabled={deletingFilename !== null}
                  onDelete={handleRequestDelete}
                />
              )}
            </div>
          );
        })}
      </div>
      {pendingDelete && (
        <UploadDeleteConfirmationModal
          otherUsageLocations={pendingDelete.otherUsageLocations}
          canRemoveFromCurrentSlot={false}
          isDeleting={deletingFilename === pendingDelete.filename}
          isVideo={pendingDelete.isVideo}
          error={deleteError}
          onCancel={handleCancelDelete}
          onRemoveFromCurrentSlot={handleDeleteEverywhere}
          onDeleteEverywhere={handleDeleteEverywhere}
          bounds={deleteDialogBounds}
          overlayBounds={deleteOverlayBounds}
          targetBounds={deleteTargetBounds}
        />
      )}
    </div>
  );
}
