"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { dynamicApiConfigService } from "@/config/dynamic-api";
import { regenerateToken } from "@/lib/jwt-regeneration";
import { logger } from "@/lib/request-context";

export interface UploadedFile {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string | null;
  size: number;
  signedUrl?: string;
  /** Full signed URL for browser access (base agent URL + signedUrl path) */
  fullSignedUrl?: string;
  /** Origin marker. 'crawled' = source-site image imported during a rebuild. */
  source?: 'crawled';
}

export interface UseUploadedMediaResult {
  uploads: UploadedFile[];
  setUploads: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /** Call from an <img onError> to refetch fresh signed URLs once. */
  handleImageError: () => void;
}

/**
 * Fetches the app's uploaded media (images + videos) from the agent's
 * `/files/:appId/list` endpoint, computing browser-ready signed URLs with a
 * mount-time cache-bust param. Shared by the slot-scoped UploadedMediaSection
 * and the top-level SourceImagesLibrary.
 *
 * @param appId      App whose uploads to list.
 * @param refreshKey Increment to force a refetch (e.g. after an upload/delete).
 */
export function useUploadedMedia(appId: string, refreshKey?: number): UseUploadedMediaResult {
  const [uploads, setUploads] = useState<UploadedFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable timestamp at mount — busts browser cache for thumbnails when the
  // component remounts after an image editor save (file overwritten in-place).
  const [cacheBustTs] = useState(() => Date.now());

  // Guard against infinite refetch loops when files are genuinely missing.
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

      // Filter to media files (images and videos) and compute full signed URLs.
      // Append the mount-time cache-bust param so thumbnails for files overwritten
      // in-place (same URL, new content) always load fresh.
      const mediaFiles = (data.files || [])
        .filter((file: UploadedFile) => file.mimeType?.startsWith('image/') || file.mimeType?.startsWith('video/'))
        .map((file: UploadedFile) => {
          if (!file.signedUrl) return { ...file, fullSignedUrl: undefined };
          const fullUrl = `${baseAgentUrl}${file.signedUrl}`;
          const sep = fullUrl.includes('?') ? '&' : '?';
          return { ...file, fullSignedUrl: `${fullUrl}${sep}_t=${cacheBustTs}` };
        });

      setUploads(mediaFiles);
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
  }, [appId, cacheBustTs]);

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

  return { uploads, setUploads, isLoading, error, refetch: fetchUploads, handleImageError };
}
