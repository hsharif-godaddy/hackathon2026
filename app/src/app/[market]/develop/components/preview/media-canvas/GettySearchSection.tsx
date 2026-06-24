'use client'

import { Play } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@ux/button'
import ChevronRightIcon from '@ux/icon/chevron-right'
import EditIcon from '@ux/icon/edit'
import FolderIcon from '@ux/icon/folder'
import RefreshIcon from '@ux/icon/refresh'
import SearchIcon from '@ux/icon/search'
import Search from '@ux/search'

import { dynamicApiConfigService } from '@/config/dynamic-api'
import type { MediaFolder } from '@/hooks/useMediaFolders'
import { agentFetch } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'

const IMAGE_PAGE_SIZE = 9
const VIDEO_PAGE_SIZE = 3
const SINGLE_MODE_PAGE_SIZE = 9

export interface GettySearchResult {
  url: string
  gettyId: string | null
  videoUrl?: string
}

export type MediaFormatFilter = 'all' | 'images' | 'videos'

// ─── Search Bar ─────────────────────────────────────────────────────────────────

interface MediaSearchBarProps {
  query: string
  onQueryChange: (query: string) => void
  onSearch: () => void
  isSearching: boolean
  formatFilter: MediaFormatFilter
  onFormatChange: (format: MediaFormatFilter) => void
}

export function MediaSearchBar({ query, onQueryChange, onSearch, isSearching, formatFilter, onFormatChange }: MediaSearchBarProps) {
  return (
    <div className="flex gap-2 mb-4 h-[38px]">
      <div className="flex-1 h-full">
        <Search
          id="media-search-bar"
          visualSize="sm"
          className="h-[38px] [&_.ux-search-clear-button]:!hidden [&_.ux-text-input:only-child]:!rounded-r-none [&_*]:!h-[38px] [&_*]:!min-h-0 [&_*]:!max-h-[38px] [&_input]:!py-0"
          value={query}
          onChange={(value: string) => onQueryChange(value)}
          onConfirm={onSearch}
          clearable={false}
          placeholder="Search stock media..."
          button={
            <Button
              design="primary"
              size="small"
              className="!px-2 !h-[38px]"
              onClick={onSearch}
              disabled={!query.trim() || isSearching}
              icon={isSearching ? <RefreshIcon className="size-2.5 animate-spin" /> : <SearchIcon className="size-2.5" />}
            />
          }
        />
      </div>
      <select
        value={formatFilter}
        onChange={(e) => onFormatChange(e.target.value as MediaFormatFilter)}
        className="h-[38px] px-2 text-sm rounded-md border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor"
      >
        <option value="all">All Formats</option>
        <option value="images">Images</option>
        <option value="videos">Videos</option>
      </select>
    </div>
  )
}

// ─── Getty Search Hook ──────────────────────────────────────────────────────────

interface UseGettySearchOptions {
  appId: string
  initialQuery?: string
  defaultFormat?: MediaFormatFilter
  imagePageSize?: number
  videoPageSize?: number
  singleModePageSize?: number
}

