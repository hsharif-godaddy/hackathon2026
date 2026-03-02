'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import ChevronDownIcon from '@ux/icon/chevron-down'
import Skeleton from '@ux/skeleton'
import Spinner from '@ux/spinner'

import { useAppIdFromParams } from '@/app/develop/components/utils'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { useSound } from '@/hooks/useSound'
import { useTranslations } from '@/hooks/useTranslations'
import { shipAnalyticsLog } from '@/lib/logging'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
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
import StreamingMessage from './StreamingMessage'
import ThinkingIndicator from './ThinkingIndicator'

interface StreamingMessageListProps {
  allMessages: (ChatMessage | StreamingMessageType)[]
  isCreateFlowSession?: boolean
}

export default function StreamingMessageList({ allMessages, isCreateFlowSession = false }: StreamingMessageListProps) {
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

  // Store hooks for loading state
  const isStreaming = useIsActivelyStreaming()
  const currentAppId = useCurrentAppId()
  const appIdFromParams = useAppIdFromParams()
  const isLoadingMessages = useIsLoading()
  const historyLoadingComplete = useHistoryLoadingComplete()
  const loadingPhase = useDevelopPageStore((state) => state.loadingPhase)

  // Pagination state from store
  const historyHasMore = useStreamingConversationStore((s) => s.historyHasMore)
  const historyNextCursor = useStreamingConversationStore((s) => s.historyNextCursor)
  const historyLoadingMore = useStreamingConversationStore((s) => s.historyLoadingMore)
  const setHistoryLoadingMore = useStreamingConversationStore((s) => s.setHistoryLoadingMore)

  const { loadMoreHistory } = useWebSocketContext()
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

        if (!loadMoreHistory({ cursor: historyNextCursor, limit: 20 })) {
          setHistoryLoadingMore(false)
          paginationAnchorRef.current = null
        }
      }
    }, 100)
  }, [loadMoreHistory, allMessages.length])

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

  // Show "new messages" indicator when new stream starts while user is scrolled up
  useEffect(() => {
    if (!isNearBottomRef.current && activeStream && !activeStream.isComplete) {
      setShowNewMessageIndicator(true)
    }
  }, [activeStream?.id]) // Only trigger when a new stream starts

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

  // Restore scroll position after prepending older messages (pagination)
  // Only fires when loading finishes AND the message count grew beyond the anchor
  // (ignores new live messages appended at the end)
  useEffect(() => {
    const anchor = paginationAnchorRef.current
    if (!anchor || historyLoadingMore) return

    if (allMessages.length > anchor.messageCount) {
      const container = containerRef.current
      const delta = container ? container.scrollHeight - anchor.scrollHeight : 0
      if (container && delta > 0) {
        container.scrollTop += delta
      }
    }
    paginationAnchorRef.current = null
  }, [historyLoadingMore, allMessages.length])

  // Safety timeout: reset historyLoadingMore if response never arrives
  // (WebSocket drop mid-flight, server error without isLoadMore flag, or network timeout)
  useEffect(() => {
    if (!historyLoadingMore) return

    const timeout = setTimeout(() => {
      setHistoryLoadingMore(false)
    }, 10_000)

    return () => clearTimeout(timeout)
  }, [historyLoadingMore, setHistoryLoadingMore])

  // Auto-load more history when content doesn't fill the container (no scrollbar = no scroll events)
  useEffect(() => {
    if (!historyHasMore || historyLoadingMore || !historyNextCursor || !isConnected) return

    const container = containerRef.current
    if (!container) return

    if (container.scrollHeight <= container.clientHeight) {
      setHistoryLoadingMore(true)
      paginationAnchorRef.current = { scrollHeight: container.scrollHeight, messageCount: allMessages.length }

      if (!loadMoreHistory({ cursor: historyNextCursor, limit: 20 })) {
        setHistoryLoadingMore(false)
        paginationAnchorRef.current = null
      }
    }
  }, [historyHasMore, historyLoadingMore, historyNextCursor, isConnected, allMessages.length, loadMoreHistory, setHistoryLoadingMore])

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

  // Show loading state during app transitions to prevent showing stale messages
  const isAppTransitioning = currentAppId !== appIdFromParams

  if (allMessages.length === 0 || isAppTransitioning || !historyLoadingComplete) {
    const isPageLoading = loadingPhase !== 'ready'
    const showSpinner = isLoadingMessages || isPageLoading || isAppTransitioning || !historyLoadingComplete

    return (
      <div ref={containerRef} data-testid="chat-transcript" className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-2" onScroll={handleScroll}>
        {showSpinner ? (
          <Box orientation="vertical" gap="lg" className="pt-2">
            {/* User message skeleton */}
            <Box orientation="horizontal" gap="sm" inlineAlignChildren="end">
              <div className="flex-1" />
              <Box orientation="vertical" gap="sm" className="max-w-[80%]">
                <Skeleton width="180px" height="16px" />
                <Skeleton width="240px" height="16px" />
              </Box>
            </Box>

            {/* Assistant message skeleton */}
            <Box orientation="horizontal" gap="sm" inlineAlignChildren="start">
              <Skeleton rounding="full" width="24px" height="24px" className="flex-shrink-0 mt-0.5" />
              <Box orientation="vertical" gap="sm" className="flex-1">
                <Skeleton width="280px" height="16px" />
                <Skeleton width="320px" height="16px" />
                <Skeleton width="240px" height="16px" />
                <Skeleton width="180px" height="16px" />
              </Box>
            </Box>

            {/* User message skeleton */}
            <Box orientation="horizontal" gap="sm" inlineAlignChildren="end">
              <div className="flex-1" />
              <Box orientation="vertical" gap="sm" className="max-w-[80%]">
                <Skeleton width="200px" height="16px" />
              </Box>
            </Box>

            {/* Assistant message skeleton */}
            <Box orientation="horizontal" gap="sm" inlineAlignChildren="start">
              <Skeleton rounding="full" width="24px" height="24px" className="flex-shrink-0 mt-0.5" />
              <Box orientation="vertical" gap="sm" className="flex-1">
                <Skeleton width="260px" height="16px" />
                <Skeleton width="300px" height="16px" />
              </Box>
            </Box>

            {/* User message skeleton */}
            <Box orientation="horizontal" gap="sm" inlineAlignChildren="end">
              <div className="flex-1" />
              <Box orientation="vertical" gap="sm" className="max-w-[80%]">
                <Skeleton width="160px" height="16px" />
                <Skeleton width="220px" height="16px" />
              </Box>
            </Box>

            {/* Assistant message skeleton */}
            <Box orientation="horizontal" gap="sm" inlineAlignChildren="start">
              <Skeleton rounding="full" width="24px" height="24px" className="flex-shrink-0 mt-0.5" />
              <Box orientation="vertical" gap="sm" className="flex-1">
                <Skeleton width="290px" height="16px" />
                <Skeleton width="310px" height="16px" />
                <Skeleton width="270px" height="16px" />
              </Box>
            </Box>
          </Box>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="opacity-50 text-center">
              <p>{t('builder_messages_empty_title')}</p>
              <p>{t('builder_messages_empty_subtitle')}</p>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    )
  }

  return (
    <div ref={containerRef} data-testid="chat-transcript" className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 md:px-1 pt-1.5 md:pt-0 gap-1" onScroll={handleScroll}>
      {/* Loading indicator for pagination */}
      {historyLoadingMore && (
        <div className="flex justify-center items-center py-3 gap-2">
          <Spinner size="sm" />
          <span className="text-sm opacity-60">{t('builder_messages_loading_older', undefined, 'Loading older messages...')}</span>
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

        return (
          <StreamingMessage
            key={message.id}
            message={message}
            isActiveStream={'isComplete' in message && !message.isComplete}
            isLastAssistantMessage={isLastAssistantMessage}
            startTime={startTime}
          />
        )
      })}

      {shouldShowGlobalThinking && <ThinkingIndicator active={true} />}

      {/* New messages indicator - shows when user is scrolled up and new messages arrive */}
      {showNewMessageIndicator && (
        <div className="sticky bottom-2 flex justify-center z-10">
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
