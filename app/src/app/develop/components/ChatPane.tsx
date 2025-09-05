'use client'

import { useRef } from 'react'
import MessageList from './MessageList'
import PlanTracker from './PlanTracker'
import ChatInput from './ChatInput'
import ChatHeader from './ChatHeader'
import VersionHistory from './VersionHistory'
import { useMessageProcessing } from './useMessageProcessing'
import { useMessagesStore } from '@/stores/useMessagesStore'

interface ChatPaneProps {
  expandedPlan: boolean
  isSelectMode: boolean
  onKeyPress: (e: React.KeyboardEvent) => void
  onToggleSelectMode: () => void
  onToggleExpandedPlan: () => void
  onToggleVersionHistory?: () => void
  isVersionHistoryOpen?: boolean
  hasSelectedCommit?: boolean
  appId?: string
  selectedCommit?: {
    hash: string
    shortHash: string
    message: string
    author: string
    date: string
  } | null
  commits?: Array<{
    hash: string
    shortHash: string
    message: string
    author: string
    date: string
  }>
  isLoadingCommits?: boolean
  onRefreshCommits?: () => void
  onSelectCommit?: (commit: {
    hash: string
    shortHash: string
    message: string
    author: string
    date: string
  } | null) => void
}

export default function ChatPane({
  expandedPlan,
  isSelectMode,
  onKeyPress,
  onToggleSelectMode,
  onToggleExpandedPlan,
  onToggleVersionHistory = () => {},
  isVersionHistoryOpen = false,
  hasSelectedCommit = false,
  appId = '',
  selectedCommit = null,
  commits = [],
  isLoadingCommits = false,
  onRefreshCommits = () => {},
  onSelectCommit = () => {}
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
      <ChatHeader 
        onToggleVersionHistory={onToggleVersionHistory}
        isVersionHistoryOpen={isVersionHistoryOpen}
        hasSelectedCommit={hasSelectedCommit}
      />
      <PlanTracker 
        developmentPlan={developmentPlan}
        expandedPlan={expandedPlan}
        onToggleExpandedPlan={onToggleExpandedPlan}
      />
      
      {/* Toggle between MessageList and VersionHistory */}
      {isVersionHistoryOpen ? (
        <div className="flex-1 overflow-auto">
          <VersionHistory
            appId={appId}
            isOpen={true}
            onClose={onToggleVersionHistory}
            onSelectCommit={onSelectCommit}
            selectedCommit={selectedCommit}
            commits={commits}
            isLoading={isLoadingCommits}
            onRefresh={onRefreshCommits}
          />
        </div>
      ) : (
        <MessageList messages={messages} />
      )}
      
      {/* AI Edit Context Display - Simple selector above input */}
      {/* Chat Status Indicator - only shows during processing */}
      {isProcessing && (
        <div className="mx-4 mb-2 rounded-md p-2 flex items-center justify-center">
          <div className="flex space-x-1 mr-2">
            <div className="w-3 h-3 bg-gray-400 rounded-full animate-pulse"></div>
            <div className="w-3 h-3 bg-gray-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
            <div className="w-3 h-3 bg-gray-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
          </div>
        </div>
      )}
      
      {safeAiEditContext && (
        <div className="mx-4 mb-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm">✨</span>
              <span className="text-sm font-medium text-blue-900">Selected Element</span>
              <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded">
                {safeAiEditContext.elementInfo.tagName}
              </span>
            </div>
            <button
              onClick={() => setAiEditContext(null)}
              className="text-blue-400 hover:text-blue-600 text-sm"
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
