/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'

import type { MediaFolder } from '@/hooks/useMediaFolders'
import { renderWithProviders } from '@/tests/test-utils'
import { MediaCanvas } from './MediaCanvas'

interface CapturedMediaUploadOptions {
  onFilesUploaded?: (filenames: string[]) => void | Promise<void>
}

interface RecentUploadFileMock {
  id: string
  filename: string
  originalName: string
  mimeType: string | null
  fullSignedUrl?: string
}

interface RecentUploadsSectionMockProps {
  onMoveUploadToFolder?: (filename: string, folderId: string) => void
  onModifyUpload?: (file: RecentUploadFileMock) => void
}

interface FoldersSectionMockProps {
  folders: MediaFolder[]
  onSelectFolder: (folder: MediaFolder) => void
}

interface BreadcrumbMockProps {
  activeFolder: MediaFolder
}

const mediaCanvasMocks = vi.hoisted(() => ({
  importAsSlot: vi.fn(),
  moveToFolder: vi.fn(),
  refetchManifest: vi.fn(),
  refetchUploads: vi.fn(),
}))

let capturedMediaUploadOptions: CapturedMediaUploadOptions | null = null

const customFolder: MediaFolder = {
  id: 'folder-1',
  name: 'Featured',
  slots: [],
  createdAt: '2026-06-26T00:00:00.000Z',
}

const recentUpload: RecentUploadFileMock = {
  id: 'upload-1',
  filename: 'photo.png',
  originalName: 'photo.png',
  mimeType: 'image/png',
}

vi.mock('@/app/[market]/develop/components/preview/media-canvas/GettySearchSection', () => ({
  GettyResultsGrid: () => null,
  useGettySearch: () => ({
    formatFilter: 'all',
    gettyIds: [],
    hasMore: false,
    hasSearched: false,
    isLoadingMore: false,
    isSearching: false,
    loadMore: vi.fn(),
    results: [],
    searchQuery: '',
    setFormatFilter: vi.fn(),
    setSearchQuery: vi.fn(),
    triggerSearch: vi.fn(),
    videoUrls: [],
  }),
}))

vi.mock('@/app/[market]/develop/components/preview/media-canvas/shared', () => ({
  Breadcrumb: ({ activeFolder }: BreadcrumbMockProps) => <div data-testid={`active-folder-${activeFolder.id}`} />,
  FoldersSection: ({ folders, onSelectFolder }: FoldersSectionMockProps) => (
    <div>
      {folders.map((folder: MediaFolder) => (
        <button key={folder.id} type="button" data-testid={`folder-${folder.id}`} onClick={() => onSelectFolder(folder)}>
          {folder.name}
        </button>
      ))}
    </div>
  ),
  MediaThumbnail: () => null,
  NewFolderModal: () => null,
  RecentUploadsSection: ({ onMoveUploadToFolder, onModifyUpload }: RecentUploadsSectionMockProps) => (
    <div>
      <button type="button" data-testid="move-upload" onClick={() => onMoveUploadToFolder?.('photo.png', 'folder-1')} />
      <button type="button" data-testid="move-upload-site-files" onClick={() => onMoveUploadToFolder?.('photo.png', '__site-files__')} />
      <button type="button" data-testid="modify-upload" onClick={() => onModifyUpload?.(recentUpload)} />
    </div>
  ),
  UploadCard: () => <button type="button" data-testid="upload-card" />,
}))

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: () => 'app-123',
}))

vi.mock('@/hooks/useImportAsSlot', () => ({
  useImportAsSlot: () => mediaCanvasMocks.importAsSlot,
}))

vi.mock('@/hooks/useMediaFolders', () => ({
  SITE_FILES_FOLDER: {
    id: '__site-files__',
    name: 'Site Files',
    slots: [],
    createdAt: '2026-06-26T00:00:00.000Z',
  },
  useMediaFolders: () => ({
    createFolder: vi.fn(),
    folders: [customFolder],
    isCreating: false,
    moveToFolder: mediaCanvasMocks.moveToFolder,
    removeFromFolder: vi.fn(),
  }),
}))

vi.mock('@/hooks/useMediaManifest', () => ({
  useMediaManifest: () => ({
    isLoading: false,
    manifest: {},
    refetch: mediaCanvasMocks.refetchManifest,
    slotNames: [],
  }),
}))

