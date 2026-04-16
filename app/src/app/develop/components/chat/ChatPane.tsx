'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { isEmployeeAuthType } from '@airo/shared/auth'
import Growl from '@ux/growl'

import { AssetManagerItem, MediaType } from '@/app/develop/components/chat/AssetTypes'
import ChatBanners from '@/app/develop/components/chat/banners/ChatBanners'
import BudgetExceededBanner from '@/app/develop/components/chat/BudgetExceededBanner'
import { ChatContext } from '@/app/develop/components/chat/ChatContext'
import ChatInput, { type StagedChatFile } from '@/app/develop/components/chat/ChatInput'
import ChatToolbar from '@/app/develop/components/chat/ChatToolbar'
import { UploadedFile } from '@/app/develop/components/chat/FileUploadButton'
import {
  getStagedFilePreviewUrl,
  revokeStagedFilePreviewIfCached,
} from '@/app/develop/components/chat/stagedFilePreviewUrl'
import { uploadChatFiles } from '@/app/develop/components/chat/uploadChatFiles'
import MediaPanel from '@/app/develop/components/media/MediaPanel'
import PersistentTodoList from '@/app/develop/components/PersistentTodoList'
import PlanTracker from '@/app/develop/components/PlanTracker'
import AnalyticsPanel from '@/app/develop/components/settings/Analytics/AnalyticsPanel'
import SettingsView from '@/app/develop/components/settings/SettingsView'
import StreamingMessageList from '@/app/develop/components/StreamingMessageList'
import { ChatTab } from '@/app/develop/components/types'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import VersionHistory from '@/app/develop/components/VersionHistory'
import { useAuthContext } from '@/components/providers/AuthProvider'
import { useBudgetService } from '@/hooks/useBudgetService'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useCreditGrants } from '@/hooks/useCreditGrants'
import type { SendMessageOptions } from '@/hooks/useStreamingWebSocket'
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
import { MAX_TOTAL_ASSETS, validateForStaging } from '@/utils/file-upload-validation'
import { logAiroHQEvent } from '@/utils/instrumentation'
import { postMessageToIframe } from '@/utils/postMessage'

interface ChatPaneProps {
  sendMessage: (options: SendMessageOptions) => Promise<void>
  stopGeneration: () => void
  isCreateFlowSession?: boolean
}

function mapUploadedFilesToAssetItems(files: UploadedFile[], agentUrl: string): AssetManagerItem[] {
  return files.map((file) => {
    let mediaType: MediaType
    if (file.mimeType?.startsWith('image/')) {
      mediaType = MediaType.IMAGE
    } else if (file.mimeType?.startsWith('video/')) {
      mediaType = MediaType.VIDEO
    } else if (file.mimeType === 'application/pdf') {
      mediaType = MediaType.PDF
    } else {
      mediaType = MediaType.FILE
    }

    const fileUrl = file.signedUrl ? `${agentUrl}${file.signedUrl}` : undefined

    const baseAsset = {
      mediaType,
      sourceType: 'upload' as const,
      imageUrl: fileUrl,
      filename: file.originalName,
      contentType: file.mimeType || 'application/octet-stream',
      size: file.size,
      thumbnailUrl: fileUrl
    }

    if (mediaType === MediaType.IMAGE) {
      return {
        ...baseAsset,
        mediaType: MediaType.IMAGE,
        dimensions: { width: 0, height: 0 }
      } as AssetManagerItem
    }
    if (mediaType === MediaType.VIDEO) {
      return {
        ...baseAsset,
        mediaType: MediaType.VIDEO,
        videoUrl: fileUrl,
        id: file.id,
        urlHash: file.id,
        width: 0,
        height: 0
      } as AssetManagerItem
    }
    if (mediaType === MediaType.PDF) {
      return {
        ...baseAsset,
        mediaType: MediaType.PDF
      } as AssetManagerItem
    }
    return {
      ...baseAsset,
      mediaType: MediaType.FILE
    } as AssetManagerItem
  })
}

