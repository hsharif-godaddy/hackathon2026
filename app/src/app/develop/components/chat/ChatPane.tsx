'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AssetManagerItem, MediaType } from '@/app/develop/components/chat/AssetTypes'
import ChatBanners from '@/app/develop/components/chat/banners/ChatBanners'
import { ChatContext } from '@/app/develop/components/chat/ChatContext'
import ChatInput from '@/app/develop/components/chat/ChatInput'
import ChatToolbar from '@/app/develop/components/chat/ChatToolbar'
import { UploadedFile } from '@/app/develop/components/chat/FileUploadButton'
import PersistentTodoList from '@/app/develop/components/PersistentTodoList'
import PlanTracker from '@/app/develop/components/PlanTracker'
import SettingsPane from '@/app/develop/components/settings/SettingsPane'
import StreamingMessageList from '@/app/develop/components/StreamingMessageList'
import { ChatTab } from '@/app/develop/components/types'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import VersionHistory from '@/app/develop/components/VersionHistory'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useCreditGrants } from '@/hooks/useCreditGrants'
import { useSubscription } from '@/hooks/useSubscription'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { appFetch } from '@/lib/gasket-config'
import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'
import { appService } from '@/services/AppService'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useSiteStore } from '@/stores/useSiteStore'
import {
  useActiveStream,
  useAiEditContext,
  useBudgetExceeded,
  useBuildErrorContext,
  useCurrentAppId,
  useDevelopmentPlan,
  useHistoryLoadingComplete,
  useInputValue,
  useIsActivelyStreaming,
  useIsLoading,
  useMessages,
  useSetAiEditContext,
  useSetBuildErrorContext,
  useSetCurrentAppId,
  useSetInputValue,
  useStreamingConversationStore,
} from '@/stores/useStreamingConversationStore'
import { getActiveGrant } from '@/utils/credits'
import { logAiroHQEvent } from '@/utils/instrumentation'
import { postMessageToIframe } from '@/utils/postMessage'

interface ChatPaneProps {
  sendMessage: (content: string, aiEditContext?: any, selectedAssets?: AssetManagerItem[] | null, todoListContext?: any, isActionRequest?: boolean, customContext?: any) => Promise<void>
  isCreateFlowSession?: boolean
}

