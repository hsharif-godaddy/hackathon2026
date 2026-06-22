'use client'

import { createContext, useContext } from 'react'

import type { SendMessageOptions } from '@/services/transport/messageTypes'

/**
 * Chat Context
 *
 * Provides the chat transport's sendMessage function to deeply nested components
 * without prop drilling through the entire component tree.
 */

interface ChatContextValue {
  // Type must match the sendMessage signature returned by the chat transport
  sendMessage: (options: SendMessageOptions) => Promise<void>
  loadHistory: (params?: { cursor?: string; limit?: number }) => boolean
  stopGeneration: () => Promise<void>
  cancelLogoGeneration: (jobId?: string) => Promise<void>
}

const ChatContext = createContext<ChatContextValue | null>(null)

export function ChatProvider({ children, ...value }: ChatContextValue & { children: React.ReactNode }) {
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChatContext() {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useChatContext must be used within ChatProvider')
  }
  return context
}
