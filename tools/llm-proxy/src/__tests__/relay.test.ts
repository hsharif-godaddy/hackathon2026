import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import { FaultController } from '../faults.js'
import { createRelayServer } from '../relay.js'
import type { AgentsEnv } from '../resolve.js'

const UPSTREAM_BODY: string = [
  'event: message_start',
  'data: {"type":"message_start","message":{"model":"test"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
  '',
].join('\n')

const servers: http.Server[] = []

afterEach(async (): Promise<void> => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

interface Stub {
  origin: string
  lastHeaders: () => http.IncomingHttpHeaders
  lastUrl: () => string
}

function startStub(): Promise<Stub> {
  let captured: http.IncomingHttpHeaders = {}
  let capturedUrl: string = ''
  const server: http.Server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse): void => {
    captured = req.headers
    capturedUrl = req.url ?? ''
    req.resume()
    req.on('end', (): void => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(UPSTREAM_BODY)
    })
  })
  servers.push(server)
  return new Promise<Stub>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        lastHeaders: () => captured,
        lastUrl: () => capturedUrl,
      }),
    ),
  )
}

// Starts a relay in provider-prefix mode (no upstreamOverride) with the given
// agents env, so tests can exercise resolveUpstream + path forwarding.
async function startPrefixRelay(agentsEnv: AgentsEnv): Promise<string> {
  const server: http.Server = createRelayServer({
    controller: new FaultController(),
    proxyOrigin: 'http://127.0.0.1:8788',
    agentsEnv,
    log: (): void => {},
  })
  servers.push(server)
  const port: number = await new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)),
  )
  return `http://127.0.0.1:${port}`
}

// Upstream that promises more bytes than it sends, then kills the socket — the
// proxy's upstream response stream errors (truncated body) and the relay's
// flush trips a content-length mismatch on the client res. Both must be caught.
function startTruncatingStub(): Promise<string> {
  const server: http.Server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse): void => {
    req.resume()
    req.on('end', (): void => {
      res.writeHead(200, { 'content-length': '1000', 'content-type': 'text/event-stream' })
      res.write('partial')
      res.socket?.destroy()
    })
  })
  servers.push(server)
  return new Promise<string>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  )
}

async function startRelay(controller: FaultController, upstreamOverride: string): Promise<string> {
  const server: http.Server = createRelayServer({
    controller,
    proxyOrigin: 'http://127.0.0.1:8788',
    agentsEnv: { s2s: true },
    upstreamOverride,
    log: (): void => {},
  })
  servers.push(server)
  const port: number = await new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)),
  )
  return `http://127.0.0.1:${port}`
}

