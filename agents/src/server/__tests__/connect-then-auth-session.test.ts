import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Server } from 'socket.io'
import { io as ioc } from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  attachConnectThenAuthPendingInboundGate,
  finalizeConnectThenAuthSessionReady,
} from '../connect-then-auth-session.js'

describe('connect-then-auth-session', function packageTests() {
  describe('#attachConnectThenAuthPendingInboundGate', function inboundGateTests() {
    let httpServer: ReturnType<typeof createServer>
    let io: Server
    let port: number
    let chatReceived: boolean
    let setupRelease!: () => void
    let setupPromise: Promise<void>

    beforeEach(async function setupEach() {
      chatReceived = false
      setupPromise = new Promise<void>(function deferSetup(resolve) {
        setupRelease = resolve
      })

      httpServer = createServer()
      io = new Server(httpServer, { cors: { origin: '*' } })

      io.on('connection', function onConnection(socket) {
        if (!socket.handshake.auth?.pendingAuth) {
          return
        }
        attachConnectThenAuthPendingInboundGate(socket)
        socket.on('authenticate', async function onAuthenticate() {
          Object.assign(socket.handshake.auth as object, {
            pendingAuth: true,
            agentContext: { siteId: 'local-dev-site' },
          })
          await setupPromise
          finalizeConnectThenAuthSessionReady(socket, 'local-dev-site')
        })
        socket.on('chat_message', function onChat(_payload: unknown, ack?: (err?: Error, res?: unknown) => void) {
          chatReceived = true
          ack?.(undefined, { ok: true })
        })
      })

      await new Promise<void>(function listen(resolve) {
        httpServer.listen(0, resolve)
      })
      port = (httpServer.address() as AddressInfo).port
    })

    afterEach(async function teardownEach() {
      await new Promise<void>(function closeIo(resolve) {
        io.close(() => resolve())
      })
      await new Promise<void>(function closeHttp(resolve) {
        httpServer.close(() => resolve())
      })
    })

    it('blocks chat_message until authenticateSuccess', async function ordering() {
      const client = ioc(`http://127.0.0.1:${port}`, {
        auth: { pendingAuth: true, appId: 'test-app' },
        transports: ['websocket'],
        autoConnect: false,
      })

      client.connect()
      await new Promise<void>(function waitConnect(resolve) {
        client.once('connect', () => resolve())
      })

      client.emit('authenticate', { token: 'test-token' })
      await new Promise<void>(function nextTick(resolve) {
        setImmediate(resolve)
      })

      const chatPayload = {
        message: 'hi',
        context: { metadata: { appId: 'local-dev-site' } },
      }

      // Middleware blocks the packet before the handler runs, so no server ack is sent;
      // emitWithAck rejects with a client-side timeout (or an error if the engine forwards one).
      await expect(
        client.timeout(500).emitWithAck('chat_message', chatPayload)
      ).rejects.toSatisfy(function assertBlocked(err: unknown) {
        expect(err).toBeInstanceOf(Error)
        const message = (err as Error).message
        expect(
          /Authentication required|operation has timed out|timed out|timeout/i.test(message)
        ).toBe(true)
        return true
      })
      expect(chatReceived).toBe(false)

      setupRelease()
      await new Promise<void>(function waitSuccess(resolve) {
        client.once('authenticateSuccess', () => resolve())
      })

      await client.emitWithAck('chat_message', chatPayload)
      expect(chatReceived).toBe(true)

      client.close()
    })
  })
})
