/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, waitFor } from '@testing-library/react'

import { useSwitchboard } from '@/hooks/useSwitchboard'
import { renderWithProviders } from '@/tests/test-utils'
import DesignFileUpload from './DesignFileUpload'
import type { UploadedDesignFile } from '../types'

const { mockProcessDesignFiles, mockLogImpressionEvent, mockImpressionThunk, mockGenerateClickEID } = vi.hoisted(() => {
  const mockImpressionThunk = vi.fn()
  return {
    mockProcessDesignFiles: vi.fn().mockResolvedValue({ processed: [], errors: [] }),
    mockImpressionThunk,
    mockLogImpressionEvent: vi.fn(() => mockImpressionThunk),
    mockGenerateClickEID: vi.fn(() => 'appbuilder.homepage.prompt.attach.click'),
  }
})

// The component dynamically imports processDesignFiles from this module.
vi.mock('./design-file-processing', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return { ...actual, processDesignFiles: mockProcessDesignFiles }
})

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: mockGenerateClickEID,
  logImpressionEvent: mockLogImpressionEvent,
}))

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => true),
}))

vi.mock('@/hooks/useBreakpoints', () => ({
  useBreakpoints: vi.fn(() => ({
    isBelowSmBreakpoint: false,
    isSmBreakpoint: true,
    isMdBreakpoint: true,
    isLgBreakpoint: true,
    isXlBreakpoint: true,
  })),
}))

describe('DesignFileUpload (picker path)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function renderUpload() {
    const onFilesChange = vi.fn()
    const onError = vi.fn()
    const currentFilesRef = { current: [] as UploadedDesignFile[] }
    const result = renderWithProviders(
      <DesignFileUpload
        currentFilesRef={currentFilesRef}
        onFilesChange={onFilesChange}
        onError={onError}
      />,
    )
    const input = result.container.querySelector('input[type="file"]') as HTMLInputElement
    return { ...result, input, onFilesChange, onError }
  }

  it('logs a fileAttached impression with source=picker when files are processed', async () => {
    const newFile: UploadedDesignFile = { name: 'a.png', content: '', isDesignMd: false }
    mockProcessDesignFiles.mockResolvedValueOnce({ processed: [newFile], errors: [], warnings: [] })

    const { input, onFilesChange, user } = renderUpload()
    await user.upload(input, new File(['x'], 'a.png', { type: 'image/png' }))

    await waitFor(() => {
      expect(mockLogImpressionEvent).toHaveBeenCalledWith('homepage.prompt.fileAttached', { fileCount: 1, source: 'picker' })
    })
    // The returned thunk must actually be invoked — a dropped trailing () would
    // call logImpressionEvent but never fire the data-layer push.
    expect(mockImpressionThunk).toHaveBeenCalledTimes(1)
    expect(onFilesChange).toHaveBeenCalledWith([newFile])
  })

  it('does not log a fileAttached impression when nothing is processed', async () => {
    mockProcessDesignFiles.mockResolvedValueOnce({
      processed: [],
      errors: [{ fileName: 'big.zip', error: 'too_large', message: { key: 'File too large' } }],
      warnings: [],
    })

    const { input, onError, user } = renderUpload()
    await user.upload(input, new File(['x'], 'big.zip'))

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('File too large')
    })
    expect(mockLogImpressionEvent).not.toHaveBeenCalledWith('homepage.prompt.fileAttached', expect.anything())
  })

  it('triggers file input click when the attachment button is clicked', async () => {
    const { container, user } = renderUpload()
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {})
    const button = container.querySelector('button') as HTMLButtonElement
    await user.click(button)
    expect(clickSpy).toHaveBeenCalled()
  })

  it('renders nothing when switchboard flag is disabled', () => {
    vi.mocked(useSwitchboard).mockReturnValueOnce(false)

    const { container } = renderWithProviders(
      <DesignFileUpload
        currentFilesRef={{ current: [] }}
        onFilesChange={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('does nothing when change event fires with null file list', () => {
    const { input, onFilesChange, onError } = renderUpload()
    fireEvent.change(input, { target: { files: null } })
    expect(onFilesChange).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('falls back to empty array when currentFilesRef.current is null', async () => {
    const newFile: UploadedDesignFile = { name: 'a.png', content: '', isDesignMd: false }
    mockProcessDesignFiles.mockResolvedValueOnce({ processed: [newFile], errors: [], warnings: [] })
    const onFilesChange = vi.fn()
    const { container } = renderWithProviders(
      <DesignFileUpload
        currentFilesRef={{ current: null as unknown as UploadedDesignFile[] }}
        onFilesChange={onFilesChange}
      />,
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.png')] } })
    await waitFor(() => expect(onFilesChange).toHaveBeenCalledWith([newFile]))
  })

  it('does nothing when isProcessing is true and a file is selected', async () => {
    const onFilesChange = vi.fn()
    const onError = vi.fn()
    const currentFilesRef = { current: [] as UploadedDesignFile[] }
    const { container } = renderWithProviders(
      <DesignFileUpload
        currentFilesRef={currentFilesRef}
        onFilesChange={onFilesChange}
        onError={onError}
        isProcessing={true}
      />,
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['x'], 'doc.txt')
    fireEvent.change(input, { target: { files: [file] } })
    expect(onFilesChange).not.toHaveBeenCalled()
  })

  it('calls onProcessingChange and onProcessingFilesChange when provided', async () => {
    const onProcessingChange = vi.fn()
    const onProcessingFilesChange = vi.fn()
    const newFile: UploadedDesignFile = { name: 'a.png', content: '', isDesignMd: false }
    mockProcessDesignFiles.mockResolvedValueOnce({ processed: [newFile], errors: [], warnings: [] })

    const onFilesChange = vi.fn()
    const currentFilesRef = { current: [] as UploadedDesignFile[] }
    const { container, user } = renderWithProviders(
      <DesignFileUpload
        currentFilesRef={currentFilesRef}
        onFilesChange={onFilesChange}
        onProcessingChange={onProcessingChange}
        onProcessingFilesChange={onProcessingFilesChange}
      />,
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, new File(['x'], 'a.png', { type: 'image/png' }))

    await waitFor(() => {
      expect(onProcessingChange).toHaveBeenCalledWith(true)
      expect(onProcessingChange).toHaveBeenCalledWith(false)
    })
    expect(onProcessingFilesChange).toHaveBeenCalledWith(['a.png'])
    expect(onProcessingFilesChange).toHaveBeenCalledWith([])
  })
})
