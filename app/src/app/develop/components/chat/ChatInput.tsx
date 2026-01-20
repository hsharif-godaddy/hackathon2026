'use client'

import Button from '@ux/button'
import PlusIcon from '@ux/icon/plus'
import SendIcon from '@ux/icon/send'

import AssetInline, { AssetInlineList, AssetMode } from '@/app/develop/components/chat/AssetInline'
import { AssetManagerItem, MediaType } from '@/app/develop/components/chat/AssetManagerModal'
import type { SendMessageOptions } from '@/app/develop/components/chat/ChatContext'
import UsageGauge from '@/app/develop/components/chat/UsageGauge'
import type { AiEditContext } from '@/app/develop/components/types'
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
  const isMobile = useDevelopPageStore((state) => state.isMobile);
  const isAssetManagerOpen = useDevelopPageStore((state) => state.isAssetManagerOpen);
  const setIsAssetManagerOpen = useDevelopPageStore((state) => state.setIsAssetManagerOpen);
  const { data: isAssetManagerEnabled } = useSwitchboard('appbuilder-image-manager');
  const canAddAsset = selectedAssets.length < maxAssets;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSendMessage()
    }
  }

  return (
    <div className="px-2 sm:px-3 md:px-0 mt-1 mt-auto">
      <div id="tour-chat-input" className="relative">
        <div className="flex flex-col pt-1.5 pr-1.5 pb-1 pl-1 border rounded-lg focus-within:ring-2">

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
                onChange={(e) => onInputChange(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={isDisabled ? t('builder_chatinput_processing') : t('builder_chatinput_ask_airo')}
                rows={3}
                disabled={isDisabled}
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
              <UsageGauge appId={appId} />
            </div>
            
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
  )
}
