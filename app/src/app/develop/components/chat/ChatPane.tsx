'use client'

import { useRef, useMemo, useEffect, useCallback, useState } from 'react'
import { motion } from 'framer-motion'
import Apps from '@/app/develop/components/Apps'
import PlanTracker from '@/app/develop/components/PlanTracker'
import ChatInput from '@/app/develop/components/chat/ChatInput'
import ChatToolbar from '@/app/develop/components/chat/ChatToolbar'
import { ImageManagerItem } from '@/app/develop/components/chat/ImageManagerModal'
import StreamingMessageList from '@/app/develop/components/StreamingMessageList'
import VersionHistory from '@/app/develop/components/VersionHistory'
import PreviewPane from '@/app/develop/components/preview/PreviewPane'
import SettingsPane from '@/app/develop/components/settings/SettingsPane'
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
  useSetCurrentAppId,
} from '@/stores/useStreamingConversationStore'
import { logger } from '@/lib/request-context'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { logAiroHQEvent } from '@/utils/instrumentation'
import { ChatTab } from '@/app/develop/components/types'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { postMessageToIframe } from '@/utils/postMessage'

interface ChatPaneProps {
  onPreviewRefresh?: () => void
  sendMessage: (content: string, aiEditContext?: any, selectedImage?: ImageManagerItem | null) => Promise<void>
}

