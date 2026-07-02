'use client'

import '@/app/[market]/develop/components/preview/media-canvas/media-grid.css'

import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '@ux/button'
import PlusIcon from '@ux/icon/plus'
import SearchIcon from '@ux/icon/search'
import Search from '@ux/search'

import { ImageEditorPanel } from '@/app/[market]/develop/components/media/ImageEditorPanel'
import type { MediaSlot } from '@/app/[market]/develop/components/media/types'
import type { MediaFormatFilter } from '@/app/[market]/develop/components/preview/media-canvas/GettySearchSection'
import { GettyResultsGrid, useGettySearch } from '@/app/[market]/develop/components/preview/media-canvas/GettySearchSection'
import {
  Breadcrumb,
  FoldersSection,
  MediaThumbnail,
  NewFolderModal,
  RecentUploadsSection,
  UploadCard,
} from '@/app/[market]/develop/components/preview/media-canvas/shared'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { dynamicApiConfigService } from '@/config/dynamic-api'
import { useImportAsSlot } from '@/hooks/useImportAsSlot'
import type { MediaFolder } from '@/hooks/useMediaFolders'
import { SITE_FILES_FOLDER, useMediaFolders } from '@/hooks/useMediaFolders'
import { useMediaManifest } from '@/hooks/useMediaManifest'
import { useMediaUpload } from '@/hooks/useMediaUpload'
import { useRecentUploads } from '@/hooks/useRecentUploads'
import { useTranslations } from '@/hooks/useTranslations'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation'

const RECENT_UPLOADS_LIMIT = 30

function MediaCanvasShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-full flex flex-col pr-1 md:pr-2.5 pl-1 media-canvas">
      <div className="relative h-full overflow-auto rounded-lg md:rounded-b-none border bg-intents-ux-box-backgroundColor">
        {children}
      </div>
    </div>
  )
}

interface RecentFileEntry {
  name: string
  slot: MediaSlot
}

