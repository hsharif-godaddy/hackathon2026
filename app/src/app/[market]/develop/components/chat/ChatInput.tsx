'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import Button from '@ux/button'
import MicIcon from '@ux/icon/mic'
import SendIcon from '@ux/icon/send'
import StopIcon from '@ux/icon/stop'
import XIcon from '@ux/icon/x'

import AssetInline, { AssetMode } from '@/app/[market]/develop/components/chat/AssetInline'
import { AssetManagerItem, MediaType } from '@/app/[market]/develop/components/chat/AssetTypes'
import ChatAttachmentMenu from '@/app/[market]/develop/components/chat/ChatAttachmentMenu'
import type { SendMessageOptions } from '@/app/[market]/develop/components/chat/ChatContext'
import InputActionsPanel from '@/app/[market]/develop/components/chat/InputActionsPanel'
import UsageGauge from '@/app/[market]/develop/components/chat/usage-gauge/UsageGauge'
import { useChatHistoryNavigation } from '@/app/[market]/develop/components/chat/useChatHistoryNavigation'
import type { AiEditContext } from '@/app/[market]/develop/components/types'
import type { ActiveColorSchemeSuggest } from '@/app/[market]/develop/components/utils/findLatestColorSchemeSuggest'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { logClickEvent } from '@/utils/instrumentation'
import { handleModifierEnterNewline } from '@/utils/textareaShortcuts'

export interface StagedChatFile {
  id: string
  file: File
  /** Set for image/* so AssetInline can show a thumbnail; revoked when removed or after send */
  previewUrl: string
}

const MAX_INLINE_PASTE_LENGTH = 4_000

function fileToMediaType(file: File): MediaType {
  if (file.type.startsWith('image/')) return MediaType.IMAGE
  if (file.type.startsWith('video/')) return MediaType.VIDEO
  if (file.type === 'application/pdf') return MediaType.PDF
  return MediaType.FILE
}

function collectFilesFromClipboard(e: React.ClipboardEvent): File[] {
  const items = e.clipboardData?.items
  if (!items) {
    return []
  }
  const files: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind === 'file') {
      const f = item.getAsFile()
      if (f) files.push(f)
    }
  }
  return files
}

interface ChatInputProps {
  appId?: string | null
  inputValue?: string
  isDisabled?: boolean
  isStreaming?: boolean
  /**
   * Show the stop button (disabled) while a generation has been requested but
   * the WebSocket stream has not yet started. Lets the user see a stop button
   * during the early "creating" phase even though there's nothing to stop yet.
   */
  isAwaitingStream?: boolean
  isBudgetExceeded?: boolean
  loadingMessage?: string | null
  onInputChange: (value: string) => void
  onSendMessage: (content?: string, options?: SendMessageOptions) => void | Promise<void>
  onStopGeneration?: () => void
  selectedAssets?: AssetManagerItem[]
  maxAssets?: number
  onClearSelectedAsset?: (index: number) => void
  stagedFiles?: StagedChatFile[]
  onStageFiles?: (files: File[]) => void
  onRemoveStagedFile?: (id: string) => void
  onScreenshotCaptured?: (dataUrl: string) => void
  onFileReferencesSelected?: (filePaths: string[]) => void
  onUploadError?: (errorMessage?: string) => void
  /** Staged file ids currently uploading — shows overlay spinner on each matching thumbnail */
  uploadingStagedFileIds?: readonly string[]
  referencedFiles?: Array<{ path: string; content: string }>
  onClearReferencedFile?: (index: number) => void
  aiEditContext?: AiEditContext | null
  onClearAiEditContext?: () => void
  onLargePasteDetected?: (content: string) => void
  mediaLimitError?: string | null
  userMessages?: string[]
  activeColorSchemeSuggest?: ActiveColorSchemeSuggest | null
}

