'use client'

import { useRef, useEffect, useState, useMemo } from 'react'
import StreamingMessage from './StreamingMessage'
import Button from '@ux/button'
import Spinner from '@ux/spinner'
import { 
  useMessages, 
  useActiveStream, 
  useIsActivelyStreaming, 
  useLoadMoreConversations, 
  useConversationPagination,
  useCurrentAppId 
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
  const scrollToBottom = (smooth = true) => {
    // Clear any pending scroll
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current)
    }

    // Use requestAnimationFrame to ensure DOM is ready
    const performScroll = () => {
      // Try multiple scroll methods for reliability
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ 
          behavior: smooth ? 'smooth' : 'instant',
          block: 'end'
        })
      }
      
      // Also try scrolling the container directly
      if (containerRef.current) {
        const container = containerRef.current
        container.scrollTop = container.scrollHeight
      }
    }

    if (smooth) {
      // Throttle smooth scrolls
      scrollTimeoutRef.current = setTimeout(() => {
        requestAnimationFrame(performScroll)
      }, 50)
    } else {
      // Immediate scroll
      requestAnimationFrame(performScroll)
    }
  }

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
  }, [allMessages, isInitialLoad])

  // Handle streaming content updates - more aggressive for better UX
  useEffect(() => {
    if (isStreaming) {
      // More frequent scroll updates for streaming content
      scrollToBottom(true)
    }
  }, [isStreaming, activeStream]) // Also depend on activeStream changes

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
        <div className="flex items-center justify-center h-full text-gray-500">
          <p>No messages yet. Start a conversation!</p>
        </div>
        <div ref={messagesEndRef} />
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
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
