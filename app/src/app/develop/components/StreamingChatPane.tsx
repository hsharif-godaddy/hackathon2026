'use client'

import { useRef, useMemo } from 'react'
import PlanTracker from './PlanTracker'
import ChatInput from './ChatInput'
import StreamingChatTabs from './StreamingChatTabs'
import { 
  useInputValue, 
  useIsLoading, 
  useCurrentAppId,
  useMessages,
  useActiveStream,
  useIsActivelyStreaming,
  useDevelopmentPlan,
  useAiEditContext,
  useSetInputValue,
  useSetAiEditContext,
  useSetCurrentAppId
} from '@/stores/useStreamingConversationStore'
import { useStreamingWebSocket } from '@/hooks/useStreamingWebSocket'

interface StreamingChatPaneProps {
  expandedPlan: boolean
  isSelectMode: boolean
  onKeyPress: (e: React.KeyboardEvent) => void
  onToggleSelectMode: () => void
  onToggleExpandedPlan: () => void
  appId?: string
}

export default function StreamingChatPane({
  expandedPlan,
  isSelectMode,
  onKeyPress,
  onToggleSelectMode,
  onToggleExpandedPlan,
  appId = ''
}: StreamingChatPaneProps) {
  // Get state from streaming store
  const messages = useMessages()
  const activeStream = useActiveStream()
  const inputValue = useInputValue()
  const isLoading = useIsLoading()
  const currentAppId = useCurrentAppId()
  const isStreaming = useIsActivelyStreaming()
  const developmentPlan = useDevelopmentPlan()
  const aiEditContext = useAiEditContext()
  const setInputValue = useSetInputValue()
  const setAiEditContext = useSetAiEditContext()
  const setCurrentAppId = useSetCurrentAppId()
  
  // Get WebSocket functionality
  const { sendMessage } = useStreamingWebSocket()
  
  // Combine messages and activeStream with useMemo to prevent infinite loops
  const allMessages = useMemo(() => {
    return activeStream ? [...messages, activeStream] : messages
  }, [messages, activeStream])
  
  // Only show messages and state if they belong to the current app context
  const visibleMessages = (currentAppId === appId) ? allMessages : []
  const safeInputValue = (currentAppId === appId) ? (inputValue || '') : ''
  const safeAiEditContext = (currentAppId === appId) ? aiEditContext : null
  
  // Debug current state (only log when there's a significant change)
  const prevDebugRef = useRef<string>('')
  const currentDebugState = `${appId}-${currentAppId}-${visibleMessages?.length}`
  
  // Only log if app changed or messages changed (ignore loading/input changes)
  if (prevDebugRef.current !== currentDebugState) {
    console.log('🎯 StreamingChatPane state changed:', {
      appIdFromProps: appId,
      currentAppIdFromStore: currentAppId,
      messagesCount: visibleMessages?.length,
      isLoading
    })
    prevDebugRef.current = currentDebugState
  }
  
  // Track processing state - use isLoading OR isStreaming to match original behavior
  const isProcessing = isLoading || isStreaming
  
  // Handle sending a message
  const handleSendMessage = () => {
    console.log('🎯 StreamingChatPane handleSendMessage called:', {
      inputValue: inputValue?.slice(0, 50) + '...',
      sendMessage: typeof sendMessage
    })
    
    if (inputValue?.trim()) {
      // Ensure we're connected to the right app
      if (currentAppId !== appId) {
        setCurrentAppId(appId)
      }
      
      // Send the message using the streaming WebSocket
      sendMessage(inputValue, safeAiEditContext)
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <PlanTracker 
        developmentPlan={developmentPlan}
        expandedPlan={expandedPlan}
        onToggleExpandedPlan={onToggleExpandedPlan}
      />
      
      <StreamingChatTabs
        messages={visibleMessages}
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
