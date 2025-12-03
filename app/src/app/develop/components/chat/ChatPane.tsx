'use client'

import { useRef, useMemo, useEffect, useCallback, useState } from 'react'
import { motion } from 'framer-motion'
import PlanTracker from '@/app/develop/components/PlanTracker'
import PersistentTodoList from '@/app/develop/components/PersistentTodoList'
import ChatInput from '@/app/develop/components/chat/ChatInput'
import ChatToolbar from '@/app/develop/components/chat/ChatToolbar'
import { ChatContext } from '@/app/develop/components/chat/ChatContext'
import { AssetManagerItem } from '@/app/develop/components/chat/AssetManagerModal'
import StreamingMessageList from '@/app/develop/components/StreamingMessageList'
import VersionHistory from '@/app/develop/components/VersionHistory'
import PreviewPane from '@/app/develop/components/preview/PreviewPane'
import SettingsPane from '@/app/develop/components/settings/SettingsPane'
import SettingsView from '@/app/develop/components/settings/SettingsView'
import {
  useInputValue,
  useIsLoading,
  useCurrentAppId,
  useMessages,
  useActiveStream,
  useIsActivelyStreaming,
  useDevelopmentPlan,
  useAiEditContext,
  useBuildErrorContext,
  useSetInputValue,
  useSetAiEditContext,
  useSetBuildErrorContext,
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
  sendMessage: (content: string, aiEditContext?: any, selectedAsset?: AssetManagerItem | null, todoListContext?: any, isActionRequest?: boolean) => Promise<void>
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
  const buildErrorContext = useBuildErrorContext()
  const setInputValue = useSetInputValue()
  const setAiEditContext = useSetAiEditContext()
  const setBuildErrorContext = useSetBuildErrorContext()
  const setCurrentAppId = useSetCurrentAppId()


  const expandedPlan = useDevelopPageStore((state) => state.expandedPlan)
  const activeChatTab = useDevelopPageStore((state) => state.activeChatTab)
  const toggleExpandedPlan = useDevelopPageStore((state) => state.toggleExpandedPlan)
  const setActiveChatTab = useDevelopPageStore((state) => state.setActiveChatTab)
  const isMobile = useDevelopPageStore((state) => state.isMobile)

  const appId = useAppIdFromParams()

  // On desktop, if Preview tab is selected, fall back to Chat
  useEffect(() => {
    if (!isMobile && activeChatTab === ChatTab.PREVIEW) {
      setActiveChatTab(ChatTab.CHAT)
    }
  }, [isMobile, activeChatTab, setActiveChatTab])

  // State for selected asset from AssetManager
  const [selectedAsset, setSelectedAsset] = useState<AssetManagerItem | null>(null)

  // Pre-fetch ventureId for AssetManager to avoid loading delay
  const [ventureId, setVentureId] = useState<string | null>(null)

  // Fetch ventureId on component mount
  useEffect(function fetchVentureId() {
    async function load() {
      try {
        const response = await fetch('/api/venture', {
          credentials: 'include',
        })

        if (!response.ok) {
          logger.error('chat-pane.venture-fetch-error', {
            message: 'Failed to fetch venture ID',
            status: response.status
          })
          return
        }

        const data = await response.json()

        if (data.success && data.ventureId) {
          setVentureId(data.ventureId)
          logger.debug('chat-pane.venture-fetched', {
            message: 'Venture ID fetched successfully'
          })
        }
      } catch (err) {
        logger.error('chat-pane.venture-fetch-exception', {
          message: 'Exception fetching venture ID',
          error: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    }

    load()
  }, [])

  // Combine messages and activeStream with useMemo to prevent infinite loops
  const allMessages = useMemo(() => {
    return activeStream ? [...messages, activeStream] : messages
  }, [messages, activeStream])

  // Only show messages and state if they belong to the current app context
  const visibleMessages = (currentAppId === appId) ? allMessages : []
  const safeInputValue = (currentAppId === appId) ? (inputValue || '') : ''
  const safeAiEditContext = (currentAppId === appId) ? aiEditContext : null
  const safeBuildErrorContext = (currentAppId === appId) ? buildErrorContext : null

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

  // Handle clearing selected asset
  const handleClearSelectedAsset = useCallback(() => {
    setSelectedAsset(null)
  }, [])

  // Handle clearing build error context
  const handleClearBuildErrorContext = useCallback(() => {
    setBuildErrorContext(null)
  }, [setBuildErrorContext])

  // Handle sending a message - accepts optional content for programmatic sends
  const handleSendMessage = useCallback((content?: string, options?: { isActionRequest?: boolean }) => {
    const messageToSend = content ?? inputValue

    logger.debug('chat-pane.send-message', {
      message: 'ChatPane handleSendMessage called',
      inputValuePreview: inputValue?.slice(0, 50) + '...',
      hasSendMessageFunction: !!sendMessage
    })

    if (messageToSend?.trim()) {
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
      // For programmatic sends (suggestions), don't include edit context/assets
      // Screenshot is null to avoid agent analyzing it
      if (content) {
        // Programmatic send (e.g., suggestion button click)
        // Parameters: message, aiEditContext, selectedAsset, todoListContext, isActionRequest
        // - aiEditContext: minimal (no screenshot) since this isn't a user edit request
        // - selectedAsset: null since programmatic sends don't have asset selections
        // - todoListContext: undefined since todo context is managed separately
        // - isActionRequest: signals agent to execute request immediately.
        sendMessage(messageToSend, { screenshot: null }, null, undefined, options?.isActionRequest)
      } else {
        // User input send - include all context
        sendMessage(messageToSend, { ...safeAiEditContext, screenshot: null }, selectedAsset)

        // Clear contexts only for user input sends
      if (safeAiEditContext) {
        handleClearAiEditContext()
      }
      if (selectedAsset) {
        handleClearSelectedAsset()
      }
      if (safeBuildErrorContext) {
        handleClearBuildErrorContext()
      }
    }
  }
  }, [inputValue, sendMessage, currentAppId, appId, setCurrentAppId, safeAiEditContext, selectedAsset, safeBuildErrorContext, handleClearAiEditContext, handleClearSelectedAsset, handleClearBuildErrorContext])

  // Create stable context value - reuses handleSendMessage
  const chatContextValue = useMemo(() => ({
    sendMessage: handleSendMessage
  }), [handleSendMessage])

  // Handle asset selection from AssetManager
  const handleAssetSelect = useCallback((items: AssetManagerItem[]) => {
    if (items && items.length > 0) {
      setSelectedAsset(items[0])
    }
  }, [])

  // Listen for error fix requests from PreviewPaneSimple
  useEffect(() => {
    const handleErrorFixEvent = (event: CustomEvent) => {
      if (event.detail.appId === appId && inputValue?.trim()) {
        // Use the actual sendMessage function from WebSocket hook
        sendMessage(inputValue, { ...safeAiEditContext, screenshot: null }, selectedAsset)

        // Clear the AI edit context after sending
        if (safeAiEditContext) {
          handleClearAiEditContext()
        }

        // Clear the selected asset after sending
        if (selectedAsset) {
          handleClearSelectedAsset()
        }

        // Clear the build error context after sending
        if (safeBuildErrorContext) {
          handleClearBuildErrorContext()
        }
      }
    }

    window.addEventListener('airo-error-fix', handleErrorFixEvent as EventListener)

    return () => {
      window.removeEventListener('airo-error-fix', handleErrorFixEvent as EventListener)
    }
  }, [appId, inputValue, sendMessage, safeAiEditContext, selectedAsset, safeBuildErrorContext, handleClearAiEditContext, handleClearSelectedAsset, handleClearBuildErrorContext])


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

  // Helper function to get the display URL for an asset
  const getAssetDisplayUrl = (asset: AssetManagerItem): string => {
    // Ensure protocol is https
    const url = asset.imageUrl.startsWith('//') ? `https:${asset.imageUrl}` : asset.imageUrl
    return url
  }

  // Helper function to get the asset label
  const getAssetLabel = (asset: AssetManagerItem): string => {
    switch (asset.mediaType) {
      case 'IMAGE':
        return asset.filename || 'Selected image'
      case 'VIDEO':
        return 'Selected video'
      case 'PDF':
        return asset.filename || 'Selected PDF'
      default:
        return 'Selected asset'
    }
  }

  if (isMobile) {
    const tabIndex = getTabIndex(activeChatTab)
    const transformValue = `-${tabIndex * 100}%`

    return (
      <ChatContext.Provider value={chatContextValue}>
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

              {selectedAsset && (
                <div className="mx-4 rounded-md overflow-hidden bg-white">
                  <div className="p-2">
                    <div className="relative inline-block">
                      <img // eslint-disable-line @next/next/no-img-element
                        src={getAssetDisplayUrl(selectedAsset)}
                        alt={getAssetLabel(selectedAsset)}
                        className="max-h-[120px] object-contain rounded border"
                      />
                      <button
                        onClick={handleClearSelectedAsset}
                        className="absolute -top-2 -right-2 w-6 h-6 flex items-center shadow-lg justify-center bg-white rounded-full font-bold text-lg"
                        style={{ backgroundColor: '#ffffff' }}
                        title="Clear asset"
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
              className="w-full flex-shrink-0 flex flex-col min-h-0 overflow-y-auto"
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
              <SettingsView />
            </motion.div>
          </motion.div>
        </div>

      <ChatToolbar
        isProcessing={isProcessing}
        onAssetSelect={handleAssetSelect}
        ventureId={ventureId}
      />
    </div>
    </ChatContext.Provider>
  )
}

  return (
    <ChatContext.Provider value={chatContextValue}>
    <div className="flex-1 flex flex-col h-full md:pt-4 gap-2 md:gap-4">
      <PlanTracker
        developmentPlan={developmentPlan}
        expandedPlan={expandedPlan}
        onToggleExpandedPlan={toggleExpandedPlan}
      />

      {activeChatTab === ChatTab.CHAT && <PersistentTodoList />}

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

          {selectedAsset && (
            <div className="mx-4 rounded-md overflow-hidden bg-white">
              <div className="p-2">
                <div className="relative inline-block">
                  <img // eslint-disable-line @next/next/no-img-element
                    src={getAssetDisplayUrl(selectedAsset)}
                    alt={getAssetLabel(selectedAsset)}
                    className="max-h-[120px] object-contain rounded border"
                  />
                  <button
                    onClick={handleClearSelectedAsset}
                    className="absolute -top-2 -right-2 w-6 h-6 flex items-center shadow-lg justify-center bg-white rounded-full font-bold text-lg"
                    style={{ backgroundColor: '#ffffff' }}
                    title="Clear asset"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          )}

          {safeBuildErrorContext && (
            <div className="mx-4 rounded-md overflow-hidden bg-red-50 border border-red-200">
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="font-semibold text-sm text-red-900">Build Error Context</span>
                    </div>
                    <div className="text-xs text-red-800 break-words">
                      {safeBuildErrorContext.error}
                    </div>
                    {safeBuildErrorContext.exitCode && (
                      <div className="text-xs text-red-700 mt-1">
                        Exit code: {safeBuildErrorContext.exitCode}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={handleClearBuildErrorContext}
                    className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-white rounded-full shadow-sm hover:shadow-md font-bold text-lg text-red-600"
                    title="Clear build error"
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
        onAssetSelect={handleAssetSelect}
        ventureId={ventureId}
      />
    </div>
    </ChatContext.Provider>
  )
}
