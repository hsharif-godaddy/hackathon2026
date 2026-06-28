import http from 'node:http'
import https from 'node:https'

import {
  FaultController,
  isPreStreamFault,
  type ClaimResult,
  type FaultName,
} from './faults.js'
import { parseProviderPrefix, resolveUpstream, stripTrailingSlash, type AgentsEnv } from './resolve.js'
import { CYAN, DIM, GREEN, RED, RESET, YELLOW, describeChunk } from './sse-log.js'

export interface RelayConfig {
  controller: FaultController
  // Origin of this proxy's data listener, for the resolve self-reference guard.
  proxyOrigin: string
  // Agent provider config (mode + real upstreams), read once at startup.
  agentsEnv: AgentsEnv
  // When set (standalone `pnpm run llm-proxy`), every request forwards here and
  // provider-prefix routing is bypassed.
  upstreamOverride?: string
  log?: (line: string) => void
}

// An Anthropic `event: error` frame — the wire shape the AI SDK surfaces as a
// stream error (exercises classifyTurnError on the client).
const ANTHROPIC_ERROR_FRAME: string =
  'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"injected by llm-proxy fault stream-error-event"}}\n\n'

// A content_block_delta whose data carries an unknown discriminator — drives
// the AI SDK Anthropic parser into a TypeValidationError mid-stream. The
// synthetic discriminator carries no recognizable marker, so the agent's
// classifyTurnError lands it on the non-retryable STREAM_TYPE_VALIDATION
// ('unknown') sub-branch.
const INVALID_CHUNK_FRAME: string =
  'event: content_block_delta\ndata: {"type":"__llm_proxy_invalid_discriminator__"}\n\n'

// Leaked Bedrock-exception envelopes the GoCode/LiteLLM proxy can surface as
// non-Anthropic stream chunks. Each fails the AI SDK discriminatedUnion (the
// `type` isn't an Anthropic chunk type) → TypeValidationError, and the offending
// value carries the substring classifyTurnError keys on: `validationException`
// → CONTENT_FILTERED (non-retryable guardrail), `internalServerException` /
// "try your request again" → STREAM_TYPE_VALIDATION transient (retryable). These
// are the dominant real-world shapes the synthetic INVALID_CHUNK_FRAME misses.
const CONTENT_FILTER_FRAME: string =
  'event: content_block_delta\ndata: {"type":"validationException","message":"injected by llm-proxy fault content-filter"}\n\n'
const TRANSIENT_ERROR_FRAME: string =
  'event: content_block_delta\ndata: {"type":"internalServerException","message":"Try your request again. (injected by llm-proxy fault transient-error)"}\n\n'

export function createRelayServer(config: RelayConfig): http.Server {
  const log: (line: string) => void = config.log ?? ((line: string): void => console.log(line))
  let requestCounter: number = 0

  return http.createServer((req: http.IncomingMessage, res: http.ServerResponse): void => {
    const requestId: number = ++requestCounter
    const tag: string = `${CYAN}[${requestId}]${RESET}`
    const rawUrl: string = req.url ?? '/'

    // Error listeners are mandatory for this tool: arming a fault deliberately
    // destroys streams mid-flight, and an upstream drop or client abort emits
    // 'error' on req/res. Without a listener Node rethrows it as an uncaught
    // exception and crashes the whole proxy (every in-flight request with it).
    // These only log — the stream is already failing, there's nothing to retry.
    req.on('error', (err: Error): void => {
      log(`${tag} ${RED}ERR${RESET} request stream error: ${err.message}`)
    })
    res.on('error', (err: Error): void => {
      log(`${tag} ${RED}ERR${RESET} response stream error: ${err.message}`)
    })

    const target: { base: string; path: string } | null = resolveTarget(rawUrl, config)
    if (!target) {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end('{"error":"llm-proxy: no upstream — missing /u/<provider> prefix and UPSTREAM_URL"}')
      log(`${tag} ${RED}502${RESET} unresolved upstream for ${rawUrl}`)
      return
    }

    const isChat: boolean = pathIsChat(target.path)
    const isSSE: boolean = isChat || (req.headers.accept?.includes('text/event-stream') ?? false)

    const bodyChunks: Buffer[] = []
    req.on('data', (chunk: Buffer): void => {
      bodyChunks.push(chunk)
    })
    req.on('end', (): void => {
      const body: Buffer = Buffer.concat(bodyChunks)
      log(`\n${tag} ${YELLOW}>>> ${req.method} ${rawUrl}${RESET}  ${DIM}${ts()}${RESET}`)
      logModel(body, tag, log)

      const fault: ClaimResult | null = config.controller.claim(isChat)

      if (fault && isPreStreamFault(fault.fault)) {
        applyPreStreamFault(fault, req, res, tag, log)
        return
      }

      forwardToUpstream({ req, res, body, target, fault, isSSE, tag, log })
    })
  })
}

