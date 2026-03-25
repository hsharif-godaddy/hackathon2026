'use client'

import { createContext, useContext } from 'react'

import type { SendMessageOptions } from '@/hooks/useStreamingWebSocket'

/**
 * WebSocket Context
 *
 * Provides WebSocket sendMessage function to deeply nested components
 * without prop drilling through the entire component tree.
 */

interface WebSocketContextValue {
  // Type must match the sendMessage signature returned by useStreamingWebSocket
  sendMessage: (options: SendMessageOptions) => Promise<void>
  loadMoreHistory: (params: { cursor: string; limit?: number }) => boolean
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null)

export function WebSocketProvider({
  children,
  sendMessage,
  loadMoreHistory
}: {
  children: React.ReactNode
  // Type must match the sendMessage signature returned by useStreamingWebSocket
  sendMessage: (options: SendMessageOptions) => Promise<void>
  loadMoreHistory: (params: { cursor: string; limit?: number }) => boolean
}) {
  return (
    <WebSocketContext.Provider value={{ sendMessage, loadMoreHistory }}>
      {children}
    </WebSocketContext.Provider>
  )
}

export function useWebSocketContext() {
  const context = useContext(WebSocketContext)
  if (!context) {
    throw new Error('useWebSocketContext must be used within WebSocketProvider')
  }
  return context
}
