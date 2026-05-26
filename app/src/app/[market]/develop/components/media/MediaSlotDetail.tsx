'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FormattedMessage } from 'react-intl';
import { AIRO_ASSET_UPLOADS_URL_PREFIX } from '@airo/shared/media';
import Button from '@ux/button';
import CheckboxFilledIcon from '@ux/icon/checkbox-filled';
import ChevronDownIcon from '@ux/icon/chevron-down';
import ChevronUpIcon from '@ux/icon/chevron-up';
import CropIcon from '@ux/icon/crop';
import RefreshIcon from '@ux/icon/refresh';
import SearchIcon from '@ux/icon/search';
import Search from '@ux/search';
import Skeleton from '@ux/skeleton';
import Tag from '@ux/tag';

import type {
  DeleteUploadResult,
  SlotUploadItem,
} from '@/app/[market]/develop/components/media/UploadedImagesSection';
import { UploadedImagesSection } from '@/app/[market]/develop/components/media/UploadedImagesSection';
import { getParentOrigin } from '@/components/security/allowed-frame-ancestors';
import { dynamicApiConfigService } from '@/config/dynamic-api';
import { useIsEmbedded } from '@/hooks/useIsEmbedded';
import { useMediaManifest } from '@/hooks/useMediaManifest';
import { useMediaSlot } from '@/hooks/useMediaSlot';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { agentFetch } from '@/lib/agent-fetch';
import { regenerateToken } from '@/lib/jwt-regeneration';
import { logger } from '@/lib/request-context';
import { useServerPollingStore } from '@/stores/useServerPollingStore';
import { fetchAsDataUrl } from '@/utils/image';
import { generateClickEID, logImpressionEvent } from '@/utils/instrumentation';
import { isOriginAllowed, postMessageToIframe } from '@/utils/postMessage';
import { GettyImagesLogo } from './icons/GettyImagesLogo';
import { formatSlotName } from './mediaSlotLabels';

export function getSlotImageUrl(
  slotName: string | null,
  imageUrl: string,
  previewBaseUrl: string | null
): string {
  if (!imageUrl || !slotName || !previewBaseUrl) {
    return imageUrl || '';
  }
  // Absolute URLs (e.g. signed agent URLs for chat uploads) are used as-is
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }
  if (imageUrl.startsWith(AIRO_ASSET_UPLOADS_URL_PREFIX)) {
    return `${previewBaseUrl}${imageUrl}`;
  }
  return `${previewBaseUrl}/airo-assets/images/${slotName}?src=${encodeURIComponent(imageUrl)}`;
}

interface MediaSlotDetailProps {
  appId: string;
  slotName: string;
  enabled?: boolean;
  onDone?: () => void;
  onEdit?: (effectiveUrl: string) => void;
}

// Number of Getty alternatives to show initially / after "Less"
const GETTY_INITIAL_COUNT = 3;
// Number of additional items to reveal per "More" click
const GETTY_LOAD_MORE_COUNT = 9;

// null = any (no filter applied)
type SearchOrientation = 'horizontal' | 'vertical' | null;

