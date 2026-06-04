/**
 * @vitest-environment jsdom
 */
import { createElement, type ReactNode } from 'react'
import { IntlProvider } from 'react-intl'
import { beforeEach,describe, expect, it, vi } from 'vitest'
import { act,renderHook } from '@testing-library/react'

import type { UploadedDesignFile } from '@/app/[market]/components/types'
import { useDesignFileDrop } from './useDesignFileDrop'

const { mockProcessDesignFiles } = vi.hoisted(() => ({
  mockProcessDesignFiles: vi.fn().mockResolvedValue({ processed: [], errors: [] }),
}))
vi.mock('@/app/[market]/components/design-file-processing', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
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

  it('calls onFilesChange with appended files on successful drop', async () => {
    const existingFile: UploadedDesignFile = { name: 'existing.txt', content: 'hi', isDesignMd: false }
    filesRef.current = [existingFile]
    const newFile: UploadedDesignFile = { name: 'new.txt', content: 'hello', isDesignMd: false }
    mockProcessDesignFiles.mockResolvedValueOnce({ processed: [newFile], errors: [] })

    const { result } = renderDrop()
    await act(async () => { result.current.dragProps.onDrop(createDragEvent('drop')) })

    expect(onFilesChange).toHaveBeenCalledWith([existingFile, newFile])
    expect(onError).toHaveBeenCalledWith(null)
  })

  it('calls onError when processDesignFiles returns errors', async () => {
    mockProcessDesignFiles.mockResolvedValueOnce({ processed: [], errors: ['File too large'] })

    const { result } = renderDrop()
    await act(async () => { result.current.dragProps.onDrop(createDragEvent('drop')) })

    expect(onFilesChange).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('File too large')
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
    mockProcessDesignFiles.mockResolvedValueOnce({ processed: [newFile], errors: [] })

    const { result } = renderDrop()
    await act(async () => { result.current.dragProps.onDrop(createDragEvent('drop')) })

    expect(mockLogImpressionEvent).toHaveBeenCalledWith('homepage.prompt.fileAttached', { fileCount: 1, source: 'drop' })
    expect(mockImpressionThunk).toHaveBeenCalledTimes(1)
  })

  it('does not log a fileAttached impression EID when nothing is processed', async () => {
    mockProcessDesignFiles.mockResolvedValueOnce({ processed: [], errors: ['File too large'] })

    const { result } = renderDrop()
    await act(async () => { result.current.dragProps.onDrop(createDragEvent('drop')) })

    expect(mockLogImpressionEvent).not.toHaveBeenCalled()
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
