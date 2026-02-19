"use client";

import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

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

interface UploadedImagesSectionProps {
  appId: string;
  onSelectImage: (file: UploadedFile) => void;
  isDisabled?: boolean;
  layout?: 'horizontal' | 'grid';
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
}: UploadedImagesSectionProps) {
  const [uploads, setUploads] = useState<UploadedFileWithFullUrl[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    async function fetchUploads() {
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
      } catch (err) {
        logger.error("uploaded_images_section.fetch_failed", {
          appId,
          error: err instanceof Error ? err.message : String(err),
        });
        setError("Failed to load uploads");
      } finally {
        setIsLoading(false);
      }
    }

    fetchUploads();
  }, [appId]);

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

  if (uploads.length === 0) {
    return null; // Don't show section if no uploads
  }

  // Grid layout - used in tabbed view
  if (layout === 'grid') {
    return (
      <div className="grid grid-cols-2 gap-2 content-start">
        {uploads.map((file) => (
          <button
            key={file.id}
            type="button"
            onClick={() => onSelectImage(file)}
            disabled={isDisabled}
            className={`rounded-md hover:opacity-80 transition-opacity ${
              isDisabled ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            {file.fullSignedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={file.fullSignedUrl}
                alt={file.originalName}
                className="w-full object-contain rounded-md bg-intents-ux-boxLowContrast-backgroundColor p-2"
              />
            ) : (
              <span className="text-xs text-intents-ux-textSubtle-textColor truncate px-1 block p-2 bg-intents-ux-boxLowContrast-backgroundColor rounded-md">
                {file.originalName}
              </span>
            )}
          </button>
        ))}
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
