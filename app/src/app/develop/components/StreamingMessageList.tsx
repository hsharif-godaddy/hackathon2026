'use client'

import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import StreamingMessage from './StreamingMessage'
import Button from '@ux/button'
import Spinner from '@ux/spinner'
import {
  useMessages,
  useActiveStream,
  useIsActivelyStreaming,
  useLoadMoreConversations,
  useConversationPagination,
  useCurrentAppId,
  useIsLoading,
} from '@/stores/useStreamingConversationStore'

export default function StreamingMessageList() {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const prevMessagesLength = useRef(0)
  const prevLastMessageId = useRef<string | null>(null)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Get all visible messages (completed + active stream)
  const messages = useMessages()
  const activeStream = useActiveStream()
  const isStreaming = useIsActivelyStreaming()
  const loadMoreConversations = useLoadMoreConversations()
  const pagination = useConversationPagination()
  const currentAppId = useCurrentAppId()
  const isLoadingMessages = useIsLoading()

  // Combine messages with useMemo to prevent infinite loops
  const allMessages = useMemo(() => {
    return activeStream ? [...messages, activeStream] : messages
  }, [messages, activeStream])

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
    } else if (messagesChanged) {
      // Check if the last message changed (new message at end) or just length changed (prepended messages)
      const lastMessageChanged = currentLastMessageId !== prevLastMessageId.current

      if (lastMessageChanged) {
        // New message added at the end - auto scroll
        scrollToBottom(true)
      }
      // If only length changed but last message is the same, it means older messages were prepended
      // In that case, don't auto-scroll to maintain user's position
    }

    prevMessagesLength.current = allMessages.length
    prevLastMessageId.current = currentLastMessageId
  }, [allMessages, isInitialLoad, scrollToBottom])

  // Handle streaming content updates - more aggressive for better UX
  useEffect(() => {
    if (isStreaming) {
      // More frequent scroll updates for streaming content
      scrollToBottom(true)
    }
  }, [isStreaming, activeStream, scrollToBottom]) // Also depend on activeStream changes

  // Additional scroll trigger for content changes that might cause layout shifts
  useEffect(() => {
    if (isStreaming && activeStream) {
      // Use immediate scroll for layout-changing content to prevent jumping
      scrollToBottom(true, true)
    }
  }, [isStreaming, activeStream, scrollToBottom])

  // Handle thinking indicator appearance with immediate scroll
  useEffect(() => {
    if (isStreaming && activeStream && !activeStream.isComplete) {
      // Delay scroll slightly to catch thinking indicator appearance
      const thinkingScrollTimeout = setTimeout(() => {
        scrollToBottom(false, true) // Instant scroll when thinking indicator appears
      }, 450) // Slightly after the 400ms thinking indicator delay

      return () => clearTimeout(thinkingScrollTimeout)
    }
  }, [isStreaming, activeStream, scrollToBottom])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [])

  if (allMessages.length === 0) {
    return (
      <div ref={containerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center justify-center h-full flex-col gap-1">
          {isLoadingMessages ? (
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
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 gap-4">
      {/* Load More Button */}
      {pagination.hasMore && (
        <div className="flex justify-center mb-4">
          <Button
            design="secondary"
            size="sm"
            disabled={pagination.isLoading}
            onClick={handleLoadMore}
          >
            {pagination.isLoading ? (
              <>
                <Spinner size="sm" /> Loading...
              </>
            ) : (
              'Load previous conversations'
            )}
          </Button>
        </div>
      )}

      {allMessages.map((message) => (
        <StreamingMessage
          key={message.id}
          message={message}
          isActiveStream={'isComplete' in message && !message.isComplete}
        />
      ))}

      <div ref={messagesEndRef} />
    </div>
  )
}
