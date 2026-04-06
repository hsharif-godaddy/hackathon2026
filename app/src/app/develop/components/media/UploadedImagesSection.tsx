"use client";

import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import CheckboxFilledIcon from '@ux/icon/checkbox-filled';

import { dynamicApiConfigService } from "@/config/dynamic-api";
import { regenerateToken } from "@/lib/jwt-regeneration";
import { logger } from "@/lib/request-context";

interface UploadedFile {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string | null;
  size: number;
  signedUrl?: string;
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

interface UploadedImagesSectionProps {
  appId: string;
  onSelectImage: (file: UploadedFile) => void;
  isDisabled?: boolean;
  layout?: 'horizontal' | 'grid';
  selectedFilename?: string | null;
  /** Increment to trigger a refetch (e.g., after a device upload) */
  refreshKey?: number;
  /** Slot upload URLs to show as fallback when chat copies expire */
  slotUploads?: SlotUploadItem[];
  /** Currently selected slot upload URL (for highlight) */
  selectedSlotUploadUrl?: string | null;
  /** Called when a slot upload is selected */
  onSelectSlotUpload?: (url: string) => void;
}

// Extend UploadedFile with computed full signed URL for rendering
interface UploadedFileWithFullUrl extends UploadedFile {
  fullSignedUrl?: string;
}

export function UploadedImagesSection({
  appId,
  onSelectImage,
  isDisabled,
  layout = 'horizontal',
  selectedFilename,
  refreshKey,
  slotUploads,
  selectedSlotUploadUrl,
  onSelectSlotUpload,
}: UploadedImagesSectionProps) {
  const [uploads, setUploads] = useState<UploadedFileWithFullUrl[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Track whether we've already attempted a refetch after image errors
  // to avoid infinite refetch loops when files are genuinely missing.
  const hasRefetchedForErrorRef = useRef(false);

  const fetchUploads = useCallback(async () => {
    try {
      const tokenResult = await regenerateToken({ siteId: appId, force: true });
      const apiConfig = await dynamicApiConfigService.getConfigForSite(appId);

      if (!apiConfig.agentUrl) {
        throw new Error("Agent URL not available");
      }

      // Get base agent URL (remove app-specific path if present)
      const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, "");

      const response = await fetch(`${baseAgentUrl}/files/${appId}/list`, {
        headers: {
          Authorization: `Bearer ${tokenResult.token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch uploads");
      }

      const data = await response.json();

      // Filter to only image files and compute full signed URLs
      const imageFiles = (data.files || [])
        .filter((file: UploadedFile) => file.mimeType?.startsWith("image/"))
        .map((file: UploadedFile) => ({
          ...file,
          // Combine base agent URL with signed URL path for browser access
          fullSignedUrl: file.signedUrl ? `${baseAgentUrl}${file.signedUrl}` : undefined,
        }));

      setUploads(imageFiles);
      setError(null);
    } catch (err) {
      logger.error("uploaded_images_section.fetch_failed", {
        appId,
        error: err instanceof Error ? err.message : String(err),
      });
      setError("Failed to load uploads");
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

    logger.info("uploaded_images_section.signed_url_expired", {
      appId,
      message: "Image failed to load, refetching signed URLs",
    });

    fetchUploads();
  }, [fetchUploads, appId]);


  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin text-intents-ux-textSubtle-textColor" />
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

  const hasAnyUploads = uploads.length > 0 || dedupedSlotUploads.length > 0;

  if (!hasAnyUploads) {
    return null; // Don't show section if no uploads
  }

  // Grid layout - used in tabbed view (matches ImageGrid 3-col styling + selection)
  if (layout === 'grid') {
    return (
      <div className="grid grid-cols-3 gap-2">
        {uploads.map((file) => {
          const isSelected = selectedFilename === file.filename;
          return (
            <button
              key={file.id}
              type="button"
              onClick={() => onSelectImage(file)}
              disabled={isDisabled}
              aria-pressed={isSelected}
              className={`relative aspect-square rounded-md overflow-hidden transition-opacity ${
                isSelected ? '' : 'hover:opacity-80'
              } ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
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
                    <div className="w-2 h-2 absolute bottom-0.5 right-0.5" style={{ backgroundColor: 'var(--background)' }} />
                    <CheckboxFilledIcon className="w-3 h-3 absolute inset-0 text-black" />
                  </span>
                </>
              )}
            </button>
          );
        })}
        {dedupedSlotUploads.map((su) => {
          const isSelected = selectedSlotUploadUrl === su.url;
          return (
            <button
              key={su.url}
              type="button"
              onClick={() => onSelectSlotUpload?.(su.url)}
              disabled={isDisabled}
              aria-pressed={isSelected}
              className={`relative aspect-square rounded-md overflow-hidden transition-opacity ${
                isSelected ? '' : 'hover:opacity-80'
              } ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
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
          );
        })}
      </div>
    );
  }

  // Horizontal layout - used in mobile view with collapsible header
  return (
    <div className="mt-4 pt-4 border-t border-intents-ux-boxLowContrast-backgroundColor">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-controls="uploads-list"
        className="flex items-center gap-1 text-sm font-medium text-intents-ux-textSubtle-textColor hover:text-intents-ux-text-textColor transition-colors w-full"
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        Your Uploads ({uploads.length})
      </button>
      {isExpanded && (
        <div id="uploads-list" className="flex gap-2 overflow-x-auto pb-1 mt-2">
          {uploads.map((file) => (
            <button
              key={file.id}
              type="button"
              onClick={() => onSelectImage(file)}
              disabled={isDisabled}
              className={`flex-shrink-0 w-16 h-16 flex items-center justify-center rounded-md bg-intents-ux-boxLowContrast-backgroundColor hover:opacity-80 transition-opacity ${
                isDisabled ? "opacity-50 cursor-not-allowed" : ""
              }`}
            >
              {file.fullSignedUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={file.fullSignedUrl}
                  alt={file.originalName}
                  onError={handleImageError}
                  className="max-w-full max-h-full object-contain rounded-md"
                />
              ) : (
                <span className="text-xs text-intents-ux-textSubtle-textColor truncate px-1">
                  {file.originalName}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
