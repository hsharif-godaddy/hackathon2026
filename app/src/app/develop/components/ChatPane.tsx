'use client'

import { useRef } from 'react'
import PlanTracker from './PlanTracker'
import ChatInput from './ChatInput'
import ChatTabs from './ChatTabs'
import { useMessageProcessing } from './useMessageProcessing'
import { useMessagesStore } from '@/stores/useMessagesStore'

interface ChatPaneProps {
  expandedPlan: boolean
  isSelectMode: boolean
  onKeyPress: (e: React.KeyboardEvent) => void
  onToggleSelectMode: () => void
  onToggleExpandedPlan: () => void
  appId?: string
}

export default function ChatPane({
  expandedPlan,
  isSelectMode,
  onKeyPress,
  onToggleSelectMode,
  onToggleExpandedPlan,
  appId = ''
}: ChatPaneProps) {
  // Get state from messages store
  const {
    messages: rawMessages,
    developmentPlan,
    inputValue,
    aiEditContext,
    isLoading,
    currentAppId,
    setInputValue,
    setAiEditContext,
    handleSendMessage: sendMessageFromStore
  } = useMessagesStore()
  
  // Only show messages and state if they belong to the current app context
  const messages = (currentAppId === appId) ? rawMessages : []
  const safeInputValue = (currentAppId === appId) ? inputValue : ''
  const safeAiEditContext = (currentAppId === appId) ? aiEditContext : null
  
  // Debug current state (only log when there's a significant change)
  const prevDebugRef = useRef<string>('')
  const currentDebugState = `${appId}-${currentAppId}-${messages?.length}`
  
  // Only log if app changed or messages changed (ignore loading/input changes)
  if (prevDebugRef.current !== currentDebugState) {
    console.log('🎯 ChatPane state changed:', {
      appIdFromProps: appId,
      currentAppIdFromStore: currentAppId,
      messagesCount: messages?.length,
      isLoading
    })
    prevDebugRef.current = currentDebugState
  }
  
  // Track processing state using the hook that follows messageService.ts logic
  const isProcessing = useMessageProcessing(messages, isLoading)
  
  // Handle sending a message
  const handleSendMessage = () => {
    console.log('🎯 ChatPane handleSendMessage called:', {
      inputValue: inputValue?.slice(0, 50) + '...',
      sendMessageFromStore: typeof sendMessageFromStore
    })
    sendMessageFromStore()
  }
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <PlanTracker 
        developmentPlan={developmentPlan}
        expandedPlan={expandedPlan}
        onToggleExpandedPlan={onToggleExpandedPlan}
      />
      
      <ChatTabs
        messages={messages}
        appId={appId}
      />
      
      {isProcessing && (
        <div className="mx-4 mb-2 rounded-md p-2 flex items-center justify-center">
          <div className="flex space-x-1 mr-2">
            <div className="w-3 h-3 bg-ai-light rounded-full animate-pulse"></div>
            <div className="w-3 h-3 bg-ai rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
            <div className="w-3 h-3 bg-ai-dark rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
          </div>
        </div>
      )}
      
      {safeAiEditContext && (
        <div className="mx-4 mb-2 px-3 py-2 border rounded-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm">✨</span>
              <span className="text-sm font-medium">Selected Element</span>
              <span className="text-xs px-2 py-0.5 rounded">
                {safeAiEditContext.elementInfo.tagName}
              </span>
            </div>
            <button
              onClick={() => setAiEditContext(null)}
              className="text-sm"
              title="Clear selection"
            >
              ×
            </button>
          </div>
        </div>
      )}
      
      <ChatInput
        inputValue={safeInputValue}
        isSelectMode={isSelectMode}
        isDisabled={isProcessing}
        onInputChange={setInputValue}
        onSendMessage={handleSendMessage}
        onKeyPress={onKeyPress}
        onToggleSelectMode={onToggleSelectMode}
      />
    </div>
  )
}
