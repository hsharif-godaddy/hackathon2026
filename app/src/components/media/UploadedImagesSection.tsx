"use client";

import { Loader2 } from "lucide-react";
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
}

interface UploadedImagesSectionProps {
  appId: string;
  onSelectImage: (file: UploadedFile) => void;
  isDisabled?: boolean;
}

export function UploadedImagesSection({
  appId,
  onSelectImage,
  isDisabled,
}: UploadedImagesSectionProps) {
  const [uploads, setUploads] = useState<UploadedFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

        // Filter to only image files
        const imageFiles = (data.files || []).filter((file: UploadedFile) =>
          file.mimeType?.startsWith("image/")
        );

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

  return (
    <div className="mt-4 pt-4 border-t border-intents-ux-boxLowContrast-backgroundColor">
      <h4 className="text-sm font-medium mb-2 text-intents-ux-textSubtle-textColor">
        Your Uploads
      </h4>
      <div className="flex gap-2 overflow-x-auto pb-1">
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/files/${appId}/uploads/${file.filename}`}
              alt={file.originalName}
              className="max-w-full max-h-full object-contain rounded-md"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
