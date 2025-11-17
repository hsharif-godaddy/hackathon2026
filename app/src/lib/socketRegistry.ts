/**
 * Shared Socket.IO connection registry
 * 
 * Provides access to the main WebSocket connection so other parts of the app
 * (like OAuth popup) can listen for events without creating separate connections.
 */

import type { Socket } from 'socket.io-client'

let sharedSocket: Socket | null = null

/**
 * Set the shared Socket.IO connection
 * Called by useStreamingWebSocket when creating/destroying the socket
 */
export const setSharedSocket = (socket: Socket | null) => {
  sharedSocket = socket
}

/**
 * Get the shared Socket.IO connection
 * Returns null if no connection exists yet
 */
export const getSharedSocket = (): Socket | null => {
  return sharedSocket
}