function resolveTarget(rawUrl: string, config: RelayConfig): { base: string; path: string } | null {
  if (config.upstreamOverride) {
    return { base: stripTrailingSlash(config.upstreamOverride), path: rawUrl }
  }
  const parsed: ReturnType<typeof parseProviderPrefix> = parseProviderPrefix(rawUrl)
  if (!parsed) {
    return null
  }
  return {
    base: resolveUpstream(parsed.provider, { proxyOrigin: config.proxyOrigin, agentsEnv: config.agentsEnv }),
    path: parsed.path,
  }
}

interface ForwardArgs {
  req: http.IncomingMessage
  res: http.ServerResponse
  body: Buffer
  target: { base: string; path: string }
  fault: ClaimResult | null
  isSSE: boolean
  tag: string
  log: (line: string) => void
}

function forwardToUpstream(args: ForwardArgs): void {
  const { req, res, body, target, fault, isSSE, tag, log } = args
  const upstream: URL = new URL(target.base)
  const client: typeof http | typeof https = upstream.protocol === 'https:' ? https : http
  const reqStart: number = performance.now()

  const options: https.RequestOptions = {
    hostname: upstream.hostname,
    port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
    // target.path is authoritative: the agent's provider always appends `/v1`
    // to its base (the proxy URL, which has none), so the post-prefix path
    // already carries the version segment. The upstream base contributes
    // authority (host/port) only — prepending its path would double `/v1` for
    // an api-key base that ends in `/v1` (e.g. https://api.openai.com/v1).
    path: target.path,
    method: req.method,
    // upstream.host (not hostname) so a non-default port survives in the Host
    // header — virtual-host upstreams reject a port-less Host.
    headers: { ...req.headers, host: upstream.host },
  }

  const proxyReq: http.ClientRequest = client.request(options, (proxyRes: http.IncomingMessage): void => {
    const ttfb: string = (performance.now() - reqStart).toFixed(0)
    log(`${tag} ${GREEN}<<< ${proxyRes.statusCode}${RESET}  TTFB: ${ttfb}ms  ${DIM}${ts()}${RESET}`)

    relayBody({ proxyRes, res, fault, isSSE, reqStart, tag, log })
  })

  proxyReq.on('error', (err: Error): void => {
    log(`${tag} ${RED}ERR${RESET} ${err.message}`)
    if (!res.headersSent && !res.destroyed) {
      res.writeHead(502)
    }
    if (!res.writableEnded) {
      res.end('Bad Gateway')
    }
  })

  // The agent cancelled the stream (Stop / supersession / disconnect). Tear down
  // the upstream request so we stop pumping into a dead socket and don't leak the
  // upstream connection. No-op once the response has completed.
  res.on('close', (): void => {
    proxyReq.destroy()
  })

  if (body.length > 0) {
    proxyReq.write(body)
  }
  proxyReq.end()
}

interface RelayBodyArgs {
  proxyRes: http.IncomingMessage
  res: http.ServerResponse
  fault: ClaimResult | null
  isSSE: boolean
  reqStart: number
  tag: string
  log: (line: string) => void
}