vi.mock('@/hooks/useMediaUpload', () => ({
  useMediaUpload: (options: CapturedMediaUploadOptions) => {
    capturedMediaUploadOptions = options
    return {
      acceptString: 'image/png',
      fileInputRef: { current: null },
      handleFileSelect: vi.fn(),
      isUploading: false,
      setUploadError: vi.fn(),
      triggerFileInput: vi.fn(),
      uploadError: null,
    }
  },
}))

vi.mock('@/hooks/useRecentUploads', () => ({
  useRecentUploads: () => ({
    isLoading: false,
    refetch: mediaCanvasMocks.refetchUploads,
    uploads: [recentUpload],
  }),
}))

vi.mock('@/app/[market]/develop/components/media/ImageEditorPanel', () => ({
  ImageEditorPanel: ({ appId, slotName }: { appId: string; slotName: string }) => (
    <div data-testid="image-editor-panel" data-app-id={appId} data-slot-name={slotName} />
  ),
}))

vi.mock('@/lib/request-context', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('@/stores/useServerPollingStore', () => ({
  useServerPollingStore: (selector: (state: { getServerState: () => { url: string } }) => unknown) =>
    selector({ getServerState: () => ({ url: 'https://preview.example.com' }) }),
}))

describe('MediaCanvas slots-only upload orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mediaCanvasMocks.importAsSlot.mockResolvedValue('uploads/photo')
    mediaCanvasMocks.moveToFolder.mockResolvedValue(undefined)
    mediaCanvasMocks.refetchManifest.mockResolvedValue(undefined)
    mediaCanvasMocks.refetchUploads.mockResolvedValue(undefined)
    capturedMediaUploadOptions = null
  })

  it('imports newly uploaded files as slots before moving them into the active folder', async () => {
    const { user } = renderWithProviders(<MediaCanvas />)

    await user.click(screen.getByTestId('folder-folder-1'))
    await waitFor(() => expect(screen.getByTestId('active-folder-folder-1')).toBeInTheDocument())

    await act(async () => {
      await capturedMediaUploadOptions?.onFilesUploaded?.(['photo.png'])
    })

    expect(mediaCanvasMocks.importAsSlot).toHaveBeenCalledWith({ filename: 'photo.png' })
    expect(mediaCanvasMocks.moveToFolder).toHaveBeenCalledWith({ folderId: 'folder-1', slotName: 'uploads/photo' })
    expect(mediaCanvasMocks.refetchManifest).toHaveBeenCalled()
  })

  it('imports a recent upload as a slot before moving it to a folder', async () => {
    const { user } = renderWithProviders(<MediaCanvas />)

    await user.click(screen.getByTestId('move-upload'))

    await waitFor(() => {
      expect(mediaCanvasMocks.moveToFolder).toHaveBeenCalledWith({ folderId: 'folder-1', slotName: 'uploads/photo' })
    })
    expect(mediaCanvasMocks.importAsSlot).toHaveBeenCalledWith({ filename: 'photo.png' })
  })

  it('imports a recent upload as a slot without moving when Site Files is selected', async () => {
    const { user } = renderWithProviders(<MediaCanvas />)

    await user.click(screen.getByTestId('move-upload-site-files'))

    await waitFor(() => {
      expect(mediaCanvasMocks.importAsSlot).toHaveBeenCalledWith({ filename: 'photo.png' })
    })
    expect(mediaCanvasMocks.refetchManifest).toHaveBeenCalled()
    expect(mediaCanvasMocks.moveToFolder).not.toHaveBeenCalled()
  })

  it('imports a recent upload as a slot and opens the inline editor', async () => {
    const { user } = renderWithProviders(<MediaCanvas />)

    await user.click(screen.getByTestId('modify-upload'))

    await waitFor(() => {
      expect(mediaCanvasMocks.importAsSlot).toHaveBeenCalledWith({ filename: 'photo.png' })
    })

    const editor = screen.getByTestId('image-editor-panel')
    expect(editor).toBeInTheDocument()
    expect(editor).toHaveAttribute('data-slot-name', 'uploads/photo')
    expect(editor).toHaveAttribute('data-app-id', 'app-123')
  })
})
