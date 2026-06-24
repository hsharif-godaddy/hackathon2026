'use client'

import '@/app/[market]/develop/components/preview/media-canvas/media-grid.css'

import { useCallback, useMemo, useRef, useState } from 'react'
import Button from '@ux/button'
import RefreshIcon from '@ux/icon/refresh'

import type { MediaSlot } from '@/app/[market]/develop/components/media/types'
import type { GettySearchResult, MediaFormatFilter } from '@/app/[market]/develop/components/preview/media-canvas/GettySearchSection'
import { GettyResultsGrid, MediaSearchBar, useGettySearch } from '@/app/[market]/develop/components/preview/media-canvas/GettySearchSection'
import type { RecentUploadFile } from '@/app/[market]/develop/components/preview/media-canvas/shared'
import {
  Breadcrumb,
  FoldersSection,
  MediaThumbnail,
  NewFolderModal,
  RecentUploadsSection,
  UploadCard,
} from '@/app/[market]/develop/components/preview/media-canvas/shared'
import {
  ALL_MEDIA_FORMATS,
  getCategoryForMime,
  IMAGE_FORMATS,
  MAX_FILES_PER_UPLOAD,
  MAX_SIZE_BY_CATEGORY,
  MediaCategory,
  VIDEO_FORMATS,
} from '@/app/[market]/develop/components/preview/media-canvas/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { dynamicApiConfigService } from '@/config/dynamic-api'
import type { MediaFolder } from '@/hooks/useMediaFolders'
import { SITE_FILES_FOLDER, useMediaFolders } from '@/hooks/useMediaFolders'
import { useMediaManifest } from '@/hooks/useMediaManifest'
import { useRecentUploads } from '@/hooks/useRecentUploads'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { logger } from '@/lib/request-context'
import { uploadImages } from '@/services/file-upload'
import { useMediaSlotDialogStore } from '@/stores/useMediaSlotDialogStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { compressImageFiles } from '@/utils/image-compression'
import { postMessageToIframe } from '@/utils/postMessage'

const ACCEPT_STRING = ALL_MEDIA_FORMATS.join(',')

interface MediaReplacePanelProps {
  slotName: string
  onClose: () => void
}

