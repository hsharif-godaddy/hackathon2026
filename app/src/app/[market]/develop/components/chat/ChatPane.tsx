'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { isEmployeeAuthType } from '@airo/shared/auth'
import Box from '@ux/box'
import Growl from '@ux/growl'

import { AssetManagerItem, MediaType } from '@/app/[market]/develop/components/chat/AssetTypes'
import ChatBanners from '@/app/[market]/develop/components/chat/banners/ChatBanners'
import { ChatContext, type SendMessageOptions as SendChatMessageOptions } from '@/app/[market]/develop/components/chat/ChatContext'
import ChatInput, { type StagedChatFile } from '@/app/[market]/develop/components/chat/ChatInput'
import ChatToolbar from '@/app/[market]/develop/components/chat/ChatToolbar'
import { DebugStatsProvider, useDebugStats } from '@/app/[market]/develop/components/chat/DebugStatsContext'
import { DebugStatsPanel } from '@/app/[market]/develop/components/chat/DebugStatsDrawer'
import { UploadedFile } from '@/app/[market]/develop/components/chat/FileUploadButton'
import {
  getStagedFilePreviewUrl,
  revokeStagedFilePreviewIfCached,
} from '@/app/[market]/develop/components/chat/stagedFilePreviewUrl'
import { uploadChatFiles } from '@/app/[market]/develop/components/chat/uploadChatFiles'
import { useDebugStatsBridge } from '@/app/[market]/develop/components/chat/useDebugStatsBridge'
import PanelSkeleton from '@/app/[market]/develop/components/PanelSkeleton'
import PersistentTodoList from '@/app/[market]/develop/components/PersistentTodoList'
import PlanTracker from '@/app/[market]/develop/components/PlanTracker'
import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState'
import StreamingMessageList from '@/app/[market]/develop/components/StreamingMessageList'
import { ChatTab } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { isColorSuggestPanelVisible } from '@/app/[market]/develop/components/utils/colorSuggestPanelVisibility'
import { findLatestColorSchemeSuggest } from '@/app/[market]/develop/components/utils/findLatestColorSchemeSuggest'
import { findLatestFontThemeSuggest } from '@/app/[market]/develop/components/utils/findLatestFontThemeSuggest'
import { isFontSuggestPanelVisible } from '@/app/[market]/develop/components/utils/fontSuggestPanelVisibility'
import { useAuthContext } from '@/components/providers/AuthProvider'
import { SWITCHBOARD_APPBUILDER_GO_LIVE_FEATURE } from '@/config/switchboard-flags'
import { trackPostInteraction } from '@/hooks/shared/initialBuildFunnel'
import { useAotPreload } from '@/hooks/useAotPreload'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useConversionEvent } from '@/hooks/useConversionEvent'
import { useCreditGrants } from '@/hooks/useCreditGrants'
import type { SendMessageOptions } from '@/hooks/useStreamingWebSocket'
import { useSubscription } from '@/hooks/useSubscription'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTodoListLoader } from '@/hooks/useTodoListLoader'
import { useTranslations } from '@/hooks/useTranslations'
import { useVisitedTabs } from '@/hooks/useVisitedTabs'
import { getFileUploadAgent } from '@/lib/file-agent'
import { appFetch } from '@/lib/gasket-config'
import { shipAnalyticsLog } from '@/lib/logging'
import { createPostPublishPreLaunchAssistantMessage } from '@/lib/post-publish-prelaunch-ask-question'
import { logger } from '@/lib/request-context'
import { appService } from '@/services/AppService'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useSiteStore } from '@/stores/useSiteStore'
import {
  useActiveStream,
  useAiEditContext,
  useAiEditContexts,
  useBudgetExceeded,
  useBuildErrorContext,
  useClearAiEditContexts,
  useCurrentAppId,
  useDevelopmentPlan,
  useInputValue,
  useIsActivelyStreaming,
  useIsLoading,
  useMessages,
  useRemoveAiEditContext,
  useSetAiEditContext,
  useSetBuildErrorContext,
  useSetCurrentAppId,
  useSetInputValue,
  useStreamingConversationStore,
} from '@/stores/useStreamingConversationStore'
import { getActiveGrant } from '@/utils/credits'
import { MAX_TOTAL_ASSETS, UPLOAD_TIMEOUT_MS, UPLOAD_TIMEOUT_SECONDS, validateForStaging } from '@/utils/file-upload-validation'
import { logAiroHQEvent } from '@/utils/instrumentation'
import { postMessageToIframe } from '@/utils/postMessage'

