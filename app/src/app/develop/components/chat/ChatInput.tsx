'use client'

import { useEffect, useRef } from 'react'
import { useIntl } from 'react-intl'
import Button from '@ux/button'
import MicIcon from '@ux/icon/mic'
import SendIcon from '@ux/icon/send'
import StopIcon from '@ux/icon/stop'
import XIcon from '@ux/icon/x'

import AssetInline, { AssetMode } from '@/app/develop/components/chat/AssetInline'
import { AssetManagerItem, MediaType } from '@/app/develop/components/chat/AssetTypes'
import ChatAttachmentMenu, { UploadedFile } from '@/app/develop/components/chat/ChatAttachmentMenu'
import type { SendMessageOptions } from '@/app/develop/components/chat/ChatContext'
import UsageGauge from '@/app/develop/components/chat/usage-gauge/UsageGauge'
import type { AiEditContext } from '@/app/develop/components/types'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID } from '@/utils/instrumentation'

interface ChatInputProps {
  appId?: string | null
  inputValue?: string
  isDisabled?: boolean
  isStreaming?: boolean
  isBudgetExceeded?: boolean
  onInputChange: (value: string) => void
  onSendMessage: (content?: string, options?: SendMessageOptions) => void
  onStopGeneration?: () => void
  selectedAssets?: AssetManagerItem[]
  maxAssets?: number
  onClearSelectedAsset?: (index: number) => void
  onFilesUploaded?: (files: UploadedFile[]) => void
  onScreenshotCaptured?: (dataUrl: string) => void
  onFileReferencesSelected?: (filePaths: string[]) => void
  onUploadStart?: (files: File[]) => void
  onUploadError?: (errorMessage?: string) => void
  uploadingFiles?: Array<{ id: string; name: string }>
  referencedFiles?: Array<{ path: string; content: string }>
  onClearReferencedFile?: (index: number) => void
  aiEditContext?: AiEditContext | null
  onClearAiEditContext?: () => void
  mediaLimitError?: string | null
}

