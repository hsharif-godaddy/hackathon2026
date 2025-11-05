'use client'

import { generateClickEID } from '@/utils/instrumentation'
import Box from '@ux/box'
import Button from '@ux/button'
import WandIcon from '@ux/icon/wand'

interface ChatInputProps {
  inputValue?: string
  isDisabled?: boolean
  onInputChange: (value: string) => void
  onSendMessage: () => void
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
    <div className="px-4 mt-2 mt-auto">
      <div className="relative">
        <div className="flex items-stretch space-x-2 p-3 border rounded-lg focus-within:ring-2">
          <div className="flex-1">
            <textarea
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={isDisabled ? "Processing... please wait" : "Ask Airo to modify code, add features, or explain implementation..."}
              rows={3}
              disabled={isDisabled}
              className={`w-full h-full resize-none border-0 focus:ring-0 focus:outline-none text-sm chat-input-text`}
            />
          </div>

          <Box className="flex flex-col justify-end space-y-2" gap="sm">
            {/* Send Button */}
            <Button
              onClick={onSendMessage}
              data-eid={generateClickEID('develop.prompt.send')}
              disabled={!inputValue?.trim() || isDisabled}
              aria-label="Send message"
              design="primary"
              icon={<WandIcon className="w-4 h-4" />}
              size="sm"
              data-partial="componentAiro"
            />
          </Box>
        </div>
      </div>
    </div>
  )
}
