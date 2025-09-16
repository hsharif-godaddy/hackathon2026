'use client'

import { useRef, useEffect, useState } from 'react'
import Message from './Message'
import { Message as MessageType } from './types'

interface MessageListProps {
  messages: MessageType[]
}

export default function MessageList({ messages }: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const prevMessagesLength = useRef(messages.length)

  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' })
  }

  useEffect(() => {
    const messagesChanged = messages.length !== prevMessagesLength.current
    
    if (isInitialLoad) {
      scrollToBottom(false)
      setIsInitialLoad(false)
    } else if (messagesChanged) {
      scrollToBottom(true)
    }
    
    prevMessagesLength.current = messages.length
  }, [messages, isInitialLoad])

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((message, index) => (
        <Message key={message.id || `message-${index}`} message={message} />
      ))}
      <div ref={messagesEndRef} />
    </div>
  )
}
