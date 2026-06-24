'use client'

import '@/app/[market]/develop/components/preview/media-canvas/media-grid.css'

import { useCallback, useMemo, useRef, useState } from 'react'
import Button from '@ux/button'
import PlusIcon from '@ux/icon/plus'
import SearchIcon from '@ux/icon/search'
import Search from '@ux/search'

import type { MediaSlot } from '@/app/[market]/develop/components/media/types'
import { GettyResultsGrid, useGettySearch } from '@/app/[market]/develop/components/preview/media-canvas/GettySearchSection'
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
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { compressImageFiles } from '@/utils/image-compression'

const ACCEPT_STRING = ALL_MEDIA_FORMATS.join(',')
const RECENT_UPLOADS_LIMIT = 30

interface RecentFileEntry {
  name: string
  slot: MediaSlot
}

export function MediaCanvas() {
  const appId = useAppIdFromParams()
  const { manifest, slotNames, isLoading, refetch } = useMediaManifest({ appId: appId || null })
  const { uploads: recentUploads, isLoading: uploadsLoading, refetch: refetchUploads } = useRecentUploads({ appId: appId || null })
  const { folders, createFolder, isCreating, moveToFolder } = useMediaFolders({ appId: appId || null })
  const previewBaseUrl = useServerPollingStore((state) => state.getServerState(appId || ''))?.url || null
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [activeFolder, setActiveFolder] = useState<MediaFolder | null>(null)
  const [isNewFolderModalOpen, setIsNewFolderModalOpen] = useState(false)
  const [showAllUploads, setShowAllUploads] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const gettySearch = useGettySearch({ appId: appId || '', imagePageSize: 17, videoPageSize: 3, singleModePageSize: 20 })

  // All manifest slots sorted by lastUpdated (for Site Files folder)
  const allSiteFiles = useMemo((): RecentFileEntry[] => {
    if (!manifest) return []
    return slotNames
      .map((name) => ({ name, slot: manifest[name] }))
      .filter((entry): entry is RecentFileEntry => !!entry.slot)
      .sort((a, b) => new Date(b.slot.lastUpdated).getTime() - new Date(a.slot.lastUpdated).getTime())
  }, [manifest, slotNames])

  // Virtual "Site Files" folder always first
  const allFolders = useMemo(() => [SITE_FILES_FOLDER, ...folders], [folders])

  const isSiteFilesActive = activeFolder?.id === SITE_FILES_FOLDER.id

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleCreateFolder = useCallback(async (name: string) => {
    try {
      await createFolder(name)
      setIsNewFolderModalOpen(false)
    } catch {
      // Error handled by the hook
    }
  }, [createFolder])

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

      // Upload in chunks of 5 (API limit per request)
      for (let i = 0; i < allFiles.length; i += 5) {
        const chunk = allFiles.slice(i, i + 5)
        await uploadImages(appId, chunk)
      }

      logger.info('media_canvas.upload.success', { appId, fileCount: allFiles.length })
      await Promise.all([refetch(), refetchUploads()])
    } catch (err) {
      logger.error('media_canvas.upload.error', {
        appId,
        error: err instanceof Error ? err.message : String(err),
      })
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploading(false)
      e.target.value = ''
    }
  }, [appId, refetch, refetchUploads])

  return (
    <div className="h-full flex flex-col pr-1 md:pr-2.5 pl-1 media-canvas">
      <div className="relative h-full overflow-auto rounded-lg md:rounded-b-none border bg-intents-ux-box-backgroundColor">
        <div className="p-4">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-2xl font-semibold">Media Library</h1>
            <div className="flex items-center gap-2">
              <Search
                id="media-library-search"
                visualSize="sm"
                className="w-36 max-w-[200px] h-[38px] [&_.ux-search-clear-button]:!hidden [&_.ux-text-input:only-child]:!rounded-r-none [&_*]:!h-[38px] [&_*]:!min-h-0 [&_*]:!max-h-[38px] [&_input]:!py-0"
                value={gettySearch.searchQuery}
                onChange={(value: string) => gettySearch.setSearchQuery(value)}
                onConfirm={() => { void gettySearch.triggerSearch() }}
                clearable={false}
                placeholder="Search media..."
                button={
                  <Button
                    design="primary"
                    size="small"
                    className="!px-2 !h-[38px]"
                    onClick={() => { if (gettySearch.searchQuery.trim()) void gettySearch.triggerSearch() }}
                    disabled={!gettySearch.searchQuery.trim() || gettySearch.isSearching}
                    icon={<SearchIcon className="size-2.5" />}
                    aria-label="Search"
                  />
                }
              />
              <Button design="secondary" size="small" onClick={() => setIsNewFolderModalOpen(true)} disabled={isCreating} className="!h-[38px]">
                New Folder
              </Button>
              <Button design="primary" size="small" onClick={handleUploadClick} disabled={isUploading} className="!h-[38px] !px-3" icon={<PlusIcon className="size-2.5" />} text="Upload" />
            </div>
          </div>

          {uploadError && (
            <div className="mb-4 p-3 rounded-md bg-red-50 text-red-700 text-sm">
              {uploadError}
            </div>
          )}

          {/* Format filter — above folders */}
          {!activeFolder && (
            <div className="mb-1">
              <select
                value={gettySearch.formatFilter}
                onChange={(e) => gettySearch.setFormatFilter(e.target.value as 'all' | 'images' | 'videos')}
                className="h-[32px] px-2 text-sm rounded-md border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor"
              >
                <option value="all">All Formats</option>
                <option value="images">Images</option>
                <option value="videos">Videos</option>
              </select>
            </div>
          )}

          {/* Folders section — always shown, even when empty */}
          {!activeFolder && (
            <FoldersSection folders={allFolders} onSelectFolder={setActiveFolder} />
          )}

          {/* Breadcrumb — only when inside a folder */}
          {activeFolder && (
            <Breadcrumb activeFolder={activeFolder} onNavigateRoot={() => setActiveFolder(null)} />
          )}

          {/* Content */}
          {activeFolder ? (
            <section>
              <div className="flex flex-wrap gap-[12px]">
                <UploadCard onClick={handleUploadClick} isUploading={isUploading} />
                {(isSiteFilesActive ? allSiteFiles : allSiteFiles.filter(({ name }) => (activeFolder.slots || []).includes(name)))
                  .map(({ name, slot }) => (
                    <MediaThumbnail key={name} name={name} slot={slot} previewBaseUrl={previewBaseUrl} folders={allFolders} onMoveToFolder={(slotName, folderId) => { void moveToFolder({ folderId, slotName }) }} />
                  ))}
              </div>
            </section>
          ) : (
            <RecentUploadsSection
              uploads={recentUploads}
              isLoading={uploadsLoading}
              onUploadClick={handleUploadClick}
              isUploading={isUploading}
              limit={showAllUploads ? undefined : RECENT_UPLOADS_LIMIT}
              onShowMore={() => setShowAllUploads(true)}
              hasMore={!showAllUploads && recentUploads.length > RECENT_UPLOADS_LIMIT}
              folders={allFolders}
              onDeleteUpload={async (filename) => {
                if (!appId) return
                try {
                  const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)
                  if (!apiConfig.agentUrl) throw new Error('Agent URL not available')
                  const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '')
                  const tokenResult = await regenerateToken({ siteId: appId, force: true })
                  const response = await fetch(`${baseAgentUrl}/media/${appId}/uploads/${encodeURIComponent(filename)}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${tokenResult.token}` },
                  })
                  if (!response.ok) throw new Error('Failed to delete upload')
                  await refetchUploads()
                } catch (err) {
                  logger.error('media_canvas.delete_upload.error', { appId, filename, error: err instanceof Error ? err.message : String(err) })
                  setUploadError(err instanceof Error ? err.message : 'Failed to delete upload')
                }
              }}
            />
          )}

          {/* Getty Results — below uploads at root level */}
          {appId && !activeFolder && (
            <section className="mb-3">
              <h2 className="text-lg font-semibold mb-2">Recommendations by Getty Images</h2>
              <GettyResultsGrid
                results={gettySearch.results}
                gettyIds={gettySearch.gettyIds}
                videoUrls={gettySearch.videoUrls}
                isSearching={gettySearch.isSearching}
                hasSearched={gettySearch.hasSearched}
                onSelectResult={() => {}}
                selectedUrl={null}
                hasMore={gettySearch.hasMore}
                isLoadingMore={gettySearch.isLoadingMore}
                onLoadMore={() => { void gettySearch.loadMore() }}
                folders={allFolders}
              />
            </section>
          )}

          <input
            type="file"
            ref={fileInputRef}
            accept={ACCEPT_STRING}
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />

          <NewFolderModal
            isOpen={isNewFolderModalOpen}
            onClose={() => setIsNewFolderModalOpen(false)}
            onSave={handleCreateFolder}
            isCreating={isCreating}
          />
        </div>
      </div>
    </div>
  )
}
