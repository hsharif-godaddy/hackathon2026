'use client'

import { PaperAirplaneIcon, PencilIcon } from '@heroicons/react/24/outline'

interface ChatInputProps {
  inputValue: string
  isSelectMode: boolean
  onInputChange: (value: string) => void
  onSendMessage: () => void
  onKeyPress: (e: React.KeyboardEvent) => void
  onToggleSelectMode: () => void
}

export default function ChatInput({
  inputValue,
  isSelectMode,
  onInputChange,
  onSendMessage,
  onKeyPress,
  onToggleSelectMode
}: ChatInputProps) {
  return (
    <div className="p-4 bg-white border-t border-gray-200">
      {/* Cursor-style Chat Input */}
      <div className="relative">
        <div className="flex items-end space-x-2 p-3 border border-gray-300 rounded-lg bg-white shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
          <div className="flex-1">
            <textarea
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyPress={onKeyPress}
              placeholder="Ask CodeBot-DEV to modify code, add features, or explain implementation..."
              rows={2}
              className="w-full resize-none border-0 focus:ring-0 focus:outline-none text-sm placeholder-gray-500 chat-input-text"
              style={{ minHeight: '44px', maxHeight: '120px' }}
            />
          </div>
          
          {/* Element Selector Button */}
          <button
            onClick={onToggleSelectMode}
            className={`p-2 rounded-md transition-all duration-200 ${
              isSelectMode
                ? 'bg-blue-100 text-blue-600 hover:bg-blue-200'
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
            }`}
            title={isSelectMode ? 'Select mode active' : 'Enable element selector'}
          >
            <PencilIcon className="w-4 h-4" />
          </button>
          
          {/* Send Button */}
          <button
            onClick={onSendMessage}
            disabled={!inputValue.trim()}
            className="p-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
          >
            <PaperAirplaneIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
