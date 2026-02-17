import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'

import { mockInstrumentation } from '@/tests/mocks'
import { renderWithProviders } from '@/tests/test-utils'
import { MediaSlotDialog } from './MediaSlotDialog'

// Mock external dependencies
vi.mock('@/utils/instrumentation', () => mockInstrumentation())
vi.mock('@/lib/request-context', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}))

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLProps<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
}))

// Mock createPortal
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom')
  return {
    ...actual,
    createPortal: (children: React.ReactNode) => children,
  }
})

// Mock the store
const mockCloseDialog = vi.fn()
vi.mock('@/stores/useMediaSlotDialogStore', () => ({
  useMediaSlotDialogStore: vi.fn(() => ({
    isOpen: true,
    slotName: 'pages/home/hero',
    appId: 'test-app',
    closeDialog: mockCloseDialog,
  })),
}))

// Mock the useMediaSlot hook
vi.mock('@/hooks/useMediaSlot', () => ({
  useMediaSlot: vi.fn(() => ({
    slot: {
      mediaType: 'image',
      currentUrl: 'https://media.gettyimages.com/current.jpg',
      alternatives: ['https://media.gettyimages.com/alt1.jpg'],
      searchQuery: 'hero image',
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  })),
}))

// Mock jwt-regeneration
vi.mock('@/lib/jwt-regeneration', () => ({
  regenerateToken: vi.fn().mockResolvedValue({ token: 'test-token' }),
}))

// Mock dynamic-api
vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn().mockResolvedValue({ agentUrl: 'http://localhost:4000' }),
  },
}))

// Mock postMessage
vi.mock('@/utils/postMessage', () => ({
  postMessageToIframe: vi.fn(),
}))

// Mock UploadedImagesSection to avoid additional fetch calls in tests
vi.mock('./UploadedImagesSection', () => ({
  UploadedImagesSection: () => null,
}))

describe('MediaSlotDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset fetch mock
    global.fetch = vi.fn()
  })

  it('renders upload button', () => {
    renderWithProviders(<MediaSlotDialog />)

    expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument()
  })

  it('has file input with correct accept attribute', () => {
    renderWithProviders(<MediaSlotDialog />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement

    expect(fileInput).toBeInTheDocument()
    expect(fileInput).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,image/gif')
  })

  it('shows loading state during upload', async () => {
    // Mock slow response
    vi.mocked(global.fetch).mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: () => Promise.resolve({ success: true, uploadedUrl: 'http://example.com/uploaded.jpg' }),
              } as Response),
            100
          )
        )
    )

    const { user } = renderWithProviders(<MediaSlotDialog />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })

    await user.upload(fileInput, file)

    // Should show uploading state
    await waitFor(() => {
      expect(screen.getByText(/uploading/i)).toBeInTheDocument()
    })
  })

  it('validates file type before upload', async () => {
    renderWithProviders(<MediaSlotDialog />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const invalidFile = new File(['test'], 'test.pdf', { type: 'application/pdf' })

    // Use fireEvent to bypass the accept attribute validation (which browsers enforce)
    // This tests our JavaScript validation layer
    fireEvent.change(fileInput, { target: { files: [invalidFile] } })

    // Should show error
    await waitFor(() => {
      expect(screen.getByText(/Only JPEG, PNG, WebP, and GIF images are supported/i)).toBeInTheDocument()
    })

    // Should not call fetch
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('validates file size before upload', async () => {
    const { user } = renderWithProviders(<MediaSlotDialog />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    // Create file larger than 10MB
    const largeFile = new File([new ArrayBuffer(11 * 1024 * 1024)], 'large.jpg', { type: 'image/jpeg' })

    await user.upload(fileInput, largeFile)

    // Should show error
    await waitFor(() => {
      expect(screen.getByText(/10MB/i)).toBeInTheDocument()
    })

    // Should not call fetch
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('calls upload endpoint with correct parameters', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, uploadedUrl: 'http://example.com/uploaded.jpg' }),
    } as Response)

    const { user } = renderWithProviders(<MediaSlotDialog />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })

    await user.upload(fileInput, file)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:4000/media/test-app/slots/pages/home/hero/upload',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      )
    })
  })

  it('closes dialog on successful upload', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, uploadedUrl: 'http://example.com/uploaded.jpg' }),
    } as Response)

    const { user } = renderWithProviders(<MediaSlotDialog />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })

    await user.upload(fileInput, file)

    await waitFor(() => {
      expect(mockCloseDialog).toHaveBeenCalled()
    })
  })

  it('shows error message on upload failure', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Server error' }),
    } as Response)

    const { user } = renderWithProviders(<MediaSlotDialog />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })

    await user.upload(fileInput, file)

    await waitFor(() => {
      expect(screen.getByText(/server error/i)).toBeInTheDocument()
    })
  })
})
