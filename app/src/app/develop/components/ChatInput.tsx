'use client'

import { generateClickEID } from '@/utils/instrumentation'
import Box from '@ux/box'
import Button from '@ux/button'
import PencilIcon from '@ux/icon/edit'
import WandIcon from '@ux/icon/wand'

interface ChatInputProps {
  inputValue?: string
  isSelectMode: boolean
  isDisabled?: boolean
  onInputChange: (value: string) => void
  onSendMessage: () => void
  onToggleSelectMode: () => void
  onKeyDown?: (e: React.KeyboardEvent<Element>) => void;
}

export default function ChatInput({
  inputValue = '',
  isSelectMode,
  isDisabled,
  onInputChange,
  onSendMessage,
  onToggleSelectMode
}: ChatInputProps) {
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSendMessage()
    }
  }

  return (
    <div className="p-4 border-t">
      {/* Cursor-style Chat Input */}
      <div className="relative">
        <div className="flex items-stretch space-x-2 p-3 border rounded-lg bg-white shadow-sm focus-within:ring-2">
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

          <Box className="flex flex-col space-y-2" gap="sm">
            {/* Element Selector Button */}
            <Button
              onClick={onToggleSelectMode}
              data-eid={ generateClickEID('develop.prompt.selector') }
              disabled={isDisabled}
              title={isSelectMode ? 'Select mode active' : 'Enable element selector'}
              aria-label={isSelectMode ? 'Select mode active' : 'Enable element selector'}
              design="control"
              icon={<PencilIcon className="w-4 h-4" />}
              size="sm"
            />

            {/* Send Button */}
            <Button
              onClick={onSendMessage}
              data-eid={ generateClickEID('develop.prompt.send') }
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