export default function ChatInput({
  appId = null,
  inputValue = '',
  isDisabled,
  isStreaming,
  isAwaitingStream = false,
  isBudgetExceeded,
  loadingMessage = null,
  onInputChange,
  onSendMessage,
  onStopGeneration,
  selectedAssets = [],
  maxAssets = 1,
  onClearSelectedAsset,
  stagedFiles = [],
  onStageFiles,
  onRemoveStagedFile,
  onScreenshotCaptured,
  onFileReferencesSelected,
  onUploadError,
  uploadingStagedFileIds = [],
  referencedFiles = [],
  onClearReferencedFile,
  aiEditContext,
  onClearAiEditContext,
  onLargePasteDetected,
  userMessages = [],
  activeColorSchemeSuggest = null,
}: ChatInputProps) {
  const t = useTranslations();
  const clickContext = useMemo(() => (appId ? { appId } : undefined), [appId]);
  const { locale } = useIntl();
  const isChatGaugeEnabled = useSwitchboard('appbuilder-chat-gauge');
  const areChatPlansEnabled = useSwitchboard('airo-builder-chat-plans');
  const attachmentSlotsUsed = selectedAssets.length + stagedFiles.length
  const canAddAsset = attachmentSlotsUsed < maxAssets;

  const textBeforeListeningRef = useRef('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isFileDragOver, setIsFileDragOver] = useState(false)

  const { handleArrowUp, handleArrowDown, resetNavigation, exitNavigationMode, navRevision } =
    useChatHistoryNavigation({
      userMessages,
      inputValue,
      onInputChange,
      appId,
      isDisabled: Boolean(isDisabled && !isStreaming),
    })

  // After each navigation, move cursor to end of textarea once React has committed the new value
  useLayoutEffect(() => {
    if (navRevision > 0 && textareaRef.current) {
      const len = textareaRef.current.value.length
      textareaRef.current.setSelectionRange(len, len)
    }
  }, [navRevision])

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
  }, [isListening])

  const canStageFiles = Boolean(
    appId &&
    onStageFiles &&
    canAddAsset &&
    !((isDisabled && !isStreaming) || isBudgetExceeded || isListening)
  )

  function handleSend() {
    logClickEvent('develop.prompt.send', clickContext)();
    if (isListening) {
      textBeforeListeningRef.current = ''
      stopSpeech()
      resetTranscript()
    }
    void onSendMessage()
    resetNavigation()
  }

  const handleLargeTextPaste = useCallback(function handleLargeTextPaste(e: React.ClipboardEvent) {
    if (!onLargePasteDetected) return
    const text = e.clipboardData.getData('text/plain')
    if (text.length <= MAX_INLINE_PASTE_LENGTH) return

    e.preventDefault()
    onLargePasteDetected(text)
  }, [onLargePasteDetected])

  function handlePaste(e: React.ClipboardEvent) {
    handleLargeTextPaste(e)
    if (e.defaultPrevented) return

    if (isDisabled || isBudgetExceeded || isListening) return

    const files = collectFilesFromClipboard(e)
    if (files.length > 0 && canStageFiles && onStageFiles) {
      e.preventDefault()
      onStageFiles(files)
      return
    }

    const items = e.clipboardData?.items
    if (!items?.length) return

    const imageItem = Array.from(items).find(
      item => item.type.startsWith('image/')
    )

    if (!imageItem || !canAddAsset || !onScreenshotCaptured) return

    const file = imageItem.getAsFile()
    if (!file) return

    e.preventDefault()

    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const maxDimension = 1024
        const scale = Math.min(1, maxDimension / img.width, maxDimension / img.height)
        const targetWidth = Math.round(img.width * scale)
        const targetHeight = Math.round(img.height * scale)

        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        ctx.drawImage(img, 0, 0, targetWidth, targetHeight)
        onScreenshotCaptured(canvas.toDataURL('image/jpeg', 0.75))
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    }
    img.onerror = () => URL.revokeObjectURL(objectUrl)
    img.src = objectUrl
  }

  function handleDragEnter(e: React.DragEvent<HTMLDivElement>) {
    if (!canStageFiles || !e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    setIsFileDragOver(true)
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!canStageFiles || !e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    // Do not gate on dataTransfer.types — it is often empty in dragleave (e.g. Firefox protected mode),
    // which would skip clearing and leave the drag ring stuck.
    e.stopPropagation()
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsFileDragOver(false)
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!canStageFiles || !onStageFiles) return
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    setIsFileDragOver(false)
    const files = Array.from(e.dataTransfer.files || [])
    if (files.length === 0) return
    onStageFiles(files)
  }

  const canSubmit = Boolean(inputValue?.trim())

  function getPlaceholder() {
    if (isBudgetExceeded) return t('builder_chatinput_budget_exceeded');
    if (isDisabled && !isStreaming) return loadingMessage ?? t('builder_chatinput_processing');
    return t('builder_chatinput_ask_airo');
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'ArrowUp') {
      if (textareaRef.current && handleArrowUp(textareaRef.current)) {
        e.preventDefault()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      if (textareaRef.current && handleArrowDown(textareaRef.current)) {
        e.preventDefault()
      }
      return
    }
    if (handleModifierEnterNewline(e, {
      currentValue: inputValue,
      onValueChange: (nextValue) => {
        exitNavigationMode()
        onInputChange(nextValue)
      },
    })) {
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (
        canSubmit &&
        uploadingStagedFileIds.length === 0 &&
        !((isStreaming || isAwaitingStream) && onStopGeneration)
      ) {
        handleSend()
      }
    }
  }

  const cardClassName = `flex flex-col p-1.5 mb-px bg-intents-ux-box-backgroundColor shadow-md rounded-lg focus-within:ring-1 focus-within:ring-ai-light${
    isFileDragOver ? ' ring-2 ring-ai-light ring-offset-1' : ''
  }`

  return (
    <div className="px-2 sm:px-3 md:px-0 mt-1 mt-auto pb-1">
      <div id="tour-chat-input" className="relative">
        <div
          data-testid="chat-input-card"
          className={cardClassName}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {areChatPlansEnabled ? (
            <InputActionsPanel activeColorSchemeSuggest={activeColorSchemeSuggest} />
          ) : null}

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

          {/* Selected assets and staged local files (upload overlay on staged items) */}
          {(selectedAssets.length > 0 || stagedFiles.length > 0) && (
            <div className="flex flex-wrap gap-1 mb-1">
              {selectedAssets.map((asset, index) => (
                <AssetInline
                  key={asset.imageUrl ?? `asset-${index}`}
                  asset={asset}
                  onClear={() => onClearSelectedAsset?.(index)}
                  mode={AssetMode.EDIT}
                />
              ))}

              {stagedFiles.map((s) => (
                <AssetInline
                  key={s.id}
                  customAsset={{
                    mediaType: fileToMediaType(s.file),
                    imageUrl: s.previewUrl || undefined,
                    filename: s.file.name,
                    imageAlt: s.file.name,
                  }}
                  onClear={() => onRemoveStagedFile?.(s.id)}
                  mode={AssetMode.EDIT}
                  isLoading={uploadingStagedFileIds.includes(s.id)}
                />
              ))}
            </div>
          )}

          <div className="flex items-stretch space-x-1">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                id="chat-input-textarea"
                data-testid="chat-input-textarea"
                value={inputValue}
                onChange={(e) => {
                  if (isListening) return
                  exitNavigationMode()
                  onInputChange(e.target.value)
                }}
                onPaste={handlePaste}
                onKeyDown={onKeyDown}
                placeholder={getPlaceholder()}
                rows={3}
                disabled={(isDisabled && !isStreaming) || isListening || isBudgetExceeded}
                className={`w-full h-full resize-none border-0 focus:ring-0 focus:outline-none text-base md:text-sm chat-input-text`}
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-1">
              {appId && onStageFiles && (
                <ChatAttachmentMenu
                  appId={appId}
                  onStageFiles={onStageFiles}
                  onScreenshotCaptured={onScreenshotCaptured}
                  onFileReferencesSelected={onFileReferencesSelected}
                  onUploadError={onUploadError}
                  disabled={(isDisabled && !isStreaming) || isBudgetExceeded || !canAddAsset}
                />
              )}
              {isChatGaugeEnabled && <UsageGauge appId={appId} />}
            </div>

            <div className="flex items-center gap-0.5">
              {isSpeechSupported && (
                <Button
                  onClick={() => {
                    logClickEvent('develop.prompt.speech', clickContext)();
                    toggleSpeech();
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  disabled={(isDisabled && !isStreaming) || isBudgetExceeded}
                  design={isListening ? 'primary' : 'control'}
                  className={isListening
                    ? '!bg-intents-ux-feedbackHighContrastCritical-feedbackColor !border-none'
                    : '!bg-transparent'
                  }
                  icon={<MicIcon />}
                  size="sm"
                  aria-label={isListening ? t('builder_homepage_hero_stop_listening', undefined, 'Stop listening') : t('builder_chatinput_start_listening', undefined, 'Start listening')}
                  aria-pressed={isListening}
                />
              )}
              {(isStreaming || isAwaitingStream) && onStopGeneration ? (
                <Button
                  data-testid="chat-stop-button"
                  onClick={() => {
                    if (!isStreaming) return
                    logClickEvent('develop.prompt.stop', clickContext)();
                    onStopGeneration();
                  }}
                  disabled={!isStreaming}
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
                  disabled={!canSubmit || (isDisabled && !isStreaming) || isBudgetExceeded || uploadingStagedFileIds.length > 0}
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
