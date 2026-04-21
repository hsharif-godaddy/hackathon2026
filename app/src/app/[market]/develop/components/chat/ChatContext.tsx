'use client'

import { createContext, useContext } from 'react'

import type { CustomContext } from '@/services/websocket/ChatMessageBuilder'

interface SendMessageOptions {
  /**
   * When true, marks this as an action request
   * This tells the agent to execute the request immediately.
   */
  isActionRequest?: boolean
  /**
   * Context data sent to the agent but not displayed in the chat bubble.
   */
  customContext?: CustomContext
}

interface ChatContextValue {
  /**
   * Send a message to the chat
   * @param content - The message text to send
   * @param options - Optional settings for the message
   */
  sendMessage: (content?: string, options?: SendMessageOptions) => void | Promise<void>
}

const ChatContext = createContext<ChatContextValue | null>(null)

/**
 * Hook to access chat context for sending messages
 * @throws Error if used outside of ChatProvider
 */
 const useChatContext = (): ChatContextValue => {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useChatContext must be used within a ChatProvider')
  }
  return context
}

/**
 * Hook to send a user message to the chat, returns null if outside chat context
 * Useful for components that may be rendered outside ChatProvider
 */
 const useSendUserMessage = (): ((content?: string, options?: SendMessageOptions) => void | Promise<void>) | null => {
  const context = useContext(ChatContext)
  return context?.sendMessage ?? null
}

export { ChatContext, useChatContext, useSendUserMessage }
export type { ChatContextValue, SendMessageOptions }

