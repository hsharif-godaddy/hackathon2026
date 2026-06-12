import clsx from 'clsx'
import { type ChangeEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import Box from '@ux/box'

import DesignFileUpload, { DesignFileUploadCard, DesignFileUploadSkeleton } from '@/app/[market]/components/DesignFileUpload'
import type { UploadedDesignFile } from '@/app/[market]/components/types'
import { PromptInputErrors } from '@/components/home/PromptInputErrors'
import { SpeechToggleButton } from '@/components/home/SpeechToggleButton'
import { SubmitInitialPrompt } from '@/components/home/SubmitInitialPrompt'
import { useBreakpoints } from '@/hooks/useBreakpoints'

export interface PromptInputProps {
  className?: string
  displayText: string
  isTyping: boolean
  isLoading: boolean
  isListening: boolean
  animatedPlaceholder: string
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onTextareaChange: (e: ChangeEvent<HTMLTextAreaElement>) => void
  onTextareaKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onTextareaFocus: () => void
  onTextareaBlur: () => void
  dataTestId?: string

  isFileDragOver: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void

  uploadedFiles?: UploadedDesignFile[]
  onFilesChange?: (files: UploadedDesignFile[]) => void
  uploadedFilesRef?: RefObject<UploadedDesignFile[]>
  processingFiles: string[]
  isProcessing: boolean
  fileUploadError: string | null
  onFileUploadError: (error: string | null) => void
  onPickerProcessingChange: (processing: boolean) => void
  onProcessingFilesChange: (names: string[]) => void

  bytesRemaining: number
  isOverLimit: boolean

  isSpeechSupported?: boolean
  onSpeechToggle?: () => void

  onSubmit: () => void
  submitText?: string
  submitIcon?: ReactNode
}

export function PromptInput({
  className,
  displayText,
  isTyping,
  isLoading,
  isListening,
  animatedPlaceholder,
  textareaRef,
  onTextareaChange,
  onTextareaKeyDown,
  onTextareaFocus,
  onTextareaBlur,
  dataTestId = 'homepage-prompt-input',
  isFileDragOver,
  onMouseEnter,
  onMouseLeave,
  uploadedFiles,
  onFilesChange,
  uploadedFilesRef,
  processingFiles,
  isProcessing,
  fileUploadError,
  onFileUploadError,
  onPickerProcessingChange,
  onProcessingFilesChange,
  bytesRemaining,
  isOverLimit,
  isSpeechSupported,
  onSpeechToggle,
  onSubmit,
  submitText,
  submitIcon,
}: PromptInputProps) {
  const { isBelowSmBreakpoint } = useBreakpoints()

  return (
    <div
      className={clsx('relative transition-all duration-300 ease-out glowing-input', className, {
        'glowing-input--disabled': isLoading,
        'ring-2 ring-intents-ux-action-borderColor bg-intents-ux-action-backgroundColor/5': isFileDragOver,
      })}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <Box
        className="p-2 transition-all duration-300 ease-out bg-intents-ux-box-backgroundColor outline-4 outline-solid outline-[rgba(0,0,0,0.15)]"
        elevation="float"
        gap={isBelowSmBreakpoint ? 'sm' : 'md'}
      >
        {((uploadedFiles ?? []).length > 0 || processingFiles.length > 0) && onFilesChange && (
          <div aria-live="polite" className="flex flex-wrap gap-2">
            {(uploadedFiles ?? []).map((file, idx) => (
              <DesignFileUploadCard
                key={`${file.name}-${file.zipRaw?.byteLength ?? 0}`}
                uploadedFile={file}
                onRemove={() => onFilesChange((uploadedFiles ?? []).filter((_, i) => i !== idx))}
                disabled={isLoading}
              />
            ))}
            <DesignFileUploadSkeleton fileNames={processingFiles} />
          </div>
        )}

        <textarea
          ref={textareaRef}
          data-testid={dataTestId}
          aria-describedby="prompt-char-count"
          value={displayText}
          onChange={onTextareaChange}
          onKeyDown={onTextareaKeyDown}
          onFocus={onTextareaFocus}
          onBlur={onTextareaBlur}
          dir="auto"
          disabled={isLoading || isListening}
          className="w-full min-h-6 md:min-h-8 max-h-20 md:max-h-24 bg-transparent overflow-y-auto text-md sm:text-xl font-light resize-none focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-opacity duration-300"
          placeholder={isTyping ? "" : animatedPlaceholder}
        />

        <Box orientation="horizontal" blockAlignChildren="spaceBetween" inlineAlignChildren="end">
          <PromptInputErrors bytesRemaining={bytesRemaining} isOverLimit={isOverLimit} fileUploadError={fileUploadError} />

          <Box orientation="horizontal" gap="sm">
            {onFilesChange && uploadedFilesRef && (
              <DesignFileUpload
                currentFilesRef={uploadedFilesRef}
                onFilesChange={onFilesChange}
                onError={onFileUploadError}
                isProcessing={isProcessing}
                onProcessingChange={onPickerProcessingChange}
                onProcessingFilesChange={onProcessingFilesChange}
                disabled={isLoading}
              />
            )}
            {isSpeechSupported && onSpeechToggle && (
              <SpeechToggleButton
                isListening={isListening}
                isLoading={isLoading}
                isTyping={isTyping}
                onToggle={onSpeechToggle}
              />
            )}
            <SubmitInitialPrompt
              onClick={onSubmit}
              disabled={!displayText.trim() || isLoading || isTyping || isOverLimit}
              isLoading={isLoading}
              text={submitText}
              icon={submitIcon}
            />
          </Box>
        </Box>
      </Box>
    </div>
  )
}
