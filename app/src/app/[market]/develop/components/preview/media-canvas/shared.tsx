'use client'

import { Play } from 'lucide-react'
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import CheckmarkIcon from '@ux/icon/checkmark'
import ChevronRightIcon from '@ux/icon/chevron-right'
import EditIcon from '@ux/icon/edit'
import FolderIcon from '@ux/icon/folder'
import PlusIcon from '@ux/icon/plus'
import TrashIcon from '@ux/icon/trash'
import Modal from '@ux/modal'
import Select from '@ux/select'

import { getPreviewOrigin } from '@/app/[market]/develop/components/media/slotImageUrl'
import type { MediaSlot } from '@/app/[market]/develop/components/media/types'
import { LogoShimmer, logoShimmerOrientation, LogoShimmerOverlay } from '@/app/[market]/develop/components/preview/brand-book/LogoShimmer'
import type { MediaFolder } from '@/hooks/useMediaFolders'
import { useTranslations } from '@/hooks/useTranslations'

// ─── Selected Checkmark ─────────────────────────────────────────────────────────

const THUMBNAIL_MENU_CLOSE_DELAY_MS: number = 120
const THUMBNAIL_MENU_MIN_WIDTH_PX: number = 160

interface HorizontalBounds {
  left: number
  right: number
}

function getMenuClipBounds(element: HTMLElement): HorizontalBounds {
  let current: HTMLElement | null = element.parentElement
  while (current) {
    const style: CSSStyleDeclaration = window.getComputedStyle(current)
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
      const rect: DOMRect = current.getBoundingClientRect()
      return { left: rect.left, right: rect.right }
    }
    current = current.parentElement
  }
  return { left: 0, right: window.innerWidth }
}

export function SelectedCheckmark(): ReactElement {
  return (
    <div className="absolute bottom-1 right-1 z-10 w-[24px] h-[24px] rounded-full flex items-center justify-center" style={{ backgroundColor: '#000' }}>
      <CheckmarkIcon className="size-3.5 text-intents-ux-box-backgroundColor" />
    </div>
  )
}

// ─── Thumbnail Menu (shared 3-dot dropdown) ─────────────────────────────────────

interface ThumbnailMenuProps {
  showModify?: boolean
  onModify?: () => void
  folders?: MediaFolder[]
  /** When provided, folder items are clickable (slot-based move) */
  onMoveToFolder?: (folderId: string) => void
  /** Label for the folder action button (default uses media library translation) */
  folderLabel?: string
  /** When provided, shows "New Folder" at the end of the folder submenu. Called with folder name; parent should create folder and move item. */
  onCreateFolder?: (name: string) => void | Promise<void>
  showDelete?: boolean
  onDelete?: () => void
  isDeleting?: boolean
  /** Show "Remove from Folder" instead of Delete (used when inside a folder) */
  showRemoveFromFolder?: boolean
  onRemoveFromFolder?: () => void
}

