/**
 * @vitest-environment jsdom
 */
import { createElement, type ReactNode } from 'react'
import { IntlProvider } from 'react-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { ProcessFileErrorReason } from '@/app/[market]/components/DesignFileUpload/design-file-processing'
import type { UploadedDesignFile } from '@/app/[market]/components/types'
import { useDesignFileDrop } from './useDesignFileDrop'

const { mockProcessDesignFiles } = vi.hoisted(() => ({
  mockProcessDesignFiles: vi.fn().mockResolvedValue({ processed: [], errors: [], warnings: [] }),
}))
vi.mock('@/app/[market]/components/DesignFileUpload', async (importOriginal: () => Promise<Record<string, unknown>>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    processDesignFiles: mockProcessDesignFiles,
  }
})

const { mockLogActionEvent, mockActionThunk, mockLogImpressionEvent, mockImpressionThunk } = vi.hoisted(() => {
  const mockActionThunk = vi.fn()
  const mockImpressionThunk = vi.fn()
  return {
    mockActionThunk,
    mockImpressionThunk,
    mockLogActionEvent: vi.fn(() => mockActionThunk),
    mockLogImpressionEvent: vi.fn(() => mockImpressionThunk),
  }
})
vi.mock('@/utils/instrumentation', () => ({
  logActionEvent: mockLogActionEvent,
  logImpressionEvent: mockLogImpressionEvent,
}))

const mockSwitchboard = vi.hoisted(() => vi.fn().mockReturnValue(undefined))
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: mockSwitchboard,
}))

function createDragEvent(type: string, hasFiles = true): React.DragEvent<HTMLDivElement> {
  return {
    type,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      types: hasFiles ? ['Files'] : ['text/plain'],
      items: hasFiles ? [{ kind: 'file' }] : [],
      files: hasFiles ? [new File(['x'], 'test.txt')] : [],
    },
    currentTarget: document.createElement('div'),
    relatedTarget: null,
  } as unknown as React.DragEvent<HTMLDivElement>
}