// Lazy-load features that are conditionally rendered or behind user interaction
const AnalyticsPanel = dynamic(() => import('@/app/[market]/develop/components/settings/Analytics/AnalyticsPanel'), { loading: () => <SettingsLoadingState fullPage /> })
const MediaPanel = dynamic(() => import('@/app/[market]/develop/components/media/MediaPanel'), { loading: () => <PanelSkeleton panelType={ChatTab.MEDIAS} /> })
const VersionHistory = dynamic(() => import('@/app/[market]/develop/components/VersionHistory'), { loading: () => <PanelSkeleton panelType={ChatTab.HISTORY} className="p-2 sm:p-0" /> })

// SettingsView is AOT-preloaded by page.tsx; loading fallback is still needed
// so React.lazy gets a local Suspense boundary if the preload hasn't finished.
const SettingsView = dynamic(() => import('@/app/[market]/develop/components/settings/SettingsView'), { loading: () => <SettingsLoadingState fullPage /> })

// Lazy-loaded but preloaded on idle after mount
// We do them AOT to avoid skeleton/loader flashes - purely UX and non-blocking.
const importBudgetExceededBanner = () => import('@/app/[market]/develop/components/chat/BudgetExceededBanner')
const BudgetExceededBanner = dynamic(importBudgetExceededBanner)

const aotImports = [importBudgetExceededBanner]

