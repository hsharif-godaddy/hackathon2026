/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

import type { MediaFolder } from '@/hooks/useMediaFolders'
import { renderWithProviders } from '@/tests/test-utils'
import { MediaReplacePanel } from './MediaReplacePanel'

const mocks = vi.hoisted(() => ({
  importAsSlot: vi.fn(),
  moveToFolder: vi.fn(),
  createFolder: vi.fn(),
  refetchManifest: vi.fn(),
  refetchUploads: vi.fn(),
  regenerateToken: vi.fn(),
  shipAnalyticsLog: vi.fn(),
}))

const mockLogClickEvent = vi.fn(() => vi.fn())
const mockLogImpressionEvent = vi.fn(() => vi.fn())

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: (...args: unknown[]) => mockLogClickEvent(...args),
  logImpressionEvent: (...args: unknown[]) => mockLogImpressionEvent(...args),
  getInstrumentationAppId: () => undefined,
  getSharedInstrumentationContext: () => ({}),
  normalizedAppId: (id: string) => id,
}))

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: (...args: unknown[]) => mocks.shipAnalyticsLog(...args),
}))

vi.mock('@/app/[market]/develop/components/preview/media-canvas/GettySearchSection', () => ({
  GettyResultsGrid: () => null,
  MediaSearchBar: () => <div data-testid="search-bar" />,
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
    videoUrls: {},
  }),
}))

vi.mock('@/app/[market]/develop/components/preview/media-canvas/shared', () => ({
  Breadcrumb: () => null,
  FoldersSection: ({ folders, onSelectFolder }: { folders: MediaFolder[]; onSelectFolder: (f: MediaFolder) => void }) => (
    <div>
      {folders.map((f: MediaFolder) => (
        <button key={f.id} type="button" data-testid={`folder-${f.id}`} onClick={() => onSelectFolder(f)}>{f.name}</button>
      ))}
    </div>
  ),
  MediaThumbnail: () => null,
  NewFolderModal: () => null,
  RecentUploadsSection: ({ onSelectUpload }: { onSelectUpload?: (file: { id: string; filename: string; originalName: string; mimeType: string | null }) => void }) => (
    <div>
      <button type="button" data-testid="select-upload" onClick={() => onSelectUpload?.({ id: 'u1', filename: 'photo.png', originalName: 'photo.png', mimeType: 'image/png' })} />
    </div>
  ),
  UploadCard: () => null,
}))

vi.mock('@/app/[market]/develop/components/preview/media-canvas/types', () => ({
  ALL_MEDIA_FORMATS: ['image/png'],
  getCategoryForMime: () => 'image',
  IMAGE_FORMATS: ['image/png'],
  MAX_FILES_PER_UPLOAD: 10,
  MAX_SIZE_BY_CATEGORY: { image: 25 * 1024 * 1024, video: 50 * 1024 * 1024, audio: 25 * 1024 * 1024 },
  MediaCategory: { Image: 'image', Video: 'video', Audio: 'audio' },
  VIDEO_FORMATS: ['video/mp4'],
}))

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: () => 'app-123',
}))

vi.mock('@/hooks/useImportAsSlot', () => ({
  useImportAsSlot: () => mocks.importAsSlot,
}))

vi.mock('@/hooks/useMediaFolders', () => ({
  SITE_FILES_FOLDER: { id: '__site-files__', name: 'Site Files', slots: [], createdAt: '2026-01-01T00:00:00.000Z' },
  useMediaFolders: () => ({
    createFolder: mocks.createFolder,
    folders: [{ id: 'folder-1', name: 'Featured', slots: [], createdAt: '2026-01-01T00:00:00.000Z' }],
    isCreating: false,
    moveToFolder: mocks.moveToFolder,
    removeFromFolder: vi.fn(),
  }),
}))

vi.mock('@/hooks/useMediaManifest', () => ({
  useMediaManifest: () => ({
    isLoading: false,
    manifest: {
      'hero-image': { currentUrl: 'https://example.com/hero.jpg', lastUpdated: '2026-01-01T00:00:00.000Z', mediaType: 'image', searchQuery: 'landscape' },
    },
    refetch: mocks.refetchManifest,
    slotNames: ['hero-image'],
  }),
}))

vi.mock('@/hooks/useRecentUploads', () => ({
  useRecentUploads: () => ({
    isLoading: false,
    refetch: mocks.refetchUploads,
    uploads: [{ id: 'u1', filename: 'photo.png', originalName: 'photo.png', mimeType: 'image/png' }],
  }),
}))

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn().mockResolvedValue({ agentUrl: 'https://agent.example.com/apps/app-123' }),
  },
}))

