'use client'

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Thinker } from '@airo-ux/pattern-library/chat/thinker'
import Box from '@ux/box'
import Button from '@ux/button'
import ChevronDownIcon from '@ux/icon/chevron-down'
import Spinner from '@ux/spinner'

import ChatMessagesSkeleton from '@/app/[market]/develop/components/chat/ChatMessagesSkeleton'
import { useThinkerLabel } from '@/app/[market]/develop/components/chat/useThinkerLabel'
import StaticSkeleton from '@/app/[market]/develop/components/StaticSkeleton'
import { ChatTab } from '@/app/[market]/develop/components/types'
import { navigatePreviewToRoute, useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useIsHistoryDisabled } from '@/hooks/useIsHistoryDisabled'
import { useSound } from '@/hooks/useSound'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { useUndoAction } from '@/hooks/useUndoAction'
import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useGitStore } from '@/stores/useGitStore'
import {
  type ChatMessage,
  type StreamingMessage as StreamingMessageType,
  useCurrentAppId,
  useHistoryLoadingComplete,
  useIsActivelyStreaming,
  useIsLoading,
  useStreamingConversationStore,
  useWebSocketState,
} from '@/stores/useStreamingConversationStore'
import { logClickEvent } from '@/utils/instrumentation'
import StreamingMessage from './StreamingMessage'

interface StreamingMessageListProps {
  allMessages: (ChatMessage | StreamingMessageType)[]
  isCreateFlowSession?: boolean
  hasInitialPrompt?: boolean
  initialPromptText?: string | null
  transcriptFooter?: ReactNode
  /** When transcriptFooter is shown, scroll to bottom when this value changes (e.g. post-publish Go Live nonce). */
  transcriptFooterScrollNonce?: number
  /** False while the chat transcript is hidden (e.g. display:none) so scroll runs after it becomes visible. */
  transcriptContainerVisible?: boolean
}