export default function ChatInput({
  appId = null,
  inputValue = '',
  isDisabled,
  isStreaming,
  isBudgetExceeded,
  onInputChange,
  onSendMessage,
  onStopGeneration,
  selectedAssets = [],
  maxAssets = 1,
  onClearSelectedAsset,
  onFilesUploaded,
  onScreenshotCaptured,
  onFileReferencesSelected,
  onUploadStart,
  onUploadError,
  uploadingFiles = [],
  referencedFiles = [],
  onClearReferencedFile,
  aiEditContext,
  onClearAiEditContext,
}: ChatInputProps) {
  const t = useTranslations();
  const { locale } = useIntl();
  const { data: isChatGaugeEnabled } = useSwitchboard('appbuilder-chat-gauge');
  const canAddAsset = selectedAssets.length < maxAssets;

  const textBeforeListeningRef = useRef('')

  const {
    isListening,
    isSupported: isSpeechSupported,
    toggle: toggleSpeech,
    transcript: speechTranscript,
    stop: stopSpeech,
    resetTranscript,
  } = useSpeechRecognition({ language: locale })

  useEffect(function ensureMicrophoneOffOnMount() {
    if (isSpeechSupported) {
      stopSpeech()
    }
  }, [isSpeechSupported, stopSpeech])

  useEffect(function syncSpeechTranscript() {
    if (isListening && speechTranscript) {
      const baseText = textBeforeListeningRef.current
      const separator = baseText && !baseText.endsWith(' ') ? ' ' : ''
      const newText = baseText + separator + speechTranscript
      onInputChange(newText)
    }
  }, [isListening, speechTranscript, onInputChange])

  useEffect(function captureTextOnListeningStart() {
    if (isListening) {
      textBeforeListeningRef.current = inputValue
    }
  }, [isListening]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSend() {
    if (isListening) {
      // Clear ref before stopping to prevent race condition with captureTextOnListeningStart effect
      textBeforeListeningRef.current = ''
      stopSpeech()
      resetTranscript()
    }
    onSendMessage()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (inputValue?.trim() && uploadingFiles.length === 0 && !(isStreaming && onStopGeneration)) {
        handleSend()
      }
    }
  }

  return (
    <div className="px-2 sm:px-3 md:px-0 mt-1 mt-auto pb-1">
      <div id="tour-chat-input" className="relative">
        <div className="flex flex-col p-1.5 mb-px bg-intents-ux-box-backgroundColor shadow-md rounded-lg focus-within:ring-1 focus-within:ring-ai-light">
          {/* AI Edit Context - shows screenshot (works for both Edit with AI and Replace Image) */}
          {aiEditContext && aiEditContext.screenshot && (
            <div className="mb-1">
              <AssetInline
                customAsset={{
                  imageUrl: aiEditContext.screenshot,
                  imageAlt: t('builder_chatpane_edit_selected'),
                  mediaType: MediaType.IMAGE}
                }
                onClear={onClearAiEditContext}
                mode={AssetMode.EDIT}
              />
            </div>
          )}

          {/* AI Edit Context - element-only (no screenshot) */}
          {aiEditContext && !aiEditContext.screenshot && (
            <div className="flex items-center gap-1.5 mb-1 px-2 py-1 bg-intents-ux-box-backgroundColor border border-intents-ux-boxHighContrast-borderColor rounded text-xs">
              <span className="inline-block w-2 h-2 rounded-full flex-shrink-0 bg-intents-ux-action-backgroundColor" />
              <span className="text-intents-ux-box-foregroundColor">
                {t('builder_chatpane_editing_element', undefined, 'Editing')} <strong>&lt;{aiEditContext.elementInfo.tagName}&gt;</strong>
              </span>
              {onClearAiEditContext && (
                <Button
                  design="inline"
                  size="sm"
                  onClick={onClearAiEditContext}
                  aria-label={t('builder_chatpane_clear_edit_context', undefined, 'Clear edit context')}
                  className="ml-auto"
                  data-partial="componentAiro"
                >
                  <XIcon className="size-2" />
                </Button>
              )}
            </div>
          )}

          {/* Referenced files */}
          {referencedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1">
              {referencedFiles.map((file, index) => (
                <div
                  key={file.path}
                  className="flex items-center gap-1 px-2 py-1 bg-intents-ux-box-backgroundColor border border-intents-ux-boxHighContrast-borderColor rounded text-xs"
                >
                  <span className="text-intents-ux-box-foregroundColor">{file.path.split('/').pop()}</span>
                  <button
                    onClick={() => onClearReferencedFile?.(index)}
                    className="text-intents-ux-box-foregroundColor/50 hover:text-intents-ux-box-foregroundColor"
                    aria-label="Remove referenced file"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Selected assets and uploading placeholders - combined in one line */}
          {(selectedAssets.length > 0 || uploadingFiles.length > 0) && (
            <div className="flex flex-wrap gap-1 mb-1">
              {/* Selected assets */}
              {selectedAssets.map((asset, index) => (
                <AssetInline
                  key={asset.imageUrl}
                  asset={asset}
                  onClear={() => onClearSelectedAsset?.(index)}
                  mode={AssetMode.EDIT}
                />
              ))}

              {/* Uploading placeholders */}
              {uploadingFiles.map((file) => (
                <AssetInline
                  key={file.id}
                  isLoading={true}
                  onClear={() => {}}
                  mode={AssetMode.EDIT}
                />
              ))}
            </div>
          )}

          <div className="flex items-stretch space-x-1">
            <div className="flex-1">
              <textarea
                id="chat-input-textarea"
                data-testid="chat-input-textarea"
                value={inputValue}
                onChange={(e) => {
                  if (isListening) return
                  onInputChange(e.target.value)
                }}
                onKeyDown={onKeyDown}
                placeholder={isBudgetExceeded ? t('builder_chatinput_budget_exceeded') : (isDisabled && !isStreaming) ? t('builder_chatinput_processing') : t('builder_chatinput_ask_airo')}
                rows={3}
                disabled={(isDisabled && !isStreaming) || isListening || isBudgetExceeded}
                className={`w-full h-full resize-none border-0 focus:ring-0 focus:outline-none text-base md:text-sm chat-input-text`}
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-0.5">
              {appId && onFilesUploaded && (
                <ChatAttachmentMenu
                  appId={appId}
                  onFilesUploaded={onFilesUploaded}
                  onScreenshotCaptured={onScreenshotCaptured}
                  onFileReferencesSelected={onFileReferencesSelected}
                  onUploadStart={onUploadStart}
                  onUploadError={onUploadError}
                  disabled={(isDisabled && !isStreaming) || isBudgetExceeded || !canAddAsset}
                />
              )}
              {isChatGaugeEnabled && <UsageGauge appId={appId} />}
            </div>

            <div className="flex items-center gap-0.5">
              {isSpeechSupported && (
                <Button
                  onClick={toggleSpeech}
                  onMouseDown={(e) => e.preventDefault()}
                  data-eid={generateClickEID('develop.prompt.speech')}
                  disabled={(isDisabled && !isStreaming) || isBudgetExceeded}
                  design={isListening ? 'primary' : 'control'}
                  className={isListening
                    ? '!bg-intents-ux-feedbackHighContrastCritical-feedbackColor !border-none'
                    : '!bg-transparent'
                  }
                  icon={<MicIcon />}
                  size="sm"
                />
              )}
              {isStreaming && onStopGeneration ? (
                <Button
                  data-testid="chat-stop-button"
                  onClick={onStopGeneration}
                  data-eid={generateClickEID('develop.prompt.stop')}
                  aria-label={t('builder_chatinput_stop')}
                  design="primary"
                  icon={<StopIcon />}
                  size="sm"
                />
              ) : (
                <Button
                  id="chat-send-button"
                  data-testid="chat-send-button"
                  onClick={handleSend}
                  data-eid={generateClickEID('develop.prompt.send')}
                  disabled={!inputValue?.trim() || (isDisabled && !isStreaming) || isBudgetExceeded || uploadingFiles.length > 0}
                  aria-label={t('builder_chatinput_send')}
                  design="primary"
                  icon={<SendIcon />}
                  size="sm"
                  data-partial="componentAiro"
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
