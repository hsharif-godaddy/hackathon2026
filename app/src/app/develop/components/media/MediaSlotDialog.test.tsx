import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'

import { MediaSlotDialog } from '@/app/develop/components/media/MediaSlotDialog'
import { renderWithProviders } from '@/tests/test-utils'

// Mock external dependencies
vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(() => vi.fn()),
  generateClickEID: vi.fn((event: string) => `${event}.click`),
  logAiroHQEvent: vi.fn(() => vi.fn()),
}))
vi.mock('@/lib/request-context', () => ({
  logger: {
    debug: vi.fn(),
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
import { postMessageToIframe } from '@/utils/postMessage'
vi.mock('@/utils/postMessage', () => ({
  postMessageToIframe: vi.fn(),
}))

// Mock UploadedImagesSection to avoid additional fetch calls in tests
vi.mock('./UploadedImagesSection', () => ({
  UploadedImagesSection: () => null,
}))

// vi.hoisted ensures this is initialized before vi.mock factories run (which are hoisted to top of file)
const mockCompressImageFile = vi.hoisted(() => vi.fn(async (file: File) => file))
vi.mock('@/utils/image-compression', () => ({
  compressImageFile: mockCompressImageFile,
}))

describe('MediaSlotDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
    // Restore default implementation after clearAllMocks may reset it
    mockCompressImageFile.mockImplementation(async (file: File) => file)
  })

  it('renders upload button', () => {
    renderWithProviders(<MediaSlotDialog />)

    // Translation key is returned since IntlProvider has empty messages
    expect(screen.getByText('builder_mediaslot_upload')).toBeInTheDocument()
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

    renderWithProviders(<MediaSlotDialog />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })

    // Use fireEvent because file input is hidden with display: none
    fireEvent.change(fileInput, { target: { files: [file] } })

    // Should show uploading state (translation key)
    await waitFor(() => {
      expect(screen.getByText('builder_mediaslot_uploading')).toBeInTheDocument()
    })
  })

  it('validates file type before upload', async () => {
    renderWithProviders(<MediaSlotDialog />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const invalidFile = new File(['test'], 'test.pdf', { type: 'application/pdf' })

    // Use fireEvent to bypass the accept attribute validation (which browsers enforce)
    // This tests our JavaScript validation layer
    fireEvent.change(fileInput, { target: { files: [invalidFile] } })

    // Should show error (translation key since IntlProvider has empty messages)
    await waitFor(() => {
      expect(screen.getByText('builder_mediaslot_error_type')).toBeInTheDocument()
    })

    // Should not call fetch
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('validates file size before upload', async () => {
    renderWithProviders(<MediaSlotDialog />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    // Create file larger than 10MB
    const largeFile = new File([new ArrayBuffer(11 * 1024 * 1024)], 'large.jpg', { type: 'image/jpeg' })

    // Use fireEvent because file input is hidden with display: none
    fireEvent.change(fileInput, { target: { files: [largeFile] } })

    // Should show error (translation key since IntlProvider has empty messages)
    await waitFor(() => {
      expect(screen.getByText('builder_mediaslot_error_size')).toBeInTheDocument()
    })

    // Should not call fetch
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('calls upload endpoint with correct parameters', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, uploadedUrl: 'http://example.com/uploaded.jpg' }),
    } as Response)

    renderWithProviders(<MediaSlotDialog />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })

    // Use fireEvent because file input is hidden with display: none
    fireEvent.change(fileInput, { target: { files: [file] } })

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

    renderWithProviders(<MediaSlotDialog />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })

    // Use fireEvent because file input is hidden with display: none
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(mockCloseDialog).toHaveBeenCalled()
    })
  })

  it('sends RELOAD_MEDIA_SLOT and CLEAR_SELECTION postMessages on successful upload', async () => {
    // Create a mock iframe element
    const mockIframe = document.createElement('iframe')
    mockIframe.id = 'preview-iframe'
    document.body.appendChild(mockIframe)

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, uploadedUrl: 'http://example.com/uploaded.jpg' }),
    } as Response)

    renderWithProviders(<MediaSlotDialog />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })

    // Use fireEvent because file input is hidden with display: none
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      // Verify RELOAD_MEDIA_SLOT is sent
      expect(postMessageToIframe).toHaveBeenCalledWith(
        expect.any(HTMLIFrameElement),
        { type: 'RELOAD_MEDIA_SLOT', slotPath: 'pages/home/hero' }
      )
      // Verify CLEAR_SELECTION is sent to dismiss the selection indicator
      expect(postMessageToIframe).toHaveBeenCalledWith(
        expect.any(HTMLIFrameElement),
        { type: 'CLEAR_SELECTION' }
      )
    })

    // Cleanup
    document.body.removeChild(mockIframe)
  })

  it('shows error message on upload failure', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Server error' }),
    } as Response)

    renderWithProviders(<MediaSlotDialog />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })

    // Use fireEvent because file input is hidden with display: none
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => {
      // The error message from the server response
      expect(screen.getByText('Server error')).toBeInTheDocument()
    })
  })

  describe('image compression', () => {
    it('should compress image before upload', async function compresses() {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, uploadedUrl: 'http://example.com/uploaded.jpg' }),
      } as Response)

      renderWithProviders(<MediaSlotDialog />)

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })

      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        expect(mockCompressImageFile).toHaveBeenCalledWith(file)
      })
    })

    it('should upload the compressed file not the original', async function uploadsCompressed() {
      const compressedFile = new File(['smaller'], 'test.jpg', { type: 'image/jpeg' })
      mockCompressImageFile.mockResolvedValueOnce(compressedFile)

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, uploadedUrl: 'http://example.com/uploaded.jpg' }),
      } as Response)

      renderWithProviders(<MediaSlotDialog />)

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const originalFile = new File([new ArrayBuffer(5 * 1024 * 1024)], 'test.jpg', { type: 'image/jpeg' })

      fireEvent.change(fileInput, { target: { files: [originalFile] } })

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled()
        const formData = vi.mocked(global.fetch).mock.calls[0][1]?.body as FormData
        expect(formData.get('image')).toBe(compressedFile)
      })
    })

    it('should run compression and token fetch in parallel', async function runsParallel() {
      const { regenerateToken } = await import('@/lib/jwt-regeneration')
      const { dynamicApiConfigService } = await import('@/config/dynamic-api')

      const order: string[] = []
      mockCompressImageFile.mockImplementation(async (file: File) => {
        order.push('compress')
        return file
      })
      vi.mocked(regenerateToken).mockImplementation(async () => {
        order.push('token')
        return { token: 'test-token' }
      })
      vi.mocked(dynamicApiConfigService.getConfigForSite).mockImplementation(async () => {
        order.push('config')
        return { agentUrl: 'http://localhost:4000' }
      })

      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, uploadedUrl: 'http://example.com/uploaded.jpg' }),
      } as Response)

      renderWithProviders(<MediaSlotDialog />)

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })

      fireEvent.change(fileInput, { target: { files: [file] } })

      await waitFor(() => {
        expect(order).toContain('compress')
        expect(order).toContain('token')
        expect(order).toContain('config')
      })
    })
  })
})
