'use client'

import ChatHeader from './ChatHeader'
import MessageList from './MessageList'
import PlanTracker from './PlanTracker'
import ChatInput from './ChatInput'
import { Message, PlanItem } from './types'

interface ChatPaneProps {
  messages: Message[]
  developmentPlan: PlanItem[]
  inputValue: string
  expandedPlan: boolean
  isSelectMode: boolean
  onInputChange: (value: string) => void
  onSendMessage: () => void
  onKeyPress: (e: React.KeyboardEvent) => void
  onToggleSelectMode: () => void
  onToggleExpandedPlan: () => void
}

export default function ChatPane({
  messages,
  developmentPlan,
  inputValue,
  expandedPlan,
  isSelectMode,
  onInputChange,
  onSendMessage,
  onKeyPress,
  onToggleSelectMode,
  onToggleExpandedPlan
}: ChatPaneProps) {
  return (
    <div className="w-96 bg-white border-r border-gray-200 flex flex-col min-h-0">
      <ChatHeader />
      
      <PlanTracker 
        developmentPlan={developmentPlan}
        expandedPlan={expandedPlan}
        onToggleExpandedPlan={onToggleExpandedPlan}
      />
      
      <MessageList messages={messages} />
      
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
