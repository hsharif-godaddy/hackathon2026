'use client'

import { useCallback,useEffect, useMemo, useRef, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Spinner from '@ux/spinner'

import {
  useActiveStream,
  useConversationPagination,
  useCurrentAppId,
  useIsActivelyStreaming,
  useIsLoading,
  useLoadMoreConversations,
  useMessages,
} from '@/stores/useStreamingConversationStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import StreamingMessage from './StreamingMessage'

export default function StreamingMessageList() {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const prevMessagesLength = useRef(0)
  const prevLastMessageId = useRef<string | null>(null)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [userHasScrolledUp, setUserHasScrolledUp] = useState(false)
  const scrollThrottleRef = useRef<NodeJS.Timeout | null>(null)

  // Get all visible messages (completed + active stream)
  const messages = useMessages()
  const activeStream = useActiveStream()
  const isStreaming = useIsActivelyStreaming()
  const loadMoreConversations = useLoadMoreConversations()
  const pagination = useConversationPagination()
  const currentAppId = useCurrentAppId()
  const isLoadingMessages = useIsLoading()
  const loadingPhase = useDevelopPageStore((state) => state.loadingPhase)

  // Combine messages with useMemo to prevent infinite loops
  const allMessages = useMemo(() => {
    return activeStream ? [...messages, activeStream] : messages
  }, [messages, activeStream])

  // Find the last assistant message ID for suggested response rendering
  const lastAssistantMessageId = useMemo(() => {
    for (let i = allMessages.length - 1; i >= 0; i--) {
      if (allMessages[i].role === 'assistant') {
        return allMessages[i].id
      }
    }
    return null
  }, [allMessages])

  // Check if user is near bottom of scroll
  const checkIfNearBottom = useCallback(() => {
    if (!containerRef.current) return true

    const container = containerRef.current
    const threshold = 150 // pixels from bottom
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight

    return distanceFromBottom < threshold
  }, [])

  // Handle scroll events to detect user scroll (throttled for performance)
  const handleScroll = useCallback(() => {
    // Throttle to max once per 100ms
    if (scrollThrottleRef.current) return

    scrollThrottleRef.current = setTimeout(() => {
      scrollThrottleRef.current = null

      const isNearBottom = checkIfNearBottom()

      // If user scrolled up (away from bottom), pause auto-scroll
      if (!isNearBottom && !userHasScrolledUp) {
        setUserHasScrolledUp(true)
      }
      // If user scrolled back to bottom, resume auto-scroll
      else if (isNearBottom && userHasScrolledUp) {
        setUserHasScrolledUp(false)
      }
    }, 100)
  }, [checkIfNearBottom, userHasScrolledUp])

  // Handle load more conversations
  const handleLoadMore = async () => {
    if (currentAppId && pagination.hasMore && !pagination.isLoading) {
      await loadMoreConversations(currentAppId)
    }
  }

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

  // Auto-scroll on message changes
  useEffect(() => {
    const messagesChanged = allMessages.length !== prevMessagesLength.current
    const currentLastMessage = allMessages[allMessages.length - 1]
    const currentLastMessageId = currentLastMessage?.id || null

    if (isInitialLoad) {
      // Initial load - scroll immediately
      scrollToBottom(false)
      setIsInitialLoad(false)
      setUserHasScrolledUp(false) // Reset scroll state on initial load
    } else if (messagesChanged) {
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

  // Handle streaming content updates - only if user hasn't scrolled up
  useEffect(() => {
    if (isStreaming && !userHasScrolledUp) {
      // More frequent scroll updates for streaming content
      scrollToBottom(true)
    }
  }, [isStreaming, activeStream, scrollToBottom, userHasScrolledUp]) // Also depend on activeStream changes

  // Additional scroll trigger for content changes that might cause layout shifts
  useEffect(() => {
    if (isStreaming && activeStream && !userHasScrolledUp) {
      // Use immediate scroll for layout-changing content to prevent jumping
      scrollToBottom(true, true)
    }
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

  if (allMessages.length === 0) {
    const isPageLoading = loadingPhase !== 'ready'
    const showSpinner = isLoadingMessages || isPageLoading

    return (
      <div ref={containerRef} className="flex-1 overflow-y-auto p-2 space-y-2" onScroll={handleScroll}>
        <div className="flex items-center justify-center h-full flex-col gap-0.5">
          {showSpinner ? (
            <Spinner size="md" />
          ) : (
            <div className="opacity-50 text-center">
              <p>No messages yet.</p>
              <p>Start a conversation!</p>
            </div>
          )}
        </div>
        <div ref={messagesEndRef} />
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex flex-1 flex-col overflow-y-auto px-2 sm:px-3 md:px-0 pt-1.5 md:pt-0 gap-1" onScroll={handleScroll}>
      {/* Load More Button */}
      {pagination.hasMore && (
        <div className="flex justify-center mb-2">
          <Button
            design="tertiary"
            size="sm"
            disabled={pagination.isLoading}
            onClick={handleLoadMore}
          >
            <Box orientation="horizontal" gap="sm">
              {pagination.isLoading ? (
                <>
                  <Spinner size="sm" /> Loading...
                </>
              ) : (
                'Load previous conversations'
              )}
            </Box>
          </Button>
        </div>
      )}

      {allMessages.map((message, index) => {
        let startTime: Date | undefined

        // For assistant messages, find the previous user message as the start time
        if (message.role === 'assistant' && index > 0) {
          const prevMessage = allMessages[index - 1]
          if (prevMessage.role === 'user') {
            startTime = prevMessage.timestamp
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

      <div ref={messagesEndRef} />
    </div>
  )
}
