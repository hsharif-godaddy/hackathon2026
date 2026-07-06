import { useRef, useState } from 'react'

import type { UploadedDesignFile } from '@/app/[market]/components/types'
import { useDesignFileDrop } from './useDesignFileDrop'

interface UseFileUploadStateOptions {
  uploadedFiles?: UploadedDesignFile[]
  onFilesChange?: (files: UploadedDesignFile[]) => void
  isLoading?: boolean
}

interface UseFileUploadStateResult {
  fileUploadError: string | null
  setFileUploadError: (error: string | null) => void
  setIsPickerProcessing: (processing: boolean) => void
  processingFiles: string[]
  setProcessingFiles: (names: string[]) => void
  isProcessing: boolean
  isFileDragOver: boolean
  uploadedFilesRef: React.RefObject<UploadedDesignFile[]>
  dragProps: {
    onDragEnter: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
  }
}

export function useFileUploadState({
  uploadedFiles,
  onFilesChange,
  isLoading,
}: UseFileUploadStateOptions): UseFileUploadStateResult {
  const [fileUploadError, setFileUploadError] = useState<string | null>(null)

  const uploadedFilesRef = useRef(uploadedFiles ?? [])
  uploadedFilesRef.current = uploadedFiles ?? []

  const [isPickerProcessing, setIsPickerProcessing] = useState(false)
  const [processingFiles, setProcessingFiles] = useState<string[]>([])

  const { isFileDragOver, isProcessing: isDropProcessing, dragProps } = useDesignFileDrop({
    currentFilesRef: uploadedFilesRef,
    onFilesChange: onFilesChange ?? (() => {}),
    onError: setFileUploadError,
    onProcessingFilesChange: setProcessingFiles,
    disabled: isLoading || isPickerProcessing,
  })

  const isProcessing = isDropProcessing || isPickerProcessing

  return {
    fileUploadError,
    setFileUploadError,
    setIsPickerProcessing,
    processingFiles,
    setProcessingFiles,
    isProcessing,
    isFileDragOver,
    uploadedFilesRef,
    dragProps,
  }
}
