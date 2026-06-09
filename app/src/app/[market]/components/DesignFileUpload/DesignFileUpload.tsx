import { useCallback, useRef } from 'react'
import Button from '@ux/button'
import AttachmentIcon from '@ux/icon/attachment'

import { useBreakpoints } from '@/hooks/useBreakpoints'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID, logImpressionEvent } from '@/utils/instrumentation'
import type { UploadedDesignFile } from '../types'

interface DesignFileUploadProps {
  currentFilesRef: React.RefObject<UploadedDesignFile[]>
  onFilesChange: (files: UploadedDesignFile[]) => void
  onError?: (error: string | null) => void
  isProcessing?: boolean
  onProcessingChange?: (processing: boolean) => void
  onProcessingFilesChange?: (names: string[]) => void
  disabled?: boolean
}

export default function DesignFileUpload({ currentFilesRef, onFilesChange, onError, isProcessing, onProcessingChange, onProcessingFilesChange, disabled }: DesignFileUploadProps) {
  const isEnabled = useSwitchboard('appbuilder-design-upload')
  const inputRef = useRef<HTMLInputElement>(null)
  const { isBelowSmBreakpoint } = useBreakpoints()
  const t = useTranslations()

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList || fileList.length === 0) return
    if (isProcessing) return

    onProcessingChange?.(true)
    onProcessingFilesChange?.(Array.from(fileList).map(f => f.name))
    onError?.(null)
    try {
      const { processDesignFiles } = await import('./design-file-processing')
      const { processed, errors } = await processDesignFiles(
        Array.from(fileList),
        currentFilesRef.current ?? [],
        t,
      )
      if (processed.length > 0) {
        onFilesChange([...(currentFilesRef.current ?? []), ...processed])
        logImpressionEvent('homepage.prompt.fileAttached', { fileCount: processed.length, source: 'picker' })()
      }
      if (errors.length > 0) {
        onError?.(errors[0])
      }
    } finally {
      onProcessingChange?.(false)
      onProcessingFilesChange?.([])
    }
    if (inputRef.current) inputRef.current.value = ''
  }, [currentFilesRef, isProcessing, onError, onFilesChange, onProcessingChange, onProcessingFilesChange])

  if (!isEnabled) return null

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".md,.txt,.xml,.html,.htm,.zip,.png,.jpg,.jpeg,.gif,.svg,.webp"
        multiple
        onChange={handleFileSelect}
        className="hidden"
        disabled={disabled || isProcessing}
      />
      <Button
        onClick={() => inputRef.current?.click()}
        data-eid={generateClickEID('homepage.prompt.attach')}
        size={isBelowSmBreakpoint ? 'sm' : 'md'}
        data-partial="componentAiro"
        icon={<AttachmentIcon />}
        aria-label={t('builder_common_upload_file')}
        disabled={disabled || isProcessing}
      />
    </>
  )
}
