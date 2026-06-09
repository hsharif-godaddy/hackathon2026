/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'

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
    mockProcessDesignFiles.mockResolvedValueOnce({ processed: [newFile], errors: [] })

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
    mockProcessDesignFiles.mockResolvedValueOnce({ processed: [], errors: ['File too large'] })

    const { input, onError, user } = renderUpload()
    await user.upload(input, new File(['x'], 'big.zip'))

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('File too large')
    })
    expect(mockLogImpressionEvent).not.toHaveBeenCalled()
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
})
