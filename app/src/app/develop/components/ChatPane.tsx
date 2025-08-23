'use client'

import ChatHeader from './ChatHeader'
import MessageList from './MessageList'
import PlanTracker from './PlanTracker'
import ChatInput from './ChatInput'
import { Message, PlanItem, AiEditContext } from './types'

interface ChatPaneProps {
  messages: Message[]
  developmentPlan: PlanItem[]
  inputValue: string
  expandedPlan: boolean
  isSelectMode: boolean
  aiEditContext: AiEditContext | null
  onInputChange: (value: string) => void
  onSendMessage: () => void
  onKeyPress: (e: React.KeyboardEvent) => void
  onToggleSelectMode: () => void
  onToggleExpandedPlan: () => void
  onClearAiEditContext: () => void
}

export default function ChatPane({
  messages,
  developmentPlan,
  inputValue,
  expandedPlan,
  isSelectMode,
  aiEditContext,
  onInputChange,
  onSendMessage,
  onKeyPress,
  onToggleSelectMode,
  onToggleExpandedPlan,
  onClearAiEditContext
}: ChatPaneProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ChatHeader />
      
      <PlanTracker 
        developmentPlan={developmentPlan}
        expandedPlan={expandedPlan}
        onToggleExpandedPlan={onToggleExpandedPlan}
      />
      
      <MessageList messages={messages} />
      
      {/* AI Edit Context Display - Simple selector above input */}
      {aiEditContext && (
        <div className="mx-4 mb-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm">✨</span>
              <span className="text-sm font-medium text-blue-900">Selected Element</span>
              <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded">
                {aiEditContext.elementInfo.tagName}
              </span>
            </div>
            <button
              onClick={onClearAiEditContext}
              className="text-blue-400 hover:text-blue-600 text-sm"
              title="Clear selection"
            >
              ×
            </button>
          </div>
        </div>
      )}
      
      <ChatInput
        inputValue={inputValue}
        isSelectMode={isSelectMode}
        onInputChange={onInputChange}
        onSendMessage={onSendMessage}
        onKeyPress={onKeyPress}
        onToggleSelectMode={onToggleSelectMode}
      />
    </div>
  )
}
