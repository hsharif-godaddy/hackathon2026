import { useCallback, useRef } from 'react'
import Button from '@ux/button'
import AttachmentIcon from '@ux/icon/attachment'

import { MutedIconButton } from '@/components/home/MutedIconButton'
import { useBreakpoints } from '@/hooks/useBreakpoints'
import { useTranslations } from '@/hooks/useTranslations'
import { DESIGN_UPLOAD_ACCEPTED_TYPES } from '@/utils/file-types'
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
  /** 'muted' renders a grey @ux/icon/attachment (prompt-starter design) instead of the @ux button. */
  appearance?: 'default' | 'muted'
}

export default function DesignFileUpload({ currentFilesRef, onFilesChange, onError, isProcessing, onProcessingChange, onProcessingFilesChange, disabled, appearance = 'default' }: DesignFileUploadProps) {
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
      )
      if (processed.length > 0) {
        onFilesChange([...(currentFilesRef.current ?? []), ...processed])
        logImpressionEvent('homepage.prompt.fileAttached', { fileCount: processed.length, source: 'picker' })()
      }
      if (errors.length > 0) {
        const [firstError] = errors
        onError?.(t(firstError.message.key, firstError.message.params))
      }
      for (const error of errors) {
        logImpressionEvent('homepage.prompt.fileRejected', { fileName: error.fileName, reason: error.error })()
      }
    } finally {
      onProcessingChange?.(false)
      onProcessingFilesChange?.([])
    }
    if (inputRef.current) inputRef.current.value = ''
  }, [currentFilesRef, isProcessing, onError, onFilesChange, onProcessingChange, onProcessingFilesChange, t])

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={DESIGN_UPLOAD_ACCEPTED_TYPES}
        multiple
        onChange={handleFileSelect}
        className="hidden"
        disabled={disabled || isProcessing}
      />
      {appearance === 'muted' ? (
        <MutedIconButton
          onClick={() => inputRef.current?.click()}
          data-eid={generateClickEID('homepage.prompt.attach')}
          data-partial="componentAiro"
          aria-label={t('builder_common_upload_file')}
          disabled={disabled || isProcessing}
          className="text-intents-ux-feedbackHighContrastPassive-feedbackColor"
        >
          <AttachmentIcon width={20} height={20} aria-hidden="true" />
        </MutedIconButton>
      ) : (
        <Button
          onClick={() => inputRef.current?.click()}
          data-eid={generateClickEID('homepage.prompt.attach')}
          size={isBelowSmBreakpoint ? 'sm' : 'md'}
          data-partial="componentAiro"
          icon={<AttachmentIcon />}
          aria-label={t('builder_common_upload_file')}
          disabled={disabled || isProcessing}
        />
      )}
    </>
  )
}
