'use client'

import { useEffect } from 'react'
import Modal from '@ux/modal'

import { type UploadedDesignFile } from '@/app/[market]/components/types'
import { PromptErrorAlert } from '@/components/home/PromptErrorAlert'
import { PromptInput } from '@/components/home/PromptInput'
import ExamplesSection from '@/components/home-page/HeroExamples'
import { SWITCHBOARD_AIRO_BUILDER_PROJECTS_MODAL_INPUTFIELD } from '@/config/switchboard-flags'
import { useAnimatedPlaceholder } from '@/hooks/home/useAnimatedPlaceholder'
import { useFileUploadState } from '@/hooks/home/useFileUploadState'
import { useHeroPromptState } from '@/hooks/home/useHeroPromptState'
import { useTextareaAutoResize } from '@/hooks/home/useTextareaAutoResize'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'

interface PromptModalContentProps {
  hp: {
    promptText: string
    setPromptText: (text: string) => void
    handleStartBuilding: (overridePrompt?: string, overrideFqdn?: string) => Promise<void>
    handleExampleClick: (examplePrompt: string) => void
    setSelectedTemplate: (template: string) => void
    isLoading: boolean
    error: string | null
    setHeroError: (error: string | null) => void
    uploadedFiles: UploadedDesignFile[]
    setUploadedFiles: (files: UploadedDesignFile[]) => void
  }
  onClose: () => void
}

export function PromptModalContent({ hp, onClose }: PromptModalContentProps) {
  const t = useTranslations()
  const isModalInputAutoFocusEnabled =
    useSwitchboard(SWITCHBOARD_AIRO_BUILDER_PROJECTS_MODAL_INPUTFIELD) === true
  const {
    isTyping,
    displayText,
    isFocused,
    handleTextareaChange,
    handleTextareaKeyDown,
    handleTextareaFocus,
    handleTextareaBlur,
    handleStartBuilding,
    handleSpeechToggle,
    isListening,
    isSpeechSupported,
    onPromptBoxMouseEnter,
    onPromptBoxMouseLeave,
    bytesRemaining,
    isOverLimit,
  } = useHeroPromptState({
    promptText: hp.promptText,
    setPromptText: hp.setPromptText,
    onStartBuilding: hp.handleStartBuilding,
    isLoading: hp.isLoading,
    error: hp.error,
    setError: hp.setHeroError,
  })
  const promptTextareaRef = useTextareaAutoResize({ displayText })
  const animatedPlaceholder = useAnimatedPlaceholder({ isFocused, displayText })
  const {
    fileUploadError, setFileUploadError,
    setIsPickerProcessing,
    processingFiles, setProcessingFiles,
    isProcessing, isFileDragOver, uploadedFilesRef, dragProps,
  } = useFileUploadState({ uploadedFiles: hp.uploadedFiles, onFilesChange: hp.setUploadedFiles, isLoading: hp.isLoading })

  useEffect(function focusPromptInputOnOpen() {
    if (!isModalInputAutoFocusEnabled) return
    const id: number = window.setTimeout(() => {
      promptTextareaRef.current?.focus({ preventScroll: true })
    }, 0)
    return function cleanupFocusPromptInputOnOpen() {
      window.clearTimeout(id)
    }
  }, [isModalInputAutoFocusEnabled, promptTextareaRef])

  return (
    <Modal
      title={t('builder_apps_empty_create')}
      onClose={onClose}
      centered
      // Avoids fighting the textarea and file-picker for focus
      focusLock={false}
    >
      <PromptErrorAlert error={hp.error} onDismiss={() => hp.setHeroError(null)} />
      <div {...dragProps}>
        <PromptInput
          displayText={displayText}
          isTyping={isTyping}
          isLoading={hp.isLoading}
          isListening={isListening}
          animatedPlaceholder={animatedPlaceholder}
          textareaRef={promptTextareaRef}
          onTextareaChange={handleTextareaChange}
          onTextareaKeyDown={handleTextareaKeyDown}
          onTextareaFocus={handleTextareaFocus}
          onTextareaBlur={handleTextareaBlur}
          dataTestId="apps-prompt-input"
          isFileDragOver={isFileDragOver}
          onMouseEnter={onPromptBoxMouseEnter}
          onMouseLeave={onPromptBoxMouseLeave}
          uploadedFiles={hp.uploadedFiles}
          onFilesChange={hp.setUploadedFiles}
          uploadedFilesRef={uploadedFilesRef}
          processingFiles={processingFiles}
          isProcessing={isProcessing}
          fileUploadError={fileUploadError}
          onFileUploadError={setFileUploadError}
          onPickerProcessingChange={setIsPickerProcessing}
          onProcessingFilesChange={setProcessingFiles}
          bytesRemaining={bytesRemaining}
          isOverLimit={isOverLimit}
          isSpeechSupported={isSpeechSupported}
          onSpeechToggle={handleSpeechToggle}
          onSubmit={handleStartBuilding}
          submitText={t('builder_homepage_submit_cta_generate')}
          className="w-full max-w-2xl mx-auto"
        />
      </div>
      <ExamplesSection
        theme="light"
        onExampleClick={hp.handleExampleClick}
        onTemplateChange={hp.setSelectedTemplate}
      />
    </Modal>
  )
}