export function ThumbnailMenu({ showModify, onModify, folders, onMoveToFolder, folderLabel, onCreateFolder, showDelete, onDelete, isDeleting, showRemoveFromFolder, onRemoveFromFolder }: ThumbnailMenuProps) {
  const t = useTranslations()
  const [menuOpen, setMenuOpen] = useState(false)
  const [folderSubmenuOpen, setFolderSubmenuOpen] = useState(false)
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [isMenuAlignedLeft, setIsMenuAlignedLeft] = useState(false)
  const menuContainerRef = useRef<HTMLDivElement | null>(null)
  const closeMenuTimerRef = useRef<number | null>(null)

  const allFolderItems = folders ?? []
  const moveToFolderLabel: string = folderLabel ?? t('builder_media_canvas_move_to_folder', undefined, 'Move to Folder')
  const modifyLabel: string = t('builder_mediaslot_modify', undefined, 'Modify')
  const folderNamePlaceholder: string = t('builder_media_canvas_folder_name_placeholder', undefined, 'Folder name')
  const newFolderLabel: string = t('builder_media_canvas_new_folder', undefined, 'New Folder')
  const deleteLabel: string = t('builder_common_delete', undefined, 'Delete')
  const deletingLabel: string = t('builder_common_deleting', undefined, 'Deleting...')
  const removeFromFolderLabel: string = t('builder_media_canvas_remove_from_folder', undefined, 'Remove from Folder')
  const optionsLabel: string = t('builder_common_options', undefined, 'Options')

  const clearCloseMenuTimer = useCallback((): void => {
    if (closeMenuTimerRef.current === null) return
    window.clearTimeout(closeMenuTimerRef.current)
    closeMenuTimerRef.current = null
  }, [])

  const resetMenuState = useCallback((): void => {
    setMenuOpen(false)
    setFolderSubmenuOpen(false)
    setIsCreatingFolder(false)
    setNewFolderName('')
  }, [])

  const closeMenu = useCallback((): void => {
    clearCloseMenuTimer()
    resetMenuState()
  }, [clearCloseMenuTimer, resetMenuState])

  const scheduleCloseMenu = useCallback((): void => {
    clearCloseMenuTimer()
    closeMenuTimerRef.current = window.setTimeout((): void => {
      closeMenuTimerRef.current = null
      resetMenuState()
    }, THUMBNAIL_MENU_CLOSE_DELAY_MS)
  }, [clearCloseMenuTimer, resetMenuState])

  const updateMenuPlacement = useCallback((): void => {
    if (!menuContainerRef.current) return
    const triggerRect: DOMRect = menuContainerRef.current.getBoundingClientRect()
    const clipBounds: HorizontalBounds = getMenuClipBounds(menuContainerRef.current)
    const alignMenuLeft: boolean = triggerRect.right - THUMBNAIL_MENU_MIN_WIDTH_PX < clipBounds.left
    setIsMenuAlignedLeft(alignMenuLeft)
  }, [])

  useEffect((): (() => void) => {
    return () => clearCloseMenuTimer()
  }, [clearCloseMenuTimer])

  return (
    <div
      ref={menuContainerRef}
      className="absolute top-0.5 right-0.5 z-20"
      onMouseEnter={clearCloseMenuTimer}
      onMouseLeave={scheduleCloseMenu}
    >
      <button
        type="button"
        aria-label={optionsLabel}
        onClick={(e) => {
          e.stopPropagation()
          if (menuOpen) {
            closeMenu()
            return
          }
          clearCloseMenuTimer()
          updateMenuPlacement()
          setMenuOpen(true)
        }}
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
        <div data-media-dropdown className={`absolute top-full ${isMenuAlignedLeft ? 'left-0' : 'right-0'} z-30 w-[220px] max-w-[calc(100vw-24px)] rounded-md border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor shadow-lg py-1`}>
          {showModify && (
            <button
              type="button"
              onClick={() => { onModify?.(); closeMenu() }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left whitespace-nowrap overflow-hidden"
              style={{ backgroundColor: 'transparent' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.06)' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
            >
              <EditIcon className="size-3.5 text-intents-ux-textSubtle-textColor shrink-0" />
              <span className="min-w-0 truncate">{modifyLabel}</span>
            </button>
          )}
          {(allFolderItems.length > 0 || onCreateFolder) && (
            <div className="relative">
              <button
                type="button"
                aria-expanded={folderSubmenuOpen}
                onClick={(e) => {
                  e.stopPropagation()
                  clearCloseMenuTimer()
                  setIsCreatingFolder(false)
                  setNewFolderName('')
                  setFolderSubmenuOpen((open) => !open)
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left whitespace-nowrap overflow-hidden"
                style={{ backgroundColor: 'transparent' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.06)' }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
              >
                <FolderIcon className="size-3.5 text-intents-ux-textSubtle-textColor shrink-0" />
                <span className="min-w-0 truncate">{moveToFolderLabel}</span>
                <ChevronRightIcon className={`size-3 ml-auto text-intents-ux-textSubtle-textColor shrink-0 transition-transform ${folderSubmenuOpen ? 'rotate-90' : ''}`} />
              </button>
              {folderSubmenuOpen && (
                <div className="mt-1 border-t border-intents-ux-box-borderColor py-1">
                  {allFolderItems.map((folder) => (
                    onMoveToFolder ? (
                      <button
                        key={folder.id}
                        type="button"
                        onClick={() => { onMoveToFolder(folder.id); closeMenu() }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left whitespace-nowrap overflow-hidden"
                        style={{ backgroundColor: 'transparent' }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.06)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                      >
                        <span className="min-w-0 truncate">{folder.name}</span>
                      </button>
                    ) : (
                      <span
                        key={folder.id}
                        className="block px-3 py-1.5 text-sm text-intents-ux-textSubtle-textColor cursor-default whitespace-nowrap overflow-hidden text-ellipsis"
                      >
                        {folder.name}
                      </span>
                    )
                  ))}
                  {onCreateFolder && (
                    <>
                      {allFolderItems.length > 0 && <div className="border-t border-intents-ux-box-borderColor my-1" />}
                      {isCreatingFolder ? (
                        <div className="px-3 py-1.5">
                          <input
                            type="text"
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && newFolderName.trim()) {
                                void Promise.resolve(onCreateFolder(newFolderName.trim())).then(() => {
                                  closeMenu()
                                })
                              }
                            }}
                            placeholder={folderNamePlaceholder}
                            className="w-full min-w-0 text-sm border border-intents-ux-box-borderColor rounded px-1.5 py-0.5"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); clearCloseMenuTimer(); setIsCreatingFolder(true) }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left whitespace-nowrap overflow-hidden"
                          style={{ backgroundColor: 'transparent' }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.06)' }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                        >
                          <PlusIcon className="size-3.5 text-intents-ux-textSubtle-textColor shrink-0" />
                          <span className="min-w-0 truncate">{newFolderLabel}</span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          {showDelete && (
            <button
              type="button"
              onClick={() => { onDelete?.(); closeMenu() }}
              disabled={isDeleting}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-red-600 disabled:opacity-50 whitespace-nowrap overflow-hidden"
              style={{ backgroundColor: 'transparent' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.06)' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
            >
              <TrashIcon className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">{isDeleting ? deletingLabel : deleteLabel}</span>
            </button>
          )}
          {showRemoveFromFolder && (
            <button
              type="button"
              onClick={() => { onRemoveFromFolder?.(); closeMenu() }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left whitespace-nowrap overflow-hidden"
              style={{ backgroundColor: 'transparent' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.06)' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
            >
              <FolderIcon className="size-3.5 text-intents-ux-textSubtle-textColor shrink-0" />
              <span className="min-w-0 truncate">{removeFromFolderLabel}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Folders Section ────────────────────────────────────────────────────────────

interface FoldersSectionProps {
  folders: MediaFolder[]
  onSelectFolder: (folder: MediaFolder) => void
}

export function FoldersSection({ folders, onSelectFolder }: FoldersSectionProps) {
  return (
    <section className="mb-1">
      <h2 className="text-lg font-semibold mb-1">Folders</h2>
      <div className="flex gap-2 overflow-x-auto pb-0">
        {folders.map((folder) => (
          <button
            key={folder.id}
            type="button"
            onClick={() => onSelectFolder(folder)}
            className="media-folder-pill inline-flex items-center gap-[8px] px-3 py-1.5 rounded-[8px] transition-colors text-sm shrink-0 cursor-pointer"
            style={{ backgroundColor: 'rgba(230, 233, 236, 1)' }}
          >
            <FolderIcon className="size-3.5 text-intents-ux-textSubtle-textColor" />
            <span>{folder.name}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

// ─── Breadcrumb ─────────────────────────────────────────────────────────────────

interface BreadcrumbProps {
  activeFolder: MediaFolder | null
  onNavigateRoot: () => void
  rootLabel?: string
}

export function Breadcrumb({ activeFolder, onNavigateRoot, rootLabel = 'My Library' }: BreadcrumbProps) {
  return (
    <nav className="flex items-center gap-1 mb-2">
      <button
        type="button"
        onClick={onNavigateRoot}
        className={activeFolder
          ? 'text-lg font-semibold text-intents-ux-link-textColor hover:underline cursor-pointer'
          : 'text-lg font-semibold text-intents-ux-text-textColor cursor-default'}
      >
        {rootLabel}
      </button>
      {activeFolder && (
        <>
          <ChevronRightIcon className="size-4 text-intents-ux-textSubtle-textColor" />
          <span className="text-lg font-semibold text-intents-ux-text-textColor">{activeFolder.name}</span>
        </>
      )}
    </nav>
  )
}

// ─── Upload Card ────────────────────────────────────────────────────────────────

interface UploadCardProps {
  onClick: () => void
  isUploading: boolean
}

export function UploadCard({ onClick, isUploading }: UploadCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isUploading}
      className="w-[160px] h-[160px] rounded-[10px] bg-intents-ux-boxLowContrast-backgroundColor hover:bg-intents-ux-box-borderColor active:bg-intents-ux-box-borderColor transition-colors flex flex-col items-center justify-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      style={{ border: '2px dashed #9ca3af' }}
    >
      {isUploading ? (
        <div className="size-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#000', borderTopColor: 'transparent' }} />
      ) : (
        <PlusIcon className="size-4.5 text-intents-ux-textSubtle-textColor" />
      )}
      <span className="text-xs text-intents-ux-textSubtle-textColor">
        {isUploading ? 'Uploading...' : 'Upload'}
      </span>
    </button>
  )
}

// ─── Media Thumbnail ────────────────────────────────────────────────────────────

interface MediaThumbnailProps {
  name: string
  slot: MediaSlot
  previewBaseUrl: string | null
  folders?: MediaFolder[]
  onMoveToFolder?: (slotName: string, folderId: string) => void
  onCreateFolder?: (slotName: string, folderName: string) => void | Promise<void>
  onModify?: (slotName: string) => void
  onDelete?: (slotName: string) => void
  onSelect?: (name: string) => void
  isSelected?: boolean
  /** When true, shows "Remove from Folder" instead of Delete */
  isInsideFolder?: boolean
  onRemoveFromFolder?: (slotName: string) => void
}

export function MediaThumbnail({ name, slot, previewBaseUrl, folders, onMoveToFolder, onCreateFolder, onModify, onDelete, onSelect, isSelected, isInsideFolder, onRemoveFromFolder }: MediaThumbnailProps) {
  const isPending = !!slot.pendingJobId
  const priorLogoUrl =
    isPending && slot.currentUrl &&
    (slot.currentUrl.startsWith('http://') || slot.currentUrl.startsWith('https://'))
      ? slot.currentUrl
      : undefined

  const isVideo = slot.mediaType === 'video'
  const isImage = slot.mediaType === 'image' || slot.mediaType === 'generated' || slot.mediaType === 'logo'
  const displayUrl = isVideo ? slot.currentUrl : (slot.thumbnailUrl || slot.currentUrl)
  const assetPrefix = isVideo ? '/airo-assets/videos/' : '/airo-assets/images/'
  const proxiedUrl = previewBaseUrl && displayUrl
    ? displayUrl.startsWith('http://') || displayUrl.startsWith('https://')
      ? displayUrl
      : displayUrl.startsWith('/airo-assets/uploads/')
        ? `${getPreviewOrigin(previewBaseUrl)}${displayUrl}`
        : `${getPreviewOrigin(previewBaseUrl)}${assetPrefix}${name}?src=${encodeURIComponent(displayUrl)}`
    : displayUrl
  const posterUrl = isVideo && slot.thumbnailUrl ? slot.thumbnailUrl : undefined

  return (
    <div className="relative w-[160px] h-[160px] group overflow-visible">
      <div
        onClick={() => onSelect?.(name)}
        className={`w-full h-full overflow-hidden rounded-[10px] bg-intents-ux-box-backgroundColor border transition-colors cursor-pointer ${
          isSelected ? 'border-transparent' : 'border-intents-ux-box-borderColor hover:border-intents-ux-ring-borderColor'
        }`}
        style={isSelected ? { outline: '2px solid #000', outlineOffset: '1px' } : undefined}
      >
        {isPending ? (
          priorLogoUrl ? (
            <div className="relative w-full h-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={priorLogoUrl}
                alt=""
                className="w-full h-full object-contain opacity-60"
                loading="lazy"
              />
              <LogoShimmerOverlay />
            </div>
          ) : (
            <LogoShimmer className="w-full h-full" orientation={logoShimmerOrientation(name)} />
          )
        ) : isVideo ? (
          <div className="relative w-full h-full">
            <video
              src={proxiedUrl}
              poster={posterUrl}
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
            src={proxiedUrl}
            alt=""
            className={`w-full h-full ${slot.mediaType === 'logo' ? 'object-contain' : 'object-cover'}`}
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        )}
      </div>

      {isSelected && <SelectedCheckmark />}

      {/* 3-dot menu */}
      {(folders && onMoveToFolder) && (
        <ThumbnailMenu
          showModify={isImage}
          onModify={() => onModify?.(name)}
          folders={folders}
          onMoveToFolder={(folderId) => onMoveToFolder(name, folderId)}
          onCreateFolder={onCreateFolder ? (folderName) => onCreateFolder(name, folderName) : undefined}
          showDelete={!isInsideFolder && !!onDelete}
          onDelete={() => onDelete?.(name)}
          showRemoveFromFolder={isInsideFolder}
          onRemoveFromFolder={() => onRemoveFromFolder?.(name)}
        />
      )}
    </div>
  )
}

// ─── Upload Thumbnail with 3-dot Menu ───────────────────────────────────────────

interface UploadThumbnailProps {
  file: RecentUploadFile
  isSelected: boolean
  onSelect?: (file: RecentUploadFile) => void
  folders?: MediaFolder[]
  onMoveToFolder?: (filename: string, folderId: string) => void
  onCreateFolder?: (filename: string, folderName: string) => void | Promise<void>
  onModify?: (file: RecentUploadFile) => void
  onDelete?: (filename: string) => Promise<void>
}

function UploadThumbnail({ file, isSelected, onSelect, folders, onMoveToFolder, onCreateFolder, onModify, onDelete }: UploadThumbnailProps) {
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    if (!onDelete) return
    setIsDeleting(true)
    try {
      await onDelete(file.filename)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="relative w-[160px] h-[160px] group overflow-visible">
      <div
        onClick={() => onSelect?.(file)}
        className={`w-full h-full overflow-hidden rounded-[10px] bg-intents-ux-box-backgroundColor border transition-colors cursor-pointer ${
          isSelected ? 'border-transparent' : 'border-intents-ux-box-borderColor hover:border-intents-ux-ring-borderColor'
        }`}
        style={isSelected ? { outline: '2px solid #000', outlineOffset: '1px' } : undefined}
      >
        {file.fullSignedUrl ? (
          file.mimeType?.startsWith('video/') ? (
            <video src={file.fullSignedUrl} className="w-full h-full object-cover" muted autoPlay loop playsInline preload="metadata" />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={file.fullSignedUrl} alt={file.originalName} className="w-full h-full object-cover" loading="lazy" />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-intents-ux-textSubtle-textColor p-2 text-center">
            {file.originalName}
          </div>
        )}
      </div>

      {isSelected && <SelectedCheckmark />}

      <ThumbnailMenu
        showModify={!file.mimeType?.startsWith('video/') && !!onModify}
        onModify={() => onModify?.(file)}
        folders={folders}
        onMoveToFolder={onMoveToFolder ? (folderId) => onMoveToFolder(file.filename, folderId) : undefined}
        onCreateFolder={onCreateFolder ? (folderName) => onCreateFolder(file.filename, folderName) : undefined}
        showDelete
        onDelete={() => { void handleDelete() }}
        isDeleting={isDeleting}
      />
    </div>
  )
}

// ─── Recent Uploads Section ─────────────────────────────────────────────────────

export interface RecentUploadFile {
  id: string
  filename: string
  originalName: string
  mimeType: string | null
  fullSignedUrl?: string
}

interface RecentUploadsSectionProps {
  uploads: RecentUploadFile[]
  isLoading: boolean
  onUploadClick: () => void
  isUploading: boolean
  limit?: number
  onShowMore?: () => void
  hasMore?: boolean
  onSelectUpload?: (file: RecentUploadFile) => void
  selectedUploadId?: string | null
  folders?: MediaFolder[]
  onMoveUploadToFolder?: (filename: string, folderId: string) => void
  onCreateFolderForUpload?: (filename: string, folderName: string) => void | Promise<void>
  onModifyUpload?: (file: RecentUploadFile) => void
  onDeleteUpload?: (filename: string) => Promise<void>
}

export function RecentUploadsSection({ uploads, isLoading, onUploadClick, isUploading, limit, onShowMore, hasMore, onSelectUpload, selectedUploadId, folders, onMoveUploadToFolder, onCreateFolderForUpload, onModifyUpload, onDeleteUpload }: RecentUploadsSectionProps) {
  if (isLoading) {
    return (
      <section>
        <h2 className="text-lg font-semibold mb-2">Recent Uploads</h2>
        <div className="flex flex-wrap gap-[12px] media-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="w-[160px] h-[160px] rounded-[10px] bg-intents-ux-box-borderColor animate-pulse" />
          ))}
        </div>
      </section>
    )
  }

  const visibleUploads = limit ? uploads.slice(0, limit) : uploads

  return (
    <section className="mb-3">
      <h2 className="text-lg font-semibold mb-2">Recent Uploads</h2>
      <div className="flex flex-wrap gap-[12px] media-grid">
        <UploadCard onClick={onUploadClick} isUploading={isUploading} />
        {visibleUploads.map((file) => (
          <UploadThumbnail
            key={file.id}
            file={file}
            isSelected={selectedUploadId === file.id}
            onSelect={onSelectUpload}
            folders={folders}
            onMoveToFolder={onMoveUploadToFolder}
            onCreateFolder={onCreateFolderForUpload}
            onModify={onModifyUpload}
            onDelete={onDeleteUpload}
          />
        ))}
        {hasMore && onShowMore && (
          <button
            type="button"
            onClick={onShowMore}
            className="w-[160px] h-[160px] rounded-[10px] border border-intents-ux-box-borderColor bg-intents-ux-boxLowContrast-backgroundColor hover:bg-intents-ux-box-borderColor transition-colors flex items-center justify-center cursor-pointer text-sm text-intents-ux-textSubtle-textColor"
          >
            View More
          </button>
        )}
      </div>
    </section>
  )
}

// ─── New Folder Modal ───────────────────────────────────────────────────────────

interface NewFolderModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (name: string) => void
  isCreating: boolean
}

export function NewFolderModal({ isOpen, onClose, onSave, isCreating }: NewFolderModalProps) {
  const t = useTranslations()
  const [folderName, setFolderName] = useState('')
  const title: string = t('builder_media_canvas_create_new_folder', undefined, 'Create New Folder')
  const cancelLabel: string = t('builder_common_cancel', undefined, 'Cancel')
  const saveLabel: string = t('builder_common_save', undefined, 'Save')
  const folderNameLabel: string = t('builder_media_canvas_folder_name_label', undefined, 'Folder Name')
  const folderNameExample: string = t('builder_media_canvas_folder_name_example', undefined, 'e.g. Site Files')

  const handleSave = () => {
    if (!folderName.trim()) return
    onSave(folderName.trim())
    setFolderName('')
  }

  const handleClose = () => {
    setFolderName('')
    onClose()
  }

  if (!isOpen) return null

  return (
    <Modal
      title={title}
      onClose={handleClose}
      centered
      actions={
        <Box orientation="horizontal" gap="md">
          <Button design="secondary" text={cancelLabel} onClick={handleClose} disabled={isCreating} />
          <Button design="primary" text={saveLabel} onClick={handleSave} disabled={!folderName.trim() || isCreating} />
        </Box>
      }
    >
      <div className="space-y-2">
        <label htmlFor="folder-name" className="text-sm font-medium">
          {folderNameLabel}
        </label>
        <input
          id="folder-name"
          type="text"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          placeholder={folderNameExample}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && folderName.trim()) handleSave()
          }}
          autoFocus
          maxLength={100}
          className="w-full px-3 py-2 border rounded-md bg-intents-ux-box-backgroundColor border-intents-ux-box-borderColor"
        />
      </div>
    </Modal>
  )
}

// ─── Skeleton Grid ──────────────────────────────────────────────────────────────

export function MediaGridSkeleton() {
  return (
    <div className="flex flex-wrap gap-[12px]">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="w-[160px] h-[160px] rounded-[10px] bg-intents-ux-box-borderColor animate-pulse" />
      ))}
    </div>
  )
}
