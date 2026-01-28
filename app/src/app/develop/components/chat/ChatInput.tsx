'use client'

import Button from '@ux/button'
import SendIcon from '@ux/icon/send'

import type { SendMessageOptions } from '@/app/develop/components/chat/ChatContext'
import UsageGauge from '@/app/develop/components/chat/UsageGauge'
import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID } from '@/utils/instrumentation'

interface ChatInputProps {
  appId?: string | null
  inputValue?: string
  isDisabled?: boolean
  onInputChange: (value: string) => void
  onSendMessage: (content?: string, options?: SendMessageOptions) => void
  onKeyDown?: (e: React.KeyboardEvent<Element>) => void;
}

export default function ChatInput({
  appId = null,
  inputValue = '',
  isDisabled,
  onInputChange,
  onSendMessage,
}: ChatInputProps) {
  const t = useTranslations();

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSendMessage()
    }
  }

  return (
    <div className="px-2 sm:px-3 md:px-0 mt-1 mt-auto">
      <div id="tour-chat-input" className="relative">
        <div className="flex flex-col pt-1.5 pr-1.5 pb-1 pl-1 border border-intents-ux-boxHighContrast-borderColor rounded-lg focus-within:ring-1">
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
            <UsageGauge appId={appId} />
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