describe('useDesignFileDrop', () => {
  const onFilesChange = vi.fn()
  const onError = vi.fn()
  let filesRef: { current: UploadedDesignFile[] }

  beforeEach(() => {
    vi.clearAllMocks()
    filesRef = { current: [] }
  })

  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(IntlProvider, { locale: 'en', messages: {} }, children)

  function renderDrop(disabled = false) {
    return renderHook(() => useDesignFileDrop({
      currentFilesRef: filesRef,
      onFilesChange,
      onError,
      disabled,
    }), { wrapper })
  }

  it('always calls preventDefault on dragOver regardless of disabled state', () => {
    const { result } = renderDrop(true)
    const event = createDragEvent('dragover')
    act(() => { result.current.dragProps.onDragOver(event) })
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('always calls preventDefault on drop regardless of disabled state', () => {
    const { result } = renderDrop(true)
    const event = createDragEvent('drop')
    act(() => { result.current.dragProps.onDrop(event) })
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('does not process files when disabled', () => {
    const { result } = renderDrop(true)
    const event = createDragEvent('drop')
    act(() => { result.current.dragProps.onDrop(event) })
    expect(onFilesChange).not.toHaveBeenCalled()
  })

  it('tracks dragOver state via counter', () => {
    const { result } = renderDrop()
    expect(result.current.isFileDragOver).toBe(false)

    act(() => { result.current.dragProps.onDragEnter(createDragEvent('dragenter')) })
    expect(result.current.isFileDragOver).toBe(true)

    act(() => { result.current.dragProps.onDragEnter(createDragEvent('dragenter')) })
    expect(result.current.isFileDragOver).toBe(true)

    act(() => { result.current.dragProps.onDragLeave(createDragEvent('dragleave')) })
    expect(result.current.isFileDragOver).toBe(true)

    act(() => { result.current.dragProps.onDragLeave(createDragEvent('dragleave')) })
    expect(result.current.isFileDragOver).toBe(false)
  })

  it('ignores non-file drags for processing', () => {
    const { result } = renderDrop()
    const event = createDragEvent('dragenter', false)
    act(() => { result.current.dragProps.onDragEnter(event) })
    expect(result.current.isFileDragOver).toBe(false)
  })

  it('resets drag counter on drop', () => {
    const { result } = renderDrop()
    act(() => { result.current.dragProps.onDragEnter(createDragEvent('dragenter')) })
    expect(result.current.isFileDragOver).toBe(true)
    act(() => { result.current.dragProps.onDrop(createDragEvent('drop')) })
    expect(result.current.isFileDragOver).toBe(false)
  })

  it('calls processDesignFiles with options object including isServerScanEnabled from switchboard', async () => {
    mockSwitchboard.mockReturnValue(true)
    const { result } = renderDrop()
    await act(async () => { result.current.dragProps.onDrop(createDragEvent('drop')) })

    expect(mockProcessDesignFiles).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      { maxFiles: undefined, maxTotalBytes: undefined, isServerScanEnabled: true },
    )
  })

  it('passes isServerScanEnabled: undefined when switchboard flag is not set', async () => {
    mockSwitchboard.mockReturnValue(undefined)
    const { result } = renderDrop()
    await act(async () => { result.current.dragProps.onDrop(createDragEvent('drop')) })

    expect(mockProcessDesignFiles).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      expect.objectContaining({ isServerScanEnabled: undefined }),
    )
  })

  it('calls onFilesChange with appended files on successful drop', async () => {
    const existingFile: UploadedDesignFile = { name: 'existing.txt', content: 'hi', isDesignMd: false }
    filesRef.current = [existingFile]
    const newFile: UploadedDesignFile = { name: 'new.txt', content: 'hello', isDesignMd: false }
    mockProcessDesignFiles.mockResolvedValueOnce({ processed: [newFile], errors: [], warnings: [] })

    const { result } = renderDrop()
    await act(async () => { result.current.dragProps.onDrop(createDragEvent('drop')) })

    expect(onFilesChange).toHaveBeenCalledWith([existingFile, newFile])
    expect(onError).toHaveBeenCalledWith(null)
  })

  it('calls onError with the translated first error message on rejection', async () => {
    mockProcessDesignFiles.mockResolvedValueOnce({
      processed: [],
      errors: [{
        fileName: 'big.txt',
        error: ProcessFileErrorReason.TooLarge,
        message: { key: 'builder_design_file_upload_error_exceeds_limit', params: { name: 'big.txt', limit: '1MB' } },
      }],
      warnings: [],
    })

    const { result } = renderDrop()
    await act(async () => { result.current.dragProps.onDrop(createDragEvent('drop')) })

    expect(onFilesChange).not.toHaveBeenCalled()
    // IntlProvider with empty messages falls back to the translation key
    expect(onError).toHaveBeenCalledWith('builder_design_file_upload_error_exceeds_limit')
  })

  it('logs fileRejected for each error', async () => {
    mockProcessDesignFiles.mockResolvedValueOnce({
      processed: [],
      errors: [
        { fileName: 'bad.txt', error: ProcessFileErrorReason.MaliciousContent, message: { key: 'builder_design_file_upload_error_malicious_content' } },
        { fileName: 'big.txt', error: ProcessFileErrorReason.TooLarge, message: { key: 'builder_design_file_upload_error_exceeds_limit' } },
      ],
      warnings: [],
    })

    const { result } = renderDrop()
    await act(async () => { result.current.dragProps.onDrop(createDragEvent('drop')) })

    expect(mockLogImpressionEvent).toHaveBeenCalledWith('homepage.prompt.fileRejected', { fileName: 'bad.txt', reason: ProcessFileErrorReason.MaliciousContent })
    expect(mockLogImpressionEvent).toHaveBeenCalledWith('homepage.prompt.fileRejected', { fileName: 'big.txt', reason: ProcessFileErrorReason.TooLarge })
    expect(mockImpressionThunk).toHaveBeenCalledTimes(2)
  })

  it('logs scannerUnavailable for each warning and still processes the file', async () => {
    const newFile: UploadedDesignFile = { name: 'doc.txt', content: 'hello', isDesignMd: false }
    mockProcessDesignFiles.mockResolvedValueOnce({
      processed: [newFile],
      errors: [],
      warnings: [{ fileName: 'doc.txt', reason: 'scanner_unavailable' }],
    })

    const { result } = renderDrop()
    await act(async () => { result.current.dragProps.onDrop(createDragEvent('drop')) })

    expect(mockLogImpressionEvent).toHaveBeenCalledWith('homepage.prompt.scannerUnavailable', { fileName: 'doc.txt' })
    expect(onFilesChange).toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalledWith(expect.any(String))
  })

  it('logs a drag action EID once when a file drag enters', () => {
    const { result } = renderDrop()
    act(() => { result.current.dragProps.onDragEnter(createDragEvent('dragenter')) })
    act(() => { result.current.dragProps.onDragEnter(createDragEvent('dragenter')) })

    expect(mockLogActionEvent).toHaveBeenCalledTimes(1)
    expect(mockLogActionEvent).toHaveBeenCalledWith({ eid: 'homepage.prompt.attach', action: 'drag' })
    expect(mockActionThunk).toHaveBeenCalledTimes(1)
  })

  it('does not log a drag action EID for non-file drags', () => {
    const { result } = renderDrop()
    act(() => { result.current.dragProps.onDragEnter(createDragEvent('dragenter', false)) })
    expect(mockLogActionEvent).not.toHaveBeenCalled()
  })

  it('does not log a drag action EID when disabled, but still shows the drag highlight', () => {
    const { result } = renderDrop(true)
    act(() => { result.current.dragProps.onDragEnter(createDragEvent('dragenter')) })
    expect(result.current.isFileDragOver).toBe(true)
    expect(mockLogActionEvent).not.toHaveBeenCalled()
  })

  it('logs a fileAttached impression EID on successful drop', async () => {
    const newFile: UploadedDesignFile = { name: 'new.txt', content: 'hello', isDesignMd: false }
    mockProcessDesignFiles.mockResolvedValueOnce({ processed: [newFile], errors: [], warnings: [] })

    const { result } = renderDrop()
    await act(async () => { result.current.dragProps.onDrop(createDragEvent('drop')) })

    expect(mockLogImpressionEvent).toHaveBeenCalledWith('homepage.prompt.fileAttached', { fileCount: 1, source: 'drop' })
    expect(mockImpressionThunk).toHaveBeenCalledTimes(1)
  })

  it('does not log a fileAttached impression EID when nothing is processed', async () => {
    mockProcessDesignFiles.mockResolvedValueOnce({
      processed: [],
      errors: [{ fileName: 'big.txt', error: ProcessFileErrorReason.TooLarge, message: { key: 'builder_design_file_upload_error_exceeds_limit' } }],
      warnings: [],
    })

    const { result } = renderDrop()
    await act(async () => { result.current.dragProps.onDrop(createDragEvent('drop')) })

    expect(mockLogImpressionEvent).not.toHaveBeenCalledWith('homepage.prompt.fileAttached', expect.anything())
  })

  it('detects file drag via items when dataTransfer.types does not include "Files"', () => {
    const { result } = renderDrop()
    const event = {
      type: 'dragenter',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        types: ['text/uri-list'],
        items: [{ kind: 'file' }],
        files: [new File(['x'], 'test.txt')],
      },
      currentTarget: document.createElement('div'),
      relatedTarget: null,
    } as unknown as React.DragEvent<HTMLDivElement>
    act(() => { result.current.dragProps.onDragEnter(event) })
    expect(result.current.isFileDragOver).toBe(true)
  })

  it('calls onError when a second drop arrives while processing is in progress', async () => {
    let resolveFirst!: (value: { processed: never[]; errors: never[]; warnings: never[] }) => void
    mockProcessDesignFiles.mockReturnValueOnce(
      new Promise(resolve => { resolveFirst = resolve }),
    )

    const { result } = renderDrop()
    act(() => { result.current.dragProps.onDrop(createDragEvent('drop')) })
    expect(result.current.isProcessing).toBe(true)

    await act(async () => { result.current.dragProps.onDrop(createDragEvent('drop')) })
    expect(onError).toHaveBeenCalledWith('builder_design_file_upload_processing_wait')

    await act(async () => { resolveFirst({ processed: [], errors: [], warnings: [] }) })
  })

  it('calls onError with drop-failed message when processDesignFiles throws', async () => {
    mockProcessDesignFiles.mockRejectedValueOnce(new Error('unexpected crash'))

    const { result } = renderDrop()
    await act(async () => { result.current.dragProps.onDrop(createDragEvent('drop')) })

    expect(onError).toHaveBeenCalledWith('builder_design_file_upload_error_drop_failed')
  })

  it('returns false for hasFiles when dataTransfer.items is null and types omits Files', () => {
    const { result } = renderDrop()
    const event = {
      type: 'dragenter',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        types: ['text/plain'],
        items: null,
        files: [],
      },
      currentTarget: document.createElement('div'),
      relatedTarget: null,
    } as unknown as React.DragEvent<HTMLDivElement>
    act(() => { result.current.dragProps.onDragEnter(event) })
    expect(result.current.isFileDragOver).toBe(false)
  })

  it('treats null dataTransfer.files as empty on drop', async () => {
    const { result } = renderDrop()
    const event = {
      type: 'drop',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        types: ['Files'],
        items: [{ kind: 'file' }],
        files: null,
      },
      currentTarget: document.createElement('div'),
      relatedTarget: null,
    } as unknown as React.DragEvent<HTMLDivElement>
    await act(async () => { result.current.dragProps.onDrop(event) })
    expect(mockProcessDesignFiles).not.toHaveBeenCalled()
  })

  it('handles null currentFilesRef.current on drop', async () => {
    const newFile: UploadedDesignFile = { name: 'doc.txt', content: 'hello', isDesignMd: false }
    mockProcessDesignFiles.mockResolvedValueOnce({ processed: [newFile], errors: [], warnings: [] })
    const nullFilesChange = vi.fn()
    const nullRef: { current: UploadedDesignFile[] } = { current: null as unknown as UploadedDesignFile[] }
    const { result } = renderHook(() => useDesignFileDrop({
      currentFilesRef: nullRef,
      onFilesChange: nullFilesChange,
      onError: vi.fn(),
    }), { wrapper })
    await act(async () => { result.current.dragProps.onDrop(createDragEvent('drop')) })
    expect(nullFilesChange).toHaveBeenCalledWith([newFile])
  })

  it('does nothing when drop event has file items but an empty files list', async () => {
    const { result } = renderDrop()
    const event = {
      type: 'drop',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        types: ['text/uri-list'],
        items: [{ kind: 'file' }],
        files: [],
      },
      currentTarget: document.createElement('div'),
      relatedTarget: null,
    } as unknown as React.DragEvent<HTMLDivElement>
    await act(async () => { result.current.dragProps.onDrop(event) })
    expect(mockProcessDesignFiles).not.toHaveBeenCalled()
    expect(onFilesChange).not.toHaveBeenCalled()
  })

  it('decrements drag counter on dragLeave even when browser clears dataTransfer types', () => {
    const { result } = renderDrop()
    act(() => { result.current.dragProps.onDragEnter(createDragEvent('dragenter')) })
    expect(result.current.isFileDragOver).toBe(true)

    const leaveEvent = createDragEvent('dragleave', false)
    act(() => { result.current.dragProps.onDragLeave(leaveEvent) })
    expect(result.current.isFileDragOver).toBe(false)
  })
})
