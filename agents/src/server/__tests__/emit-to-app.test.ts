import { describe, it, expect } from 'vitest'

import { emitToApp, isAppEligibleForEmit } from '../ai-lib-websocket-server.js'

// Exercises the real predicate that emitToApp uses to filter per-socket delivery.
// Iterating `ioInstance.sockets.sockets` requires booting the full server, which
// is covered by integration tests; here we nail down the predicate semantics
// directly so any change to the authenticated/siteId gate is caught.

type FakeSocket = Parameters<typeof isAppEligibleForEmit>[0]

function socketWith(overrides: {
  authenticated?: boolean
  siteId?: string
}): FakeSocket {
  return {
    data: overrides.authenticated === undefined ? undefined : { authenticated: overrides.authenticated },
    handshake: {
      auth: overrides.siteId === undefined ? {} : { agentContext: { siteId: overrides.siteId } },
    },
  }
}

describe('isAppEligibleForEmit', () => {
  it('accepts authenticated sockets whose siteId matches the appId', () => {
    expect(isAppEligibleForEmit(socketWith({ authenticated: true, siteId: 'app-1' }), 'app-1')).toBe(true)
  })

  it('rejects sockets whose siteId is for a different app', () => {
    expect(isAppEligibleForEmit(socketWith({ authenticated: true, siteId: 'app-2' }), 'app-1')).toBe(false)
  })

  it('rejects sockets with no agentContext.siteId', () => {
    expect(isAppEligibleForEmit(socketWith({ authenticated: true }), 'app-1')).toBe(false)
  })

  it('rejects pre-auth sockets even when a client-injected siteId matches', () => {
    // handshake.auth is a spread of client-sent input, so a client could plant
    // agentContext.siteId === target before JWT validation runs. socket.data
    // is server-only and must gate delivery.
    expect(isAppEligibleForEmit(socketWith({ siteId: 'app-1' }), 'app-1')).toBe(false)
    expect(isAppEligibleForEmit(socketWith({ authenticated: false, siteId: 'app-1' }), 'app-1')).toBe(false)
  })
})

describe('emitToApp without initialized Socket.IO', () => {
  it('returns 0 when ioInstance is null', () => {
    expect(emitToApp('app-1', 'oauth:result', {})).toBe(0)
  })

  it('returns 0 for an empty appId', () => {
    expect(emitToApp('', 'oauth:result', {})).toBe(0)
  })
})