export function useGettySearch({ appId, initialQuery, defaultFormat, imagePageSize, videoPageSize, singleModePageSize }: UseGettySearchOptions) {
  const imgSize = imagePageSize ?? IMAGE_PAGE_SIZE
  const vidSize = videoPageSize ?? VIDEO_PAGE_SIZE
  const singleSize = singleModePageSize ?? SINGLE_MODE_PAGE_SIZE
  const [searchQuery, setSearchQuery] = useState(initialQuery ?? '')
  const [formatFilter, setFormatFilter] = useState<MediaFormatFilter>(defaultFormat ?? 'all')
  const [results, setResults] = useState<string[]>([])
  const [gettyIds, setGettyIds] = useState<string[]>([])
  const [videoUrls, setVideoUrls] = useState<Record<string, string>>({})
  const [isSearching, setIsSearching] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [committedQuery, setCommittedQuery] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const hasAutoSearchedRef = useRef(false)

  const fetchPage = useCallback(async (q: string, page: number, signal: AbortSignal) => {
    const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)
    if (!apiConfig.agentUrl) throw new Error('Agent URL not available')
    const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '')

    const searchImages = formatFilter === 'all' || formatFilter === 'images'
    const searchVideos = formatFilter === 'all' || formatFilter === 'videos'
    const imgPageSize = formatFilter === 'all' ? imgSize : singleSize
    const vidPageSize = formatFilter === 'all' ? vidSize : singleSize

    const imagePromise = searchImages
      ? agentFetch(`${baseAgentUrl}/media/${appId}/search?${new URLSearchParams({ q, page: String(page), pageSize: String(imgPageSize) })}`, { siteId: appId, method: 'GET', signal }).then(r => r.ok ? r.json() : null)
      : Promise.resolve(null)
    const videoPromise = searchVideos
      ? agentFetch(`${baseAgentUrl}/media/${appId}/video-search?${new URLSearchParams({ q, page: String(page), pageSize: String(vidPageSize) })}`, { siteId: appId, method: 'GET', signal }).then(r => r.ok ? r.json() : null)
      : Promise.resolve(null)

    const [imageData, videoData] = await Promise.all([imagePromise, videoPromise])

    const imgs: string[] = (imageData?.images ?? []).slice(0, imgPageSize)
    const imgIds: string[] = (imageData?.gettyIds ?? []).slice(0, imgPageSize)
    const thumbs: string[] = (videoData?.thumbnails ?? []).slice(0, vidPageSize)
    const vids: string[] = (videoData?.videos ?? []).slice(0, vidPageSize)
    const vidIds: string[] = (videoData?.gettyIds ?? []).slice(0, vidPageSize)
    const map: Record<string, string> = {}
    thumbs.forEach((thumb, i) => { if (vids[i]) map[thumb] = vids[i] })

    const totalExpected = (searchImages ? imgPageSize : 0) + (searchVideos ? vidPageSize : 0)
    const totalReceived = imgs.length + thumbs.length
    return { imgs, imgIds, thumbs, vidIds, map, hasMore: totalReceived >= totalExpected }
  }, [appId, formatFilter])

  const triggerSearch = useCallback(async (queryOverride?: string) => {
    const q = (queryOverride ?? searchQuery).trim()
    if (!q) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsSearching(true)
    setHasSearched(true)
    setResults([])
    setGettyIds([])
    setVideoUrls({})
    setCurrentPage(1)
    setCommittedQuery(q)

    try {
      const data = await fetchPage(q, 1, controller.signal)
      if (!controller.signal.aborted) {
        setResults([...data.imgs, ...data.thumbs])
        setGettyIds([...data.imgIds, ...data.vidIds])
        setVideoUrls(data.map)
        setHasMore(data.hasMore)
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        logger.warn('getty_search.failed', { appId, error: err instanceof Error ? err.message : String(err) })
      }
    } finally {
      if (!controller.signal.aborted) setIsSearching(false)
    }
  }, [appId, searchQuery, fetchPage])

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !committedQuery) return
    const nextPage = currentPage + 1

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsLoadingMore(true)
    try {
      const data = await fetchPage(committedQuery, nextPage, controller.signal)
      if (!controller.signal.aborted) {
        setResults(prev => [...prev, ...data.imgs, ...data.thumbs])
        setGettyIds(prev => [...prev, ...data.imgIds, ...data.vidIds])
        setVideoUrls(prev => ({ ...prev, ...data.map }))
        setCurrentPage(nextPage)
        setHasMore(data.hasMore)
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        logger.warn('getty_search.load_more.failed', { appId, error: err instanceof Error ? err.message : String(err) })
      }
    } finally {
      if (!controller.signal.aborted) setIsLoadingMore(false)
    }
  }, [appId, committedQuery, currentPage, isLoadingMore, fetchPage])

  // Auto-search on mount if initialQuery provided
  useEffect(() => {
    if (initialQuery && !hasAutoSearchedRef.current) {
      hasAutoSearchedRef.current = true
      setSearchQuery(initialQuery)
      void triggerSearch(initialQuery)
    }
  }, [initialQuery])

  const handleFormatChange = useCallback((format: MediaFormatFilter) => {
    setFormatFilter(format)
    setResults([])
    setGettyIds([])
    setVideoUrls({})
    setHasSearched(false)
  }, [])

  return {
    searchQuery,
    setSearchQuery,
    formatFilter,
    setFormatFilter: handleFormatChange,
    results,
    gettyIds,
    videoUrls,
    isSearching,
    isLoadingMore,
    hasSearched,
    hasMore,
    triggerSearch,
    loadMore,
  }
}