export default function StreamingMessageList({
  allMessages,
  isCreateFlowSession = false,
  hasInitialPrompt = false,
  initialPromptText = null,
  transcriptFooter = null,
  transcriptFooterScrollNonce = 0,
  transcriptContainerVisible = true,
}: StreamingMessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const prevMessagesLength = useRef(0)
  const prevLastMessageId = useRef<string | null>(null)
  const prevAppIdRef = useRef<string | null>(null)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [userHasScrolledUp, setUserHasScrolledUp] = useState(false)
  const userHasScrolledUpRef = useRef(false)
  const scrollThrottleRef = useRef<NodeJS.Timeout | null>(null)
  const activeStreamSignatureRef = useRef<string | null>(null)
  const isNearBottomRef = useRef(true)
  const [showNewMessageIndicator, setShowNewMessageIndicator] = useState(false)
  const showNewMessageIndicatorRef = useRef(false)
  const hasLoggedFirstResponseRef = useRef(false)
  const prevIsStreamingRef = useRef(false)
  const hasUserInteractedRef = useRef(false)
  const t = useTranslations();
  const thinkerLabel = useThinkerLabel()
  const areChatPlansEnabled = useSwitchboard('airo-builder-chat-plans')

  // Store hooks for loading state
  const isStreaming = useIsActivelyStreaming()
  const currentAppId = useCurrentAppId()
  const appIdFromParams = useAppIdFromParams()
  const isLoadingMessages = useIsLoading()
  const historyLoadingComplete = useHistoryLoadingComplete()
  const loadingPhase = useDevelopPageStore((state) => state.loadingPhase)

  const { activeChatTab, setActiveChatTab } = useChatTabs()
  const selectCommitForPreview = useGitStore((s) => s.selectCommit)
  const setSelectedCommitHash = useGitStore((s) => s.setSelectedCommitHash)
  const { isDisabled: isHistoryDisabled } = useIsHistoryDisabled(appIdFromParams || '')
  const undoAction = useUndoAction()
  // Holds the commit hash the user clicked Restore on while the history tab
  // was locked (e.g. agent streaming, publish in flight). The deferred
  // checkout fires from the effect below as soon as the lock clears.
  const pendingPreviewHashRef = useRef<string | null>(null)

  // Pagination state from store
  const historyHasMore = useStreamingConversationStore((s) => s.historyHasMore)
  const historyNextCursor = useStreamingConversationStore((s) => s.historyNextCursor)
  const historyLoadingMore = useStreamingConversationStore((s) => s.historyLoadingMore)
  const setHistoryLoadingMore = useStreamingConversationStore((s) => s.setHistoryLoadingMore)

  const { loadHistory } = useWebSocketContext()
  const isConnected = useWebSocketState().connected

  // Keep refs in sync so handleScroll reads latest values without dependency churn
  userHasScrolledUpRef.current = userHasScrolledUp
  showNewMessageIndicatorRef.current = showNewMessageIndicator

  // Scroll anchor for pagination: tracks scroll height + message count at request time
  // so restoration only fires when prepended messages actually land
  const paginationAnchorRef = useRef<{ scrollHeight: number; messageCount: number } | null>(null)

  // Sound hook
  const [playBeep] = useSound('/notification-beep.wav', { volume: 0.5 })

  // Reset scroll state when app changes to ensure fresh UX
  useEffect(() => {
    if (prevAppIdRef.current !== currentAppId) {
      // App has changed, reset all scroll tracking
      setIsInitialLoad(true)
      setUserHasScrolledUp(false)
      setShowNewMessageIndicator(false)
      isNearBottomRef.current = true
      prevMessagesLength.current = 0
      prevLastMessageId.current = null
      prevAppIdRef.current = currentAppId
      hasLoggedFirstResponseRef.current = false
      hasUserInteractedRef.current = false
      pendingPreviewHashRef.current = null

      // Clear any pending scroll timeouts
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
        scrollTimeoutRef.current = null
      }
      if (scrollThrottleRef.current) {
        clearTimeout(scrollThrottleRef.current)
        scrollThrottleRef.current = null
      }
    }
  }, [currentAppId])

  // Track user interaction - set flag when user sends a message
  useEffect(() => {
    // Check if there's at least one user message in this session
    const hasUserMessage = allMessages.some(msg => msg.role === 'user')
    if (hasUserMessage && !hasUserInteractedRef.current) {
      hasUserInteractedRef.current = true
    }
  }, [allMessages])

  // Funnel event: Track when first assistant response is rendered (visible to user)
  // Only during create flow from homepage
  useEffect(() => {
    if (hasLoggedFirstResponseRef.current || !currentAppId || !isCreateFlowSession) return

    // Find first assistant message that has actual content
    const firstAssistantWithContent = allMessages.find(
      msg => msg.role === 'assistant' &&
             (msg.content || msg.segments?.length || msg.toolCalls?.length)
    )

    if (firstAssistantWithContent) {
      shipAnalyticsLog('funnel.first_response.rendered', {
        appId: currentAppId,
        messageId: firstAssistantWithContent.id,
        hasContent: !!firstAssistantWithContent.content,
        hasSegments: !!('segments' in firstAssistantWithContent && firstAssistantWithContent.segments?.length),
        hasToolCalls: !!('toolCalls' in firstAssistantWithContent && firstAssistantWithContent.toolCalls?.length),
      })
      hasLoggedFirstResponseRef.current = true
    }
  }, [allMessages, currentAppId, isCreateFlowSession])

  // Derive activeStream from allMessages for scroll behavior
  const activeStream = useMemo(() => {
    const lastMessage = allMessages[allMessages.length - 1]
    // Check if it's a streaming message (has isComplete property set to false)
    if (lastMessage && 'isComplete' in lastMessage && !lastMessage.isComplete) {
      return lastMessage as StreamingMessageType
    }
    return null
  }, [allMessages])

  // Find the last assistant message ID for suggested response rendering
  const lastAssistantMessageId = useMemo(() => {
    for (let i = allMessages.length - 1; i >= 0; i--) {
      if (allMessages[i].role === 'assistant') {
        return allMessages[i].id
      }
    }
    return null
  }, [allMessages])

  // For each assistant message, the commit hash that represents its
  // post-turn working tree state — the message's own commitHash if it
  // committed, otherwise the most recent prior assistant commit (i.e.,
  // the working tree didn't change during this turn). Lets the Restore
  // icon point at a meaningful pre-edit state on "agent made no changes"
  // turns, which is what the user wants to preview/rewind to once a
  // later commit (editor edit, asset upload, external commit) has landed
  // on top.
  const effectiveCommitByIndex = useMemo<(string | null)[]>(() => {
    let lastSeen: string | null = null
    return allMessages.map((m) => {
      if (m.role !== 'assistant') return null
      const own = 'commitHash' in m && m.commitHash ? m.commitHash : null
      if (own) lastSeen = own
      return lastSeen
    })
  }, [allMessages])

  const runPreviewCheckout = useCallback(async (appId: string, commitHash: string) => {
    try {
      // Preview browse only — doesn't mutate main. The actual restore (and
      // its user-action notice) fires when the user clicks "Restore this
      // version" from the history tab; see VersionHistory.handleRestoreCommit.
      await selectCommitForPreview(appId, commitHash)
    } catch (error) {
      logger.error('streaming-message-list.restore.checkout-failed', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }, [selectCommitForPreview])

  const handleRestore = useCallback(async (commitHash: string) => {
    if (!appIdFromParams) return
    logClickEvent('develop.chat.restore')()
    // Always navigate to the history tab and visually mark the commit as
    // selected. The actual checkout (which mutates HEAD) is gated on the
    // same lock as the history tab itself: while the agent is working,
    // publish is in flight, etc. — defer until the lock clears so a chat
    // click can't bypass what the history panel correctly disables.
    setSelectedCommitHash(appIdFromParams, commitHash)
    setActiveChatTab(ChatTab.HISTORY)
    navigatePreviewToRoute('/')

    if (isHistoryDisabled) {
      pendingPreviewHashRef.current = commitHash
      logger.info('streaming-message-list.restore.deferred', {
        appId: appIdFromParams,
        commitHash: commitHash.substring(0, 7),
      })
      return
    }

    pendingPreviewHashRef.current = null
    await runPreviewCheckout(appIdFromParams, commitHash)
  }, [appIdFromParams, isHistoryDisabled, runPreviewCheckout, setActiveChatTab, setSelectedCommitHash])

  // Cancel any queued preview checkout when the user navigates off the
  // history tab. Without this, leaving History while the agent is still
  // streaming leaves the deferred hash armed — it would fire when the
  // lock releases and race with ChatToolbar's autoReturnToMain, leaving
  // the working tree on the older commit while the UI thinks it's on
  // main.
  useEffect(() => {
    if (activeChatTab !== ChatTab.HISTORY) {
      pendingPreviewHashRef.current = null
    }
  }, [activeChatTab])

  // When the history-tab lock releases (e.g. the agent finishes streaming),
  // fire any deferred preview checkout that was queued by handleRestore.
  // The ref is cleared before the call so the inevitable feedback loop
  // (selectCommit flips isSelectingCommit on, which re-locks, then off,
  // which re-runs this effect) doesn't double-fire.
  useEffect(() => {
    if (isHistoryDisabled) return
    const pendingHash = pendingPreviewHashRef.current
    if (!pendingHash || !appIdFromParams) return
    pendingPreviewHashRef.current = null
    void runPreviewCheckout(appIdFromParams, pendingHash)
  }, [isHistoryDisabled, appIdFromParams, runPreviewCheckout])

  // Handle scroll events to detect user scroll (throttled for performance)
  // Reads from refs and store.getState() to avoid dependency churn on every state change
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (scrollThrottleRef.current) return

    // Capture DOM element before setTimeout — React nullifies synthetic event properties after handler returns
    const container = e.currentTarget

    scrollThrottleRef.current = setTimeout(() => {
      scrollThrottleRef.current = null

      if (!container) return
      const { scrollTop, scrollHeight, clientHeight } = container
      const nearBottom = scrollHeight - scrollTop - clientHeight < 150
      isNearBottomRef.current = nearBottom

      if (nearBottom && showNewMessageIndicatorRef.current) {
        setShowNewMessageIndicator(false)
      }

      if (!nearBottom && !userHasScrolledUpRef.current) {
        setUserHasScrolledUp(true)

        // Show indicator if user scrolls up during an active stream
        const { activeStream } = useStreamingConversationStore.getState()
        if (activeStream && !activeStream.isComplete) {
          setShowNewMessageIndicator(true)
        }
      } else if (nearBottom && userHasScrolledUpRef.current) {
        setUserHasScrolledUp(false)
      }

      // Load more history when user scrolls near the top
      const { historyHasMore, historyLoadingMore, historyNextCursor, setHistoryLoadingMore } =
        useStreamingConversationStore.getState()

      if (scrollTop < 100 && historyHasMore && !historyLoadingMore && historyNextCursor) {
        setHistoryLoadingMore(true)
        paginationAnchorRef.current = { scrollHeight, messageCount: allMessages.length }

        if (!loadHistory({ cursor: historyNextCursor, limit: 20 })) {
          setHistoryLoadingMore(false)
          paginationAnchorRef.current = null
        }
      }
    }, 100)
  }, [loadHistory, allMessages.length])

  // Reliable scroll to bottom function
  const scrollToBottom = useCallback((smooth = true, immediate = false) => {
    // Clear any pending scroll
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }

    // Use requestAnimationFrame to ensure DOM is ready
    const performScroll = () => {
      // Try multiple scroll methods for reliability
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({
          behavior: smooth && !immediate ? 'smooth' : 'instant',
          block: 'end'
        })
      }

      // Also try scrolling the container directly
      if (containerRef.current) {
        const container = containerRef.current
        container.scrollTop = container.scrollHeight
      }
    }

    if (smooth && !immediate) {
      // Shorter delay for streaming content to be more responsive
      const delay = isStreaming ? 25 : 50
      scrollTimeoutRef.current = setTimeout(() => {
        requestAnimationFrame(performScroll)
      }, delay)
    } else {
      // Immediate scroll
      requestAnimationFrame(performScroll)
    }
  }, [isStreaming])

  // Scroll to bottom and hide new message indicator (for button click)
  const scrollToBottomAndHideIndicator = useCallback(() => {
    const container = containerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
      setShowNewMessageIndicator(false)
      isNearBottomRef.current = true
      setUserHasScrolledUp(false)
    }
  }, [])

  const prevTranscriptFooterScrollNonceRef = useRef(0)

  useLayoutEffect(
    function scrollTranscriptWhenPostPublishFooterOpens() {
      if (!transcriptFooter || !transcriptContainerVisible) {
        if (!transcriptFooter) {
          prevTranscriptFooterScrollNonceRef.current = 0
        }
        return
      }

      if (transcriptFooterScrollNonce === 0 || transcriptFooterScrollNonce === prevTranscriptFooterScrollNonceRef.current) {
        return
      }

      prevTranscriptFooterScrollNonceRef.current = transcriptFooterScrollNonce
      setUserHasScrolledUp(false)
      scrollToBottom(false, true)
      requestAnimationFrame(() => {
        scrollToBottom(false, true)
      })
    },
    [transcriptFooter, transcriptContainerVisible, transcriptFooterScrollNonce, scrollToBottom],
  )

  // Show "new messages" indicator when new stream starts while user is scrolled up
  useEffect(() => {
    if (!isNearBottomRef.current && activeStream && !activeStream.isComplete) {
      setShowNewMessageIndicator(true)
    }
  }, [activeStream?.id])

  // Initial scroll - use useLayoutEffect to prevent flicker
  // Wait for historyLoadingComplete so all messages render at once with no visible scroll
  useLayoutEffect(() => {
    if (isInitialLoad && historyLoadingComplete && allMessages.length > 0 && containerRef.current) {
      // Set scroll position before browser paints to prevent visible scrolling
      containerRef.current.scrollTop = containerRef.current.scrollHeight
      setIsInitialLoad(false)
      setUserHasScrolledUp(false)
    }
  }, [isInitialLoad, historyLoadingComplete, allMessages.length])

  // Auto-scroll on message changes
  useEffect(() => {
    const messagesChanged = allMessages.length !== prevMessagesLength.current
    const currentLastMessage = allMessages[allMessages.length - 1]
    const currentLastMessageId = currentLastMessage?.id || null

    // Skip initial load handling (now done in useLayoutEffect above)
    if (isInitialLoad) {
      return
    }

    if (messagesChanged) {
      // Check if the last message changed (new message at end) or just length changed (prepended messages)
      const lastMessageChanged = currentLastMessageId !== prevLastMessageId.current

      if (lastMessageChanged) {
        const currentLastMessageRole = currentLastMessage?.role

        // New message added (user sent OR assistant started responding)
        // ALWAYS scroll to bottom and reset scroll state
        setUserHasScrolledUp(false)

        if (currentLastMessageRole === 'user') {
          // User message - immediate aggressive scroll
          scrollToBottom(false, true)
          requestAnimationFrame(() => scrollToBottom(false, true))
        } else {
          // Assistant message starting - smooth scroll
          scrollToBottom(true)
        }
      }
      // If only length changed but last message is the same, it means older messages were prepended
      // In that case, don't auto-scroll to maintain user's position
    }

    prevMessagesLength.current = allMessages.length
    prevLastMessageId.current = currentLastMessageId
  }, [allMessages, isInitialLoad, scrollToBottom, userHasScrolledUp])

  // Handle streaming content updates and completion
  const wasStreamingRef = useRef(false)
  useEffect(() => {
    const currentSignature = activeStream
      ? `${activeStream.id}:${activeStream.content.length}:${activeStream.segments.length}:${activeStream.toolCalls.length}`
      : null

    // Handle stream completion (was streaming, now stopped)
    if (wasStreamingRef.current && !isStreaming && !userHasScrolledUp) {
      scrollToBottom(true, true)
      wasStreamingRef.current = false
      activeStreamSignatureRef.current = currentSignature
      return
    }

    wasStreamingRef.current = isStreaming

    if (!isStreaming || userHasScrolledUp) {
      activeStreamSignatureRef.current = currentSignature
      return
    }

    const shouldScrollImmediately = Boolean(
      activeStream && activeStreamSignatureRef.current !== currentSignature
    )

    scrollToBottom(true, shouldScrollImmediately)

    activeStreamSignatureRef.current = currentSignature
  }, [isStreaming, activeStream, scrollToBottom, userHasScrolledUp])

  // Handle thinking indicator appearance with immediate scroll
  useEffect(() => {
    if (isStreaming && activeStream && !activeStream.isComplete && !userHasScrolledUp) {
      // Delay scroll slightly to catch thinking indicator appearance
      const thinkingScrollTimeout = setTimeout(() => {
        scrollToBottom(false, true) // Instant scroll when thinking indicator appears
      }, 450) // Slightly after the 400ms thinking indicator delay

      return () => clearTimeout(thinkingScrollTimeout)
    }
  }, [isStreaming, activeStream, scrollToBottom, userHasScrolledUp])

  // Listen for widget injection events to trigger scroll
  useEffect(() => {
    const handleWidgetInjected = () => {
      // Scroll to bottom when a widget is dynamically injected
      if (!userHasScrolledUp) {
        scrollToBottom(true, true)
      }
    }

    window.addEventListener('widget-injected', handleWidgetInjected)
    return () => {
      window.removeEventListener('widget-injected', handleWidgetInjected)
    }
  }, [scrollToBottom, userHasScrolledUp])

  // Play notification sound when streaming completes (only after user interaction)
  useEffect(() => {
    // Detect transition from streaming to not streaming
    // Only play sound if user has actively sent a message in this session
    if (prevIsStreamingRef.current && !isStreaming && hasUserInteractedRef.current) {
      playBeep()
    }
    prevIsStreamingRef.current = isStreaming
  }, [isStreaming, playBeep])

  // Restore scroll position after prepending older messages (pagination).
  // Only fires when loading finishes AND the message count grew beyond the anchor
  // (ignores new live messages appended at the end).
  //
  // We nudge the viewport up by PEEK_PX so the bottom edge of the newly-prepended
  // messages is visible — the user sees "something arrived above" without being
  // yanked to the top of the list.
  const PAGINATION_PEEK_PX = 80
  useEffect(() => {
    const anchor = paginationAnchorRef.current
    if (!anchor || historyLoadingMore) return

    if (allMessages.length > anchor.messageCount) {
      const container = containerRef.current
      const delta = container ? container.scrollHeight - anchor.scrollHeight : 0
      if (container && delta > 0) {
        container.scrollTop = Math.max(0, container.scrollTop + delta - PAGINATION_PEEK_PX)
      }
    }
    paginationAnchorRef.current = null
  }, [historyLoadingMore, allMessages.length])

  // Safety timeout: re-fire load_history if historyLoadingComplete is still false after 15s.
  // Covers two cases: (1) server returned history_loaded with an error field — handler leaves
  // historyLoadingComplete false so we retry here; (2) network drop mid-flight — history_loaded
  // never arrived, reconnect + agents_available will also retry, but this is a belt-and-braces
  // guard. After 2 retries the skeleton is cleared; user interaction is unaffected throughout.
  //
  // historyRetryCount uses useState (not useRef) so each increment re-triggers this effect and
  // schedules a fresh timeout — a ref update alone wouldn't re-run the effect after each retry.
  const MAX_HISTORY_RETRIES = 2
  const [historyRetryCount, setHistoryRetryCount] = useState(0)
  // Distinguishes "retry cap exhausted" from "fresh conversation with 0 messages".
  // A fresh conversation never hits this path — its history_loaded arrives with 0 messages
  // and the handler sets historyLoadingComplete=true directly, leaving retryCount at 0.
  const [historyLoadFailed, setHistoryLoadFailed] = useState(false)
  useEffect(() => {
    if (historyLoadingComplete) {
      if (historyRetryCount !== 0) setHistoryRetryCount(0)
      // historyLoadFailed is intentionally NOT reset here: both setHistoryLoadFailed(true) and
      // setHistoryLoadingComplete(true) are dispatched in the same batch when the retry cap is
      // hit, so by the time this branch runs historyLoadFailed is already true — resetting it
      // here would wipe the flag before the error message can render. The flag resets on remount.
      return
    }
    // Retry based on the transport API result rather than connection state:
    // WebSocket returns false while disconnected, SSE can still fetch history
    // over HTTP even if the EventSource stream is down.
    const timeout = setTimeout(() => {
      if (historyRetryCount < MAX_HISTORY_RETRIES) {
        if (loadHistory()) {
          setHistoryRetryCount(c => c + 1)
        }
      } else {
        setHistoryLoadFailed(true)
        useStreamingConversationStore.getState().setHistoryLoadingComplete(true)
      }
    }, 15_000)

    return () => clearTimeout(timeout)
    // isConnected stays in deps so this effect re-runs (and reschedules the
    // 15s timeout) when the transport reconnects after loadHistory() returned false.
  }, [historyLoadingComplete, historyRetryCount, isConnected, loadHistory])

  // Tracks a failed pagination load so the inline error banner can be shown.
  // Parallel to historyLoadFailed but scoped to pagination — resets when a new
  // load starts so the banner clears automatically on retry.
  const [paginationLoadFailed, setPaginationLoadFailed] = useState(false)

  // Safety timeout: reset historyLoadingMore if history_complete never arrives
  // (WebSocket drop mid-flight, server error, or network timeout)
  useEffect(() => {
    if (!historyLoadingMore) return
    if (paginationLoadFailed) setPaginationLoadFailed(false)

    const timeout = setTimeout(() => {
      setPaginationLoadFailed(true)
      setHistoryLoadingMore(false)
    }, 10_000)

    return () => clearTimeout(timeout)
  }, [historyLoadingMore, paginationLoadFailed, setHistoryLoadingMore])


  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
      if (scrollThrottleRef.current) {
        clearTimeout(scrollThrottleRef.current)
      }
    }
  }, [])

  const shouldShowGlobalThinking = useMemo(() => {
    if (!isStreaming || !activeStream || activeStream.isComplete) {
      return false
    }

    if (activeStream.upstreamError || activeStream.budgetExceeded || activeStream.maxStepsReached) {
      return false
    }

    // Build a map of tool IDs to their latest status from segments
    const toolStatusMap = new Map<string, string>()
    activeStream.segments?.forEach(segment => {
      if ((segment.type === 'tool_start' || segment.type === 'tool_result' || segment.type === 'tool_call') && segment.toolCall) {
        const toolId = segment.toolCall.id
        const currentStatus = segment.toolCall.status
        if (currentStatus) {
          toolStatusMap.set(toolId, currentStatus)
        }
      }
    })

    const runningToolsFromSegments = Array.from(toolStatusMap.entries()).filter(([_toolId, status]) => status === 'running')
    const runningInToolCalls = activeStream.toolCalls?.filter(tool => tool.status === 'running')
    const hasRunningTools = runningToolsFromSegments.length > 0 || (runningInToolCalls && runningInToolCalls.length > 0)

    const lastSegment = activeStream.segments?.[activeStream.segments.length - 1]
    const isStreamingText = lastSegment && (lastSegment.type === 'text' || lastSegment.type === 'content')

    const lastToolSegment = activeStream.segments?.findLast(seg =>
      seg.type === 'tool_result' || seg.type === 'tool_call'
    )
    const isSuggestedResponseCompleted = lastToolSegment?.toolCall?.name === 'suggestedResponse' &&
                                         lastToolSegment?.toolCall?.status === 'completed'

    return !hasRunningTools && !isStreamingText && !isSuggestedResponseCompleted
  }, [isStreaming, activeStream])

  // Standalone thinking indicator shows when the last assistant message has no content yet.
  // When chat plans are enabled, thinking is shown in InputActionsPanel instead.
  const lastMsg = allMessages[allMessages.length - 1]
  const lastMsgHasContent = lastMsg?.role === 'assistant' && (lastMsg.segments?.length ?? 0) > 0
  const effectiveShouldShowThinking = areChatPlansEnabled ? false : shouldShowGlobalThinking
  const shouldShowStandaloneThinking = effectiveShouldShowThinking && !lastMsgHasContent

  // Show loading state during app transitions to prevent showing stale messages
  const isAppTransitioning = currentAppId !== appIdFromParams

  if (allMessages.length === 0 || isAppTransitioning) {
    // Creation flow with initial prompt: show the user's prompt as a real message + thinking indicator
    if (hasInitialPrompt && initialPromptText && allMessages.length === 0) {
      return (
        <div ref={containerRef} data-testid="chat-transcript" className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden px-2 md:px-0 pt-3 md:pt-1 gap-1" onScroll={handleScroll}>
          <StreamingMessage
            message={{ id: 'initial-prompt', role: 'user', content: initialPromptText, timestamp: new Date() } satisfies ChatMessage}
          />
          <Thinker label={thinkerLabel} />
          <div ref={messagesEndRef} />
        </div>
      )
    }

    const isPageLoading = loadingPhase !== 'ready'
    const showSpinner = isLoadingMessages || isPageLoading || isAppTransitioning || !historyLoadingComplete

    return (
      <div ref={containerRef} data-testid="chat-transcript" className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-2" onScroll={handleScroll}>
        {showSpinner ? (
          <ChatMessagesSkeleton />
        ) : historyLoadFailed ? (
          <div className="flex items-center justify-center h-full">
            <div className="opacity-50 text-center">
              <p>{t('builder_messages_load_failed_title', undefined, "Couldn't load conversation history")}</p>
              <p>{t('builder_messages_load_failed_subtitle', undefined, 'You can continue - new messages will appear here')}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="opacity-50 text-center">
              <p>{t('builder_messages_empty_title')}</p>
              <p>{t('builder_messages_empty_subtitle')}</p>
            </div>
          </div>
        )}
        {transcriptFooter}
        <div ref={messagesEndRef} />
      </div>
    )
  }

  return (
    <div ref={containerRef} data-testid="chat-transcript" className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden px-2 md:px-0 pt-3 md:pt-1 gap-1" onScroll={handleScroll}>
      {/* Skeleton while initial history loads — matches the empty-state skeleton treatment */}
      {!historyLoadingComplete && (
        <Box orientation="vertical" gap="lg" className="pt-2 pb-1">
          <Box orientation="horizontal" gap="sm" inlineAlignChildren="start">
            <StaticSkeleton rounding="full" width="24px" height="24px" className="flex-shrink-0 mt-0.5" />
            <Box orientation="vertical" gap="sm" className="flex-1">
              <StaticSkeleton width="280px" height="16px" />
              <StaticSkeleton width="320px" height="16px" />
              <StaticSkeleton width="240px" height="16px" />
            </Box>
          </Box>
          <Box orientation="horizontal" gap="sm" inlineAlignChildren="end">
            <div className="flex-1" />
            <Box orientation="vertical" gap="sm" className="max-w-[80%]">
              <StaticSkeleton width="200px" height="16px" />
            </Box>
          </Box>
          <Box orientation="horizontal" gap="sm" inlineAlignChildren="start">
            <StaticSkeleton rounding="full" width="24px" height="24px" className="flex-shrink-0 mt-0.5" />
            <Box orientation="vertical" gap="sm" className="flex-1">
              <StaticSkeleton width="260px" height="16px" />
              <StaticSkeleton width="300px" height="16px" />
            </Box>
          </Box>
        </Box>
      )}

      {/* Spinner while paginating */}
      {historyLoadingMore && (
        <div className="flex justify-center items-center py-3 gap-2">
          <Spinner size="sm" />
          <span className="text-sm opacity-60">Loading older messages...</span>
        </div>
      )}

      {/* Inline error banner when pagination times out — existing messages stay visible below */}
      {paginationLoadFailed && !historyLoadingMore && (
        <div className="flex items-center justify-between px-3 py-2 text-sm opacity-60">
          <span>{t('builder_messages_pagination_failed', undefined, 'Could not load older messages')}</span>
          <Button
            design="inline"
            size="small"
            onClick={() => {
              if (!historyNextCursor) return
              setHistoryLoadingMore(true)
              paginationAnchorRef.current = {
                scrollHeight: containerRef.current?.scrollHeight ?? 0,
                messageCount: allMessages.length
              }
              if (!loadHistory({ cursor: historyNextCursor, limit: 20 })) {
                setHistoryLoadingMore(false)
                paginationAnchorRef.current = null
              }
            }}
            text={t('builder_common_try_again', undefined, 'Try again')}
          />
        </div>
      )}

      {allMessages.map((message, index) => {
        let startTime: Date | undefined

        // Only show "Completed" on the last assistant message in a consecutive sequence.
        // This prevents "Completed" from appearing mid-turn after refreshing the page when the agent sends
        // multiple assistant messages (e.g., plan execution + handoff).
        if (message.role === 'assistant') {
          const nextMessage = allMessages[index + 1]
          const isLastInSequence = !nextMessage || nextMessage.role !== 'assistant'

          if (isLastInSequence) {
            for (let i = index - 1; i >= 0; i--) {
              if (allMessages[i].role === 'user') {
                startTime = allMessages[i].timestamp
                break
              }
              // Break on any role that isn't 'assistant'. Today only 'user' and
              // 'assistant' exist, but if a future role appears between the assistant
              // turn and its originating user message we intentionally skip the
              // "Completed" indicator rather than attribute the wrong timestamp.
              if (allMessages[i].role !== 'assistant') break
            }
          }
        }

        const isLastAssistantMessage = message.role === 'assistant' && message.id === lastAssistantMessageId
        const isActiveStream = 'isComplete' in message && !message.isComplete
        // Use the effective commit (own, or the most recent prior assistant
        // commit when this turn made no changes) so Restore on a "no
        // changes" turn previews the state at the end of that turn rather
        // than disappearing once HEAD drifts past it.
        const commitHash = effectiveCommitByIndex[index]
        // Restore is offered on every assistant turn with an effective
        // commit. The action is non-destructive (it browses the commit in
        // the preview pane and routes the user to the history tab), so the
        // button serves as a discovery hook that surfaces the history tab.
        // ResponseMetadata renders it next to copy.
        const canRestore = message.role === 'assistant' && !!commitHash
        // Undo replaces restore on the most recent completed assistant turn
        // when it follows a user prompt — that's the one with `startTime`
        // populated. Falls back to restore (handled below) when undo is
        // locked, e.g. the latest message is already a user-action notice
        // or the rollback target is unknown. useUndoAction covers both
        // branches: stash uncommitted changes, or rewind to the prior
        // commit captured on the previous user prompt's metadata.
        const isUndoTarget = isLastAssistantMessage && !isActiveStream && !!startTime && !undoAction.isLocked

        return (
          <StreamingMessage
            key={message.id}
            message={message}
            isActiveStream={isActiveStream}
            isLastAssistantMessage={isLastAssistantMessage}
            startTime={startTime}
            showThinking={isLastAssistantMessage && effectiveShouldShowThinking}
            commitHash={commitHash}
            onUndo={isUndoTarget ? undoAction.triggerUndo : undefined}
            onRestore={canRestore && !isUndoTarget ? handleRestore : undefined}
          />
        )
      })}

      {/* Standalone thinking indicator when the last assistant message has no content yet */}
      {shouldShowStandaloneThinking && <Thinker label={thinkerLabel} />}

      {transcriptFooter}

      {/* New messages indicator - shows when user is scrolled up and new messages arrive */}
      {showNewMessageIndicator && (
        <div className="sticky bottom-2 flex justify-center">
          <Button
            design="primary"
            size="sm"
            icon={<ChevronDownIcon />}
            onClick={scrollToBottomAndHideIndicator}
            text={t('builder_messages_new_messages', undefined, 'New messages')}
            aria-label={t('builder_messages_new_messages', undefined, 'New messages')}
          />
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  )
}
