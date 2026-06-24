'use client'

import { Play } from 'lucide-react'
import { useRef, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
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
            className="inline-flex items-center gap-[8px] px-3 py-1.5 rounded-[8px] transition-colors text-sm shrink-0 cursor-pointer"
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
      className="w-[160px] h-[160px] rounded-[10px] bg-intents-ux-box-backgroundColor hover:bg-intents-ux-box-backgroundColor/80 transition-colors flex flex-col items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
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
  onSelect?: (name: string) => void
  isSelected?: boolean
}

export function MediaThumbnail({ name, slot, previewBaseUrl, folders, onMoveToFolder, onSelect, isSelected }: MediaThumbnailProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [folderSubmenuOpen, setFolderSubmenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

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
          isSelected ? 'border-2' : 'border-intents-ux-box-borderColor hover:border-intents-ux-ring-borderColor'
        }`}
        style={isSelected ? { borderColor: '#000' } : undefined}
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

      {/* 3-dot menu wrapper */}
      {(folders && onMoveToFolder) && (
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
            <div
              ref={menuRef}
              className="absolute top-full right-0 z-30 min-w-[160px] rounded-md border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor shadow-lg py-1"
            >
              {isImage && (
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-intents-ux-boxLowContrast-backgroundColor text-left"
                >
                  <EditIcon className="size-3.5 text-intents-ux-textSubtle-textColor" />
                  Modify
                </button>
              )}
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
                    {folders.length === 0 ? (
                      <span className="block px-3 py-1.5 text-sm text-intents-ux-textSubtle-textColor">No folders</span>
                    ) : (
                      folders.filter((f) => !f.isVirtual).map((folder) => (
                        <button
                          key={folder.id}
                          type="button"
                          onClick={() => { onMoveToFolder(name, folder.id); setMenuOpen(false); setFolderSubmenuOpen(false) }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-intents-ux-boxLowContrast-backgroundColor text-left"
                        >
                          {folder.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => { setMenuOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-intents-ux-boxLowContrast-backgroundColor text-left text-red-600"
              >
                <TrashIcon className="size-3.5" />
                Delete
              </button>
            </div>
          )}
        </div>
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
  onDelete?: (filename: string) => Promise<void>
}

function UploadThumbnail({ file, isSelected, onSelect, folders, onDelete }: UploadThumbnailProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [folderSubmenuOpen, setFolderSubmenuOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    if (!onDelete) return
    setIsDeleting(true)
    try {
      await onDelete(file.filename)
    } finally {
      setIsDeleting(false)
      setMenuOpen(false)
    }
  }

  return (
    <div className="relative w-[160px] h-[160px] group overflow-visible">
      <div
        onClick={() => onSelect?.(file)}
        className={`w-full h-full overflow-hidden rounded-[10px] bg-intents-ux-box-backgroundColor border transition-colors cursor-pointer ${
          isSelected ? 'border-2' : 'border-intents-ux-box-borderColor hover:border-intents-ux-ring-borderColor'
        }`}
        style={isSelected ? { borderColor: '#000' } : undefined}
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
            {!file.mimeType?.startsWith('video/') && (
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
            <button
              type="button"
              onClick={() => { void handleDelete() }}
              disabled={isDeleting}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-intents-ux-boxLowContrast-backgroundColor text-left text-red-600 disabled:opacity-50"
            >
              <TrashIcon className="size-3.5" />
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        )}
      </div>
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
  onDeleteUpload?: (filename: string) => Promise<void>
}

export function RecentUploadsSection({ uploads, isLoading, onUploadClick, isUploading, limit, onShowMore, hasMore, onSelectUpload, selectedUploadId, folders, onDeleteUpload }: RecentUploadsSectionProps) {
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
  const [folderName, setFolderName] = useState('')

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
      title="Create New Folder"
      onClose={handleClose}
      centered
      actions={
        <Box orientation="horizontal" gap="md">
          <Button design="secondary" text="Cancel" onClick={handleClose} disabled={isCreating} />
          <Button design="primary" text="Save" onClick={handleSave} disabled={!folderName.trim() || isCreating} />
        </Box>
      }
    >
      <div className="space-y-2">
        <label htmlFor="folder-name" className="text-sm font-medium">
          Folder Name
        </label>
        <input
          id="folder-name"
          type="text"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          placeholder="e.g. Site Files"
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
