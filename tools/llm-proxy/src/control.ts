import http from 'node:http'

import { FaultController, isFaultName, type ArmRequest, type ArmState, type FaultParams } from './faults.js'

export interface ControlConfig {
  controller: FaultController
  env?: NodeJS.ProcessEnv
  log?: (line: string) => void
}

// Control plane for arming/disarming faults. Bound to loopback only by the
// caller. Arming is refused under NODE_ENV=production as a belt-and-braces
// guard — this tool is dev-only and must never inject faults against a real
// deployment.
export function createControlServer(config: ControlConfig): http.Server {
  const env: NodeJS.ProcessEnv = config.env ?? process.env
  const log: (line: string) => void = config.log ?? ((line: string): void => console.log(line))

  return http.createServer((req: http.IncomingMessage, res: http.ServerResponse): void => {
    const method: string = req.method ?? 'GET'
    const url: string = req.url ?? '/'

    // Mirror the relay's mandatory error listeners: the TUI control client has a
    // 2s timeout, so an /arm POST interrupted mid-body emits 'error' on req with
    // no handler → uncaught exception → the control server dies and faults can no
    // longer be armed/disarmed for the session. These only log.
    req.on('error', (err: Error): void => {
      log(`[control] request stream error: ${err.message}`)
    })
    res.on('error', (err: Error): void => {
      log(`[control] response stream error: ${err.message}`)
    })

    if (method === 'GET' && url === '/health') {
      sendJson(res, 200, { status: 'ok' })
      return
    }

    if (method === 'GET' && url === '/state') {
      const state: ArmState | null = config.controller.snapshot()
      sendJson(res, 200, state ? { armed: true, ...state } : { armed: false })
      return
    }

    if (method === 'POST' && url === '/disarm') {
      config.controller.disarm()
      log('[control] disarmed')
      sendJson(res, 200, { armed: false })
      return
    }

    if (method === 'POST' && url === '/arm') {
      if (isProduction(env)) {
        sendJson(res, 403, { error: 'arming disabled when NODE_ENV=production' })
        return
      }
      readBody(req, (raw: string): void => {
        let parsed: unknown
        try {
          parsed = JSON.parse(raw || '{}')
        } catch {
          sendJson(res, 400, { error: 'invalid JSON' })
          return
        }
        const armRequest: ArmRequest | null = toArmRequest(parsed)
        if (!armRequest) {
          sendJson(res, 400, { error: 'invalid or missing fault name' })
          return
        }
        const state: ArmState = config.controller.arm(armRequest)
        log(`[control] armed: ${state.fault} x${state.remaining} scope=${state.scope}`)
        sendJson(res, 200, { armed: true, ...state })
      })
      return
    }

    sendJson(res, 404, { error: 'not found' })
  })
}

function toArmRequest(value: unknown): ArmRequest | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const obj: Record<string, unknown> = value as Record<string, unknown>
  if (!isFaultName(obj.fault)) {
    return null
  }
  const request: ArmRequest = { fault: obj.fault }
  if (typeof obj.count === 'number') {
    request.count = obj.count
  }
  if (obj.scope === 'all' || obj.scope === 'chat') {
    request.scope = obj.scope
  }
  if (typeof obj.params === 'object' && obj.params !== null) {
    request.params = sanitizeParams(obj.params as Record<string, unknown>)
  }
  return request
}

// Coerces the untrusted params object to the known FaultParams fields, dropping
// anything malformed. Without this a bad status (e.g. "oops" or 99999) reaches
// res.writeHead() and throws a RangeError inside the request handler, crashing
// the proxy. Dropped fields fall back to the relay's defaults.
function sanitizeParams(raw: Record<string, unknown>): FaultParams {
  const params: FaultParams = {}
  if (typeof raw.status === 'number' && Number.isInteger(raw.status) && raw.status >= 100 && raw.status <= 599) {
    params.status = raw.status
  }
  if (typeof raw.afterChunks === 'number' && Number.isInteger(raw.afterChunks) && raw.afterChunks >= 0) {
    params.afterChunks = raw.afterChunks
  }
  return params
}

function isProduction(env: NodeJS.ProcessEnv): boolean {
  const value: string = (env.NODE_ENV ?? '').toLowerCase()
  return value === 'production' || value === 'prod'
}

function readBody(req: http.IncomingMessage, callback: (raw: string) => void): void {
  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer): void => {
    chunks.push(chunk)
  })
  req.on('end', (): void => {
    callback(Buffer.concat(chunks).toString('utf8'))
  })
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