export default function ChatPane({
  sendMessage,
  isCreateFlowSession = false
}: ChatPaneProps) {
  const t = useTranslations();
  const messages = useMessages()
  const activeStream = useActiveStream()
  const inputValue = useInputValue()
  const isLoading = useIsLoading()
  const currentAppId = useCurrentAppId()
  const isStreaming = useIsActivelyStreaming()
  const developmentPlan = useDevelopmentPlan()
  const aiEditContext = useAiEditContext()
  const buildErrorContext = useBuildErrorContext()
  const budgetExceededFlag = useBudgetExceeded()
  const setInputValue = useSetInputValue()
  const setAiEditContext = useSetAiEditContext()
  const setBuildErrorContext = useSetBuildErrorContext()
  const setCurrentAppId = useSetCurrentAppId()

  const { data: isGrantsEnabled } = useSwitchboard('app-builder-grants')
  const { data: subscription } = useSubscription()
  const { data: grants } = useCreditGrants({
    subscriptionId: isGrantsEnabled ? subscription?.id : undefined,
  })

  // Only block input if budget flag is set AND user has no available credits
  const hasAvailableCredits = isGrantsEnabled && grants && getActiveGrant(grants) !== undefined
  const budgetExceeded = budgetExceededFlag && !hasAvailableCredits

  const hasLoggedFirstUserMessageRef = useRef(false)

  const expandedPlan = useDevelopPageStore((state) => state.expandedPlan)
  const toggleExpandedPlan = useDevelopPageStore((state) => state.toggleExpandedPlan)
  const isMobile = useDevelopPageStore((state) => state.isMobile)
  const setIsVersionHistoryOpen = useDevelopPageStore((state) => state.setIsVersionHistoryOpen)
  const { activeChatTab, setActiveChatTab } = useChatTabs()

  const appId = useAppIdFromParams()

  // Get site data to access agent_url for file URLs
  const getSite = useSiteStore((state) => state.getSite)
  const site = appId ? getSite(appId) : null
  const agentUrl = site?.agent_url

  // On desktop, if Preview tab is selected, fall back to Chat
  useEffect(() => {
    if (!isMobile && activeChatTab === ChatTab.PREVIEW) {
      setActiveChatTab(ChatTab.CHAT)
    }
  }, [isMobile, activeChatTab, setActiveChatTab])

  // Sync isVersionHistoryOpen with activeChatTab
  useEffect(() => {
    setIsVersionHistoryOpen(activeChatTab === ChatTab.HISTORY)
  }, [activeChatTab, setIsVersionHistoryOpen])

  // Reset funnel tracking when app changes
  useEffect(() => {
    hasLoggedFirstUserMessageRef.current = false
  }, [appId])

  // State for selected assets from AssetManager
  const [selectedAssets, setSelectedAssets] = useState<AssetManagerItem[]>([])

  // State for uploading files (placeholder assets with loading state)
  const [uploadingFiles, setUploadingFiles] = useState<Array<{ id: string; name: string }>>([])

  // State for upload error message (auto-dismisses after 8s)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const uploadErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // State for referenced files (file paths with content from file tree)
  const [referencedFiles, setReferencedFiles] = useState<Array<{ path: string; content: string }>>([])

  // Pre-fetch ventureId for AssetManager to avoid loading delay
  const [ventureId, setVentureId] = useState<string | null>(null) // eslint-disable-line @typescript-eslint/no-unused-vars

  // Fetch ventureId on component mount
  useEffect(function fetchVentureId() {
    let cancelled = false;

    async function load() {
      try {
        const response = await appFetch('/api/venture')

        // Check if component unmounted during fetch
        if (cancelled) return;

        if (!response.ok) {
          logger.error('chat-pane.venture-fetch-error', {
            message: 'Failed to fetch venture ID',
            status: response.status
          })
          return
        }

        const data = await response.json()

        if (!cancelled && data.success && data.ventureId) {
          setVentureId(data.ventureId)
          logger.debug('chat-pane.venture-fetched', {
            message: 'Venture ID fetched successfully'
          })
        }
      } catch (err) {
        if (cancelled) return;

        logger.error('chat-pane.venture-fetch-exception', {
          message: 'Exception fetching venture ID',
          error: err instanceof Error ? err.message : 'Unknown error'
        })
      }
    }

    load()

    return () => {
      cancelled = true;
    };
  }, [])

  // Combine messages and activeStream, guarding against duplicate IDs
  // (can happen when persistHistory and set({ activeStream }) are separate store updates)
  const allMessages = useMemo(() => {
    if (!activeStream) return messages
    if (messages.some((m) => m.id === activeStream.id)) return messages
    return [...messages, activeStream]
  }, [messages, activeStream])

  // Only show messages and state if they belong to the current app context
  const visibleMessages = (currentAppId === appId) ? allMessages : []
  const safeInputValue = (currentAppId === appId) ? (inputValue || '') : ''
  const safeAiEditContext = (currentAppId === appId) ? aiEditContext : null
  const safeBuildErrorContext = (currentAppId === appId) ? buildErrorContext : null

  // Calculate maxAssets based on image replacement mode
  const maxAssets = safeAiEditContext?.isImageReplacement ? 1 : 4

  // Clear selected assets when entering image replacement mode
  useEffect(() => {
    if (safeAiEditContext?.isImageReplacement) {
      setSelectedAssets([])
    }
  }, [safeAiEditContext?.isImageReplacement])

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
  // Also disable input until history/recovery has loaded to prevent duplicate messages after refresh
  const historyLoadingComplete = useHistoryLoadingComplete()
  const isProcessing = isLoading || isStreaming || !historyLoadingComplete

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

  // Handle clearing selected assets
  const handleClearSelectedAsset = useCallback(() => {
    setSelectedAssets([])
  }, [])

  // Handle clearing a single asset by index
  const handleClearSingleAsset = useCallback((index: number) => {
    setSelectedAssets((prev) => prev.filter((_, i) => i !== index))
  }, [])

  // Handle file references selected - fetch file contents
  const handleFileReferencesSelected = useCallback(async (filePaths: string[]) => {
    logger.info('chat-pane.file-references-selected', {
      appId,
      fileCount: filePaths.length,
      totalReferences: referencedFiles.length + filePaths.length
    })

    // Fetch contents for all selected files
    const filesWithContent = await Promise.all(
      filePaths.map(async (path) => {
        try {
          const result = await appService.readFile(appId, path)
          return {
            path,
            content: result.content
          }
        } catch (error) {
          logger.error('chat-pane.file-reference-read-failed', {
            appId,
            path,
            error: error instanceof Error ? error.message : String(error)
          })
          return {
            path,
            content: `[Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}]`
          }
        }
      })
    )

    setReferencedFiles((prev) => [...prev, ...filesWithContent])
  }, [appId, referencedFiles.length])

  // Handle clearing all referenced files
  const handleClearReferencedFiles = useCallback(() => {
    setReferencedFiles([])
  }, [])

  // Handle clearing a single referenced file by index
  const handleClearSingleReferencedFile = useCallback((index: number) => {
    setReferencedFiles((prev) => prev.filter((_, i) => i !== index))
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

      shipAnalyticsLog('chat.prompt.sent', {
        appId,
        promptLength: messageToSend.length,
        source: content ? 'suggestion' : 'user-input',
        hasEditContext: !!safeAiEditContext,
        hasSelectedAsset: selectedAssets.length > 0,
        hasBuildErrorContext: !!safeBuildErrorContext,
        hasReferencedFiles: referencedFiles.length > 0
      });

      // Funnel event: Track first user-initiated message after create
      // Only log if this is part of a create flow from homepage (not a returning visit)
      if (!hasLoggedFirstUserMessageRef.current && appId && isCreateFlowSession) {
        // Count user messages with early exit (we only care if <= 1)
        let userCount = 0
        for (const msg of messages) {
          if (msg.role === 'user' && ++userCount > 1) break
        }
        // If there's 0 or 1 user message (the auto-sent one), this is the first manual interaction
        if (userCount <= 1) {
          shipAnalyticsLog('funnel.user_first_message.sent', {
            appId,
            promptLength: messageToSend.length,
          })
          hasLoggedFirstUserMessageRef.current = true
        }
      }

      // Ensure we're connected to the right app
      if (currentAppId !== appId) {
        setCurrentAppId(appId)
      }

      // Send the message using the streaming WebSocket
      // For programmatic sends (suggestions), don't include edit context/assets
      // Screenshot is null to avoid agent analyzing it
      if (content) {
        // Programmatic send (e.g., suggestion button click)
        // Parameters: message, aiEditContext, selectedAssets, todoListContext, isActionRequest, customContext
        // - aiEditContext: minimal (no screenshot) since this isn't a user edit request
        // - selectedAssets: undefined since programmatic sends don't have asset selections
        // - todoListContext: undefined since todo context is managed separately
        // - isActionRequest: signals agent to execute request immediately
        // - customContext: pass file references if any
        const customContext = referencedFiles.length > 0 ? { referencedFiles } : undefined
        sendMessage(messageToSend, { screenshot: null }, undefined, undefined, options?.isActionRequest, customContext)
      } else {
        // User input send - include all context
        const customContext = referencedFiles.length > 0 ? { referencedFiles } : undefined
        sendMessage(messageToSend, { ...safeAiEditContext, screenshot: null }, selectedAssets.length > 0 ? selectedAssets : undefined, undefined, undefined, customContext)

        // Clear contexts only for user input sends
      if (safeAiEditContext) {
        handleClearAiEditContext()
      }
      if (selectedAssets.length > 0) {
        handleClearSelectedAsset()
      }
      if (referencedFiles.length > 0) {
        handleClearReferencedFiles()
      }
      if (safeBuildErrorContext) {
        handleClearBuildErrorContext()
      }
    }
  }
  }, [inputValue, sendMessage, currentAppId, appId, setCurrentAppId, safeAiEditContext, selectedAssets, referencedFiles, safeBuildErrorContext, handleClearAiEditContext, handleClearSelectedAsset, handleClearReferencedFiles, handleClearBuildErrorContext, isCreateFlowSession, messages])

  // Create stable context value - reuses handleSendMessage
  const chatContextValue = useMemo(() => ({
    sendMessage: handleSendMessage
  }), [handleSendMessage])

  // Handle asset selection from AssetManager
  const handleAssetSelect = useCallback((items: AssetManagerItem[]) => {
    logger.debug('chat-pane.asset-select', { itemCount: items?.length })

    if (items && items.length > 0) {
      // Get current state directly from store to avoid stale closure issues
      const currentAiEditContext = useStreamingConversationStore.getState().aiEditContext

      logger.debug('chat-pane.asset-select.context', {
        isImageReplacement: currentAiEditContext?.isImageReplacement,
        hasAiEditContext: !!currentAiEditContext
      })

      if (currentAiEditContext?.isImageReplacement) {
        // Image replacement mode: try AST first, then fall back to AI agent
        logger.debug('chat-pane.image-replace.auto-send', { appId })
        const selectedItem = items[0]
        const newImageUrl = selectedItem.imageUrl

        // Try AST replacement first
        const tryAstReplacement = async () => {
          try {
            logger.debug('chat-pane.image-replace.ast-attempt', { appId })
            // Combine elementInfo with devContext for the API
            const elementInfoWithDevContext = {
              tagName: currentAiEditContext.elementInfo?.tagName || '',
              className: currentAiEditContext.elementInfo?.className || '',
              id: currentAiEditContext.elementInfo?.id || '',
              selector: currentAiEditContext.selector || '',
              devContext: currentAiEditContext.devContext || { fileName: '', componentName: '', lineNumber: 0 }
            }
            const astResult = await appService.replaceImage(appId, {
              elementInfo: elementInfoWithDevContext,
              imageInfo: currentAiEditContext.imageInfo || { type: 'img', currentUrl: null },
              newImageUrl
            })

            if (astResult.success) {
              logger.info('chat-pane.image-replace.ast-success', { appId })
              // No manual refresh needed - Vite HMR will auto-update the preview
              handleClearAiEditContext()
              return
            }

            if (astResult.fallbackRequired) {
              // AST failed, fall back to AI agent
              logger.info('chat-pane.image-replace.ast-fallback', { appId, error: astResult.error })
              sendFallbackMessage()
            } else {
              // AST failed but fallback not required - just clear context
              logger.debug('chat-pane.image-replace.ast-failed-no-fallback', { appId, error: astResult.error })
              handleClearAiEditContext()
            }
          } catch (error) {
            logger.error('chat-pane.image-replace.ast-error', { appId, error: String(error) })
            // On exception, fall back to AI agent
            sendFallbackMessage()
          }

          function sendFallbackMessage() {
            const message = 'Replace this image with the new one I selected'
            shipAnalyticsLog('chat.prompt.sent', {
              appId,
              promptLength: message.length,
              source: 'image-replacement',
              hasEditContext: true,
              hasSelectedAsset: true,
              hasBuildErrorContext: false
            })
            sendMessage(message, { ...currentAiEditContext, screenshot: null }, [selectedItem])
            handleClearAiEditContext()
          }
        }

        void tryAstReplacement()
      } else {
        // Normal mode: allow multiple images (append with duplicate checking)
        logger.debug('chat-pane.asset-select.manual', { appId })
        setSelectedAssets((prevAssets) => {
          // Create a Set of existing asset URLs to check for duplicates
          const existingUrls = new Set(prevAssets.map(asset => asset.imageUrl))

          // Filter out duplicates from new items
          const newItems = items.filter(item => !existingUrls.has(item.imageUrl))

          // Combine existing and new items
          return [...prevAssets, ...newItems]
        })
      }
    } else {
      logger.debug('chat-pane.asset-select.empty', { appId })
    }
  }, [appId, sendMessage, handleClearAiEditContext])

  // Handle upload start - show placeholders immediately
  const handleUploadStart = useCallback((files: File[]) => {
    logger.debug('chat-pane.upload-start', { fileCount: files.length })

    const uploadingPlaceholders = files.map(file => ({
      id: `temp-${Date.now()}-${Math.random()}`,
      name: file.name
    }))

    setUploadingFiles(uploadingPlaceholders)
  }, [])

  useEffect(function cleanupUploadErrorTimer() {
    return () => {
      if (uploadErrorTimeoutRef.current) {
        clearTimeout(uploadErrorTimeoutRef.current)
      }
    }
  }, [])

  const handleUploadError = useCallback((errorMessage?: string) => {
    logger.error('chat-pane.upload-error', { errorMessage })
    setUploadingFiles([])
    if (errorMessage) {
      setUploadError(errorMessage)
      if (uploadErrorTimeoutRef.current) {
        clearTimeout(uploadErrorTimeoutRef.current)
      }
      uploadErrorTimeoutRef.current = setTimeout(() => {
        setUploadError(null)
        uploadErrorTimeoutRef.current = null
      }, 8000)
    }
  }, [])

  // Handle screenshot capture from chat input
  const handleScreenshotCaptured = useCallback((dataUrl: string) => {
    logger.debug('chat-pane.screenshot-captured', { appId })

    // Generate timestamp for unique filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)

    // Create asset item from screenshot data URL
    const screenshotAsset: AssetManagerItem = {
      mediaType: MediaType.IMAGE,
      sourceType: 'screenshot',
      imageUrl: dataUrl,
      filename: `screenshot-${timestamp}.jpg`,
      contentType: 'image/jpeg',
      size: dataUrl.length, // Approximate size
      thumbnailUrl: dataUrl,
      dimensions: { width: 1024, height: 0 } // Width is 1024 from resize
    }

    // Add to selected assets (or replace if at max)
    setSelectedAssets(prev => {
      if (prev.length >= maxAssets) {
        // Replace last asset if at max
        return [...prev.slice(0, maxAssets - 1), screenshotAsset]
      }
      return [...prev, screenshotAsset]
    })

    logger.info('chat-pane.screenshot-added', { appId, assetsCount: selectedAssets.length + 1 })
  }, [appId, maxAssets, selectedAssets.length])

  // Handle file uploads from chat input
  const handleFilesUploaded = useCallback((files: UploadedFile[]) => {
    logger.debug('chat-pane.files-uploaded', { fileCount: files.length })

    // Clear uploading placeholders
    setUploadingFiles([])

    // Agent URL is required to construct file URLs
    if (!agentUrl) {
      logger.error('chat-pane.files-uploaded.no-agent-url', { appId })
      return
    }

    // Convert UploadedFile to AssetManagerItem
    const assetItems: AssetManagerItem[] = files.map(file => {
      // Determine media type from MIME type
      let mediaType: MediaType
      if (file.mimeType?.startsWith('image/')) {
        mediaType = MediaType.IMAGE
      } else if (file.mimeType?.startsWith('video/')) {
        mediaType = MediaType.VIDEO
      } else if (file.mimeType === 'application/pdf') {
        mediaType = MediaType.PDF
      } else {
        // All other files (markdown, JSON, text, etc.)
        mediaType = MediaType.FILE
      }

      // Use signed URL if available, otherwise undefined (triggers fallback UI)
      const fileUrl = file.signedUrl
        ? `${agentUrl}${file.signedUrl}`
        : undefined

      // Create base asset structure
      const baseAsset = {
        mediaType,
        sourceType: 'upload',
        imageUrl: fileUrl,
        filename: file.originalName,
        contentType: file.mimeType || 'application/octet-stream',
        size: file.size,
        thumbnailUrl: fileUrl
      }

      // Return appropriate asset type based on media type
      if (mediaType === MediaType.IMAGE) {
        return {
          ...baseAsset,
          mediaType: MediaType.IMAGE,
          dimensions: { width: 0, height: 0 } // Dimensions unknown for now
        } as AssetManagerItem
      } else if (mediaType === MediaType.VIDEO) {
        return {
          ...baseAsset,
          mediaType: MediaType.VIDEO,
          videoUrl: fileUrl,
          id: file.id,
          urlHash: file.id,
          width: 0,
          height: 0
        } as AssetManagerItem
      } else if (mediaType === MediaType.PDF) {
        return {
          ...baseAsset,
          mediaType: MediaType.PDF
        } as AssetManagerItem
      } else {
        return {
          ...baseAsset,
          mediaType: MediaType.FILE
        } as AssetManagerItem
      }
    })

    // Use existing handleAssetSelect logic
    handleAssetSelect(assetItems)
  }, [appId, agentUrl, handleAssetSelect])

  // Listen for error fix requests from PreviewPaneSimple
  useEffect(() => {
    const handleErrorFixEvent = (event: CustomEvent) => {
      if (!isProcessing && event.detail.appId === appId && inputValue?.trim()) {
        // Use the actual sendMessage function from WebSocket hook
        sendMessage(inputValue, { ...safeAiEditContext, screenshot: null }, selectedAssets.length > 0 ? selectedAssets : undefined)

        // Clear the AI edit context after sending
        if (safeAiEditContext) {
          handleClearAiEditContext()
        }

        // Clear the selected assets after sending
        if (selectedAssets.length > 0) {
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
  }, [appId, inputValue, isProcessing, sendMessage, safeAiEditContext, selectedAssets, safeBuildErrorContext, handleClearAiEditContext, handleClearSelectedAsset, handleClearBuildErrorContext])

  if (isMobile) {
    return (
      <ChatContext.Provider value={chatContextValue}>
        <div className="flex-1 flex flex-col min-h-0 overflow-x-hidden">
          <PlanTracker
            developmentPlan={developmentPlan}
            expandedPlan={expandedPlan}
            onToggleExpandedPlan={toggleExpandedPlan}
          />

          <StreamingMessageList allMessages={visibleMessages} isCreateFlowSession={isCreateFlowSession} />

          <ChatBanners appId={appId} />
          {uploadError && (
            <div className="mx-2 sm:mx-3 md:mx-0 mb-1 px-3 py-2 text-sm rounded-md bg-intents-ux-feedbackHighContrastCritical-feedbackColor/10 text-intents-ux-feedbackHighContrastCritical-feedbackColor flex items-center justify-between">
              <span>{uploadError}</span>
              <button onClick={() => setUploadError(null)} className="ml-2 font-bold hover:opacity-70" aria-label={t('builder_common_dismiss')}>×</button>
            </div>
          )}
          <ChatInput
            appId={appId}
            inputValue={safeInputValue}
            isDisabled={isProcessing}
            isBudgetExceeded={budgetExceeded}
            onInputChange={setInputValue}
            onSendMessage={handleSendMessage}
            selectedAssets={selectedAssets}
            maxAssets={maxAssets}
            onClearSelectedAsset={handleClearSingleAsset}
            onFilesUploaded={handleFilesUploaded}
            onScreenshotCaptured={handleScreenshotCaptured}
            onFileReferencesSelected={handleFileReferencesSelected}
            onUploadStart={handleUploadStart}
            onUploadError={handleUploadError}
            uploadingFiles={uploadingFiles}
            referencedFiles={referencedFiles}
            onClearReferencedFile={handleClearSingleReferencedFile}
            aiEditContext={safeAiEditContext}
            onClearAiEditContext={handleClearAiEditContext}
          />
        </div>
      </ChatContext.Provider>
    )
  }

  return (
    <ChatContext.Provider value={chatContextValue}>
    <div className="flex-1 flex flex-col h-full p-0 md:p-2 gap-1 md:gap-2">
      <PlanTracker
        developmentPlan={developmentPlan}
        expandedPlan={expandedPlan}
        onToggleExpandedPlan={toggleExpandedPlan}
      />

      {/* Chat Tab - Keep mounted, hide with CSS */}
      <div
        className="flex flex-col flex-1 min-h-0"
        style={{ display: activeChatTab === ChatTab.CHAT ? 'flex' : 'none' }}
      >
        <PersistentTodoList />

        <StreamingMessageList allMessages={visibleMessages} isCreateFlowSession={isCreateFlowSession} />

        {safeBuildErrorContext && (
          <div className="mx-2 rounded-md overflow-hidden border">
            <div className="p-1.5">
              <div className="flex items-start justify-between gap-1">
                <div className="flex-1">
                  <div className="flex items-center gap-1 mb-0.5">
                    <svg className="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="font-semibold text-sm">{t('builder_chatpane_build_error')}</span>
                  </div>
                  <div className="text-xs break-words">
                    {safeBuildErrorContext.error}
                  </div>
                  {safeBuildErrorContext.exitCode && (
                    <div className="text-xs mt-0.5">
                      {t('builder_chatpane_exit_code')}: {safeBuildErrorContext.exitCode}
                    </div>
                  )}
                </div>
                <button
                  onClick={handleClearBuildErrorContext}
                  className="flex-shrink-0 w-3 h-3 flex items-center justify-center bg-white rounded-full shadow-sm hover:shadow-md font-bold text-lg text-red-600"
                  title={t('builder_chatpane_build_exit_code')}
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="px-2 sm:px-3 md:px-0">
          <ChatBanners appId={appId} />
          {uploadError && (
            <div className="mb-1 px-3 py-2 text-sm rounded-md bg-intents-ux-feedbackHighContrastCritical-feedbackColor/10 text-intents-ux-feedbackHighContrastCritical-feedbackColor flex items-center justify-between">
              <span>{uploadError}</span>
              <button onClick={() => setUploadError(null)} className="ml-2 font-bold hover:opacity-70" aria-label={t('builder_common_dismiss')}>×</button>
            </div>
          )}
          <ChatInput
            appId={appId}
            inputValue={safeInputValue}
            isDisabled={isProcessing}
            isBudgetExceeded={budgetExceeded}
            onInputChange={setInputValue}
            onSendMessage={handleSendMessage}
            selectedAssets={selectedAssets}
            maxAssets={maxAssets}
            onClearSelectedAsset={handleClearSingleAsset}
            onFilesUploaded={handleFilesUploaded}
            onScreenshotCaptured={handleScreenshotCaptured}
            onFileReferencesSelected={handleFileReferencesSelected}
            onUploadStart={handleUploadStart}
            onUploadError={handleUploadError}
            uploadingFiles={uploadingFiles}
            referencedFiles={referencedFiles}
            onClearReferencedFile={handleClearSingleReferencedFile}
            aiEditContext={safeAiEditContext}
            onClearAiEditContext={handleClearAiEditContext}
          />
        </div>
      </div>

      {/* History Tab - Keep mounted, hide with CSS */}
      <div
        className="flex flex-col flex-1 min-h-0"
        style={{ display: activeChatTab === ChatTab.HISTORY ? 'flex' : 'none' }}
      >
        <VersionHistory />
      </div>

      {/* Settings Tab - Keep mounted, hide with CSS */}
      <div
        className="flex flex-col flex-1 min-h-0"
        style={{ display: activeChatTab === ChatTab.SETTINGS ? 'flex' : 'none' }}
      >
        <SettingsPane />
      </div>

      <ChatToolbar
        isProcessing={isProcessing}
      />
    </div>
    </ChatContext.Provider>
  )
}