export function MediaCanvas() {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const { manifest, slotNames, isLoading, refetch } = useMediaManifest({ appId: appId || null })
  const { uploads: recentUploads, isLoading: uploadsLoading, refetch: refetchUploads } = useRecentUploads({ appId: appId || null })
  const { folders, createFolder, isCreating, moveToFolder, removeFromFolder } = useMediaFolders({ appId: appId || null })
  const previewBaseUrl = useServerPollingStore((state) => state.getServerState(appId || ''))?.url || null
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editorSlotName, setEditorSlotName] = useState<string | null>(null)
  const [activeFolder, setActiveFolder] = useState<MediaFolder | null>(null)
  const [isNewFolderModalOpen, setIsNewFolderModalOpen] = useState(false)
  const [showAllUploads, setShowAllUploads] = useState(false)
  const [selectedSlotName, setSelectedSlotName] = useState<string | null>(null)
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null)
  const [selectedGettyUrl, setSelectedGettyUrl] = useState<string | null>(null)
  const isSiteFilesActive = activeFolder?.id === SITE_FILES_FOLDER.id
  const importAsSlot = useImportAsSlot(appId || null)
  const { isUploading, uploadError, setUploadError, fileInputRef, triggerFileInput, handleFileSelect, acceptString } = useMediaUpload({
    appId: appId || null,
    onSuccess: async (): Promise<void> => { shipAnalyticsLog('media.upload.completed', { appId }); await Promise.all([refetch(), refetchUploads()]) },
    onFilesUploaded: async (filenames: string[]): Promise<void> => {
      if (!activeFolder || isSiteFilesActive) return
      for (const filename of filenames) {
        try {
          const slotPath: string = await importAsSlot({ filename })
          await moveToFolder({ folderId: activeFolder.id, slotName: slotPath })
        } catch (err) {
          logger.warn('media_canvas.upload_to_folder.failed', {
            appId,
            filename,
            folderId: activeFolder.id,
            error: err instanceof Error ? err.message : String(err),
          })
          setUploadError(err instanceof Error ? err.message : 'Failed to add upload to folder')
        }
      }
      await refetch()
    },
    logPrefix: 'media_canvas',
  })
  const gettySearch = useGettySearch({ appId: appId || '', imagePageSize: 17, videoPageSize: 3, singleModePageSize: 20 })

  // Track canvas open
  useState(() => { logImpressionEvent('media.canvas.view')(); shipAnalyticsLog('media.canvas.opened', { appId }) })

  // Track search no results
  useEffect(() => {
    if (gettySearch.hasSearched && !gettySearch.isSearching && gettySearch.results.length === 0) {
      logImpressionEvent('media.search.noresults')()
      shipAnalyticsLog('media.search.no_results', { appId, query: gettySearch.searchQuery, format: gettySearch.formatFilter })
    }
  }, [gettySearch.hasSearched, gettySearch.isSearching, gettySearch.results.length])

  const handleMoveUploadToFolder = useCallback(async (filename: string, folderId: string): Promise<void> => {
    try {
      const slotPath: string = await importAsSlot({ filename })
      await refetch()
      if (folderId !== SITE_FILES_FOLDER.id) {
        await moveToFolder({ folderId, slotName: slotPath })
      }
    } catch (err) {
      logger.warn('media_canvas.move_upload_to_folder.failed', {
        appId,
        filename,
        folderId,
        error: err instanceof Error ? err.message : String(err),
      })
      setUploadError(err instanceof Error ? err.message : 'Failed to move upload to folder')
    }
  }, [appId, importAsSlot, moveToFolder, refetch, setUploadError])

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

  // Folders available as move targets — excludes the active folder and the virtual Site Files entry
  const moveFolders = useMemo(() => allFolders.filter((f) => f.id !== activeFolder?.id && f.id !== SITE_FILES_FOLDER.id), [allFolders, activeFolder])

  // Folders shown in Getty results dropdown — includes active folder so users can save to current folder
  const gettyTargetFolders = useMemo(() => allFolders.filter((f) => f.id !== SITE_FILES_FOLDER.id), [allFolders])

  // Get fresh folder data from the hook (activeFolder state is a stale snapshot)
  const currentFolderSlots = useMemo(() => {
    if (!activeFolder) return []
    if (isSiteFilesActive) return []
    const fresh = allFolders.find((f) => f.id === activeFolder.id)
    return fresh?.slots ?? []
  }, [activeFolder, isSiteFilesActive, allFolders])

  const handleCreateFolder = useCallback(async (name: string) => {
    try {
      await createFolder(name)
      logClickEvent('media.folders.create')()
      setIsNewFolderModalOpen(false)
    } catch {
      // Error handled by the hook
    }
  }, [appId, createFolder])

  // Editor replaces the grid via early return (not the old navigateToSlot dialog flow)
  if (isEditorOpen && editorSlotName && appId) {
    return (
      <MediaCanvasShell>
        <ImageEditorPanel
          appId={appId}
          slotName={editorSlotName}
          onDone={() => { logClickEvent('media.editor.save')(); setIsEditorOpen(false); void refetch(); void refetchUploads() }}
          onCancel={() => { logClickEvent('media.editor.cancel')(); setIsEditorOpen(false) }}
        />
      </MediaCanvasShell>
    )
  }

  return (
    <MediaCanvasShell>
        <div className="p-4" style={{ containerType: 'inline-size' }}>
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-semibold">{t('builder_chatfiles_media_library', undefined, 'Media Library')}</h1>
            <div className="flex items-center gap-2">
              <div className="hidden @[640px]:block">
                <Search
                  id="media-library-search"
                  visualSize="sm"
                  className="w-[204px] max-w-[260px] h-[38px] [&_.ux-search-clear-button]:!hidden [&_.ux-text-input:only-child]:!rounded-r-none [&_*]:!h-[38px] [&_*]:!min-h-0 [&_*]:!max-h-[38px] [&_input]:!py-0"
                  value={gettySearch.searchQuery}
                  onChange={(value: string) => gettySearch.setSearchQuery(value)}
                  onConfirm={() => { logClickEvent('media.canvas.search')(); shipAnalyticsLog('media.search.triggered', { appId, query: gettySearch.searchQuery, format: gettySearch.formatFilter }); void gettySearch.triggerSearch() }}
                  clearable={false}
                  placeholder={t('builder_media_canvas_search_placeholder', undefined, 'Search media...')}
                  button={
                    <Button
                      design="primary"
                      size="small"
                      className="!px-2 !h-[38px]"
                      onClick={() => { if (gettySearch.searchQuery.trim()) { logClickEvent('media.canvas.search')(); shipAnalyticsLog('media.search.triggered', { appId, query: gettySearch.searchQuery, format: gettySearch.formatFilter }); void gettySearch.triggerSearch() } }}
                      disabled={!gettySearch.searchQuery.trim() || gettySearch.isSearching}
                      icon={<SearchIcon className="size-2.5" />}
                      aria-label={t('builder_media_canvas_search_action', undefined, 'Search')}
                    />
                  }
                />
              </div>
              <div className="hidden @[640px]:block">
                <Button design="primary" size="small" onClick={() => { logClickEvent('media.canvas.upload')(); shipAnalyticsLog('media.upload.initiated', { appId }); triggerFileInput() }} disabled={isUploading} className="!h-[38px] !px-3" icon={<PlusIcon className="size-2.5" />} text={t('builder_mediaslot_upload', undefined, 'Upload')} />
              </div>
            </div>
          </div>

          {uploadError && (
            <div className="mb-4 p-3 rounded-md bg-red-50 text-red-700 text-sm">
              {uploadError}
            </div>
          )}

          {/* Search + format filter — at <640 search drops here inline with All Formats */}
          <div className="flex items-center gap-2 mb-1">
            <div className="flex-1 min-w-0 @[640px]:hidden">
              <Search
                id="media-library-search-sm"
                visualSize="sm"
                className="h-[38px] [&_.ux-search-clear-button]:!hidden [&_.ux-text-input:only-child]:!rounded-r-none [&_*]:!h-[38px] [&_*]:!min-h-0 [&_*]:!max-h-[38px] [&_input]:!py-0"
                value={gettySearch.searchQuery}
                onChange={(value: string) => gettySearch.setSearchQuery(value)}
                onConfirm={() => { logClickEvent('media.canvas.search')(); shipAnalyticsLog('media.search.triggered', { appId, query: gettySearch.searchQuery, format: gettySearch.formatFilter }); void gettySearch.triggerSearch() }}
                clearable={false}
                placeholder={t('builder_media_canvas_search_placeholder', undefined, 'Search media...')}
                button={
                  <Button
                    design="primary"
                    size="small"
                    className="!px-2 !h-[38px]"
                    onClick={() => { if (gettySearch.searchQuery.trim()) { logClickEvent('media.canvas.search')(); shipAnalyticsLog('media.search.triggered', { appId, query: gettySearch.searchQuery, format: gettySearch.formatFilter }); void gettySearch.triggerSearch() } }}
                    disabled={!gettySearch.searchQuery.trim() || gettySearch.isSearching}
                    icon={<SearchIcon className="size-2.5" />}
                    aria-label={t('builder_media_canvas_search_action', undefined, 'Search')}
                  />
                }
              />
            </div>
            <select
              value={gettySearch.formatFilter}
              onChange={(e) => { const format = e.target.value as MediaFormatFilter; logClickEvent('media.canvas.filter')(); gettySearch.setFormatFilter(format) }}
              className="h-[38px] px-2 text-sm rounded-md border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor shrink-0"
            >
              <option value="all">{t('builder_media_canvas_format_all', undefined, 'All Formats')}</option>
              <option value="images">{t('builder_media_images', undefined, 'Images')}</option>
              <option value="videos">{t('builder_media_videos', undefined, 'Videos')}</option>
            </select>
          </div>

          {/* Folders section — always visible */}
          <FoldersSection folders={allFolders} onSelectFolder={(folder) => { logClickEvent('media.folders.open')(); setActiveFolder(folder) }} onCreateFolder={() => { logClickEvent('media.folders.create')(); setIsNewFolderModalOpen(true) }} />

          {/* Breadcrumb — only when inside a folder */}
          {activeFolder && (
            <Breadcrumb activeFolder={activeFolder} onNavigateRoot={() => { logClickEvent('media.breadcrumb.root')(); setActiveFolder(null) }} />
          )}

          {/* Content */}
          {activeFolder ? (
            <section>
              <div className="flex flex-wrap gap-[12px] media-grid">
                <UploadCard onClick={triggerFileInput} isUploading={isUploading} />
                {(isSiteFilesActive ? allSiteFiles : allSiteFiles.filter(({ name }) => currentFolderSlots.includes(name)))
                  .map(({ name, slot }) => (
                    <MediaThumbnail key={name} name={name} slot={slot} previewBaseUrl={previewBaseUrl} folders={moveFolders} onMoveToFolder={(slotName, folderId) => {
                      if (folderId === SITE_FILES_FOLDER.id) {
                        if (activeFolder && !isSiteFilesActive) void removeFromFolder({ folderId: activeFolder.id, slotName })
                        return
                      }
                      void moveToFolder({ folderId, slotName })
                    }} onModify={(slotName) => { logClickEvent('media.editor.open')(); shipAnalyticsLog('media.editor.opened', { appId, slotName, source: 'folder_view' }); setEditorSlotName(slotName); setIsEditorOpen(true) }} onSelect={(n) => { setSelectedSlotName(n); setSelectedUploadId(null); setSelectedGettyUrl(null) }} isSelected={selectedSlotName === name} isInsideFolder={!isSiteFilesActive} onRemoveFromFolder={(slotName) => { logClickEvent('media.folders.remove')(); if (activeFolder) void removeFromFolder({ folderId: activeFolder.id, slotName }) }} />
                  ))}
              </div>
            </section>
          ) : (
            <RecentUploadsSection
              uploads={recentUploads}
              isLoading={uploadsLoading}
              onUploadClick={triggerFileInput}
              isUploading={isUploading}
              limit={showAllUploads ? undefined : RECENT_UPLOADS_LIMIT}
              onShowMore={() => setShowAllUploads(true)}
              hasMore={!showAllUploads && recentUploads.length > RECENT_UPLOADS_LIMIT}
              folders={moveFolders}
              onMoveUploadToFolder={(filename, folderId) => { void handleMoveUploadToFolder(filename, folderId) }}
              onModifyUpload={(file) => {
                void (async () => {
                  try {
                    const slotPath: string = await importAsSlot({ filename: file.filename })
                    await refetch()
                    setEditorSlotName(slotPath)
                    setIsEditorOpen(true)
                  } catch (err) {
                    logger.warn('media_canvas.modify_upload.failed', {
                      appId,
                      filename: file.filename,
                      error: err instanceof Error ? err.message : String(err),
                    })
                    setUploadError('Failed to open editor')
                  }
                })()
              }}
              onSelectUpload={(file) => { setSelectedUploadId(file.id); setSelectedSlotName(null); setSelectedGettyUrl(null) }}
              selectedUploadId={selectedUploadId}
              onDeleteUpload={async (filename) => {
                if (!appId) return
                try {
                  const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)
                  if (!apiConfig.agentUrl) throw new Error('Agent URL not available')
                  const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '')
                  const tokenResult = await regenerateToken({ siteId: appId, force: true })
                  const response = await fetch(`${baseAgentUrl}/media/${appId}/uploads/${encodeURIComponent(filename)}?preserveSlotMedia=true`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${tokenResult.token}` },
                  })
                  if (!response.ok) {
                    if (response.status === 409) {
                      throw new Error('This media is currently in use. Make sure media is not in use before retrying delete.')
                    }
                    const data = await response.json().catch(() => ({ error: 'Failed to delete upload' }))
                    throw new Error(data.error || 'Failed to delete upload')
                  }
                  logClickEvent('media.uploads.delete')(); shipAnalyticsLog('media.upload.deleted', { appId, filename })
                  await Promise.all([refetch(), refetchUploads()])
                } catch (err) {
                  shipAnalyticsLog('media.upload.deleted_failed', { appId, filename, error: err instanceof Error ? err.message : String(err) })
                  logger.error('media_canvas.delete_upload.error', { appId, filename, error: err instanceof Error ? err.message : String(err) })
                  setUploadError(err instanceof Error ? err.message : 'Failed to delete upload')
                }
              }}
            />
          )}

          {/* Getty Results — shown after user searches, regardless of folder context */}
          {appId && gettySearch.hasSearched && (
            <section className="mb-3">
              <h2 className="text-lg font-semibold mb-2">{t('builder_media_canvas_getty_heading', undefined, 'Recommendations by <b>getty</b>images').split(/<b>|<\/b>/).map((part, i) => i === 1 ? <span key={i} className="font-bold">{part}</span> : part)}</h2>
              <GettyResultsGrid
                results={gettySearch.results}
                gettyIds={gettySearch.gettyIds}
                videoUrls={gettySearch.videoUrls}
                isSearching={gettySearch.isSearching}
                hasSearched={gettySearch.hasSearched}
                onSelectResult={(result) => { logClickEvent('media.getty.select')(); setSelectedGettyUrl(result.url); setSelectedSlotName(null); setSelectedUploadId(null) }}
                selectedUrl={selectedGettyUrl}
                hasMore={gettySearch.hasMore}
                isLoadingMore={gettySearch.isLoadingMore}
                onLoadMore={() => { logClickEvent('media.getty.loadmore')(); void gettySearch.loadMore() }}
                folders={gettyTargetFolders}
                onModifyResult={(result) => {
                  logClickEvent('media.editor.open')()
                  shipAnalyticsLog('media.editor.opened', { appId, source: 'getty' })
                  void (async () => {
                    try {
                      const slotPath: string = await importAsSlot({ imageUrl: result.url })
                      await refetch()
                      setEditorSlotName(slotPath)
                      setIsEditorOpen(true)
                    } catch (err) {
                      logger.warn('media_canvas.modify_getty.failed', { appId, error: err instanceof Error ? err.message : String(err) })
                      setUploadError(t('builder_mediaslot_error_fail_use', undefined, 'Failed to open editor'))
                    }
                  })()
                }}
                onMoveResultToFolder={(result, folderId) => {
                  logClickEvent('media.folders.move')()
                  shipAnalyticsLog('media.folder.moved_to', { appId, folderId, source: 'getty' })
                  void (async () => {
                    try {
                      const slotPath: string = await importAsSlot({ imageUrl: result.url })
                      await refetch()
                      if (folderId !== SITE_FILES_FOLDER.id) {
                        await moveToFolder({ folderId, slotName: slotPath })
                      }
                    } catch (err) {
                      logger.warn('media_canvas.move_getty_to_folder.failed', { appId, folderId, error: err instanceof Error ? err.message : String(err) })
                      setUploadError(t('builder_media_canvas_move_to_folder_failed', undefined, 'Media was imported but could not be moved to folder. It is available in Site Files.'))
                    }
                  })()
                }}
                onCreateFolderForResult={async (result, folderName) => {
                  try {
                    const newFolder = await createFolder(folderName)
                    if (!newFolder?.id) {
                      throw new Error('Folder creation did not return an id')
                    }
                    const slotPath: string = await importAsSlot({ imageUrl: result.url })
                    await refetch()
                    await moveToFolder({ folderId: newFolder.id, slotName: slotPath })
                  } catch (err) {
                    logger.warn('media_canvas.create_folder_for_getty.failed', { appId, folderName, error: err instanceof Error ? err.message : String(err) })
                    setUploadError(t('builder_media_canvas_move_to_folder_failed', undefined, 'Media was imported but could not be moved to folder. It is available in Site Files.'))
                  }
                }}
              />
            </section>
          )}

          <input
            type="file"
            ref={fileInputRef}
            accept={acceptString}
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
      </MediaCanvasShell>
  )
}