export default function ChatPane({
  onPreviewRefresh,
  sendMessage
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


  const {
    expandedPlan,
    activeChatTab,
    toggleExpandedPlan,
    isMobile
  } = useDevelopPageStore()

  const appId = useAppIdFromParams()

  // State for selected image from ImageManager
  const [selectedImage, setSelectedImage] = useState<ImageManagerItem | null>(null)

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
      logAiroHQEvent({
        category: 'click',
        recommendation_task: 'builder_develop_prompt_submit',
        recommendation_type: 'user_prompt'
      })();

      // Ensure we're connected to the right app
      if (currentAppId !== appId) {
        setCurrentAppId(appId)
      }

      // Send the message using the streaming WebSocket
      sendMessage(inputValue, safeAiEditContext, selectedImage)

      // Clear the AI edit context after sending
      if (safeAiEditContext) {
        handleClearAiEditContext()
      }

      // Clear the selected image after sending
      if (selectedImage) {
        handleClearSelectedImage()
      }
    }
  }

  // Handle clearing AI edit context
  const handleClearAiEditContext = useCallback(() => {
    // Send message to iframe to clear selection and highlight
    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
    if (iframe) {
      postMessageToIframe(iframe, {
        type: 'CLEAR_SELECTION'
      })
    }
    // Clear the context in the store
    setAiEditContext(null)
  }, [setAiEditContext])

  // Handle image selection from ImageManager
  const handleImageSelect = useCallback((items: ImageManagerItem[]) => {
    if (items && items.length > 0) {
      setSelectedImage(items[0])
    }
  }, [])

  // Handle clearing selected image
  const handleClearSelectedImage = useCallback(() => {
    setSelectedImage(null)
  }, [])

  // Listen for error fix requests from PreviewPaneSimple
  useEffect(() => {
    const handleErrorFixEvent = (event: CustomEvent) => {
      if (event.detail.appId === appId && inputValue?.trim()) {
        // Use the actual sendMessage function from WebSocket hook
        sendMessage(inputValue, safeAiEditContext, selectedImage)

        // Clear the AI edit context after sending
        if (safeAiEditContext) {
          handleClearAiEditContext()
        }

        // Clear the selected image after sending
        if (selectedImage) {
          handleClearSelectedImage()
        }
      }
    }

    window.addEventListener('airo-error-fix', handleErrorFixEvent as EventListener)

    return () => {
      window.removeEventListener('airo-error-fix', handleErrorFixEvent as EventListener)
    }
  }, [appId, inputValue, sendMessage, safeAiEditContext, selectedImage, handleClearAiEditContext, handleClearSelectedImage])


  // Get tab index for animation - matches mobile toolbar order
  const getTabIndex = (tab: ChatTab): number => {
    switch (tab) {
      case ChatTab.PREVIEW: return 0
      case ChatTab.CHAT: return 1
      case ChatTab.HISTORY: return 2
      case ChatTab.SETTINGS: return 3
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

            <motion.div
              className="w-full flex-shrink-0 flex flex-col min-h-0"
              initial={false}
              animate={{ opacity: activeChatTab === ChatTab.CHAT ? 1 : 0.3 }}
              transition={{ duration: 0.2 }}
            >
              <StreamingMessageList />

              {safeAiEditContext && (
                <div className="mx-4 rounded-md overflow-hidden bg-white">
                  <div className="p-2">
                    {safeAiEditContext.screenshot && (
                      <div className="relative inline-block">
                        <img // eslint-disable-line @next/next/no-img-element
                          src={safeAiEditContext.screenshot}
                          alt="Selected element"
                          className="max-h-[120px] object-contain rounded border"
                        />
                        <button
                          onClick={handleClearAiEditContext}
                          className="absolute -top-2 -right-2 w-6 h-6 flex items-center shadow-lg justify-center bg-white rounded-full font-bold text-lg"
                          style={{ backgroundColor: '#ffffff' }}
                          title="Clear selection"
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {selectedImage && (
                <div className="mx-4 rounded-md overflow-hidden bg-white">
                  <div className="p-2">
                    <div className="relative inline-block">
                      <img // eslint-disable-line @next/next/no-img-element
                        src={`https:${selectedImage.imageUrl}`}
                        alt={selectedImage.filename || "Selected image"}
                        className="max-h-[120px] object-contain rounded border"
                      />
                      <button
                        onClick={handleClearSelectedImage}
                        className="absolute -top-2 -right-2 w-6 h-6 flex items-center shadow-lg justify-center bg-white rounded-full font-bold text-lg"
                        style={{ backgroundColor: '#ffffff' }}
                        title="Clear image"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <ChatInput
                inputValue={safeInputValue}
                isDisabled={isProcessing}
                onInputChange={setInputValue}
                onSendMessage={handleSendMessage}
              />
            </motion.div>

            <motion.div
              className="w-full flex-shrink-0 flex flex-col min-h-0"
              initial={false}
              animate={{ opacity: activeChatTab === ChatTab.HISTORY ? 1 : 0.3 }}
              transition={{ duration: 0.2 }}
            >
              <VersionHistory />
            </motion.div>

            <motion.div
              className="w-full flex-shrink-0 flex flex-col min-h-0"
              initial={false}
              animate={{ opacity: activeChatTab === ChatTab.SETTINGS ? 1 : 0.3 }}
              transition={{ duration: 0.2 }}
            >
              <SettingsPane />
            </motion.div>
          </motion.div>
        </div>

        <ChatToolbar
          isProcessing={isProcessing}
          onImageSelect={handleImageSelect}
        />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col h-full md:pt-4 gap-2 md:gap-4">
      <PlanTracker
        developmentPlan={developmentPlan}
        expandedPlan={expandedPlan}
        onToggleExpandedPlan={toggleExpandedPlan}
      />

      {activeChatTab === ChatTab.APPS && (
        <Apps />
      )}

      {activeChatTab === ChatTab.PREVIEW && (
        <PreviewPane
          onPreviewRefresh={onPreviewRefresh}
          isMobile
        />
      )}

      {activeChatTab === ChatTab.CHAT && (
        <>
          <StreamingMessageList />

          {safeAiEditContext && (
            <div className="mx-4 rounded-md overflow-hidden bg-white">
              <div className="p-2">
                {safeAiEditContext.screenshot && (
                  <div className="relative inline-block">
                    <img // eslint-disable-line @next/next/no-img-element
                      src={safeAiEditContext.screenshot}
                      alt="Selected element"
                      className="max-h-[120px] object-contain rounded border"
                    />
                    <button
                      onClick={handleClearAiEditContext}
                      className="absolute -top-2 -right-2 w-6 h-6 flex items-center shadow-lg justify-center bg-white rounded-full font-bold text-lg"
                      style={{ backgroundColor: '#ffffff' }}
                      title="Clear selection"
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {selectedImage && (
            <div className="mx-4 rounded-md overflow-hidden bg-white">
              <div className="p-2">
                <div className="relative inline-block">
                  <img // eslint-disable-line @next/next/no-img-element
                    src={`https:${selectedImage.imageUrl}`}
                    alt={selectedImage.filename || "Selected image"}
                    className="max-h-[120px] object-contain rounded border"
                  />
                  <button
                    onClick={handleClearSelectedImage}
                    className="absolute -top-2 -right-2 w-6 h-6 flex items-center shadow-lg justify-center bg-white rounded-full font-bold text-lg"
                    style={{ backgroundColor: '#ffffff' }}
                    title="Clear image"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          )}
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

      {activeChatTab === ChatTab.SETTINGS && (
        <SettingsPane />
      )}

      <ChatToolbar
        isProcessing={isProcessing}
        onImageSelect={handleImageSelect}
      />
    </div>
  )
}
