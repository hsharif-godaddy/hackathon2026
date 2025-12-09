'use client'

import { generateClickEID } from '@/utils/instrumentation'
import type { SendMessageOptions } from './ChatContext'
import Box from '@ux/box'
import Button from '@ux/button'
import SendIcon from '@ux/icon/send'

interface ChatInputProps {
  inputValue?: string
  isDisabled?: boolean
  onInputChange: (value: string) => void
  onSendMessage: (content?: string, options?: SendMessageOptions) => void
  onKeyDown?: (e: React.KeyboardEvent<Element>) => void;
}

export default function ChatInput({
  inputValue = '',
  isDisabled,
  onInputChange,
  onSendMessage,
}: ChatInputProps) {
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSendMessage()
    }
  }

  return (
    <div className="px-2 sm:px-3 md:px-0 mt-1 mt-auto">
      <div id="tour-chat-input" className="relative">
        <div className="flex items-stretch space-x-1 p-1.5 border rounded-lg focus-within:ring-2">
          <div className="flex-1">
            <textarea
              id="chat-input-textarea"
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={isDisabled ? "Processing... please wait" : "Ask Airo to modify code, add features, or explain implementation..."}
              rows={3}
              disabled={isDisabled}
              className={`w-full h-full resize-none border-0 focus:ring-0 focus:outline-none text-sm chat-input-text`}
            />
          </div>

          <Box className="flex flex-col justify-end" gap="sm">
            {/* Send Button */}
            <Button
              id="chat-send-button"
              onClick={() => onSendMessage()}
              data-eid={generateClickEID('develop.prompt.send')}
              disabled={!inputValue?.trim() || isDisabled}
              aria-label="Send message"
              design="primary"
              icon={<SendIcon />}
              size="sm"
              data-partial="componentAiro"
            />
          </Box>
        </div>
      </div>
    </div>
  )
}
