'use client'

import '@/app/[market]/develop/components/preview/media-canvas/media-grid.css'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Button from '@ux/button'
import RefreshIcon from '@ux/icon/refresh'

import { ImageEditorPanel } from '@/app/[market]/develop/components/media/ImageEditorPanel'
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
import { useImportAsSlot } from '@/hooks/useImportAsSlot'
import type { MediaFolder } from '@/hooks/useMediaFolders'
import { SITE_FILES_FOLDER, useMediaFolders } from '@/hooks/useMediaFolders'
import { useMediaManifest } from '@/hooks/useMediaManifest'
import { useRecentUploads } from '@/hooks/useRecentUploads'
import { useTranslations } from '@/hooks/useTranslations'
import { regenerateToken } from '@/lib/jwt-regeneration'
import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'
import { uploadImages } from '@/services/file-upload'
import { useMediaSlotDialogStore } from '@/stores/useMediaSlotDialogStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { compressImageFiles } from '@/utils/image-compression'
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation'
import { postMessageToIframe } from '@/utils/postMessage'

const ACCEPT_STRING = ALL_MEDIA_FORMATS.join(',')

interface MediaReplacePanelProps {
  slotName: string
  onClose: () => void
}

export function MediaReplacePanel({ slotName, onClose }: MediaReplacePanelProps) {
  const t = useTranslations()
  const appId = useAppIdFromParams()

  // Track panel open
  useState(() => { logImpressionEvent('media.replace.view')(); shipAnalyticsLog('media.replace_panel.opened', { appId, slotName }) })

  const { manifest, slotNames, refetch } = useMediaManifest({ appId: appId || null })
  const { uploads: recentUploads, isLoading: uploadsLoading, refetch: refetchUploads } = useRecentUploads({ appId: appId || null })
  const { folders, createFolder, isCreating, moveToFolder, removeFromFolder } = useMediaFolders({ appId: appId || null })
  const previewBaseUrl = useServerPollingStore((state) => state.getServerState(appId || ''))?.url || null
  const openEditorForSlot = useMediaSlotDialogStore((state) => state.openEditorForSlot)
  const clearEditorSlot = useMediaSlotDialogStore((state) => state.clearEditorSlot)

  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editorSlotName, setEditorSlotName] = useState<string>(slotName)
  const [activeFolder, setActiveFolder] = useState<MediaFolder | null>(null)
  const [isNewFolderModalOpen, setIsNewFolderModalOpen] = useState(false)
  const [showAllUploads, setShowAllUploads] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isSwapping, setIsSwapping] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const gettyResultsRef = useRef<HTMLElement>(null)
  const prevIsSearchingRef = useRef(false)

  // Selection state
  const [selectedSlotName, setSelectedSlotName] = useState<string | null>(null)
  const [selectedUpload, setSelectedUpload] = useState<RecentUploadFile | null>(null)
  const [selectedGettyResult, setSelectedGettyResult] = useState<GettySearchResult | null>(null)
  const importAsSlot = useImportAsSlot(appId || null)

  const slot = manifest?.[slotName] ?? null

  // Auto-open editor when navigated with openEditor flag
  useEffect(() => {
    if (openEditorForSlot === slotName) {
      setEditorSlotName(slotName)
      setIsEditorOpen(true)
      clearEditorSlot()
    }
  }, [openEditorForSlot, slotName, clearEditorSlot])

  // Determine default format from the slot being replaced
  const defaultFormat: MediaFormatFilter = slot?.mediaType === 'video' ? 'videos' : slot?.mediaType === 'image' ? 'images' : 'all'
  const gettySearch = useGettySearch({
    appId: appId || '',
    initialQuery: slot?.searchQuery || slot?.caption || undefined,
    defaultFormat,
  })

  // Scroll Getty results into view only when a search completes
  useEffect(() => {
    if (prevIsSearchingRef.current && !gettySearch.isSearching && gettySearch.hasSearched) {
      gettyResultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
    prevIsSearchingRef.current = gettySearch.isSearching
  }, [gettySearch.isSearching, gettySearch.hasSearched])

  // All manifest slots for Site Files folder
  const allSiteFiles = useMemo(() => {
    if (!manifest) return [] as { name: string; slot: MediaSlot }[]
    return slotNames
      .map((name) => ({ name, slot: manifest[name] }))
      .filter((entry): entry is { name: string; slot: MediaSlot } => !!entry.slot)
      .sort((a, b) => new Date(b.slot.lastUpdated).getTime() - new Date(a.slot.lastUpdated).getTime())
  }, [manifest, slotNames])

  const allFolders = useMemo(() => [SITE_FILES_FOLDER, ...folders], [folders])
  const moveFolders = useMemo(() => allFolders.filter((f) => f.id !== activeFolder?.id && f.id !== SITE_FILES_FOLDER.id), [allFolders, activeFolder])
  const isSiteFilesActive = activeFolder?.id === SITE_FILES_FOLDER.id
  const currentFolderSlots = useMemo(() => {
    if (!activeFolder || isSiteFilesActive) return []
    const fresh = allFolders.find((f) => f.id === activeFolder.id)
    return fresh?.slots ?? []
  }, [activeFolder, isSiteFilesActive, allFolders])

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

  const handleModifyGetty = useCallback(async (result: GettySearchResult) => {
    try {
      const slotPath: string = await importAsSlot({ imageUrl: result.url })
      await refetch()
      setEditorSlotName(slotPath)
      setIsEditorOpen(true)
    } catch (err) {
      logger.error('media_replace_panel.modify_getty.error', {
        appId,
        imageUrl: result.url,
        error: err instanceof Error ? err.message : String(err),
      })
      setUploadError(err instanceof Error ? err.message : 'Failed to import media')
    }
  }, [appId, importAsSlot, refetch])

  const handleModifyUpload = useCallback(async (file: RecentUploadFile) => {
    try {
      const slotPath: string = await importAsSlot({ filename: file.filename })
      await refetch()
      setEditorSlotName(slotPath)
      setIsEditorOpen(true)
    } catch (err) {
      logger.error('media_replace_panel.modify_upload.error', {
        appId,
        filename: file.filename,
        error: err instanceof Error ? err.message : String(err),
      })
      setUploadError(err instanceof Error ? err.message : 'Failed to import media')
    }
  }, [appId, importAsSlot, refetch])

  const handleMoveGettyToFolder = useCallback(async (result: GettySearchResult, folderId: string) => {
    try {
      const slotPath: string = await importAsSlot({ imageUrl: result.url })
      await refetch()
      if (folderId !== SITE_FILES_FOLDER.id) {
        await moveToFolder({ folderId, slotName: slotPath })
      }
    } catch (err) {
      logger.error('media_replace_panel.move_getty_to_folder.error', {
        appId,
        folderId,
        imageUrl: result.url,
        error: err instanceof Error ? err.message : String(err),
      })
      setUploadError(err instanceof Error ? err.message : 'Failed to move media to folder')
    }
  }, [appId, importAsSlot, refetch, moveToFolder])

  // Create new folder and move item into it
  const handleCreateFolderAndMove = useCallback(async (folderName: string, moveItem: (folderId: string) => Promise<void>) => {
    const newFolder = await createFolder(folderName)
    if (newFolder?.id) {
      await moveItem(newFolder.id)
    }
  }, [createFolder])

  const handleUseImage = useCallback(async () => {
    if (!appId || !slot) return
    logClickEvent('media.replace.start')()
    shipAnalyticsLog('media.replace.started', { appId, slotName, source: selectedUpload ? 'upload' : selectedGettyResult ? 'getty' : 'slot' })

    const forkBody: Record<string, unknown> = { skipFork: true }

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
        const isVideo = !!selectedGettyResult?.videoUrl || !!selectedUpload?.mimeType?.startsWith('video/')
        postMessageToIframe(iframe, { type: 'RELOAD_MEDIA_SLOT', slotPath: slotName, ...(isVideo && { isVideo: true }) })
        postMessageToIframe(iframe, { type: 'CLEAR_SELECTION' })
        // Force iframe reload for cases where HMR doesn't pick up the asset change
        setTimeout(() => {
          postMessageToIframe(iframe, { type: 'RELOAD_MEDIA_SLOT', slotPath: slotName, ...(isVideo && { isVideo: true }) })
        }, 1000)
      }

      logger.info('media_replace_panel.swap.success', { appId, slotName })
      logClickEvent('media.replace.complete')()
      shipAnalyticsLog('media.replace.completed', { appId, slotName, source: selectedUpload ? 'upload' : selectedGettyResult ? 'getty' : 'slot' })
      await refetch()
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
  }, [appId, slotName, slot, selectedUpload, selectedGettyResult, selectedSlotName, manifest])

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0 || !appId) return

    const fileList = Array.from(files)

    if (fileList.length > MAX_FILES_PER_UPLOAD) {
      setUploadError(`Maximum ${MAX_FILES_PER_UPLOAD} files allowed at a time`)
      e.target.value = ''
      return
    }

    // Filter out invalid files — upload what we can
    const validFiles: File[] = []
    const skippedNames: string[] = []

    for (const f of fileList) {
      const category = getCategoryForMime(f.type)
      if (!category) {
        skippedNames.push(f.name)
        continue
      }
      const maxSize = MAX_SIZE_BY_CATEGORY[category]
      if (f.size > maxSize) {
        skippedNames.push(f.name)
        continue
      }
      validFiles.push(f)
    }

    if (validFiles.length === 0) {
      setUploadError(`No valid files to upload. Skipped: ${skippedNames.join(', ')}`)
      e.target.value = ''
      return
    }

    if (skippedNames.length > 0) {
      setUploadError(`Skipped ${skippedNames.length} file(s): ${skippedNames.join(', ')}`)
    } else {
      setUploadError(null)
    }

    setIsUploading(true)

    try {
      const imageFiles = validFiles.filter((f) => f.type.startsWith('image/'))
      const videoFiles = validFiles.filter((f) => f.type.startsWith('video/'))
      const compressed = await compressImageFiles(imageFiles)
      const allFiles = [...compressed, ...videoFiles]

      for (let i = 0; i < allFiles.length; i += 5) {
        const chunk = allFiles.slice(i, i + 5)
        await uploadImages(appId, chunk)
      }

      shipAnalyticsLog('media.upload.completed', { appId, fileCount: allFiles.length, source: 'replace_panel' })
      await Promise.all([refetch(), refetchUploads()])

      // If inside a non-virtual folder, import as slots and move into folder
      if (activeFolder && !isSiteFilesActive && appId) {
        for (const file of allFiles) {
          const slotPath: string = await importAsSlot({ filename: file.name })
          await moveToFolder({ folderId: activeFolder.id, slotName: slotPath })
        }
      }
    } catch (err) {
      logger.error('media_replace_panel.upload.error', {
        appId,
        error: err instanceof Error ? err.message : String(err),
      })
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploading(false)
      e.target.value = ''
    }
  }, [appId, refetch, refetchUploads, activeFolder, isSiteFilesActive, importAsSlot, moveToFolder])

  if (isEditorOpen && appId) {
    return (
      <div className="flex flex-col h-full">
        <ImageEditorPanel
          appId={appId}
          slotName={editorSlotName}
          onDone={() => { setIsEditorOpen(false); void Promise.all([refetch(), refetchUploads()]) }}
          onCancel={() => setIsEditorOpen(false)}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full media-replace-panel rounded-2xl overflow-hidden" style={{ containerType: 'inline-size' }}>
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {/* Header — inline with X */}
        <div className="flex items-center mb-2">
          <h2 className="text-base font-semibold">{t('builder_media_replace_image_title')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto w-[36px] h-[36px] flex items-center justify-center shrink-0 hover:opacity-70 transition-opacity"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" stroke="#000" strokeWidth="1.5" fill="none">
              <line x1="2" y1="2" x2="12" y2="12" />
              <line x1="12" y1="2" x2="2" y2="12" />
            </svg>
          </button>
        </div>

        {uploadError && (
          <p className="mb-2 text-xs" style={{ color: '#dc2626' }}>{uploadError}</p>
        )}

        {/* Search bar + format filter */}
        {appId && (
          <MediaSearchBar
            query={gettySearch.searchQuery}
            onQueryChange={gettySearch.setSearchQuery}
            onSearch={() => { shipAnalyticsLog('media.search.triggered', { appId, query: gettySearch.searchQuery, format: gettySearch.formatFilter, source: 'replace_panel' }); void gettySearch.triggerSearch() }}
            isSearching={gettySearch.isSearching}
            formatFilter={gettySearch.formatFilter}
            onFormatChange={gettySearch.setFormatFilter}
          />
        )}

        {/* Folders */}
        {!activeFolder && (
          <FoldersSection folders={allFolders} onSelectFolder={setActiveFolder} onCreateFolder={() => setIsNewFolderModalOpen(true)} />
        )}

        {/* Breadcrumb — only shown when inside a folder */}
        {activeFolder && (
          <Breadcrumb activeFolder={activeFolder} onNavigateRoot={() => setActiveFolder(null)} />
        )}

        {/* Recent Uploads (or folder content) */}
        {activeFolder ? (
          <div className="flex flex-wrap gap-[12px] media-grid mb-6">
            <UploadCard onClick={handleUploadClick} isUploading={isUploading} />
            {(isSiteFilesActive ? allSiteFiles : allSiteFiles.filter(({ name }) => currentFolderSlots.includes(name)))
              .map(({ name, slot: s }) => (
                <MediaThumbnail
                  key={name}
                  name={name}
                  slot={s}
                  previewBaseUrl={previewBaseUrl}
                  folders={moveFolders}
                  onMoveToFolder={(slotName, folderId) => {
                    if (folderId === SITE_FILES_FOLDER.id) {
                      if (activeFolder && !isSiteFilesActive) void removeFromFolder({ folderId: activeFolder.id, slotName })
                      return
                    }
                    void moveToFolder({ folderId, slotName })
                  }}
                  onCreateFolder={async (slotName, folderName) => {
                    await handleCreateFolderAndMove(folderName, async (folderId) => {
                      void moveToFolder({ folderId, slotName })
                    })
                  }}
                  onModify={(slotToEdit) => { setEditorSlotName(slotToEdit); setIsEditorOpen(true) }}
                  onSelect={handleSelectSlot}
                  isSelected={selectedSlotName === name}
                  isInsideFolder={!isSiteFilesActive && !!activeFolder}
                  onRemoveFromFolder={(slotName) => { if (activeFolder) void removeFromFolder({ folderId: activeFolder.id, slotName }) }}
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
            folders={moveFolders}
            onModifyUpload={(file) => { void handleModifyUpload(file) }}
            onMoveUploadToFolder={(filename, folderId) => {
              void (async () => {
                try {
                  const slotPath: string = await importAsSlot({ filename })
                  await refetch()
                  if (folderId !== SITE_FILES_FOLDER.id) {
                    await moveToFolder({ folderId, slotName: slotPath })
                  }
                } catch (err) {
                  logger.error('media_replace_panel.move_upload_to_folder.error', {
                    appId,
                    filename,
                    folderId,
                    error: err instanceof Error ? err.message : String(err),
                  })
                  setUploadError(err instanceof Error ? err.message : 'Failed to move upload to folder')
                }
              })()
            }}
            onCreateFolderForUpload={async (filename, folderName) => {
              try {
                await handleCreateFolderAndMove(folderName, async (folderId) => {
                  const slotPath: string = await importAsSlot({ filename })
                  await moveToFolder({ folderId, slotName: slotPath })
                })
              } catch (err) {
                logger.error('media_replace_panel.create_folder_for_upload.error', {
                  appId,
                  filename,
                  folderName,
                  error: err instanceof Error ? err.message : String(err),
                })
                setUploadError(err instanceof Error ? err.message : 'Failed to move upload to folder')
              }
            }}
            onDeleteUpload={async (filename) => {
              if (!appId) return
              try {
                const tokenResult = await regenerateToken({ siteId: appId, force: true })
                const apiConfig = await dynamicApiConfigService.getConfigForSite(appId)
                if (!apiConfig.agentUrl) return
                const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '')
                const response = await fetch(`${baseAgentUrl}/media/${appId}/uploads/${encodeURIComponent(filename)}?preserveSlotMedia=true`, {
                  method: 'DELETE',
                  headers: { Authorization: `Bearer ${tokenResult.token}` },
                })
                if (!response.ok) {
                  if (response.status === 409) {
                    setUploadError('This media is currently in use. Make sure media is not used before retrying delete.')
                    return
                  }
                  const data = await response.json().catch(() => ({ error: 'Failed to delete upload' }))
                  setUploadError(data.error || 'Failed to delete upload')
                  return
                }
                await Promise.all([refetch(), refetchUploads()])
              } catch (err) {
                setUploadError(err instanceof Error ? err.message : 'Failed to delete upload')
              }
            }}
          />
        )}

        {/* Recommendations by Getty Images — shown when searched, even inside folders */}
        {appId && gettySearch.hasSearched && (
          <section className="mb-6" ref={gettyResultsRef}>
            <h2 className="text-lg font-semibold mb-3">{t('builder_media_canvas_getty_heading', undefined, 'Recommendations by <b>getty</b>images').split(/<b>|<\/b>/).map((part, i) => i === 1 ? <span key={i} className="font-bold">{part}</span> : part)}</h2>
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
              folders={moveFolders}
              onModifyResult={(result) => { void handleModifyGetty(result) }}
              onMoveResultToFolder={(result, folderId) => { void handleMoveGettyToFolder(result, folderId) }}
              onCreateFolderForResult={async (result, folderName) => {
                try {
                  await handleCreateFolderAndMove(folderName, async (folderId) => {
                    await handleMoveGettyToFolder(result, folderId)
                  })
                } catch (err) {
                  logger.error('media_replace_panel.create_folder_for_result.error', {
                    appId,
                    folderName,
                    imageUrl: result.url,
                    error: err instanceof Error ? err.message : String(err),
                  })
                  setUploadError(err instanceof Error ? err.message : 'Failed to move media to folder')
                }
              }}
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
          text={isSwapping ? t('builder_mediaslot_swapping', undefined, 'Replacing...') : (selectedGettyResult?.videoUrl || selectedUpload?.mimeType?.startsWith('video/')) ? t('builder_mediaslot_use_vid', undefined, 'Use this Video') : t('builder_mediaslot_use_image', undefined, 'Use this Image')}
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