interface ChatPaneProps {
  sendMessage: (options: SendMessageOptions) => Promise<void>
  stopGeneration: () => void
  isCreateFlowSession?: boolean
  hasInitialPrompt?: boolean
  /**
   * Show the stop button (disabled) while a generation has been requested but
   * the WebSocket stream has not yet started — typically the post-creation
   * window between job→app transition and the first stream chunk.
   */
  isAwaitingStream?: boolean
  loadingMessage?: string | null
  initialPromptText?: string | null
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

export default function ChatPane(props: ChatPaneProps) {
  return (
    <DebugStatsProvider>
      <ChatPaneInner {...props} />
    </DebugStatsProvider>
  )
}

function ChatPaneInner({
  sendMessage,
  stopGeneration,
  isCreateFlowSession = false,
  hasInitialPrompt = false,
  isAwaitingStream = false,
  loadingMessage = null,
  initialPromptText = null,
}: ChatPaneProps) {
  const t = useTranslations();
  const { dispatch: debugStatsDispatch } = useDebugStats()
  useDebugStatsBridge()
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
  // Seal the in-flight debug stats turn when the agent's response finishes
  // streaming, so the drawer reflects the prompt the user just saw rather
  // than waiting until the next prompt is sent.
  const wasStreamingRef = useRef(false)
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      debugStatsDispatch({ type: 'USER_MESSAGE_SENT', sealedAt: new Date().toISOString() })
    }
    wasStreamingRef.current = isStreaming
  }, [isStreaming, debugStatsDispatch])
  const developmentPlan = useDevelopmentPlan()
  const aiEditContext = useAiEditContext()
  const buildErrorContext = useBuildErrorContext()
  const budgetExceededFlag = useBudgetExceeded()
  const setInputValue = useSetInputValue()
  const setAiEditContext = useSetAiEditContext()
  const aiEditContexts = useAiEditContexts()
  const removeAiEditContext = useRemoveAiEditContext()
  const clearAiEditContexts = useClearAiEditContexts()
  const isMultiElementSelect = useDevelopPageStore((state) => state.isMultiSelectEnabled)
  const setBuildErrorContext = useSetBuildErrorContext()
  const setCurrentAppId = useSetCurrentAppId()

  const { data: subscription } = useSubscription()
  useConversionEvent(subscription)
  const areChatPlansEnabled = useSwitchboard('airo-builder-chat-plans')
  const isThemeSelectionChatEnabled = useSwitchboard('airo-builder-theme-selection-chat')
  const isGoLiveFeatureEnabled = useSwitchboard(SWITCHBOARD_APPBUILDER_GO_LIVE_FEATURE) === true
  const isFontSelectionChatEnabled = useSwitchboard('airo-builder-font-selection-chat')

  // Unified grants fetch - works for both BMS and legacy paths
  const { data: grants, isFetching: isGrantsFetching } = useCreditGrants({
    subscriptionId: subscription?.id,
  })

  const { tokenAuthType } = useAuthContext()
  // CRM skip sessions use e2s tokens. isEmployeeAuthType covers e2s/e2s2s — same check
  // used for feedback impersonation detection in Feedback.tsx.
  const isImpersonating = isEmployeeAuthType(tokenAuthType)

  // Credit availability check using unified grants
  const hasAvailableCredits = grants !== undefined && getActiveGrant(grants) !== undefined

  // Data loaded gate: prevents false "budget exceeded" during fetches
  const dataLoaded = grants !== undefined && !isGrantsFetching

  // CRM skip / impersonation sessions always have chat enabled regardless of credits
  const budgetExceeded = !isImpersonating && !hasAvailableCredits && (dataLoaded || budgetExceededFlag)
  const [isProactiveBannerDismissed, setIsProactiveBannerDismissed] = useState(false)

  useAotPreload(aotImports)

  // Reset dismissal only when credit data is stable and credits are no longer exhausted.
  // Excluding fetching state prevents a background refetch from briefly flipping
  // budgetExceeded=false (via dataLoaded) and resetting a dismissal the user just made.
  useEffect(() => {
    if (!budgetExceeded && !isGrantsFetching) setIsProactiveBannerDismissed(false)
  }, [budgetExceeded, isGrantsFetching])

  // Only show the proactive banner when budgetExceededFlag is false — the mid-stream
  // case already shows an identical banner inline in the message list.
  const showProactiveBudgetBanner = budgetExceeded && !budgetExceededFlag && !isProactiveBannerDismissed

  const hasLoggedFirstUserMessageRef = useRef(false)
  const lastInjectedPreLaunchNonceRef = useRef<number | null>(null)

  const expandedPlan = useDevelopPageStore((state) => state.expandedPlan)
  const toggleExpandedPlan = useDevelopPageStore((state) => state.toggleExpandedPlan)
  const isMobile = useDevelopPageStore((state) => state.isMobile)
  const setIsVersionHistoryOpen = useDevelopPageStore((state) => state.setIsVersionHistoryOpen)
  const { activeChatTab, setActiveChatTab } = useChatTabs()
  const visitedTabs = useVisitedTabs(activeChatTab)

  const appId = useAppIdFromParams()

  const showPostPublishFeatureSelection = useDevelopPageStore((state) =>
    appId && state.publishStates?.[appId]
      ? state.publishStates[appId].showPostPublishFeatureSelection
      : false
  )

  const postPublishFeatureSelectionNonce = useDevelopPageStore((state) =>
    appId && state.publishStates?.[appId]
      ? state.publishStates[appId].postPublishFeatureSelectionNonce
      : 0
  )

  useEffect(
    function resetPreLaunchInjectNonceOnAppChange() {
      lastInjectedPreLaunchNonceRef.current = null
    },
    [appId],
  )

  useEffect(
    function injectPreLaunchAskQuestionWhenOpened() {
      if (!appId || !showPostPublishFeatureSelection || !isGoLiveFeatureEnabled) return
      if (lastInjectedPreLaunchNonceRef.current === postPublishFeatureSelectionNonce) return

      const streamState = useStreamingConversationStore.getState()
      if (streamState.currentAppId !== appId) {
        logger.warn('publish.prelaunch.inject.skip_wrong_app', {
          streamAppId: streamState.currentAppId,
          targetAppId: appId,
        })
        return
      }

      const assistantMessage = createPostPublishPreLaunchAssistantMessage({
        appId,
        nonce: postPublishFeatureSelectionNonce,
      })

      try {
        useStreamingConversationStore.getState().persistHistory({
          appId,
          messages: [assistantMessage],
          mode: 'append',
        })

        lastInjectedPreLaunchNonceRef.current = postPublishFeatureSelectionNonce

        useDevelopPageStore.getState().setPostPublishFeatureSelection(appId, false)

        logger.info('publish.prelaunch.ask_question_injected', {
          appId,
          nonce: postPublishFeatureSelectionNonce,
        })
      } catch (error) {
        logger.error('publish.prelaunch.ask_question_inject.failed', {
          appId,
          nonce: postPublishFeatureSelectionNonce,
          errorMessage: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [appId, isGoLiveFeatureEnabled, showPostPublishFeatureSelection, postPublishFeatureSelectionNonce],
  )

  // Load current todo list into store so InputActionsPanel has data when the flag is on
  useTodoListLoader(areChatPlansEnabled ? appId : null)

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
  const activeColorSchemeSuggestRaw = useMemo(
    () =>
      isThemeSelectionChatEnabled && currentAppId === appId
        ? findLatestColorSchemeSuggest(visibleMessages)
        : null,
    [appId, currentAppId, isThemeSelectionChatEnabled, visibleMessages]
  )
  const activeColorSchemeSuggestCandidate = useMemo(() => {
    if (!isThemeSelectionChatEnabled) return null
    if (!activeColorSchemeSuggestRaw) return null
    if (!isColorSuggestPanelVisible(visibleMessages, activeColorSchemeSuggestRaw, t)) return null
    return activeColorSchemeSuggestRaw
  }, [activeColorSchemeSuggestRaw, isThemeSelectionChatEnabled, t, visibleMessages])

  const activeFontThemeSuggestRaw = useMemo(
    () =>
      isFontSelectionChatEnabled && currentAppId === appId
        ? findLatestFontThemeSuggest(visibleMessages)
        : null,
    [appId, currentAppId, isFontSelectionChatEnabled, visibleMessages]
  )
  const activeFontThemeSuggestCandidate = useMemo(() => {
    if (!isFontSelectionChatEnabled) return null
    if (!activeFontThemeSuggestRaw) return null
    if (!isFontSuggestPanelVisible(visibleMessages, activeFontThemeSuggestRaw)) return null
    return activeFontThemeSuggestRaw
  }, [activeFontThemeSuggestRaw, isFontSelectionChatEnabled, visibleMessages])

  const { activeColorSchemeSuggest, activeFontThemeSuggest } = useMemo(() => {
    const color = activeColorSchemeSuggestCandidate
    const font = activeFontThemeSuggestCandidate
    if (!color && !font) return { activeColorSchemeSuggest: null, activeFontThemeSuggest: null }
    if (color && !font) return { activeColorSchemeSuggest: color, activeFontThemeSuggest: null }
    if (!color && font) return { activeColorSchemeSuggest: null, activeFontThemeSuggest: font }
    // Both color and font are non-null here due to prior conditional returns
    const colorNonNull = color
    const fontNonNull = font
    const ic = visibleMessages.findIndex((m) => m.id === colorNonNull.messageId)
    const ifont = visibleMessages.findIndex((m) => m.id === fontNonNull.messageId)
    if (ifont > ic) return { activeColorSchemeSuggest: null, activeFontThemeSuggest: fontNonNull }
    return { activeColorSchemeSuggest: colorNonNull, activeFontThemeSuggest: null }
  }, [activeColorSchemeSuggestCandidate, activeFontThemeSuggestCandidate, visibleMessages])
  const safeInputValue = (currentAppId === appId) ? (inputValue || '') : ''
  const safeAiEditContext = (currentAppId === appId) ? aiEditContext : null
  const safeAiEditContexts = (currentAppId === appId) ? aiEditContexts : []
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
  // History now loads asynchronously in the background (decoupled from connection setup),
  // so we no longer gate on historyLoadingComplete — the spinner in StreamingMessageList
  // already signals the in-flight load and the user should be free to type at any time.
  const isProcessing = isLoading || isStreaming || !!loadingMessage

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

  // Handle clearing all AI edit contexts (multi-select)
  const handleClearAllAiEditContexts = useCallback(() => {
    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
    if (iframe) {
      postMessageToIframe(iframe, { type: 'CLEAR_ALL_SELECTIONS' })
    }
    clearAiEditContexts()
  }, [clearAiEditContexts])

  // Handle removing a single AI edit context by number (multi-select)
  const handleRemoveAiEditContext = useCallback((number: number) => {
    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
    if (iframe) {
      postMessageToIframe(iframe, { type: 'REMOVE_SELECTION', data: { number } })
    }
    removeAiEditContext(number)
  }, [removeAiEditContext])

  // Scroll preview to the element for a clicked mention chip
  useEffect(() => {
    const handler = (e: Event) => {
      const { number } = (e as CustomEvent).detail
      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
      if (iframe) {
        postMessageToIframe(iframe, { type: 'SCROLL_TO_SELECTION', data: { number } })
      }
    }
    document.addEventListener('scroll-to-mention', handler)
    return () => document.removeEventListener('scroll-to-mention', handler)
  }, [])

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

  // Handle sending a message - accepts optional content for programmatic sends
  const handleSendMessage = useCallback(async (content?: string, options?: SendChatMessageOptions) => {
    debugStatsDispatch({ type: 'USER_MESSAGE_SENT', sealedAt: new Date().toISOString() })
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

    trackPostInteraction()

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

    // Merge referenced files with any custom context from the caller (e.g. plan item instructions)
    const mergedCustomContext = options?.customContext || referencedFiles.length > 0
      ? {
          ...options?.customContext,
          ...(referencedFiles.length > 0 ? { referencedFiles } : {}),
        }
      : undefined

    if (content) {
      void sendMessage({
        content: outboundContent,
        aiEditContext: { screenshot: null },
        isActionRequest: options?.isActionRequest,
        customContext: mergedCustomContext,
      })
      handleClearAllAiEditContexts()
    } else {
      const sendOptions: Parameters<typeof sendMessage>[0] = {
        content: outboundContent,
        aiEditContext: isMultiElementSelect ? undefined : { ...safeAiEditContext, screenshot: null },
        aiEditContexts: isMultiElementSelect && safeAiEditContexts.length > 0 ? safeAiEditContexts.map(c => ({ ...c, screenshot: null })) : undefined,
        selectedAssets: mergedAssets,
        customContext: mergedCustomContext,
      }
      void sendMessage(sendOptions)

      // Clear contexts only for user input sends
      if (isMultiElementSelect && safeAiEditContexts.length > 0) {
        handleClearAllAiEditContexts()
      } else if (safeAiEditContext) {
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
    debugStatsDispatch,
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
            sendMessage({
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

        // Check before updating — functional updater runs async so we can't rely on it for side effects
        const existingUrls = new Set(selectedAssets.map(asset => asset.imageUrl))
        const newUniqueItems = items.filter(item => !existingUrls.has(item.imageUrl))
        if (selectedAssets.length + newUniqueItems.length > MAX_TOTAL_ASSETS) {
          // Not handleUploadError — that clears uploadingStagedFileIds and logs upload failure
          showTransientAttachmentBanner(
            t('builder_chatfiles_error_max_attachments', { count: MAX_TOTAL_ASSETS })
          )
        }

        // Intentional partial-accept: assets that fit within the limit are still added
        // even when the total would exceed MAX_TOTAL_ASSETS. The error banner above informs
        // the user, and setSelectedAssets slices to the limit below.
        setSelectedAssets((prevAssets) => {
          // Create a Set of existing asset URLs to check for duplicates
          const prevUrls = new Set(prevAssets.map(asset => asset.imageUrl))

          // Filter out duplicates from new items, then cap at limit
          const newItems = items.filter(item => !prevUrls.has(item.imageUrl))
          return [...prevAssets, ...newItems].slice(0, MAX_TOTAL_ASSETS)
        })
      }
    } else {
      logger.debug('chat-pane.asset-select.empty', { appId })
    }
  }, [appId, sendMessage, handleClearAiEditContext, t, selectedAssets, showTransientAttachmentBanner])

  // Refs mirror local state so handleScreenshotCaptured can read fresh values
  // after its network awaits, without re-creating the callback on every change
  // to selectedAssets / stagedFiles. The async cap calculation depends on this.
  const selectedAssetsRef = useRef(selectedAssets)
  const stagedFilesRef = useRef(stagedFiles)
  useEffect(() => { selectedAssetsRef.current = selectedAssets }, [selectedAssets])
  useEffect(() => { stagedFilesRef.current = stagedFiles }, [stagedFiles])

  // Handle screenshot/paste capture from chat input.
  // Uploads to the server so the WebSocket message carries a short URL reference
  // instead of the raw base64 data URL (which would exceed the 100k char limit).
  //
  // Bypasses handleAssetSelect intentionally: handleAssetSelect treats the
  // currentAiEditContext.isImageReplacement branch as an "auto-send" trigger
  // (AST swap or "Replace this image…" chat message). A user pasting/capturing
  // a screenshot has not opted into auto-send — they have only attached an asset.
  const handleScreenshotCaptured = useCallback(async (dataUrl: string) => {
    if (!appId) return
    // Guard agentUrl up-front to avoid wasting a multipart upload that would
    // orphan the file on the server with no UI reference. Site may not be
    // hydrated yet when the user pastes/captures very early in page load.
    if (!agentUrl) {
      logger.warn('chat-pane.screenshot.no-agent-url', { appId })
      showTransientAttachmentBanner(t('builder_chatfiles_error_upload_failed'))
      return
    }
    logger.debug('chat-pane.screenshot-captured', { appId })

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
    // crypto.randomUUID — collision-safe across rapid captures (paste-twice or
    // paste + camera shortcut within the same millisecond). Date.now alone collides.
    const placeholderId = `screenshot-${crypto.randomUUID()}`
    setUploadingStagedFileIds(prev => [...prev, placeholderId])

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)

    let assetItems: AssetManagerItem[] | null = null

    try {
      const blob = await fetch(dataUrl, { signal: controller.signal }).then(r => r.blob())
      // Today canvas.toDataURL emits image/jpeg, but trust the blob so a future
      // PNG/WebP capture path produces a File whose MIME matches its bytes.
      const mimeType = blob.type || 'image/jpeg'
      const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
      const filename = `screenshot-${timestamp}.${ext}`
      const file = new File([blob], filename, { type: mimeType })

      // getFileUploadAgent uses appFetch internally with no abort signal, so race it
      // against the controller to honour UPLOAD_TIMEOUT_MS during the token fetch too.
      const { token, uploadUrl } = await Promise.race([
        getFileUploadAgent(appId),
        new Promise<never>((_, reject) => {
          if (controller.signal.aborted) {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
            return
          }
          controller.signal.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
            { once: true }
          )
        }),
      ])

      const formData = new FormData()
      formData.append('appId', appId)
      formData.append('files', file)

      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        signal: controller.signal
      })

      if (!response.ok) {
        let errorMessage = `Upload failed (${response.status})`
        try {
          const body = await response.json()
          if (body.error) {
            errorMessage = typeof body.error === 'string' ? body.error : body.error.message || errorMessage
          }
        } catch {
          // Server returned a non-JSON error body (e.g. HTML gateway page).
          // The upload has definitively failed — log at warn so gateway/proxy
          // misbehaviour surfaces in Grafana/Loki at the default log level.
          // The raw SyntaxError is suppressed; the default errorMessage above is shown.
          logger.warn('chat-pane.screenshot-upload-failed.non-json-error-body', {
            appId,
            status: response.status
          })
        }
        throw new Error(errorMessage)
      }

      let result: { uploadId?: string; files?: unknown }
      try {
        result = await response.json()
      } catch {
        // 200 OK with a non-JSON body (e.g. an HTML page from a misbehaving proxy).
        // The raw SyntaxError message would leak to the banner, so use the localized fallback.
        logger.error('chat-pane.screenshot-upload-failed.non-json-success-body', { appId })
        throw new Error(t('builder_chatfiles_error_upload_failed'))
      }
      logger.info('chat-pane.screenshot-uploaded', { appId, uploadId: result.uploadId })

      if (!Array.isArray(result.files) || result.files.length === 0) {
        throw new Error(t('builder_chatfiles_error_upload_failed'))
      }

      assetItems = mapUploadedFilesToAssetItems(result.files, agentUrl)
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === 'AbortError'
      const message = isTimeout
        ? t('builder_chatfiles_error_timeout_duration', { seconds: UPLOAD_TIMEOUT_SECONDS })
        : error instanceof Error ? error.message : t('builder_chatfiles_error_upload_failed')
      logger.error('chat-pane.screenshot-upload-failed', { appId, error: message })
      // Not handleUploadError — that clears the entire uploadingStagedFileIds array,
      // which would wipe spinners for unrelated in-flight uploads. The finally block
      // surgically removes only this screenshot's placeholder id.
      showTransientAttachmentBanner(message)
    } finally {
      clearTimeout(timeout)
      setUploadingStagedFileIds(prev => prev.filter(id => id !== placeholderId))
    }

    // Asset attachment runs outside the try block so a programming error in
    // setSelectedAssets is not mis-logged as chat-pane.screenshot-upload-failed.
    if (!assetItems) return

    // Read current state via refs (the network awaits above can outlive the
    // useCallback closure). Cap accounts for stagedFiles since they will be
    // appended to selectedAssets at Send time. With refs supplying fresh values,
    // the setSelectedAssets updater stays a true pure prev → next mapping.
    const currentSelected = selectedAssetsRef.current
    const currentStaged = stagedFilesRef.current
    const room = MAX_TOTAL_ASSETS - currentSelected.length - currentStaged.length
    const prevUrls = new Set(currentSelected.map(a => a.imageUrl))
    const dedup = assetItems.filter(item => !prevUrls.has(item.imageUrl))
    const itemsToAdd = dedup.slice(0, Math.max(0, room))

    if (dedup.length > room) {
      showTransientAttachmentBanner(
        t('builder_chatfiles_error_max_attachments', { count: MAX_TOTAL_ASSETS })
      )
    }
    if (itemsToAdd.length > 0) {
      setSelectedAssets((prev) => [...prev, ...itemsToAdd])
    }
  }, [appId, t, agentUrl, showTransientAttachmentBanner])

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
        <div className="flex-1 flex flex-col min-h-0 overflow-x-hidden relative">
          <PlanTracker
            developmentPlan={developmentPlan}
            expandedPlan={expandedPlan}
            onToggleExpandedPlan={toggleExpandedPlan}
          />

          <StreamingMessageList
            allMessages={visibleMessages}
            isCreateFlowSession={isCreateFlowSession}
            hasInitialPrompt={hasInitialPrompt}
            initialPromptText={initialPromptText}
            transcriptContainerVisible
          />

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
            activeColorSchemeSuggest={activeColorSchemeSuggest}
            activeFontThemeSuggest={activeFontThemeSuggest}
            appId={appId}
            inputValue={safeInputValue}
            isDisabled={isProcessing}
            isStreaming={isStreaming}
            isAwaitingStream={isAwaitingStream}
            isBudgetExceeded={budgetExceeded}
            loadingMessage={loadingMessage}
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
          <DebugStatsPanel />
        </div>
      </ChatContext.Provider>
    )
  }

  return (
    <ChatContext.Provider value={chatContextValue}>
      <div className="flex-1 flex flex-col h-full p-0 md:ps-2 md:pb-2 gap-1">
        <PlanTracker
          developmentPlan={developmentPlan}
          expandedPlan={expandedPlan}
          onToggleExpandedPlan={toggleExpandedPlan}
        />

        {/* Chat Tab - Keep mounted, hide with CSS */}
        <div
          className="flex flex-col flex-1 min-h-0 relative"
          style={{ display: activeChatTab === ChatTab.CHAT ? 'flex' : 'none' }}
        >
          {!areChatPlansEnabled && <PersistentTodoList />}

          <StreamingMessageList
            allMessages={visibleMessages}
            isCreateFlowSession={isCreateFlowSession}
            hasInitialPrompt={hasInitialPrompt}
            initialPromptText={initialPromptText}
            transcriptContainerVisible={activeChatTab === ChatTab.CHAT}
          />

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
              activeColorSchemeSuggest={activeColorSchemeSuggest}
              activeFontThemeSuggest={activeFontThemeSuggest}
              appId={appId}
              inputValue={safeInputValue}
              isDisabled={isProcessing}
              isStreaming={isStreaming}
              isAwaitingStream={isAwaitingStream}
              isBudgetExceeded={budgetExceeded}
              loadingMessage={loadingMessage}
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
              aiEditContexts={safeAiEditContexts}
              onRemoveAiEditContext={handleRemoveAiEditContext}
              onClearAiEditContexts={handleClearAllAiEditContexts}
              isMultiElementSelect={Boolean(isMultiElementSelect)}
              onLargePasteDetected={handleLargePasteDetected}
              userMessages={userMessages}
            />
          </div>
          <DebugStatsPanel />
        </div>

        {/* History Tab - Mount on first visit, then CSS-hide to preserve state */}
        {(activeChatTab === ChatTab.HISTORY || visitedTabs.has(ChatTab.HISTORY)) && (
          <div
            className="flex flex-col flex-1 min-h-0"
            style={{ display: activeChatTab === ChatTab.HISTORY ? 'flex' : 'none' }}
          >
            <VersionHistory />
          </div>
        )}

        {/* Media Tab - Mount on first visit, then CSS-hide to preserve state */}
        {(activeChatTab === ChatTab.MEDIAS || visitedTabs.has(ChatTab.MEDIAS)) && (
          <div
            className="flex flex-col flex-1 min-h-0"
            style={{ display: activeChatTab === ChatTab.MEDIAS ? 'flex' : 'none' }}
          >
            <MediaPanel />
          </div>
        )}

        {/* Analytics Tab - Mount on first visit, then CSS-hide to preserve state */}
        {(activeChatTab === ChatTab.ANALYTICS || visitedTabs.has(ChatTab.ANALYTICS)) && (
          <div
            className="flex flex-col flex-1 min-h-0 overflow-y-auto"
            style={{ display: activeChatTab === ChatTab.ANALYTICS ? 'flex' : 'none' }}
          >
            <AnalyticsPanel />
          </div>
        )}

        {/* Settings Tab - Mount on first visit, then CSS-hide to preserve state */}
        {(activeChatTab === ChatTab.SETTINGS || visitedTabs.has(ChatTab.SETTINGS)) && (
          <div
            className="flex flex-col flex-1 min-h-0"
            style={{ display: activeChatTab === ChatTab.SETTINGS ? 'flex' : 'none' }}
          >
            <SettingsView />
          </div>
        )}

        <ChatToolbar />
      </div>
    </ChatContext.Provider>
  )
}
