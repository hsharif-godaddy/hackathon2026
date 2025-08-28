'use client'

import { useRef, useEffect } from 'react'
import { CodeBracketIcon } from '@heroicons/react/24/outline'
import Message from './Message'
import { Message as MessageType } from './types'

interface MessageListProps {
  messages: MessageType[]
}

export default function MessageList({ messages }: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* DevBot Header - now scrollable */}
      {messages.map((message, index) => (
        <Message key={message.id || `message-${index}`} message={message} />
      ))}
      <div ref={messagesEndRef} />
    </div>
  )
}
