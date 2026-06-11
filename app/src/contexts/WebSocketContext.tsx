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
  loadHistory: (params?: { cursor?: string; limit?: number }) => boolean
  stopGeneration: () => Promise<void>
  cancelLogoGeneration: (jobId?: string) => Promise<void>
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null)

export function WebSocketProvider({
  children,
  sendMessage,
  loadHistory,
  stopGeneration,
  cancelLogoGeneration
}: {
  children: React.ReactNode
  // Type must match the sendMessage signature returned by useStreamingWebSocket
  sendMessage: (options: SendMessageOptions) => Promise<void>
  loadHistory: (params?: { cursor?: string; limit?: number }) => boolean
  stopGeneration: () => Promise<void>
  cancelLogoGeneration: (jobId?: string) => Promise<void>
}) {
  return (
    <WebSocketContext.Provider value={{ sendMessage, loadHistory, stopGeneration, cancelLogoGeneration }}>
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