export function MediaSlotDetail({
  appId,
  slotName,
  enabled = true,
  onDone,
  onEdit,
}: MediaSlotDetailProps) {
  const t = useTranslations();
  const isImageSearchEnabled = useSwitchboard('appbuilder-image-search');

  // Stable timestamp captured at mount time. Because MediaSlotDetail unmounts while the
  // image editor is open and remounts after a save, each post-edit visit gets a new ts,
  // which cache-busts upload thumbnails that were overwritten in-place.
  const [cacheBustTs] = useState(() => Date.now());

  const { slot, isLoading, error, refetch } = useMediaSlot({
    appId,
    slotName,
    enabled,
  });

  const { manifest, refetch: refetchManifest } = useMediaManifest({ appId, enabled });

  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [selectedUploadFile, setSelectedUploadFile] = useState<{
    filename: string;
    signedUrl?: string;
    fullSignedUrl?: string;
  } | null>(null);
  const [isSwapping, setIsSwapping] = useState(false);
  const [isApplyingUpload, setIsApplyingUpload] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [alternativesOpen, setAlternativesOpen] = useState(true);
  const [uploadsOpen, setUploadsOpen] = useState(true);
  const [uploadsRefreshKey, setUploadsRefreshKey] = useState(0);

  // Search + Getty alternatives state
  const [searchQuery, setSearchQuery] = useState('');
  // The query that was actually submitted — may differ from searchQuery (the input text)
  const [committedQuery, setCommittedQuery] = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [searchGettyIds, setSearchGettyIds] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // null = any orientation; toggling the active icon deactivates it back to null
  const [searchOrientation, setSearchOrientation] = useState<SearchOrientation>(null);
  // Getty ID of the image selected from search results (needed for external-URL injection)
  const [selectedSearchGettyId, setSelectedSearchGettyId] = useState<string | null>(null);
  const [searchResultsPage, setSearchResultsPage] = useState(1);
  const [searchExhausted, setSearchExhausted] = useState(false);
  // How many grid items are visible; starts at GETTY_INITIAL_COUNT, grows with "More"
  const [displayedCount, setDisplayedCount] = useState(GETTY_INITIAL_COUNT);

  // Alternatives pagination state
  const [extraGettyImages, setExtraGettyImages] = useState<string[]>([]);
  const [alternativesNextPage, setAlternativesNextPage] = useState(2);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [alternativesExhausted, setAlternativesExhausted] = useState(false);

  const searchAbortRef = useRef<AbortController | null>(null);

  // Listen for orientation changes posted from the preview image hover bar
  useEffect(
    function listenForOrientationFromPreview() {
      const handler = (event: MessageEvent) => {
        if (!isOriginAllowed(event)) return;
        const data = event.data as { type?: string; slotName?: string; orientation?: string };
        if (data?.type !== 'SET_SLOT_SEARCH_ORIENTATION') return;
        if (data.slotName !== slotName) return;
        const orientation =
          data.orientation === 'horizontal' || data.orientation === 'vertical'
            ? data.orientation
            : null;
        setSearchOrientation(orientation);
        void triggerSearchRef.current({ orientation });
      };
      window.addEventListener('message', handler);
      return () => window.removeEventListener('message', handler);
    },
    [slotName]
  );

  useEffect(
    function resetStateOnSlotChange() {
      searchAbortRef.current?.abort();
      setIsSearching(false);
      setIsLoadingMore(false);
      setSelectedUrl(null);
      setSelectedUploadFile(null);
      setUploadError(null);
      setAlternativesOpen(true);
      setUploadsOpen(true);
      setSearchQuery('');
      setCommittedQuery('');
      setSearchResults([]);
      setSearchGettyIds([]);
      setSearchOrientation(null);
      setSelectedSearchGettyId(null);
      setSearchResultsPage(1);
      setSearchExhausted(false);
      setExtraGettyImages([]);
      setAlternativesNextPage(2);
      setAlternativesExhausted(false);
      setDisplayedCount(GETTY_INITIAL_COUNT);
      setSearchError(null);
      hasAutoSearchedRef.current = false;
    },
    [slotName]
  );

  // Pre-populate search query from the slot's stored search query and auto-run it once.
  // Skip for logo/generated slots — their alternatives are generated logos, not Getty images.
  const isGeneratedContent = slot?.mediaType === 'logo' || slot?.mediaType === 'generated';
  useEffect(
    function initSearchQuery() {
      if (!isImageSearchEnabled) return;
      if (isGeneratedContent) return;
      if (slot?.searchQuery && !hasAutoSearchedRef.current) {
        hasAutoSearchedRef.current = true;
        setSearchQuery(slot.searchQuery);
        void triggerSearchRef.current({ query: slot.searchQuery });
      }
    },
    [slot?.searchQuery, isGeneratedContent, isImageSearchEnabled]
  );

  const isEmbedded = useIsEmbedded();
  const getServerState = useServerPollingStore((state) => state.getServerState);
  const previewBaseUrl = getServerState(appId)?.url || null;

  // Shared helper: call the agents search endpoint
  const fetchGettySearch = useCallback(
    async (
      query: string,
      page: number,
      orientations: SearchOrientation,
      signal?: AbortSignal
    ): Promise<{ images: string[]; gettyIds: string[]; totalResults: number }> => {
      const apiConfig = await dynamicApiConfigService.getConfigForSite(appId);
      if (!apiConfig.agentUrl) throw new Error('Agent URL not available');
      const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '');

      const params = new URLSearchParams({
        q: query,
        page: String(page),
        pageSize: '9',
      });
      if (orientations) params.set('orientations', orientations);

      const response = await agentFetch(
        `${baseAgentUrl}/media/${appId}/search?${params.toString()}`,
        {
          siteId: appId,
          method: 'GET',
          signal,
        }
      );
      if (!response.ok) throw new Error(`Search failed: ${response.status}`);
      const data = await response.json();
      return {
        images: Array.isArray(data.images) ? data.images : [],
        gettyIds: Array.isArray(data.gettyIds) ? data.gettyIds : [],
        totalResults: data.totalResults ?? 0,
      };
    },
    [appId]
  );

  // Explicit search trigger — called on Enter key, Search button click, or filter change
  const triggerSearch = useCallback(
    async (overrides?: { orientation?: SearchOrientation; query?: string }) => {
      const q = (overrides?.query ?? searchQuery).trim();
      if (!q) return;

      const effectiveOrientation =
        overrides?.orientation !== undefined ? overrides.orientation : searchOrientation;

      // Cancel any in-flight request
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;

      setCommittedQuery(q);
      setIsSearching(true);
      setSearchResults([]);
      setSearchGettyIds([]);
      setSearchResultsPage(1);
      setSearchExhausted(false);
      setDisplayedCount(GETTY_INITIAL_COUNT);
      setSearchError(null);
      try {
        const result = await fetchGettySearch(q, 1, effectiveOrientation, controller.signal);
        if (!controller.signal.aborted) {
          setSearchResults(result.images);
          setSearchGettyIds(result.gettyIds);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setSearchError(t('builder_mediaslot_error_fail_load'));
          logger.warn('media_slot_detail.search_failed', {
            appId,
            slotName,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    },
    [searchQuery, searchOrientation, fetchGettySearch, appId, slotName]
  );

  // Keep a stable ref so the message handler below never goes stale
  const triggerSearchRef = useRef(triggerSearch);
  useEffect(() => {
    triggerSearchRef.current = triggerSearch;
  }, [triggerSearch]);

  // Prevents re-triggering auto-search after a swap updates slot.searchQuery
  const hasAutoSearchedRef = useRef(false);

  // Clear upload selection when a Getty image is selected, and vice versa
  const handleSelectGettyImage = useCallback((url: string) => {
    setSelectedUrl(url);
    setSelectedUploadFile(null);
    setSelectedSearchGettyId(null);
  }, []);

  const handleSelectSearchResult = useCallback((url: string, gettyId: string | null) => {
    setSelectedUrl(url);
    setSelectedUploadFile(null);
    setSelectedSearchGettyId(gettyId);
  }, []);

  const handleSelectUploadImage = useCallback(
    (file: { filename: string; signedUrl?: string; fullSignedUrl?: string }) => {
      setSelectedUploadFile(file);
      setSelectedUrl(null);
      setSelectedSearchGettyId(null);
    },
    []
  );

  // Select a persistent slot upload (from alternatives) — uses the same swap flow as Getty
  const handleSelectSlotUpload = useCallback((url: string) => {
    setSelectedUrl(url);
    setSelectedUploadFile(null);
    setSelectedSearchGettyId(null);
  }, []);

  const isUploadUrl = (url: string) => url.startsWith(AIRO_ASSET_UPLOADS_URL_PREFIX);

  const reloadPreviewSlot = useCallback((activeSlot: string) => {
    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement;
    if (iframe) {
      postMessageToIframe(iframe, { type: 'RELOAD_MEDIA_SLOT', slotPath: activeSlot });
      postMessageToIframe(iframe, { type: 'CLEAR_SELECTION' });
    }
  }, []);

  const handleSwapImage = useCallback(async () => {
    const effectiveUrl = selectedUrl ?? slot?.currentUrl;
    if (!slot || !effectiveUrl || effectiveUrl === slot.currentUrl) return;

    logger.info('media_slot_detail.swap_requested', { appId, slotName, newUrl: effectiveUrl });
    setIsSwapping(true);

    try {
      const tokenResult = await regenerateToken({ siteId: appId, force: true });
      const apiConfig = await dynamicApiConfigService.getConfigForSite(appId);

      if (!apiConfig.agentUrl) {
        throw new Error('Agent URL not available');
      }

      const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '');

      // When the selected URL came from user search (not in the existing alternatives list),
      // pass allowExternalUrl so the manifest service can inject it.
      const isExternal = selectedSearchGettyId !== null;
      const response = await fetch(`${baseAgentUrl}/media/${appId}/slots/${slotName}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenResult.token}`,
        },
        body: JSON.stringify({
          newUrl: effectiveUrl,
          ...(isExternal && {
            allowExternalUrl: true,
            gettyId: selectedSearchGettyId,
            ...(committedQuery && { searchQuery: committedQuery }),
          }),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Failed to swap image: ${response.status}`);
      }

      logger.info('media_slot_detail.swap_success', { appId, slotName, newUrl: effectiveUrl });
      reloadPreviewSlot(slotName);
      await refetch();
      await refetchManifest();
      setSelectedUrl(null);
      setSelectedSearchGettyId(null);
    } catch (err) {
      logger.error('media_slot_detail.swap_failed', {
        appId,
        slotName,
        error: err instanceof Error ? err.message : String(err),
      });
      setUploadError(err instanceof Error ? err.message : t('builder_mediaslot_error_fail_use'));
    } finally {
      setIsSwapping(false);
    }
  }, [
    appId,
    slotName,
    slot,
    selectedUrl,
    selectedSearchGettyId,
    committedQuery,
    reloadPreviewSlot,
    refetch,
    refetchManifest,
    t,
  ]);

  const handleUploadSuccess = useCallback(() => {
    reloadPreviewSlot(slotName);
    setUploadsRefreshKey((k) => k + 1);
    void refetch();
    void refetchManifest();
    setSelectedUrl(null);
    setSelectedUploadFile(null);
  }, [slotName, reloadPreviewSlot, refetch, refetchManifest]);

  const handleUploadDeleteSuccess = useCallback(
    (result: DeleteUploadResult) => {
      for (const affectedSlot of new Set(result.affectedSlots || [])) {
        reloadPreviewSlot(affectedSlot);
      }
      setUploadsRefreshKey((k) => k + 1);
      void refetch();
      void refetchManifest();
      setSelectedUrl(null);
      setSelectedUploadFile(null);
    },
    [reloadPreviewSlot, refetch, refetchManifest]
  );

  const effectiveSelectedUrl = selectedUrl ?? slot?.currentUrl ?? null;

  const handleSelectFromUploads = useCallback(
    async (file: { filename: string; signedUrl?: string; fullSignedUrl?: string }) => {
      setIsApplyingUpload(true);
      setUploadError(null);

      try {
        const tokenResult = await regenerateToken({ siteId: appId, force: true });
        const apiConfig = await dynamicApiConfigService.getConfigForSite(appId);

        if (!apiConfig.agentUrl) {
          throw new Error('Agent URL not available');
        }

        const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '');

        // Server-side copy: tell the agent to copy the chat upload to the media slot
        // directly, avoiding the browser roundtrip (fetch blob → re-upload) that caused
        // 500 errors when blobs arrived corrupted or empty.
        const response = await fetch(
          `${baseAgentUrl}/media/${appId}/slots/${slotName}/apply-upload`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${tokenResult.token}`,
            },
            body: JSON.stringify({ filename: file.filename }),
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
          throw new Error(errorData.error || 'Upload failed');
        }

        logger.info('media_slot_detail.upload_from_chat_success', {
          appId,
          slotName,
          filename: file.filename,
        });
        logImpressionEvent('uploads.mediaslot.success')();
        reloadPreviewSlot(slotName);
        await refetch();
        await refetchManifest();
        setSelectedUploadFile(null);
        setSelectedUrl(null);
      } catch (err) {
        logger.error('media_slot_detail.upload_from_chat_failed', {
          appId,
          slotName,
          error: err instanceof Error ? err.message : String(err),
        });
        logImpressionEvent('uploads.mediaslot.failed')();
        setUploadError(err instanceof Error ? err.message : t('builder_mediaslot_error_fail_use'));
      } finally {
        setIsApplyingUpload(false);
      }
    },
    [appId, slotName, reloadPreviewSlot, refetch, refetchManifest, t]
  );

  const allImages = slot ? [...new Set([slot.currentUrl, ...slot.alternatives])] : [];
  const gettyImages = allImages.filter((url) => !isUploadUrl(url)).sort();

  const allGettyImages = [
    ...gettyImages,
    ...extraGettyImages.filter((url) => !gettyImages.includes(url)),
  ];

  // Whether the grid is currently showing search results vs. default alternatives.
  // Never override for logo/generated slots — their grid should always show generated alternatives.
  const showingSearchResults = searchResults.length > 0 && !isGeneratedContent;
  const allGridImages = showingSearchResults ? searchResults : allGettyImages;
  // Logo/generated slots show all alternatives (no pagination); image slots paginate.
  const gridImages = isGeneratedContent ? allGridImages : allGridImages.slice(0, displayedCount);

  const showMoreButton =
    !!isImageSearchEnabled &&
    !isGeneratedContent &&
    (showingSearchResults
      ? searchResults.length > displayedCount || !searchExhausted
      : allGettyImages.length > displayedCount ||
        (!!slot?.searchQuery && !alternativesExhausted && allGettyImages.length > 0));
  const showLessButton = !!isImageSearchEnabled && displayedCount > GETTY_INITIAL_COUNT;

  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore) return;

    // Reveal already-loaded images before fetching a new page from the API
    const totalLoaded = searchResults.length > 0 ? searchResults.length : allGettyImages.length;

    if (displayedCount < totalLoaded) {
      setDisplayedCount((n) => n + GETTY_LOAD_MORE_COUNT);
      return;
    }

    // Cancel any in-flight search or prior load-more request
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setIsLoadingMore(true);
    try {
      if (searchResults.length > 0) {
        // Paginate through search results
        const nextPage = searchResultsPage + 1;
        const result = await fetchGettySearch(
          committedQuery,
          nextPage,
          searchOrientation,
          controller.signal
        );
        if (!controller.signal.aborted) {
          if (result.images.length === 0) {
            setSearchExhausted(true);
          } else {
            setSearchResults((prev) => [...prev, ...result.images]);
            setSearchGettyIds((prev) => [...prev, ...result.gettyIds]);
            setSearchResultsPage(nextPage);
            setDisplayedCount((n) => n + result.images.length);
          }
        }
      } else {
        // Paginate through slot alternatives
        if (!slot?.searchQuery) return;
        const slotOrientations = slot.orientations
          ? ((slot.orientations.split(',')[0] as SearchOrientation | undefined) ?? null)
          : null;
        const result = await fetchGettySearch(
          slot.searchQuery,
          alternativesNextPage,
          slotOrientations,
          controller.signal
        );
        if (!controller.signal.aborted) {
          if (result.images.length === 0) {
            setAlternativesExhausted(true);
          } else {
            setExtraGettyImages((prev) => [...prev, ...result.images]);
            setAlternativesNextPage((p) => p + 1);
            setDisplayedCount((n) => n + result.images.length);
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setSearchError(t('builder_mediaslot_error_fail_load'));
        logger.warn('media_slot_detail.load_more_failed', {
          appId,
          slotName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoadingMore(false);
      }
    }
  }, [
    isLoadingMore,
    displayedCount,
    searchResults,
    searchResultsPage,
    committedQuery,
    searchOrientation,
    slot,
    allGettyImages,
    alternativesNextPage,
    fetchGettySearch,
    appId,
    slotName,
  ]);

  const handleShowLess = useCallback(() => {
    setDisplayedCount(GETTY_INITIAL_COUNT);
  }, []);

  // Build slot upload items for UploadedImagesSection dedup display.
  // Includes currentUrl + alternatives. The dedup logic in UploadedImagesSection
  // hides any that have a matching active chat upload (no duplicates).
  const slotUploads: SlotUploadItem[] = slot
    ? allImages.filter(isUploadUrl).map((url) => ({
        url,
        displayUrl: previewBaseUrl ? `${previewBaseUrl}${url}?_t=${cacheBustTs}` : url,
        sourceFilename: slot.uploadSources?.[url],
      }))
    : [];

  const setAsLogo = useCallback(async () => {
    const url = effectiveSelectedUrl;
    if (!url) return;
    const parentOrigin = getParentOrigin();
    if (!parentOrigin) return;
    const imageUrl = getSlotImageUrl(slotName, url, previewBaseUrl);
    const action = 'set-as-logo';
    try {
      const dataUrl = await fetchAsDataUrl(imageUrl);
      window.parent.postMessage({ action, sender: 'airo-hq', imageUrl: dataUrl }, parentOrigin);
    } catch (err) {
      logger.warn('media.setAsLogo.fetchFailed', { action, slotName, error: err });
      const absoluteUrl = new URL(imageUrl, window.location.origin).href;
      window.parent.postMessage({ action, sender: 'airo-hq', imageUrl: absoluteUrl }, parentOrigin);
    }
  }, [effectiveSelectedUrl, slotName, previewBaseUrl]);

  // When slot.currentUrl is an upload and no explicit selection, derive the
  // matching chat upload filename from uploadSources so the checkmark shows.
  const currentUploadFilename =
    !selectedUploadFile && !selectedUrl && slot?.currentUrl && isUploadUrl(slot.currentUrl)
      ? slot.uploadSources?.[slot.currentUrl]
      : undefined;

  const effectiveSelectedFilename = selectedUploadFile?.filename ?? currentUploadFilename ?? null;
  const isCurrentImage = !selectedUploadFile && effectiveSelectedUrl === slot?.currentUrl;
  const hasSelection = selectedUploadFile || !isCurrentImage;
  const canSetAsLogo =
    !selectedUploadFile && !!effectiveSelectedUrl && !isUploadUrl(effectiveSelectedUrl);

  // Show the search section only for standard image slots (not logo/generated)
  const showSearchSection = !!isImageSearchEnabled && slot?.mediaType === 'image';

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto pr-1">
        {isLoading ? (
          <SkeletonContent />
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <p className="text-intents-ux-textSubtle-textColor">
              {t('builder_mediaslot_error_fail_load')}
            </p>
            <p className="text-sm text-intents-ux-textSubtle-textColor mt-1">{error}</p>
          </div>
        ) : slot && allImages.length > 0 ? (
          <div className="flex flex-col gap-2">
            <div>
              <h3 className="font-semibold text-lg">{formatSlotName(slotName)}</h3>

              <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                {slot.mediaType && slot.mediaType !== 'image' && (
                  <Tag emphasis="neutral" size="sm">
                    {slot.mediaType}
                  </Tag>
                )}
                {slot.orientations && (
                  <Tag emphasis="neutral" size="sm">
                    {slot.orientations}
                  </Tag>
                )}
                {slot.compositions && (
                  <Tag emphasis="neutral" size="sm">
                    {slot.compositions}
                  </Tag>
                )}
                {slot.requestedSize && (
                  <Tag emphasis="neutral" size="sm">
                    {`${slot.requestedSize.width}x${slot.requestedSize.height}`}
                  </Tag>
                )}
              </div>

              {slot.searchQuery && <p className="text-sm italic mt-1">{slot.searchQuery}</p>}
            </div>

            {uploadError && (
              <p className="text-sm text-intents-ux-error-textColor mb-2">{uploadError}</p>
            )}

            <div className="flex gap-2">
              {onEdit && (
                <Button
                  onClick={() => {
                    if (selectedUploadFile) {
                      const uploadPersistentUrl = slotUploads.find(
                        (su) => su.sourceFilename === selectedUploadFile.filename
                      )?.url;
                      onEdit(
                        uploadPersistentUrl ??
                          selectedUploadFile.fullSignedUrl ??
                          slot?.currentUrl ??
                          ''
                      );
                    } else {
                      onEdit(effectiveSelectedUrl ?? slot?.currentUrl ?? '');
                    }
                  }}
                  design="secondary"
                  size="sm"
                  icon={<CropIcon className="w-4 h-4" />}
                  text={t('builder_mediaslot_modify')}
                  disabled={!slot?.currentUrl || isApplyingUpload || isSwapping}
                  data-eid={generateClickEID('develop.media_slot_detail.modify')}
                  className="flex-1"
                />
              )}
              <Button
                onClick={
                  selectedUploadFile
                    ? () => handleSelectFromUploads(selectedUploadFile)
                    : handleSwapImage
                }
                design="primary"
                icon={
                  <RefreshIcon
                    className={`w-4 h-4 ${isSwapping || isApplyingUpload ? 'animate-spin' : ''}`}
                  />
                }
                disabled={!hasSelection || isSwapping || isApplyingUpload}
                className="flex-1"
                size="sm"
                text={
                  isSwapping || isApplyingUpload
                    ? t('builder_mediaslot_swapping')
                    : t('builder_mediaslot_use_image')
                }
                data-eid={generateClickEID('develop.media_slot_detail.use')}
              />
            </div>

            {isEmbedded && slot.mediaType === 'logo' && (
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    void setAsLogo();
                  }}
                  design="secondary"
                  size="sm"
                  text={t('builder_mediaslot_set_as_logo')}
                  disabled={!canSetAsLogo || isApplyingUpload || isSwapping}
                  data-eid={generateClickEID('develop.media_slot_detail.set_as_logo')}
                  className="flex-1"
                />
              </div>
            )}

            {/* Options by Getty Images — includes inline search for image/video slots */}
            {(showSearchSection || gettyImages.length > 0) && (
              <div>
                <button
                  type="button"
                  onClick={() => setAlternativesOpen(!alternativesOpen)}
                  className="w-full flex items-center py-2 justify-between hover:cursor-pointer"
                  data-eid={generateClickEID('develop.media_slot_detail.toggle_alternatives')}
                >
                  <span className="font-medium flex items-center">
                    {slot.mediaType === 'logo' ? (
                      t('builder_mediaslot_options_generated')
                    ) : (
                      <FormattedMessage
                        id="builder_mediaslot_options_getty"
                        defaultMessage="Options by <getty></getty>"
                        values={{
                          getty: () => (
                            <span key="getty-logo" style={{ marginLeft: '4px' }}>
                              <GettyImagesLogo className="inline-block h-2 w-auto" />
                            </span>
                          ),
                        }}
                      />
                    )}
                  </span>
                  {alternativesOpen ? (
                    <ChevronUpIcon className="size-2.5" />
                  ) : (
                    <ChevronDownIcon className="size-2.5" />
                  )}
                </button>

                {alternativesOpen && (
                  <div className="flex flex-col gap-1.5">
                    {/* Search input + filters — image/video slots only */}
                    {showSearchSection && (
                      <>
                        {/* Search bar: @ux/search with search icon button, no clear X */}
                        <Search
                          id="media-search-input"
                          visualSize="sm"
                          className="[&_.ux-search-clear-button]:!hidden [&_.ux-text-input:only-child]:!rounded-r-none"
                          value={searchQuery}
                          onChange={(value: string) => setSearchQuery(value)}
                          onConfirm={() => {
                            void triggerSearch();
                          }}
                          clearable={false}
                          placeholder={t('builder_mediaslot_search_images')}
                          data-testid="media-search-input"
                          aria-label={t('builder_mediaslot_search_images')}
                          data-eid={generateClickEID('develop.media_slot_detail.search_input')}
                          button={
                            <Button
                              design="primary"
                              size="small"
                              className="!px-2"
                              onClick={() => {
                                if (!searchQuery.trim() || isSearching) return;
                                void triggerSearch();
                              }}
                              disabled={!searchQuery.trim() || isSearching}
                              aria-label={t('builder_domain_purchase_search_button')}
                              data-testid="media-search-button"
                              data-eid={generateClickEID('develop.media_slot_detail.search_button')}
                            >
                              {isSearching ? (
                                <RefreshIcon className="size-2.5 animate-spin" />
                              ) : (
                                <span className="flex items-center gap-1">
                                  <SearchIcon className="size-2.5" />{' '}
                                  {t('builder_domain_purchase_search_button')}
                                </span>
                              )}
                            </Button>
                          }
                        />
                      </>
                    )}

                    {/* Image grid — search results or default alternatives */}
                    {searchError ? (
                      <p className="text-sm text-intents-ux-error-textColor py-2">{searchError}</p>
                    ) : isSearching ? (
                      <div className="grid grid-cols-3 gap-2">
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                          <Skeleton key={i} width="100%" height="100px" className="aspect-square" />
                        ))}
                      </div>
                    ) : gridImages.length > 0 ? (
                      <ImageGrid
                        images={gridImages}
                        selectedUrl={selectedUploadFile ? null : effectiveSelectedUrl}
                        slotName={slotName}
                        previewBaseUrl={previewBaseUrl}
                        onSelect={(url) => {
                          if (showingSearchResults) {
                            const idx = searchResults.indexOf(url);
                            const gettyId = idx !== -1 ? (searchGettyIds[idx] ?? null) : null;
                            handleSelectSearchResult(url, gettyId);
                          } else {
                            handleSelectGettyImage(url);
                          }
                        }}
                        isLogo={slot.mediaType === 'logo'}
                      />
                    ) : showingSearchResults ? (
                      <p className="text-sm text-intents-ux-textSubtle-textColor text-center py-3">
                        {t('builder_code_search_no_results')}
                      </p>
                    ) : null}

                    {(showMoreButton || showLessButton) && (
                      <div className="flex items-center justify-center gap-3">
                        {showMoreButton && (
                          <button
                            type="button"
                            onClick={() => {
                              void handleLoadMore();
                            }}
                            disabled={isLoadingMore}
                            className="text-sm text-intents-ux-link-textColor hover:underline py-1 disabled:opacity-50"
                            data-testid="media-alternatives-more"
                            data-eid={generateClickEID(
                              'develop.media_slot_detail.more_alternatives'
                            )}
                          >
                            {isLoadingMore ? (
                              <RefreshIcon className="w-4 h-4 animate-spin inline-block" />
                            ) : (
                              t('builder_mediaslot_view_more')
                            )}
                          </button>
                        )}
                        {showMoreButton && showLessButton && (
                          <span
                            aria-hidden="true"
                            className="text-2xl leading-none text-intents-ux-textSubtle-textColor select-none"
                          >
                            ·
                          </span>
                        )}
                        {showLessButton && (
                          <button
                            type="button"
                            onClick={handleShowLess}
                            className="text-sm text-intents-ux-link-textColor hover:underline py-1"
                            data-testid="media-alternatives-less"
                            data-eid={generateClickEID(
                              'develop.media_slot_detail.less_alternatives'
                            )}
                          >
                            {t('builder_common_collapse', undefined, 'Collapse')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div>
              <button
                type="button"
                onClick={() => setUploadsOpen(!uploadsOpen)}
                className="w-full flex items-center justify-between py-2 hover:cursor-pointer"
                data-eid={generateClickEID('develop.media_slot_detail.toggle_uploads')}
              >
                <span className="font-medium">{t('builder_mediaslot_uploads')}</span>
                {uploadsOpen ? (
                  <ChevronUpIcon className="size-2.5" />
                ) : (
                  <ChevronDownIcon className="size-2.5" />
                )}
              </button>
              {uploadsOpen && (
                <UploadedImagesSection
                  appId={appId}
                  slotName={slotName}
                  onUploadSuccess={handleUploadSuccess}
                  onSelectImage={handleSelectUploadImage}
                  isDisabled={isApplyingUpload}
                  selectedFilename={effectiveSelectedFilename}
                  refreshKey={uploadsRefreshKey}
                  slotUploads={slotUploads}
                  mediaManifest={manifest}
                  selectedSlotUploadUrl={selectedUploadFile ? null : effectiveSelectedUrl}
                  onSelectSlotUpload={handleSelectSlotUpload}
                  onDeleteSuccess={handleUploadDeleteSuccess}
                />
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
    </div>
  );
}

interface ImageGridProps {
  images: string[];
  selectedUrl: string | null;
  slotName: string;
  previewBaseUrl: string | null;
  onSelect: (url: string) => void;
  isLogo?: boolean;
}

function ImageGrid({
  images,
  selectedUrl,
  slotName,
  previewBaseUrl,
  onSelect,
  isLogo,
}: ImageGridProps) {
  if (images.length === 0) return null;

  return (
    <div className="grid grid-cols-3 gap-2">
      {images.map(function renderImage(url) {
        const isSelected = selectedUrl === url;
        return (
          <button
            type="button"
            key={url}
            onClick={() => onSelect(url)}
            aria-pressed={isSelected}
            className={`relative aspect-square rounded-md overflow-hidden hover:cursor-pointer ${
              isSelected ? '' : 'hover:opacity-80'
            }`}
            data-eid={generateClickEID('develop.media_slot_detail.image_option')}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getSlotImageUrl(slotName, url, previewBaseUrl)}
              alt=""
              className={`w-full h-full ${isLogo ? 'object-contain' : 'object-cover'}`}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
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
        );
      })}
    </div>
  );
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
  );
}