vi.mock('@/lib/jwt-regeneration', () => ({
  regenerateToken: () => mocks.regenerateToken(),
}))

vi.mock('@/lib/request-context', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('@/services/file-upload', () => ({
  uploadImages: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/stores/useMediaSlotDialogStore', () => ({
  useMediaSlotDialogStore: (selector: (state: { openEditorForSlot: null; clearEditorSlot: () => void }) => unknown) =>
    selector({ openEditorForSlot: null, clearEditorSlot: vi.fn() }),
}))

vi.mock('@/stores/useServerPollingStore', () => ({
  useServerPollingStore: (selector: (state: { getServerState: () => { url: string } }) => unknown) =>
    selector({ getServerState: () => ({ url: 'https://preview.example.com' }) }),
}))

vi.mock('@/utils/image-compression', () => ({
  compressImageFiles: vi.fn((files: File[]) => Promise.resolve(files)),
}))

vi.mock('@/utils/postMessage', () => ({
  postMessageToIframe: vi.fn(),
}))

vi.mock('@/app/[market]/develop/components/media/ImageEditorPanel', () => ({
  ImageEditorPanel: () => <div data-testid="image-editor-panel" />,
}))

describe('MediaReplacePanel', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.importAsSlot.mockResolvedValue('slots/hero-image')
    mocks.moveToFolder.mockResolvedValue(undefined)
    mocks.createFolder.mockResolvedValue({ id: 'new-folder-1', name: 'Album', slots: [], createdAt: '2026-01-01T00:00:00.000Z' })
    mocks.refetchManifest.mockResolvedValue(undefined)
    mocks.refetchUploads.mockResolvedValue(undefined)
    mocks.regenerateToken.mockResolvedValue({ token: 'mock-token' })
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
  })

  it('logs media.replace.view impression on mount', () => {
    renderWithProviders(<MediaReplacePanel slotName="hero-image" onClose={onClose} />)
    expect(mockLogImpressionEvent).toHaveBeenCalledWith('media.replace.view')
  })

  it('logs media.replace.start and shipAnalyticsLog on Use this Image click', async () => {
    const { user } = renderWithProviders(<MediaReplacePanel slotName="hero-image" onClose={onClose} />)

    // Select an upload first
    await user.click(screen.getByTestId('select-upload'))

    // Click "Use this Image"
    const useButton = screen.getByRole('button', { name: /use this image/i })
    await user.click(useButton)

    await waitFor(() => {
      expect(mockLogClickEvent).toHaveBeenCalledWith('media.replace.start')
    })
    expect(mocks.shipAnalyticsLog).toHaveBeenCalledWith('media.replace.started', expect.objectContaining({ appId: 'app-123', slotName: 'hero-image', source: 'upload' }))
  })

  it('logs media.replace.complete on successful replace', async () => {
    const { user } = renderWithProviders(<MediaReplacePanel slotName="hero-image" onClose={onClose} />)

    await user.click(screen.getByTestId('select-upload'))
    const useButton = screen.getByRole('button', { name: /use this image/i })
    await user.click(useButton)

    await waitFor(() => {
      expect(mockLogClickEvent).toHaveBeenCalledWith('media.replace.complete')
    })
    expect(mocks.shipAnalyticsLog).toHaveBeenCalledWith('media.replace.completed', expect.objectContaining({ appId: 'app-123', source: 'upload' }))
  })

  it('renders the search bar', () => {
    renderWithProviders(<MediaReplacePanel slotName="hero-image" onClose={onClose} />)
    expect(screen.getByTestId('search-bar')).toBeInTheDocument()
  })

  it('renders the Replace Image header', () => {
    renderWithProviders(<MediaReplacePanel slotName="hero-image" onClose={onClose} />)
    // Translation key renders via useTranslations — check for the key or default
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument()
  })

  it('shows Use this Image button disabled when nothing selected', () => {
    renderWithProviders(<MediaReplacePanel slotName="hero-image" onClose={onClose} />)
    const useButton = screen.getByRole('button', { name: /use this image/i })
    expect(useButton).toBeDisabled()
  })

  it('enables Use this Image button after selecting an upload', async () => {
    const { user } = renderWithProviders(<MediaReplacePanel slotName="hero-image" onClose={onClose} />)
    await user.click(screen.getByTestId('select-upload'))
    const useButton = screen.getByRole('button', { name: /use this image/i })
    expect(useButton).not.toBeDisabled()
  })
})
