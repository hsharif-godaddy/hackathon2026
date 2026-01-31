'use client'

import clsx from 'clsx'
import { useEffect, useRef } from 'react'
import { useIntl } from 'react-intl'
import Button from '@ux/button'
import MicIcon from '@ux/icon/mic'
import PlusIcon from '@ux/icon/plus'
import SendIcon from '@ux/icon/send'

import AssetInline, { AssetInlineList, AssetMode } from '@/app/develop/components/chat/AssetInline'
import { AssetManagerItem, MediaType } from '@/app/develop/components/chat/AssetManagerModal'
import type { SendMessageOptions } from '@/app/develop/components/chat/ChatContext'
import UsageGauge from '@/app/develop/components/chat/UsageGauge'
import type { AiEditContext } from '@/app/develop/components/types'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { generateClickEID } from '@/utils/instrumentation'

interface ChatInputProps {
  appId?: string | null
  inputValue?: string
  isDisabled?: boolean
  onInputChange: (value: string) => void
  onSendMessage: (content?: string, options?: SendMessageOptions) => void
  onKeyDown?: (e: React.KeyboardEvent<Element>) => void;
  selectedAssets?: AssetManagerItem[]
  maxAssets?: number
  onClearSelectedAsset?: (index: number) => void
  aiEditContext?: AiEditContext | null
  onClearAiEditContext?: () => void
  mediaLimitError?: string | null
}

export default function ChatInput({
  appId = null,
  inputValue = '',
  isDisabled,
  onInputChange,
  onSendMessage,
  selectedAssets = [],
  maxAssets = 1,
  onClearSelectedAsset,
  aiEditContext,
  onClearAiEditContext,
}: ChatInputProps) {
  const t = useTranslations();
  const { locale } = useIntl();
  const isMobile = useDevelopPageStore((state) => state.isMobile);
  const isAssetManagerOpen = useDevelopPageStore((state) => state.isAssetManagerOpen);
  const setIsAssetManagerOpen = useDevelopPageStore((state) => state.setIsAssetManagerOpen);
  const { data: isAssetManagerEnabled } = useSwitchboard('appbuilder-image-manager');
  const { data: isChatGaugeEnabled } = useSwitchboard('appbuilder-chat-gauge');
  const canAddAsset = selectedAssets.length < maxAssets;

  const textBeforeListeningRef = useRef('')

  const {
    isListening,
    isSupported: isSpeechSupported,
    toggle: toggleSpeech,
    transcript: speechTranscript,
    stop: stopSpeech,
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

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSendMessage()
    }
  }

  return (
    <div className="px-2 sm:px-3 md:px-0 mt-1 mt-auto">
      <div id="tour-chat-input" className="relative">
        <div className="flex flex-col pt-1.5 pr-1.5 pb-1 pl-1 mb-px border border-intents-ux-boxHighContrast-borderColor rounded-lg focus-within:ring-1">
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

          {/* Selected Asset - shows when image is selected from Asset Manager */}
          {onClearSelectedAsset && (
            <AssetInlineList
              assets={selectedAssets}
              onClearAsset={onClearSelectedAsset}
              className="mb-1"
              mode={AssetMode.EDIT}
            />
          )}

          <div className="flex items-stretch space-x-1">
            <div className="flex-1">
              <textarea
                id="chat-input-textarea"
                value={inputValue}
                onChange={(e) => {
                  if (isListening) return
                  onInputChange(e.target.value)
                }}
                onKeyDown={onKeyDown}
                placeholder={isDisabled ? t('builder_chatinput_processing') : t('builder_chatinput_ask_airo')}
                rows={3}
                disabled={isDisabled || isListening}
                className={`w-full h-full resize-none border-0 focus:ring-0 focus:outline-none text-base md:text-sm chat-input-text`}
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-0.5">
              {(!isMobile || (isMobile && isAssetManagerEnabled)) && (
                <Button
                  id="chat-media-button"
                  icon={<PlusIcon />}
                  data-eid={generateClickEID('develop.chat_toolbar.medias')}
                  onClick={() => isAssetManagerEnabled && canAddAsset ? setIsAssetManagerOpen(true) : undefined}
                  aria-label={t('builder_chat_toolbar_button_media')}
                  active={isAssetManagerOpen}
                  disabled={isDisabled || !canAddAsset}
                  design="control"
                  size="sm"
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
                  disabled={isDisabled}
                  design="control"
                  className={clsx(
                    'cursor-pointer !rounded-full aspect-square !border-none !outline-none !ring-0',
                    isListening
                      ? '!bg-intents-ux-boxLowContrast-backgroundColor [&_svg]:!text-intents-ux-box-foregroundColor'
                      : '!bg-transparent'
                  )}
                  icon={<MicIcon />}
                  size="sm"
                />
              )}
              <Button
                id="chat-send-button"
                onClick={() => onSendMessage()}
                data-eid={generateClickEID('develop.prompt.send')}
                disabled={!inputValue?.trim() || isDisabled}
                aria-label={t('builder_chatinput_send')}
                design="primary"
                icon={<SendIcon />}
                size="sm"
                data-partial="componentAiro"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
