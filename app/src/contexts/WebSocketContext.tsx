'use client'

import { createContext, useContext } from 'react'

/**
 * WebSocket Context
 *
 * Provides WebSocket sendMessage function to deeply nested components
 * without prop drilling through the entire component tree.
 */

interface WebSocketContextValue {
  // Type must match the sendMessage signature returned by useStreamingWebSocket
  sendMessage: (
    content: string,
    aiEditContext?: any,
    selectedAssets?: any[],
    todoListContext?: any,
    isActionRequest?: boolean,
    customContext?: any
  ) => Promise<void>
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null)

export function WebSocketProvider({
  children,
  sendMessage
}: {
  children: React.ReactNode
  // Type must match the sendMessage signature returned by useStreamingWebSocket
  sendMessage: (
    content: string,
    aiEditContext?: any,
    selectedAssets?: any[],
    todoListContext?: any,
    isActionRequest?: boolean,
    customContext?: any
  ) => Promise<void>
}) {
  return (
    <WebSocketContext.Provider value={{ sendMessage }}>
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