/** Map server-reported uploads back to staged rows (order: first unused match per originalName). */
function stagedIdsForSuccessfulUploads(
  staged: StagedChatFile[],
  uploaded: UploadedFile[]
): string[] {
  const pool = [...staged]
  const used = new Set<string>()
  const ids: string[] = []
  for (const u of uploaded) {
    const idx = pool.findIndex((s) => s.file.name === u.originalName && !used.has(s.id))
    if (idx >= 0) {
      used.add(pool[idx].id)
      ids.push(pool[idx].id)
    }
  }
  return ids
}

export default function ChatPane({
  sendMessage,
  stopGeneration,
  isCreateFlowSession = false
}: ChatPaneProps) {
  const t = useTranslations();
  const messages = useMessages()
  const userMessages = useMemo(
    () => messages.filter(m => m.role === 'user' && m.content.trim()).map(m => m.content),
    [messages]
  )
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

  const { data: subscription } = useSubscription()
  const { data: isBudgetServiceEnabled = false } = useSwitchboard('app-builder-budget-service')

  // Gate grants fetch: disabled when budget path active
  const { data: grants, isFetching: isGrantsFetching } = useCreditGrants({
    subscriptionId: !isBudgetServiceEnabled ? subscription?.id : undefined,
  })

  // Budget path: fetch credit status from BFF
  const { data: budgetData, isFetching: isBudgetFetching } = useBudgetService({
    subscriptionId: subscription?.id,
    enabled: isBudgetServiceEnabled,
  })

  const { authState } = useAuthContext()
  // CRM skip sessions use e2s tokens. isEmployeeAuthType covers e2s/e2s2s — same check
  // used for feedback impersonation detection in Feedback.tsx.
   
  const isImpersonating = isEmployeeAuthType((authState as any)?.authType)

  // Dual-path credit availability check
  const hasAvailableCredits = isBudgetServiceEnabled
    ? budgetData !== undefined && (budgetData.creditsTotalNumeric - budgetData.creditsUsedNumeric) > 0
    : grants !== undefined && getActiveGrant(grants) !== undefined

  // Data loaded gate: prevents false "budget exceeded" during fetches
  const dataLoaded = isBudgetServiceEnabled
    ? budgetData !== undefined && !isBudgetFetching
    : grants !== undefined && !isGrantsFetching

  // CRM skip / impersonation sessions always have chat enabled regardless of credits
  const budgetExceeded = !isImpersonating && !hasAvailableCredits && (dataLoaded || budgetExceededFlag)
  const [isProactiveBannerDismissed, setIsProactiveBannerDismissed] = useState(false)

  // Reset dismissal only when credit data is stable and credits are no longer exhausted.
  // Excluding fetching state prevents a background refetch from briefly flipping
  // budgetExceeded=false (via dataLoaded) and resetting a dismissal the user just made.
  const isCreditFetching = isBudgetServiceEnabled ? isBudgetFetching : isGrantsFetching
  useEffect(() => {
    if (!budgetExceeded && !isCreditFetching) setIsProactiveBannerDismissed(false)
  }, [budgetExceeded, isCreditFetching])

  // Only show the proactive banner when budgetExceededFlag is false — the mid-stream
  // case already shows an identical banner inline in the message list.
  const showProactiveBudgetBanner = budgetExceeded && !budgetExceededFlag && !isProactiveBannerDismissed

  const hasLoggedFirstUserMessageRef = useRef(false)

  const expandedPlan = useDevelopPageStore((state) => state.expandedPlan)
  const toggleExpandedPlan = useDevelopPageStore((state) => state.toggleExpandedPlan)
  const isMobile = useDevelopPageStore((state) => state.isMobile)
  const setIsVersionHistoryOpen = useDevelopPageStore((state) => state.setIsVersionHistoryOpen)
  const { activeChatTab, setActiveChatTab } = useChatTabs()
  const prefersReducedMotion = useReducedMotion()

  const appId = useAppIdFromParams()

  const tabCrossfadeTransition = useMemo(
    () =>
      prefersReducedMotion
        ? { duration: 0 }
        : { duration: 0.2, ease: [0.4, 0, 0.2, 1] as const },
    [prefersReducedMotion]
  )

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

  /** Local files staged for the next send (preview only until upload on send) */
  const [stagedFiles, setStagedFiles] = useState<StagedChatFile[]>([])

  /** Staged attachment ids currently uploading — ChatInput shows overlay spinners on those thumbnails */
  const [uploadingStagedFileIds, setUploadingStagedFileIds] = useState<string[]>([])

  // State for upload error message (auto-dismisses after 8s)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const uploadErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // State for referenced files (file paths with content from file tree)
  const [referencedFiles, setReferencedFiles] = useState<Array<{ path: string; content: string }>>([])

  // Pre-fetch ventureId for AssetManager to avoid loading delay
  const [ventureId, setVentureId] = useState<string | null>(null)  

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

  // Switchboard flag reserved for future support-message UI treatment
  // const { data: showSupportMessages } = useSwitchboard('airo-builder-support-chat-ui')

  // Only show messages and state if they belong to the current app context
  const visibleMessages = (currentAppId === appId) ? allMessages : []
  const safeInputValue = (currentAppId === appId) ? (inputValue || '') : ''
  const safeAiEditContext = (currentAppId === appId) ? aiEditContext : null
  const safeBuildErrorContext = (currentAppId === appId) ? buildErrorContext : null

  // Calculate maxAssets based on image replacement mode
  const maxAssets = safeAiEditContext?.isImageReplacement ? 1 : MAX_TOTAL_ASSETS

  // Clear selected assets and staged files when entering image replacement mode
  useEffect(() => {
    if (safeAiEditContext?.isImageReplacement) {
      setSelectedAssets([])
      setStagedFiles((prev) => {
        prev.forEach((s) => {
          if (s.previewUrl) URL.revokeObjectURL(s.previewUrl)
        })
        return []
      })
    }
  }, [safeAiEditContext?.isImageReplacement])

  // Drop staged files when switching apps (revoke object URLs)
  useEffect(() => {
    setStagedFiles((prev) => {
      prev.forEach((s) => {
        if (s.previewUrl) URL.revokeObjectURL(s.previewUrl)
      })
      return []
    })
  }, [appId])

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

  // Handle large paste: convert to a referenced-file context attachment
  const handleLargePasteDetected = useCallback((content: string) => {
    if (!content?.trim()) {
      return
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
    setReferencedFiles((prev) => [
      ...prev,
      { path: `pasted-content-${timestamp}.txt`, content }
    ])
    logger.info('chat-pane.large-paste-converted', {
      appId,
      contentLength: content.length,
    })
    Growl.addGrowlMessage({
      id: 'chat-large-paste-attachment',
      title: t('builder_chat_large_paste_growl_title', undefined, 'Large content added as attachment'),
      children: t(
        'builder_chat_large_paste_growl_description',
        undefined,
        'Your paste was attached as a file below. You can add a short message, then send.'
      ),
      emphasis: 'info',
      lifetime: 5000,
    })
  }, [appId, t])

  // Handle clearing build error context
  const handleClearBuildErrorContext = useCallback(() => {
    setBuildErrorContext(null)
  }, [setBuildErrorContext])

  useEffect(function cleanupUploadErrorTimer() {
    return () => {
      if (uploadErrorTimeoutRef.current) {
        clearTimeout(uploadErrorTimeoutRef.current)
      }
    }
  }, [])

  /** Chat attachment banner (staging limits, validation); does not log as upload failure or clear in-flight upload state */
  const showTransientAttachmentBanner = useCallback((errorMessage: string) => {
    setUploadError(errorMessage)
    if (uploadErrorTimeoutRef.current) {
      clearTimeout(uploadErrorTimeoutRef.current)
    }
    uploadErrorTimeoutRef.current = setTimeout(() => {
      setUploadError(null)
      uploadErrorTimeoutRef.current = null
    }, 8000)
  }, [])

  const handleUploadError = useCallback((errorMessage?: string) => {
    logger.error('chat-pane.upload-error', { errorMessage })
    setUploadingStagedFileIds([])
    if (errorMessage) {
      showTransientAttachmentBanner(errorMessage)
    }
  }, [showTransientAttachmentBanner])

  /** ChatAttachmentMenu: file validation / screenshot — not multipart upload; no upload-error log or clearing in-flight IDs */
  const handleAttachmentMenuError = useCallback(
    (errorMessage?: string) => {
      if (errorMessage) {
        showTransientAttachmentBanner(errorMessage)
      }
    },
    [showTransientAttachmentBanner]
  )

  const handleStageFiles = useCallback(
    (files: File[]) => {
      if (!appId || budgetExceeded) return
      if (files.length === 0) return

      let errorAfter: string | undefined
      let partialAfter = false

      flushSync(() => {
        setStagedFiles((prev) => {
          const usedSlots = selectedAssets.length + prev.length
          const room = maxAssets - usedSlots
          if (room <= 0) {
            errorAfter = t('builder_chatfiles_error_max_attachments', { count: maxAssets })
            return prev
          }

          const slice = files.slice(0, room)
          const validationError = validateForStaging(slice, t)
          if (validationError) {
            errorAfter = validationError
            return prev
          }

          if (slice.length < files.length) {
            partialAfter = true
          }

          return [
            ...prev,
            ...slice.map((file) => ({
              id: `staged-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              file,
              previewUrl: getStagedFilePreviewUrl(file)
            }))
          ]
        })
      })

      if (errorAfter) {
        showTransientAttachmentBanner(errorAfter)
      } else if (partialAfter) {
        showTransientAttachmentBanner(t('builder_chatfiles_error_max_attachments', { count: maxAssets }))
      }
    },
    [appId, budgetExceeded, selectedAssets.length, maxAssets, t, showTransientAttachmentBanner]
  )

  const handleRemoveStagedFile = useCallback((id: string) => {
    setStagedFiles((prev) => {
      const found = prev.find((s) => s.id === id)
      if (found) {
        revokeStagedFilePreviewIfCached(found.file)
      }
      return prev.filter((s) => s.id !== id)
    })
  }, [])

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
              handleClearAiEditContext()
              return
            }

            if (astResult.fallbackRequired) {
              logger.info('chat-pane.image-replace.ast-fallback', { appId, error: astResult.error })
              sendFallbackMessage()
            } else {
              logger.debug('chat-pane.image-replace.ast-failed-no-fallback', { appId, error: astResult.error })
              handleClearAiEditContext()
            }
          } catch (error) {
            logger.error('chat-pane.image-replace.ast-error', { appId, error: String(error) })
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
            void sendMessage({
              content: message,
              aiEditContext: { ...currentAiEditContext, screenshot: null },
              selectedAssets: [selectedItem]
            })
            handleClearAiEditContext()
          }
        }

        void tryAstReplacement()
      } else {
        // Normal mode: allow multiple images (append with duplicate checking, capped at MAX_TOTAL_ASSETS)
        logger.debug('chat-pane.asset-select.manual', { appId })

        const existingUrls = new Set(selectedAssets.map(asset => asset.imageUrl))
        const newUniqueItems = items.filter(item => !existingUrls.has(item.imageUrl))
        if (selectedAssets.length + newUniqueItems.length > MAX_TOTAL_ASSETS) {
          // Not handleUploadError — that clears uploadingStagedFileIds and logs upload failure
          showTransientAttachmentBanner(
            t('builder_chatfiles_error_max_attachments', { count: MAX_TOTAL_ASSETS })
          )
        }

        setSelectedAssets((prevAssets) => {
          const prevUrls = new Set(prevAssets.map(asset => asset.imageUrl))
          const newItems = items.filter(item => !prevUrls.has(item.imageUrl))
          return [...prevAssets, ...newItems].slice(0, MAX_TOTAL_ASSETS)
        })
      }
    } else {
      logger.debug('chat-pane.asset-select.empty', { appId })
    }
  }, [appId, sendMessage, handleClearAiEditContext, t, selectedAssets, showTransientAttachmentBanner])

  // Handle sending a message - accepts optional content for programmatic sends
  const handleSendMessage = useCallback(async (content?: string, options?: { isActionRequest?: boolean }) => {
    const messageToSend = content ?? inputValue
    const userInitiated = content === undefined
    const hasText = Boolean(messageToSend?.trim())

    logger.debug('chat-pane.send-message', {
      message: 'ChatPane handleSendMessage called',
      inputValuePreview: inputValue?.slice(0, 50) + '...',
      hasSendMessageFunction: !!sendMessage
    })

    if (!hasText) {
      logger.error('chat-pane.send-message.empty-content', {
        appId,
        userInitiated,
        stagedFileCount: stagedFiles.length,
        selectedAssetCount: selectedAssets.length,
        referencedFileCount: referencedFiles.length,
      })
      return
    }

    const outboundContent = messageToSend.trim()

    let mergedAssets: AssetManagerItem[] | undefined =
      selectedAssets.length > 0 ? [...selectedAssets] : undefined

    if (userInitiated && stagedFiles.length > 0) {
      if (!agentUrl) {
        logger.error('chat-pane.send-with-staged.no-agent-url', { appId })
        handleUploadError(t('builder_chatfiles_error_upload_failed'))
        return
      }

      const toUpload = [...stagedFiles]
      setUploadingStagedFileIds(toUpload.map((s) => s.id))

      try {
        const { files: uploadedList, failedFiles, batchLevelError } = await uploadChatFiles(
          appId!,
          toUpload.map((s) => s.file),
          t
        )

        if (batchLevelError) {
          setUploadingStagedFileIds([])
          if (uploadedList.length > 0) {
            const partialItems = mapUploadedFilesToAssetItems(uploadedList, agentUrl)
            setSelectedAssets((prev) => [...prev, ...partialItems].slice(0, MAX_TOTAL_ASSETS))
            const succeededIds = stagedIdsForSuccessfulUploads(toUpload, uploadedList)
            setStagedFiles((prev) =>
              prev.filter((s) => {
                if (succeededIds.includes(s.id)) {
                  revokeStagedFilePreviewIfCached(s.file)
                  return false
                }
                return true
              })
            )
          }
          handleUploadError(batchLevelError)
          return
        }

        if (uploadedList.length === 0) {
          setUploadingStagedFileIds([])
          handleUploadError(t('builder_chatfiles_error_upload_failed'))
          return
        }

        const newItems = mapUploadedFilesToAssetItems(uploadedList, agentUrl)
        mergedAssets = [...(mergedAssets ?? []), ...newItems]

        toUpload.forEach((s) => {
          revokeStagedFilePreviewIfCached(s.file)
        })
        setStagedFiles([])
        setUploadingStagedFileIds([])

        if (failedFiles && failedFiles.length > 0) {
          const names = failedFiles.map((f) => f.originalName).join(', ')
          showTransientAttachmentBanner(
            t('builder_chatfiles_error_partial_failure', {
              success: uploadedList.length,
              total: uploadedList.length + failedFiles.length,
              names
            })
          )
        }
      } catch (error) {
        setUploadingStagedFileIds([])
        handleUploadError(error instanceof Error ? error.message : undefined)
        return
      }
    }

    logAiroHQEvent({
      category: 'click',
      recommendation_task: 'builder_develop_prompt_submit',
      recommendation_type: 'user_prompt'
    })();

    shipAnalyticsLog('chat.prompt.sent', {
      appId,
      promptLength: outboundContent.length,
      source: content ? 'suggestion' : 'user-input',
      hasEditContext: !!safeAiEditContext,
      hasSelectedAsset: Boolean(mergedAssets?.length),
      hasBuildErrorContext: !!safeBuildErrorContext,
      hasReferencedFiles: referencedFiles.length > 0
    });

    if (!hasLoggedFirstUserMessageRef.current && appId && isCreateFlowSession && userInitiated) {
      let userCount = 0
      for (const msg of messages) {
        if (msg.role === 'user' && ++userCount > 1) break
      }
      if (userCount <= 1) {
        shipAnalyticsLog('funnel.user_first_message.sent', {
          appId,
          promptLength: outboundContent.length,
        })
        hasLoggedFirstUserMessageRef.current = true
      }
    }

    if (currentAppId !== appId) {
      setCurrentAppId(appId)
    }

    if (content) {
      void sendMessage({
        content: outboundContent,
        aiEditContext: { screenshot: null },
        isActionRequest: options?.isActionRequest,
        customContext: referencedFiles.length > 0 ? { referencedFiles } : undefined
      })
    } else {
      void sendMessage({
        content: outboundContent,
        aiEditContext: { ...safeAiEditContext, screenshot: null },
        selectedAssets: mergedAssets,
        customContext: referencedFiles.length > 0 ? { referencedFiles } : undefined
      })

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
  }, [
    inputValue,
    sendMessage,
    currentAppId,
    appId,
    setCurrentAppId,
    safeAiEditContext,
    selectedAssets,
    stagedFiles,
    referencedFiles,
    safeBuildErrorContext,
    handleClearAiEditContext,
    handleClearSelectedAsset,
    handleClearReferencedFiles,
    handleClearBuildErrorContext,
    isCreateFlowSession,
    messages,
    agentUrl,
    t,
    handleUploadError,
    showTransientAttachmentBanner,
  ])

  // Create stable context value - reuses handleSendMessage
  const chatContextValue = useMemo(() => ({
    sendMessage: handleSendMessage
  }), [handleSendMessage])

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
      size: dataUrl.length,
      thumbnailUrl: dataUrl,
      dimensions: { width: 1024, height: 0 }
    }

    // Respect combined cap with staged files (same slots as menu / drop / paste)
    setSelectedAssets(prev => {
      const roomForSelected = maxAssets - stagedFiles.length
      if (roomForSelected <= 0) {
        return prev
      }
      if (prev.length >= roomForSelected) {
        return [...prev.slice(0, roomForSelected - 1), screenshotAsset]
      }
      return [...prev, screenshotAsset]
    })

    logger.info('chat-pane.screenshot-added', { appId, assetsCount: selectedAssets.length + 1 })
  }, [appId, maxAssets, selectedAssets.length, stagedFiles.length])

  // Listen for error fix requests from PreviewPaneSimple
  useEffect(() => {
    const handleErrorFixEvent = (event: CustomEvent) => {
      if (!isProcessing && event.detail.appId === appId && inputValue?.trim()) {
        // Use the actual sendMessage function from WebSocket hook
        void sendMessage({
          content: inputValue,
          aiEditContext: { ...safeAiEditContext, screenshot: null },
          selectedAssets: selectedAssets.length > 0 ? selectedAssets : undefined
        })

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

          {showProactiveBudgetBanner && (
            <div className="mx-2 sm:mx-3 mb-2">
              <BudgetExceededBanner onClose={() => setIsProactiveBannerDismissed(true)} />
            </div>
          )}
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
            isStreaming={isStreaming}
            isBudgetExceeded={budgetExceeded}
            onInputChange={setInputValue}
            onSendMessage={handleSendMessage}
            onStopGeneration={stopGeneration}
            selectedAssets={selectedAssets}
            maxAssets={maxAssets}
            onClearSelectedAsset={handleClearSingleAsset}
            stagedFiles={stagedFiles}
            onStageFiles={handleStageFiles}
            onRemoveStagedFile={handleRemoveStagedFile}
            onScreenshotCaptured={handleScreenshotCaptured}
            onFileReferencesSelected={handleFileReferencesSelected}
            onUploadError={handleAttachmentMenuError}
            uploadingStagedFileIds={uploadingStagedFileIds}
            referencedFiles={referencedFiles}
            onClearReferencedFile={handleClearSingleReferencedFile}
            aiEditContext={safeAiEditContext}
            onClearAiEditContext={handleClearAiEditContext}
            onLargePasteDetected={handleLargePasteDetected}
            userMessages={userMessages}
          />
        </div>
      </ChatContext.Provider>
    )
  }

  return (
    <ChatContext.Provider value={chatContextValue}>
    <div className="flex-1 flex flex-col h-full p-0 md:pl-2 md:pb-2 gap-1">
      <PlanTracker
        developmentPlan={developmentPlan}
        expandedPlan={expandedPlan}
        onToggleExpandedPlan={toggleExpandedPlan}
      />

      <div className="relative flex-1 min-h-0">
        <motion.div
          className="absolute inset-0 flex flex-col min-h-0"
          initial={false}
          animate={{ opacity: activeChatTab === ChatTab.CHAT ? 1 : 0 }}
          transition={tabCrossfadeTransition}
          style={{ pointerEvents: activeChatTab === ChatTab.CHAT ? 'auto' : 'none' }}
          aria-hidden={activeChatTab !== ChatTab.CHAT}
          inert={activeChatTab !== ChatTab.CHAT ? true : undefined}
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

          {showProactiveBudgetBanner && (
            <div className="px-2 sm:px-3 md:px-1 mb-2">
              <BudgetExceededBanner onClose={() => setIsProactiveBannerDismissed(true)} />
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
              isStreaming={isStreaming}
              isBudgetExceeded={budgetExceeded}
              onInputChange={setInputValue}
              onSendMessage={handleSendMessage}
              onStopGeneration={stopGeneration}
              selectedAssets={selectedAssets}
              maxAssets={maxAssets}
              onClearSelectedAsset={handleClearSingleAsset}
              stagedFiles={stagedFiles}
              onStageFiles={handleStageFiles}
              onRemoveStagedFile={handleRemoveStagedFile}
              onScreenshotCaptured={handleScreenshotCaptured}
              onFileReferencesSelected={handleFileReferencesSelected}
              onUploadError={handleAttachmentMenuError}
              uploadingStagedFileIds={uploadingStagedFileIds}
              referencedFiles={referencedFiles}
              onClearReferencedFile={handleClearSingleReferencedFile}
              aiEditContext={safeAiEditContext}
              onClearAiEditContext={handleClearAiEditContext}
              onLargePasteDetected={handleLargePasteDetected}
              userMessages={userMessages}
            />
          </div>
        </motion.div>

        <motion.div
          className="absolute inset-0 flex flex-col min-h-0"
          initial={false}
          animate={{ opacity: activeChatTab === ChatTab.HISTORY ? 1 : 0 }}
          transition={tabCrossfadeTransition}
          style={{ pointerEvents: activeChatTab === ChatTab.HISTORY ? 'auto' : 'none' }}
          aria-hidden={activeChatTab !== ChatTab.HISTORY}
          inert={activeChatTab !== ChatTab.HISTORY ? true : undefined}
        >
          <VersionHistory />
        </motion.div>

        <motion.div
          className="absolute inset-0 flex flex-col min-h-0"
          initial={false}
          animate={{ opacity: activeChatTab === ChatTab.MEDIAS ? 1 : 0 }}
          transition={tabCrossfadeTransition}
          style={{ pointerEvents: activeChatTab === ChatTab.MEDIAS ? 'auto' : 'none' }}
          aria-hidden={activeChatTab !== ChatTab.MEDIAS}
          inert={activeChatTab !== ChatTab.MEDIAS ? true : undefined}
        >
          <MediaPanel />
        </motion.div>

        <motion.div
          className="absolute inset-0 flex flex-col min-h-0 overflow-y-auto"
          initial={false}
          animate={{ opacity: activeChatTab === ChatTab.ANALYTICS ? 1 : 0 }}
          transition={tabCrossfadeTransition}
          style={{ pointerEvents: activeChatTab === ChatTab.ANALYTICS ? 'auto' : 'none' }}
          aria-hidden={activeChatTab !== ChatTab.ANALYTICS}
          inert={activeChatTab !== ChatTab.ANALYTICS ? true : undefined}
        >
          <AnalyticsPanel />
        </motion.div>

        <motion.div
          className="absolute inset-0 flex flex-col min-h-0"
          initial={false}
          animate={{ opacity: activeChatTab === ChatTab.SETTINGS ? 1 : 0 }}
          transition={tabCrossfadeTransition}
          style={{ pointerEvents: activeChatTab === ChatTab.SETTINGS ? 'auto' : 'none' }}
          aria-hidden={activeChatTab !== ChatTab.SETTINGS}
          inert={activeChatTab !== ChatTab.SETTINGS ? true : undefined}
        >
          <SettingsView />
        </motion.div>
      </div>

      <ChatToolbar
        isProcessing={isProcessing}
      />
    </div>
    </ChatContext.Provider>
  )
}