describe('relay passthrough', () => {
  it('relays the upstream body byte-identically when unarmed', async (): Promise<void> => {
    const stub: Stub = await startStub()
    const origin: string = await startRelay(new FaultController(), stub.origin)
    const res: Response = await fetch(`${origin}/v1/messages`, { method: 'POST', body: '{"stream":true}' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(UPSTREAM_BODY)
  })

  it('forwards auth headers unchanged', async (): Promise<void> => {
    const stub: Stub = await startStub()
    const origin: string = await startRelay(new FaultController(), stub.origin)
    await fetch(`${origin}/v1/messages`, {
      method: 'POST',
      headers: { authorization: 'sso-jwt test-token', 'x-api-key': 'sk-test' },
      body: '{}',
    })
    expect(stub.lastHeaders().authorization).toBe('sso-jwt test-token')
    expect(stub.lastHeaders()['x-api-key']).toBe('sk-test')
  })

  it('forwards the request path verbatim — base path is not prepended (no double /v1)', async (): Promise<void> => {
    const stub: Stub = await startStub()
    // api-key mode with a base that carries /v1, mirroring https://api.openai.com/v1.
    // The agent already appended /v1 to the proxy URL, so target.path is /v1/messages;
    // the upstream base path must NOT be prepended or we'd send /v1/v1/messages.
    const origin: string = await startPrefixRelay({ s2s: false, openaiBaseUrl: `${stub.origin}/v1` })
    await fetch(`${origin}/u/openai/v1/messages`, { method: 'POST', body: '{}' })
    expect(stub.lastUrl()).toBe('/v1/messages')
  })
})

describe('relay fault injection', () => {
  it('http-error returns the armed status without contacting upstream', async (): Promise<void> => {
    const controller: FaultController = new FaultController()
    controller.arm({ fault: 'http-error', params: { status: 504 }, scope: 'all' })
    const origin: string = await startRelay(controller, 'http://127.0.0.1:1')
    const res: Response = await fetch(`${origin}/v1/messages`, { method: 'POST', body: '{}' })
    expect(res.status).toBe(504)
  })

  it('connection-reset drops the connection with no response', async (): Promise<void> => {
    const stub: Stub = await startStub()
    const controller: FaultController = new FaultController()
    controller.arm({ fault: 'connection-reset', scope: 'all' })
    const origin: string = await startRelay(controller, stub.origin)
    await expect(fetch(`${origin}/v1/messages`, { method: 'POST', body: '{}' })).rejects.toThrow()
  })

  it('premature-close aborts mid-stream before the upstream finishes', async (): Promise<void> => {
    const stub: Stub = await startStub()
    const controller: FaultController = new FaultController()
    controller.arm({ fault: 'premature-close', params: { afterChunks: 0 }, scope: 'all' })
    const origin: string = await startRelay(controller, stub.origin)
    await expect(
      (async (): Promise<string> => {
        const res: Response = await fetch(`${origin}/v1/messages`, { method: 'POST', body: '{}' })
        return res.text()
      })(),
    ).rejects.toThrow()
  })

  it('stream-error-event injects an Anthropic error frame', async (): Promise<void> => {
    const stub: Stub = await startStub()
    const controller: FaultController = new FaultController()
    controller.arm({ fault: 'stream-error-event', params: { afterChunks: 0 }, scope: 'all' })
    const origin: string = await startRelay(controller, stub.origin)
    const res: Response = await fetch(`${origin}/v1/messages`, { method: 'POST', body: '{}' })
    expect(await res.text()).toContain('event: error')
  })

  it('invalid-chunk injects a bad discriminator then keeps relaying', async (): Promise<void> => {
    const stub: Stub = await startStub()
    const controller: FaultController = new FaultController()
    controller.arm({ fault: 'invalid-chunk', params: { afterChunks: 0 }, scope: 'all' })
    const origin: string = await startRelay(controller, stub.origin)
    const text: string = await (await fetch(`${origin}/v1/messages`, { method: 'POST', body: '{}' })).text()
    expect(text).toContain('__llm_proxy_invalid_discriminator__')
    expect(text).toContain('message_stop')
  })

  it('content-filter injects a validationException chunk then keeps relaying', async (): Promise<void> => {
    const stub: Stub = await startStub()
    const controller: FaultController = new FaultController()
    controller.arm({ fault: 'content-filter', params: { afterChunks: 0 }, scope: 'all' })
    const origin: string = await startRelay(controller, stub.origin)
    const text: string = await (await fetch(`${origin}/v1/messages`, { method: 'POST', body: '{}' })).text()
    expect(text).toContain('validationException')
    expect(text).toContain('message_stop')
  })

  it('transient-error injects an internalServerException chunk then keeps relaying', async (): Promise<void> => {
    const stub: Stub = await startStub()
    const controller: FaultController = new FaultController()
    controller.arm({ fault: 'transient-error', params: { afterChunks: 0 }, scope: 'all' })
    const origin: string = await startRelay(controller, stub.origin)
    const text: string = await (await fetch(`${origin}/v1/messages`, { method: 'POST', body: '{}' })).text()
    expect(text).toContain('internalServerException')
    expect(text).toContain('message_stop')
  })

  it('survives an upstream mid-stream drop and keeps serving (no unhandled error)', async (): Promise<void> => {
    const upstream: string = await startTruncatingStub()
    const origin: string = await startRelay(new FaultController(), upstream)
    // First request hits the truncated upstream → proxyRes 'error' + res
    // content-length mismatch. Without the handlers this crashes the worker.
    try {
      await (await fetch(`${origin}/v1/messages`, { method: 'POST', body: '{}' })).text()
    } catch {
      // Expected: the client sees a truncated body.
    }
    // The proxy must still be alive to serve another request. Reaching a
    // response at all proves it didn't crash; 200 = headers relayed before the
    // drop, 502 = the relay's own graceful upstream-error path.
    const second: Response = await fetch(`${origin}/v1/messages`, { method: 'POST', body: '{}' })
    expect([200, 502]).toContain(second.status)
    try {
      await second.text()
    } catch {
      // Truncated again — fine.
    }
  })

  it('leaves non-chat requests alone under the default chat scope', async (): Promise<void> => {
    const stub: Stub = await startStub()
    const controller: FaultController = new FaultController()
    controller.arm({ fault: 'http-error', params: { status: 500 } })
    const origin: string = await startRelay(controller, stub.origin)
    const res: Response = await fetch(`${origin}/v1/embeddings`, { method: 'POST', body: '{}' })
    expect(res.status).toBe(200)
    expect(controller.snapshot()?.remaining).toBe(1)
  })
})
