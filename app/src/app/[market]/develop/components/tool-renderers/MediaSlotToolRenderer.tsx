'use client';

import { Image } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { formatSlotName } from '@/app/[market]/develop/components/media/mediaSlotLabels';
import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer';
import ToolHeader from '@/app/[market]/develop/components/tool-renderers/ToolHeader';
import { ChatTab } from '@/app/[market]/develop/components/types';
import { useChatTabs } from '@/hooks/useChatTabs';
import { logger } from '@/lib/request-context';
import { useMediaSlotDialogStore } from '@/stores/useMediaSlotDialogStore';
import { postMessageToIframe } from '@/utils/postMessage';

interface MediaSlotResultData {
  success: boolean;
  slot: string;
  slotUrl: string;
  mediaType: 'image' | 'video';
  searchQuery: string;
  resolvedUrl?: string;
  /** For videos: thumbnail image URL for preview display */
  thumbnailUrl?: string;
  alternatives?: string[];
  alternativeCount?: number;
  error?: string;
}

/**
 * Custom renderer for media slot tool
 *
 * Shows a compact card with slot name and primary image.
 * Click to open the MediaSlotDialog for browsing alternatives and swapping.
 */
export default function MediaSlotToolRenderer({ toolStatus, result }: DefaultToolRendererProps) {
  const params = useParams();
  const appId = params?.id as string | undefined;
  const navigateToSlot = useMediaSlotDialogStore((state) => state.navigateToSlot);
  const { setActiveChatTab } = useChatTabs();

  // Parse result
  let parsedResult: MediaSlotResultData | null = null;
  if (result) {
    try {
      if (typeof result === 'string') {
        parsedResult = JSON.parse(result) as MediaSlotResultData;
      } else {
        parsedResult = result as unknown as MediaSlotResultData;
      }
    } catch (e) {
      logger.error('tool.media_slot.parse.failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Extract stable primitives to avoid exhaustive-deps issues with parsedResult
  // (which is re-created via JSON.parse on every render).
  const slot = parsedResult?.slot;
  const success = parsedResult?.success;

  // When the media slot tool completes, notify the preview iframe to reload
  // the slot. This handles the case where an existing image is replaced with
  // a new search — only the manifest changes, not the page source, so the
  // preview wouldn't otherwise know to re-fetch the image.
  const hasNotifiedRef = useRef(false);
  useEffect(() => {
    if (toolStatus === 'completed' && success && slot && !hasNotifiedRef.current) {
      hasNotifiedRef.current = true;
      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement;
      if (iframe) {
        postMessageToIframe(iframe, {
          type: 'RELOAD_MEDIA_SLOT',
          slotPath: slot,
        });
      }
    }
  }, [toolStatus, success, slot]);

  const hasResult = parsedResult?.success && parsedResult?.resolvedUrl;
  const isVideo = parsedResult?.mediaType === 'video';
  // For videos, use thumbnailUrl for preview; for images, use resolvedUrl
  const previewUrl = isVideo
    ? parsedResult?.thumbnailUrl || parsedResult?.resolvedUrl
    : parsedResult?.resolvedUrl;

  // Helper to ensure URLs have proper protocol
  const ensureHttps = (url: string): string => {
    if (!url) return url;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return `https://${url}`;
  };

  const handleClick = () => {
    if (appId && parsedResult?.slot) {
      navigateToSlot(parsedResult.slot);
      setActiveChatTab(ChatTab.MEDIAS);
    }
  };

  // Show header when running or error
  if (toolStatus !== 'completed' || !hasResult) {
    return (
      <ToolHeader
        icon={<Image className="w-2 h-2" /> /* eslint-disable-line jsx-a11y/alt-text */}
        displayName="Selecting media..."
        toolStatus={toolStatus}
        hasDetails={false}
      />
    );
  }

  // Count of alternative options
  const alternativeCount = parsedResult.alternatives?.length || 0;

  // Completed state - show single image with slot name
  return (
    <div className="my-2">
      <button
        type="button"
        onClick={handleClick}
        className="flex items-start gap-3 cursor-pointer group"
      >
        {/* Selected media preview (thumbnail for videos, image for images) */}
        <div className="w-8 h-8 rounded-md overflow-hidden flex-shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ensureHttps(previewUrl || '')}
            alt={parsedResult.searchQuery}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
          />
        </div>

        {/* Slot info */}
        <div className="text-left">
          <p className="text-sm font-medium">{formatSlotName(parsedResult.slot)}</p>
          {alternativeCount > 0 && (
            <p className="text-xs text-intents-ux-textSubtle-textColor mt-0.5">
              {alternativeCount} other option{alternativeCount !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      </button>
    </div>
  );
}
