/**
 * Connect-then-auth helpers live here (not in ai-lib-websocket-server.ts) so unit tests
 * can import them without loading that module, which pulls DB / native deps at import time.
 */

import type { Socket } from 'socket.io'

import { logger } from '../logging/index.js'

export function attachConnectThenAuthPendingInboundGate(socket: Socket): void {
  socket.use(([event]: [string, ...unknown[]], next: (err?: Error) => void) => {
    if (socket.handshake.auth?.pendingAuth && event !== 'authenticate' && event !== 'disconnect') {
      logger.debug('websocket.auth.blocked_event', {
        message: 'Blocked event from unauthenticated socket',
        event,
        socketId: socket.id,
      })
      next(new Error('Authentication required'))
      return
    }
    next()
  })
}

export function finalizeConnectThenAuthSessionReady(socket: Socket, siteId: string): void {
  socket.handshake.auth = {
    ...(socket.handshake.auth ?? {}),
    pendingAuth: false,
  } as typeof socket.handshake.auth

  socket.emit('authenticateSuccess', {
    siteId,
    socketId: socket.id,
  })
}
