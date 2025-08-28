'use client'

import { useState } from 'react'
import MessageList from './MessageList'
import PlanTracker from './PlanTracker'
import ChatInput from './ChatInput'
import ChatHeader from './ChatHeader'
import VersionHistory from './VersionHistory'
import { Message, PlanItem, AiEditContext } from './types'
import { useState } from 'react'
import { useMessageProcessing } from './useMessageProcessing'

interface ChatPaneProps {
  messages: Message[]
  developmentPlan: PlanItem[]
  inputValue: string
  expandedPlan: boolean
  isSelectMode: boolean
  aiEditContext: AiEditContext | null
  isLoading: boolean
  onInputChange: (value: string) => void
  onSendMessage: () => void
  onKeyPress: (e: React.KeyboardEvent) => void
  onToggleSelectMode: () => void
  onToggleExpandedPlan: () => void
  onClearAiEditContext: () => void
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
  messages,
  developmentPlan,
  inputValue,
  expandedPlan,
  isSelectMode,
  aiEditContext,
  isLoading,
  onInputChange,
  onSendMessage,
  onKeyPress,
  onToggleSelectMode,
  onToggleExpandedPlan,
  onClearAiEditContext,
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
  // Track processing state using the hook that follows messageService.ts logic
  const isProcessing = useMessageProcessing(messages, isLoading)
  
  // Handle sending a message
  const handleSendMessage = () => {
    onSendMessage()
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
        isDisabled={isProcessing}
        onInputChange={onInputChange}
        onSendMessage={handleSendMessage}
        onKeyPress={onKeyPress}
        onToggleSelectMode={onToggleSelectMode}
      />
    </div>
  )
}