export function MediaReplacePanel({ slotName, onClose }: MediaReplacePanelProps) {
  const appId = useAppIdFromParams()
  const { manifest, slotNames, refetch } = useMediaManifest({ appId: appId || null })
  const { uploads: recentUploads, isLoading: uploadsLoading, refetch: refetchUploads } = useRecentUploads({ appId: appId || null })
  const { folders, createFolder, isCreating } = useMediaFolders({ appId: appId || null })
  const previewBaseUrl = useServerPollingStore((state) => state.getServerState(appId || ''))?.url || null
  const panelSlotForkContext = useMediaSlotDialogStore((state) => state.panelSlotForkContext)
  const panelSlotOccurrenceIndex = useMediaSlotDialogStore((state) => state.panelSlotOccurrenceIndex)

  const [activeFolder, setActiveFolder] = useState<MediaFolder | null>(null)
  const [isNewFolderModalOpen, setIsNewFolderModalOpen] = useState(false)
  const [showAllUploads, setShowAllUploads] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isSwapping, setIsSwapping] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Selection state
  const [selectedSlotName, setSelectedSlotName] = useState<string | null>(null)
  const [selectedUpload, setSelectedUpload] = useState<RecentUploadFile | null>(null)
  const [selectedGettyResult, setSelectedGettyResult] = useState<GettySearchResult | null>(null)

  const slot = manifest?.[slotName] ?? null

  // Determine default format from the slot being replaced
  const defaultFormat: MediaFormatFilter = slot?.mediaType === 'video' ? 'videos' : slot?.mediaType === 'image' ? 'images' : 'all'
  const gettySearch = useGettySearch({
    appId: appId || '',
    initialQuery: slot?.searchQuery || slot?.caption || undefined,
    defaultFormat,
  })

  // All manifest slots for Site Files folder
  const allSiteFiles = useMemo(() => {
    if (!manifest) return [] as { name: string; slot: MediaSlot }[]
    return slotNames
      .map((name) => ({ name, slot: manifest[name] }))
      .filter((entry): entry is { name: string; slot: MediaSlot } => !!entry.slot)
      .sort((a, b) => new Date(b.slot.lastUpdated).getTime() - new Date(a.slot.lastUpdated).getTime())
  }, [manifest, slotNames])

  const allFolders = useMemo(() => [SITE_FILES_FOLDER, ...folders], [folders])
  const isSiteFilesActive = activeFolder?.id === SITE_FILES_FOLDER.id

  const hasSelection = !!(selectedSlotName || selectedUpload || selectedGettyResult)

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleCreateFolder = useCallback(async (name: string) => {
    try {
      await createFolder(name)
      setIsNewFolderModalOpen(false)
    } catch { /* handled by hook */ }
  }, [createFolder])

  const handleSelectSlot = useCallback((name: string) => {
    setSelectedSlotName(name)
    setSelectedUpload(null)
    setSelectedGettyResult(null)
  }, [])

  const handleSelectUpload = useCallback((file: RecentUploadFile) => {
    setSelectedUpload(file)
    setSelectedSlotName(null)
    setSelectedGettyResult(null)
  }, [])

  const handleSelectGetty = useCallback((result: GettySearchResult) => {
    setSelectedGettyResult(result)
    setSelectedSlotName(null)
    setSelectedUpload(null)
  }, [])

  const handleUseImage = useCallback(async () => {
    if (!appId || !slot) return

    // Build fork context for shared slots — only when we have actual context
    // (not available after page refresh since the store is non-persistent)
    const forkBody: Record<string, unknown> = {}
    const hasForkContext = panelSlotForkContext && (
      panelSlotForkContext.devContext?.fileName?.startsWith('src/') ||
      panelSlotForkContext.devContext?.fileName?.startsWith('app/')
    )
    if (typeof panelSlotOccurrenceIndex === 'number' && panelSlotOccurrenceIndex >= 0) {
      forkBody.occurrenceIndex = panelSlotOccurrenceIndex
    }
    if (hasForkContext) {
      forkBody.forkContext = {
        selector: panelSlotForkContext.selector,
        devContext: panelSlotForkContext.devContext,
        elementInfo: {
          tagName: panelSlotForkContext.elementInfo.tagName,
          className: panelSlotForkContext.elementInfo.className,
          id: panelSlotForkContext.elementInfo.id ?? '',
          selector: panelSlotForkContext.selector,
          devContext: panelSlotForkContext.devContext,
        },
        imageInfo: panelSlotForkContext.imageInfo,
      }
    } else {
      // No fork context (e.g., after page refresh) — tell the backend to
      // skip shared-slot fork logic and update in-place
      forkBody.skipFork = true
    }

    setIsSwapping(true)
    try {
      const tokenResult = await regenerateToken({ siteId: appId, force: true })
      const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)
      if (!apiConfig.agentUrl) throw new Error('Agent URL not available')
      const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '')

      if (selectedUpload) {
        // Apply upload to slot (server-side copy)
        const response = await fetch(
          `${baseAgentUrl}/media/${appId}/slots/${slotName}/apply-upload`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${tokenResult.token}`,
            },
            body: JSON.stringify({ filename: selectedUpload.filename }),
          }
        )
        if (!response.ok) {
          const data = await response.json().catch(() => ({ error: 'Failed to replace' }))
          throw new Error(data.error || 'Failed to replace image')
        }
      } else if (selectedGettyResult) {
        // Swap with Getty image/video URL
        const response = await fetch(
          `${baseAgentUrl}/media/${appId}/slots/${slotName}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${tokenResult.token}`,
            },
            body: JSON.stringify({
              ...forkBody,
              newUrl: selectedGettyResult.url,
              allowExternalUrl: true,
              ...(selectedGettyResult.gettyId && { gettyId: selectedGettyResult.gettyId }),
              searchQuery: '',
              isVideo: !!selectedGettyResult.videoUrl,
            }),
          }
        )
        if (!response.ok) {
          const data = await response.json().catch(() => ({ error: 'Failed to replace' }))
          throw new Error(data.error || 'Failed to replace image')
        }
      } else if (selectedSlotName && manifest) {
        // Swap with another slot's URL
        const sourceSlot = manifest[selectedSlotName]
        if (!sourceSlot) throw new Error('Source slot not found')

        const response = await fetch(
          `${baseAgentUrl}/media/${appId}/slots/${slotName}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${tokenResult.token}`,
            },
            body: JSON.stringify({
              ...forkBody,
              newUrl: sourceSlot.currentUrl,
              allowExternalUrl: true,
              searchQuery: '',
            }),
          }
        )
        if (!response.ok) {
          const data = await response.json().catch(() => ({ error: 'Failed to replace' }))
          throw new Error(data.error || 'Failed to replace image')
        }
      }

      // Reload preview — send both RELOAD_MEDIA_SLOT and a full HMR nudge
      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
      if (iframe) {
        const isVideo = !!selectedGettyResult?.videoUrl
        postMessageToIframe(iframe, { type: 'RELOAD_MEDIA_SLOT', slotPath: slotName, ...(isVideo && { isVideo: true }) })
        postMessageToIframe(iframe, { type: 'CLEAR_SELECTION' })
        // Force iframe reload for cases where HMR doesn't pick up the asset change
        setTimeout(() => {
          postMessageToIframe(iframe, { type: 'RELOAD_MEDIA_SLOT', slotPath: slotName, ...(isVideo && { isVideo: true }) })
        }, 1000)
      }

      logger.info('media_replace_panel.swap.success', { appId, slotName })
      setSelectedSlotName(null)
      setSelectedUpload(null)
      setSelectedGettyResult(null)
    } catch (err) {
      logger.error('media_replace_panel.swap.error', {
        appId,
        slotName,
        error: err instanceof Error ? err.message : String(err),
      })
      setUploadError(err instanceof Error ? err.message : 'Failed to replace image')
    } finally {
      setIsSwapping(false)
    }
  }, [appId, slotName, slot, selectedUpload, selectedGettyResult, selectedSlotName, manifest, panelSlotForkContext, panelSlotOccurrenceIndex])

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0 || !appId) return

    const fileList = Array.from(files)

    if (fileList.length > MAX_FILES_PER_UPLOAD) {
      setUploadError(`Maximum ${MAX_FILES_PER_UPLOAD} files allowed at a time`)
      e.target.value = ''
      return
    }

    const invalidFile = fileList.find((f) => !getCategoryForMime(f.type))
    if (invalidFile) {
      const category = invalidFile.type.startsWith('video/') ? MediaCategory.Video : MediaCategory.Image
      const formats = category === MediaCategory.Video
        ? VIDEO_FORMATS.map(t => t.replace('video/', '').toUpperCase()).join(', ')
        : IMAGE_FORMATS.map(t => t.replace('image/', '').toUpperCase()).join(', ')
      setUploadError(`Only ${formats} files are supported`)
      e.target.value = ''
      return
    }

    const oversizedFile = fileList.find((f) => {
      const category = getCategoryForMime(f.type)
      const maxSize = category ? MAX_SIZE_BY_CATEGORY[category] : MAX_SIZE_BY_CATEGORY[MediaCategory.Image]
      return f.size > maxSize
    })
    if (oversizedFile) {
      const category = getCategoryForMime(oversizedFile.type) ?? MediaCategory.Image
      const limitMB = MAX_SIZE_BY_CATEGORY[category] / (1024 * 1024)
      const label = category === MediaCategory.Video ? 'Video' : category === MediaCategory.Audio ? 'Audio' : 'Image'
      setUploadError(`${label} must be under ${limitMB}MB`)
      e.target.value = ''
      return
    }

    setUploadError(null)
    setIsUploading(true)

    try {
      const imageFiles = fileList.filter((f) => f.type.startsWith('image/'))
      const videoFiles = fileList.filter((f) => f.type.startsWith('video/'))
      const compressed = await compressImageFiles(imageFiles)
      const allFiles = [...compressed, ...videoFiles]

      for (let i = 0; i < allFiles.length; i += 5) {
        const chunk = allFiles.slice(i, i + 5)
        await uploadImages(appId, chunk)
      }

      await Promise.all([refetch(), refetchUploads()])
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploading(false)
      e.target.value = ''
    }
  }, [appId, refetch, refetchUploads])

  return (
    <div className="flex flex-col h-full media-replace-panel" style={{ containerType: 'inline-size' }}>
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {/* Header — inline with X */}
        <div className="flex items-center gap-1.5 mb-2">
          <button
            type="button"
            onClick={onClose}
            className="w-[36px] h-[36px] flex items-center justify-center shrink-0 hover:opacity-70 transition-opacity"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" stroke="#000" strokeWidth="1.5" fill="none">
              <line x1="2" y1="2" x2="12" y2="12" />
              <line x1="12" y1="2" x2="2" y2="12" />
            </svg>
          </button>
          <h2 className="text-base font-semibold">Replace Image</h2>
        </div>

        {uploadError && (
          <p className="mb-2 text-xs" style={{ color: '#dc2626' }}>{uploadError}</p>
        )}

        {/* Search bar + format filter */}
        {appId && (
          <MediaSearchBar
            query={gettySearch.searchQuery}
            onQueryChange={gettySearch.setSearchQuery}
            onSearch={() => { void gettySearch.triggerSearch() }}
            isSearching={gettySearch.isSearching}
            formatFilter={gettySearch.formatFilter}
            onFormatChange={gettySearch.setFormatFilter}
          />
        )}

        {/* Folders */}
        {!activeFolder && (
          <FoldersSection folders={allFolders} onSelectFolder={setActiveFolder} />
        )}

        {/* Breadcrumb — only shown when inside a folder */}
        {activeFolder && (
          <Breadcrumb activeFolder={activeFolder} onNavigateRoot={() => setActiveFolder(null)} />
        )}

        {/* Recent Uploads (or folder content) */}
        {activeFolder ? (
          <div className="flex flex-wrap gap-[12px] media-grid mb-6">
            <UploadCard onClick={handleUploadClick} isUploading={isUploading} />
            {(isSiteFilesActive ? allSiteFiles : allSiteFiles.filter(({ name }) => (activeFolder.slots || []).includes(name)))
              .map(({ name, slot: s }) => (
                <MediaThumbnail
                  key={name}
                  name={name}
                  slot={s}
                  previewBaseUrl={previewBaseUrl}
                  onSelect={handleSelectSlot}
                  isSelected={selectedSlotName === name}
                />
              ))}
          </div>
        ) : (
          <RecentUploadsSection
            uploads={recentUploads}
            isLoading={uploadsLoading}
            onUploadClick={handleUploadClick}
            isUploading={isUploading}
            limit={showAllUploads ? undefined : 5}
            onShowMore={() => setShowAllUploads(true)}
            hasMore={!showAllUploads && recentUploads.length > 5}
            onSelectUpload={handleSelectUpload}
            selectedUploadId={selectedUpload?.id ?? null}
          />
        )}

        {/* Recommendations by Getty Images */}
        {appId && !activeFolder && (
          <section className="mb-6">
            <h2 className="text-lg font-semibold mb-3">Recommendations by Getty Images</h2>
            <GettyResultsGrid
              results={gettySearch.results}
              gettyIds={gettySearch.gettyIds}
              videoUrls={gettySearch.videoUrls}
              isSearching={gettySearch.isSearching}
              hasSearched={gettySearch.hasSearched}
              onSelectResult={handleSelectGetty}
              selectedUrl={selectedGettyResult?.url ?? null}
              hasMore={gettySearch.hasMore}
              isLoadingMore={gettySearch.isLoadingMore}
              onLoadMore={() => { void gettySearch.loadMore() }}
            />
          </section>
        )}

        <NewFolderModal
          isOpen={isNewFolderModalOpen}
          onClose={() => setIsNewFolderModalOpen(false)}
          onSave={handleCreateFolder}
          isCreating={isCreating}
        />
      </div>

      {/* Sticky footer */}
      <div className="px-1 py-1 border-t border-intents-ux-box-borderColor">
        <Button
          design="primary"
          size="small"
          className="w-full"
          onClick={() => { void handleUseImage() }}
          disabled={!hasSelection || isSwapping}
          icon={isSwapping ? <RefreshIcon className="size-3 animate-spin" /> : undefined}
          text={isSwapping ? 'Replacing...' : selectedGettyResult?.videoUrl ? 'Use this Video' : 'Use this Image'}
        />
      </div>

      <input
        type="file"
        ref={fileInputRef}
        accept={ACCEPT_STRING}
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  )
}