// ─── Getty Thumbnail with 3-dot Menu ────────────────────────────────────────────

interface GettyThumbnailProps {
  url: string
  isVideo: boolean
  videoUrl?: string
  gettyId: string | null
  isSelected: boolean
  onSelect: (result: GettySearchResult) => void
  folders?: MediaFolder[]
}

function GettyThumbnail({ url, isVideo, videoUrl, gettyId, isSelected, onSelect, folders }: GettyThumbnailProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [folderSubmenuOpen, setFolderSubmenuOpen] = useState(false)

  return (
    <div className="relative w-[160px] h-[160px] group overflow-visible">
      <div
        onClick={() => onSelect({
          url: isVideo && videoUrl ? videoUrl : url,
          gettyId,
          videoUrl,
        })}
        className={`w-full h-full overflow-hidden rounded-[10px] bg-intents-ux-box-backgroundColor border transition-colors cursor-pointer ${
          isSelected ? 'border-2' : 'border-intents-ux-box-borderColor hover:border-intents-ux-ring-borderColor'
        }`}
        style={isSelected ? { borderColor: '#000' } : undefined}
      >
        {isVideo && videoUrl ? (
          <div className="relative w-full h-full">
            <video
              src={videoUrl}
              poster={url}
              className="w-full h-full object-cover"
              muted
              autoPlay
              loop
              playsInline
              preload="metadata"
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-5 h-5 rounded-full bg-black/50 flex items-center justify-center">
                <Play className="w-2.5 h-2.5 text-white" fill="white" />
              </div>
            </div>
          </div>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={url}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        )}
      </div>

      {/* 3-dot menu */}
      <div
        className="absolute top-0.5 right-0.5 z-20"
        onMouseLeave={() => { setMenuOpen(false); setFolderSubmenuOpen(false) }}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
          className="w-[36px] h-[36px] rounded-md items-center justify-center cursor-pointer hidden group-hover:flex border border-gray-200 shadow-sm"
          style={{ backgroundColor: '#fff' }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="#000">
            <circle cx="9" cy="3.5" r="1.5" />
            <circle cx="9" cy="9" r="1.5" />
            <circle cx="9" cy="14.5" r="1.5" />
          </svg>
        </button>

        {menuOpen && (
          <div className="absolute top-full right-0 z-30 min-w-[160px] rounded-md border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor shadow-lg py-1">
            {!isVideo && (
              <button
                type="button"
                onClick={() => { setMenuOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-intents-ux-boxLowContrast-backgroundColor text-left"
              >
                <EditIcon className="size-3.5 text-intents-ux-textSubtle-textColor" />
                Modify
              </button>
            )}
            {folders && folders.length > 0 && (
              <div
                className="relative"
                onMouseEnter={() => setFolderSubmenuOpen(true)}
                onMouseLeave={() => setFolderSubmenuOpen(false)}
              >
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-intents-ux-boxLowContrast-backgroundColor text-left"
                >
                  <FolderIcon className="size-3.5 text-intents-ux-textSubtle-textColor" />
                  Move to Folder
                  <ChevronRightIcon className="size-3 ml-auto text-intents-ux-textSubtle-textColor" />
                </button>
                {folderSubmenuOpen && (
                  <div className="absolute left-full top-0 min-w-[140px] rounded-md border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor shadow-lg py-1">
                    {folders.filter((f) => !f.isVirtual).map((folder) => (
                      <span
                        key={folder.id}
                        className="block px-3 py-1.5 text-sm text-intents-ux-textSubtle-textColor cursor-default"
                      >
                        {folder.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Getty Results Grid ─────────────────────────────────────────────────────────

interface GettyResultsGridProps {
  results: string[]
  gettyIds: string[]
  videoUrls: Record<string, string>
  isSearching: boolean
  hasSearched: boolean
  onSelectResult: (result: GettySearchResult) => void
  selectedUrl?: string | null
  hasMore?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => void
  folders?: MediaFolder[]
}

export function GettyResultsGrid({ results, gettyIds, videoUrls, isSearching, hasSearched, onSelectResult, selectedUrl, hasMore, isLoadingMore, onLoadMore, folders }: GettyResultsGridProps) {
  if (isSearching) {
    return (
      <div className="flex flex-wrap gap-[12px] media-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="w-[160px] h-[160px] rounded-[10px] bg-intents-ux-box-borderColor animate-pulse" />
        ))}
      </div>
    )
  }

  if (results.length > 0) {
    return (
      <div className="flex flex-wrap gap-[12px] media-grid">
        {results.map((url, idx) => {
          const isVideo = !!videoUrls[url]
          const isSelected = selectedUrl === url || selectedUrl === videoUrls[url]
          return (
            <GettyThumbnail
              key={url}
              url={url}
              isVideo={isVideo}
              videoUrl={videoUrls[url]}
              gettyId={gettyIds[idx] ?? null}
              isSelected={isSelected}
              onSelect={onSelectResult}
              folders={folders}
            />
          )
        })}
        {hasMore && onLoadMore && (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="w-[160px] h-[160px] rounded-[10px] border border-intents-ux-box-borderColor bg-intents-ux-boxLowContrast-backgroundColor hover:bg-intents-ux-box-borderColor transition-colors flex items-center justify-center cursor-pointer text-sm text-intents-ux-textSubtle-textColor disabled:opacity-50"
          >
            {isLoadingMore ? (
              <div className="size-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#000', borderTopColor: 'transparent' }} />
            ) : (
              'View More'
            )}
          </button>
        )}
      </div>
    )
  }

  if (hasSearched) {
    return (
      <p className="text-sm text-intents-ux-textSubtle-textColor text-center py-4">
        No results found. Try a different search term.
      </p>
    )
  }

  return (
    <p className="text-sm text-intents-ux-textSubtle-textColor text-center py-4">
      Search to explore from thousands of stock media
    </p>
  )
}

// ─── Combined Section (backward compat for MediaCanvas) ─────────────────────────

interface GettySearchSectionProps {
  appId: string
  initialQuery?: string
  onSelectResult: (result: GettySearchResult) => void
  selectedUrl?: string | null
}

export function GettySearchSection({ appId, initialQuery, onSelectResult, selectedUrl }: GettySearchSectionProps) {
  const search = useGettySearch({ appId, initialQuery })

  return (
    <section className="mb-6">
      <h2 className="text-lg font-semibold mb-3">Recommendations by Getty Images</h2>
      <MediaSearchBar
        query={search.searchQuery}
        onQueryChange={search.setSearchQuery}
        onSearch={() => { void search.triggerSearch() }}
        isSearching={search.isSearching}
        formatFilter={search.formatFilter}
        onFormatChange={search.setFormatFilter}
      />
      <GettyResultsGrid
        results={search.results}
        gettyIds={search.gettyIds}
        videoUrls={search.videoUrls}
        isSearching={search.isSearching}
        hasSearched={search.hasSearched}
        onSelectResult={onSelectResult}
        selectedUrl={selectedUrl}
      />
    </section>
  )
}
