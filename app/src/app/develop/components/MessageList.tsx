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
      <div className="flex items-center mb-4">
        <div className="w-8 h-8 bg-gradient-to-r from-green-100 to-emerald-100 rounded-lg flex items-center justify-center mr-3">
          <CodeBracketIcon className="w-4 h-4 text-green-600" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">CodeBot-DEV</h2>
          <p className="text-xs text-green-600">Lead Developer Agent</p>
        </div>
      </div>
      
      {messages.map((message, index) => (
        <Message key={message.id || `message-${index}`} message={message} />
      ))}
      <div ref={messagesEndRef} />
    </div>
  )
}
