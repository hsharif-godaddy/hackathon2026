'use client'

import { useRef, useEffect, useState, useMemo } from 'react'
import StreamingMessage from './StreamingMessage'
import { useMessages, useActiveStream, useIsActivelyStreaming } from '@/stores/useStreamingConversationStore'

export default function StreamingMessageList() {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const prevMessagesLength = useRef(0)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // Get all visible messages (completed + active stream)
  const messages = useMessages()
  const activeStream = useActiveStream()
  const isStreaming = useIsActivelyStreaming()
  
  // Combine messages with useMemo to prevent infinite loops
  const allMessages = useMemo(() => {
    return activeStream ? [...messages, activeStream] : messages
  }, [messages, activeStream])

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
    
    if (isInitialLoad) {
      // Initial load - scroll immediately
      scrollToBottom(false)
      setIsInitialLoad(false)
    } else if (messagesChanged) {
      // New message added - smooth scroll
      scrollToBottom(true)
    }
    
    prevMessagesLength.current = allMessages.length
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
