'use client'

import Box from '@ux/box'
import Button from '@ux/button'
import PencilIcon from '@ux/icon/edit'
import WandIcon from '@ux/icon/wand'

interface ChatInputProps {
  inputValue: string
  isSelectMode: boolean
  isDisabled?: boolean
  onInputChange: (value: string) => void
  onSendMessage: () => void
  onKeyPress: (e: React.KeyboardEvent) => void
  onToggleSelectMode: () => void
}

export default function ChatInput({
  inputValue,
  isSelectMode,
  isDisabled,
  onInputChange,
  onSendMessage,
  onKeyPress,
  onToggleSelectMode
}: ChatInputProps) {
  return (
    <div className="p-4 border-t">
      {/* Cursor-style Chat Input */}
      <div className="relative">
        <div className="flex items-stretch space-x-2 p-3 border rounded-lg bg-white shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
          <div className="flex-1">
            <textarea
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyPress={onKeyPress}
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
              disabled={isDisabled}
              title={isSelectMode ? 'Select mode active' : 'Enable element selector'}
              design="control"
              icon={<PencilIcon className="w-4 h-4" />}
              size="sm"
            />
            
            {/* Send Button */}
            <Button
              onClick={onSendMessage}
              disabled={!inputValue.trim() || isDisabled}
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