function relayBody(args: RelayBodyArgs): void {
  const { proxyRes, res, fault, isSSE, reqStart, tag, log } = args
  // The client may have already disconnected before the upstream responded
  // (e.g. the agent cancelled the turn). Don't writeHead / pump into a dead
  // socket — tear down the upstream and bail.
  if (res.destroyed || res.writableEnded) {
    proxyRes.destroy()
    return
  }
  res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)

  // Any fault reaching relayBody is a streaming fault (pre-stream faults
  // short-circuit before forwardToUpstream); the controller arms at most one.
  const streamFault: ClaimResult | null = fault
  if (streamFault) {
    logFault(streamFault, tag, log, streamFault.fault)
  }

  const afterN: number = streamFault ? streamFault.params.afterChunks ?? defaultAfterChunks(streamFault.fault) : 0
  let relayed: number = 0
  let chunkIndex: number = 0
  let injected: boolean = false
  let terminated: boolean = false
  // Guards the backpressure drain handler: only one is registered at a time, so
  // sustained backpressure can't pile up `once('drain')` listeners (>10 trips
  // MaxListenersExceededWarning) that all fire redundantly on a single drain.
  let draining: boolean = false
  let lastChunkTime: number = performance.now()

  proxyRes.on('data', (chunk: Buffer): void => {
    if (terminated) {
      return
    }
    chunkIndex++
    logChunk(chunk, isSSE, chunkIndex, reqStart, lastChunkTime, tag, log)
    lastChunkTime = performance.now()

    if (streamFault && !injected && relayed >= afterN) {
      injected = true
      if (streamFault.fault === 'premature-close') {
        terminated = true
        proxyRes.destroy()
        res.destroy()
        return
      }
      if (streamFault.fault === 'stream-error-event') {
        terminated = true
        res.write(ANTHROPIC_ERROR_FRAME)
        proxyRes.destroy()
        res.end()
        return
      }
      // Bad-chunk faults write a malformed frame and fall through: keep relaying
      // so the SDK trips on it mid-stream (→ TypeValidationError, sub-classified
      // by the offending value).
      if (streamFault.fault === 'invalid-chunk') {
        res.write(INVALID_CHUNK_FRAME)
      }
      if (streamFault.fault === 'content-filter') {
        res.write(CONTENT_FILTER_FRAME)
      }
      if (streamFault.fault === 'transient-error') {
        res.write(TRANSIENT_ERROR_FRAME)
      }
    }

    relayed++
    const ok: boolean = res.write(chunk)
    if (!ok && !draining) {
      draining = true
      proxyRes.pause()
      res.once('drain', (): void => {
        draining = false
        proxyRes.resume()
      })
    }
  })

  proxyRes.on('end', (): void => {
    if (terminated) {
      return
    }
    log(`${tag} ${GREEN}--- done${RESET}  ${chunkIndex} chunks  ${(performance.now() - reqStart).toFixed(0)}ms total`)
    if (!res.writableEnded) {
      res.end()
    }
  })

  // An upstream mid-stream drop (ECONNRESET/TLS/truncation) emits 'error' here.
  // Without this listener Node would crash the proxy — the exact failure this
  // tool is built to simulate.
  proxyRes.on('error', (err: Error): void => {
    if (terminated) {
      return
    }
    terminated = true
    log(`${tag} ${RED}ERR${RESET} upstream stream error: ${err.message}`)
    if (!res.writableEnded) {
      res.end()
    }
  })
}

function applyPreStreamFault(
  fault: ClaimResult,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  tag: string,
  log: (line: string) => void,
): void {
  logFault(fault, tag, log, fault.fault)
  if (fault.fault === 'connection-reset') {
    req.socket?.destroy()
    return
  }
  const status: number = fault.params.status ?? 503
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(`{"error":{"type":"llm_proxy_fault","message":"injected http-error ${status}"}}`)
}

function logChunk(
  chunk: Buffer,
  isSSE: boolean,
  chunkIndex: number,
  reqStart: number,
  lastChunkTime: number,
  tag: string,
  log: (line: string) => void,
): void {
  const now: number = performance.now()
  const delta: string = (now - lastChunkTime).toFixed(0)
  const elapsed: string = (now - reqStart).toFixed(0)
  const prefix: string = `${tag}   ${DIM}#${chunkIndex} +${delta}ms ${elapsed}ms${RESET}`
  if (!isSSE) {
    log(`${prefix}  ${DIM}${chunk.length}B${RESET}`)
    return
  }
  for (const line of describeChunk(chunk.toString('utf8'))) {
    log(`${prefix}  ${line}`)
  }
}

function logModel(body: Buffer, tag: string, log: (line: string) => void): void {
  if (body.length === 0) {
    return
  }
  try {
    const parsed: Record<string, unknown> = JSON.parse(body.toString('utf8'))
    if (parsed.model) {
      log(`${tag}   model: ${String(parsed.model)}  stream: ${String(parsed.stream ?? false)}`)
    }
  } catch {
    // Non-JSON body — nothing to summarize.
  }
}

function logFault(fault: ClaimResult, tag: string, log: (line: string) => void, label: string): void {
  const disarmed: string = fault.autoDisarmed ? `  ${DIM}(disarmed)${RESET}` : ''
  log(`${tag} ${RED}FAULT applied: ${label}${RESET}${disarmed}`)
}

function defaultAfterChunks(fault: FaultName): number {
  switch (fault) {
    case 'stream-error-event':
      return 1
    case 'premature-close':
    case 'invalid-chunk':
    case 'content-filter':
    case 'transient-error':
      return 2
    default:
      return 0
  }
}

function pathIsChat(path: string): boolean {
  return path.includes('/chat/completions') || path.includes('/messages')
}

function ts(): string {
  return new Date().toISOString()
}
