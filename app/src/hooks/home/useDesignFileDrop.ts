import { useCallback, useRef, useState } from 'react'

import { processDesignFiles } from '@/app/[market]/components/DesignFileUpload'
import type { UploadedDesignFile } from '@/app/[market]/components/types'
import { useTranslations } from '@/hooks/useTranslations'
import { logActionEvent, logImpressionEvent } from '@/utils/instrumentation'

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
  maxFiles,
  maxTotalBytes,
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
      if (!disabled) {
        logActionEvent({ eid: 'homepage.prompt.attach', action: 'drag' })()
      }
    }
  }, [disabled])

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

    processDesignFiles(droppedFiles, currentFilesRef.current ?? [], t, maxFiles, maxTotalBytes)
      .then(({ processed, errors }) => {
        if (processed.length > 0) {
          const updated = [...(currentFilesRef.current ?? []), ...processed]
          onFilesChange(updated)
          logImpressionEvent('homepage.prompt.fileAttached', { fileCount: processed.length, source: 'drop' })()
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
