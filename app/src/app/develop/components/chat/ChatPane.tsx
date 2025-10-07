'use client'

import { useRef, useMemo, useEffect } from 'react'
import { motion } from 'framer-motion'
import PlanTracker from '@/app/develop/components/PlanTracker'
import ChatInput from '@/app/develop/components/chat/ChatInput'
import ChatToolbar from '@/app/develop/components/chat/ChatToolbar'
import StreamingMessageList from '@/app/develop/components/StreamingMessageList'
import VersionHistory from '@/app/develop/components/VersionHistory'
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
import { logger } from '@/lib/request-context'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { ChatTab } from '@/app/develop/components/types'
import { getAppIdFromParams } from '@/app/develop/components/utils'
import PreviewPane from '../preview/PreviewPane'

interface ChatPaneProps {
  onPreviewRefresh?: () => void
}

export default function ChatPane({
  onPreviewRefresh
}: ChatPaneProps) {
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
  const { sendMessage } = useStreamingWebSocket()

  const {
    expandedPlan,
    activeChatTab,
    toggleExpandedPlan,
    isMobile
  } = useDevelopPageStore()

  const appId = getAppIdFromParams()

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
    logger.debug('chat-pane.state-change', {
      message: 'ChatPane state changed',
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
    logger.debug('chat-pane.send-message', {
      message: 'ChatPane handleSendMessage called',
      inputValuePreview: inputValue?.slice(0, 50) + '...',
      hasSendMessageFunction: !!sendMessage
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

  // Listen for error fix requests from PreviewPaneSimple
  useEffect(() => {
    const handleErrorFixEvent = (event: CustomEvent) => {
      if (event.detail.appId === appId && inputValue?.trim()) {
        // Use the actual sendMessage function from WebSocket hook
        sendMessage(inputValue, safeAiEditContext)
      }
    }

    window.addEventListener('airo-error-fix', handleErrorFixEvent as EventListener)

    return () => {
      window.removeEventListener('airo-error-fix', handleErrorFixEvent as EventListener)
    }
  }, [appId, inputValue, sendMessage, safeAiEditContext])

  // Get tab index for animation - matches mobile toolbar order
  const getTabIndex = (tab: ChatTab): number => {
    switch (tab) {
      case ChatTab.PREVIEW: return 0  // First tab on mobile
      case ChatTab.CHAT: return 1     // Second tab on mobile  
      case ChatTab.HISTORY: return 2  // Last available tab
      default: return 1 // Default to chat
    }
  }

  if (isMobile) {
    const tabIndex = getTabIndex(activeChatTab)
    const transformValue = `-${tabIndex * 100}%`
    
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <PlanTracker
          developmentPlan={developmentPlan}
          expandedPlan={expandedPlan}
          onToggleExpandedPlan={toggleExpandedPlan}
        />

        {/* Mobile horizontal scrolling container */}
        <div className="flex-1 relative overflow-hidden">
          <motion.div
            className="flex h-full"
            initial={{ x: transformValue }}
            animate={{ x: transformValue }}
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 30
            }}
          >
            {/* Preview Tab Content - Index 0, always rendered to prevent reloading */}
            <motion.div
              className="w-full flex-shrink-0 flex flex-col min-h-0"
              initial={false}
              animate={{ opacity: activeChatTab === ChatTab.PREVIEW ? 1 : 0.3 }}
              transition={{ duration: 0.2 }}
            >
              <PreviewPane
                onPreviewRefresh={onPreviewRefresh}
                isMobile
              />
            </motion.div>

            {/* Chat Tab Content - Index 1 */}
            <motion.div
              className="w-full flex-shrink-0 flex flex-col min-h-0"
              initial={false}
              animate={{ opacity: activeChatTab === ChatTab.CHAT ? 1 : 0.3 }}
              transition={{ duration: 0.2 }}
            >
              <StreamingMessageList />
              <ChatInput
                inputValue={safeInputValue}
                isDisabled={isProcessing}
                onInputChange={setInputValue}
                onSendMessage={handleSendMessage}
              />
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
            </motion.div>

            {/* History Tab Content - Index 2 */}
            <motion.div
              className="w-full flex-shrink-0 flex flex-col min-h-0"
              initial={false}
              animate={{ opacity: activeChatTab === ChatTab.HISTORY ? 1 : 0.3 }}
              transition={{ duration: 0.2 }}
            >
              <VersionHistory />
            </motion.div>
          </motion.div>
        </div>

        <ChatToolbar />
      </div>
    )
  }

  // Desktop layout (unchanged)
  return (
    <div className="flex-1 flex flex-col min-h-0 md:pt-4">
      <PlanTracker
        developmentPlan={developmentPlan}
        expandedPlan={expandedPlan}
        onToggleExpandedPlan={toggleExpandedPlan}
      />

      {activeChatTab === ChatTab.PREVIEW && (
        <PreviewPane
          onPreviewRefresh={onPreviewRefresh}
          isMobile
        />
      )}

      {activeChatTab === ChatTab.CHAT && (
        <>
          <StreamingMessageList />
          <ChatInput
            inputValue={safeInputValue}
            isDisabled={isProcessing}
            onInputChange={setInputValue}
            onSendMessage={handleSendMessage}
          />
        </>
      )}

      {activeChatTab === ChatTab.HISTORY && (
        <VersionHistory />
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

      <ChatToolbar />
    </div>
  )
}
