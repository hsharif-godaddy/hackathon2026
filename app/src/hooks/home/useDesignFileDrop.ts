import { useCallback, useRef, useState } from 'react'

import { MAX_FILES, MAX_TOTAL_BYTES, processDesignFiles } from '@/app/[market]/components/design-file-processing'
import type { UploadedDesignFile } from '@/app/[market]/components/types'
import { useTranslations } from '@/hooks/useTranslations'

interface UseDesignFileDropOptions {
  currentFilesRef: React.RefObject<UploadedDesignFile[]>
  onFilesChange: (files: UploadedDesignFile[]) => void
  onError: (error: string | null) => void
  onProcessingFilesChange?: (names: string[]) => void
  maxFiles?: number
  maxTotalBytes?: number
  disabled?: boolean
}

interface UseDesignFileDropResult {
  isFileDragOver: boolean
  isProcessing: boolean
  dragProps: {
    onDragEnter: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
  }
}

function hasFiles(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes('Files') ||
    Array.from(e.dataTransfer.items || []).some(item => item.kind === 'file')
}

export function useDesignFileDrop({
  currentFilesRef,
  onFilesChange,
  onError,
  onProcessingFilesChange,
  maxFiles = MAX_FILES,
  maxTotalBytes = MAX_TOTAL_BYTES,
  disabled = false,
}: UseDesignFileDropOptions): UseDesignFileDropResult {
  const t = useTranslations()
  const [isFileDragOver, setIsFileDragOver] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const dragCounterRef = useRef(0)

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!hasFiles(e)) return
    dragCounterRef.current += 1
    if (dragCounterRef.current === 1) {
      setIsFileDragOver(true)
    }
  }, [])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current -= 1
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setIsFileDragOver(false)
    }
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsFileDragOver(false)

    if (disabled || !hasFiles(e)) return
    if (isProcessing) {
      onError(t('builder_design_file_upload_processing_wait'))
      return
    }

    const droppedFiles = Array.from(e.dataTransfer.files || [])
    if (droppedFiles.length === 0) return

    setIsProcessing(true)
    onProcessingFilesChange?.(droppedFiles.map(f => f.name))
    onError(null)

    processDesignFiles(droppedFiles, currentFilesRef.current ?? [], maxFiles, maxTotalBytes, t)
      .then(({ processed, errors }) => {
        if (processed.length > 0) {
          const updated = [...(currentFilesRef.current ?? []), ...processed]
          onFilesChange(updated)
        }
        if (errors.length > 0) {
          onError(errors[0])
        }
      })
      .catch(() => {
        onError(t('builder_design_file_upload_error_drop_failed'))
      })
      .finally(() => {
        setIsProcessing(false)
        onProcessingFilesChange?.([])
      })
  }, [currentFilesRef, disabled, isProcessing, maxFiles, maxTotalBytes, onError, onFilesChange, onProcessingFilesChange, t])

  return {
    isFileDragOver,
    isProcessing,
    dragProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
  }
}
