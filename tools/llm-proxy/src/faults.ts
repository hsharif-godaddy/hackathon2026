// Fault catalog and the in-memory arm state. The controller is the single
// source of truth for what (if anything) the next matching request should
// suffer; the relay claims a fault per request and applies it on the wire.

export const FAULT_NAMES = [
  'premature-close',
  'stream-error-event',
  'invalid-chunk',
  'content-filter',
  'transient-error',
  'http-error',
  'connection-reset',
] as const

export type FaultName = (typeof FAULT_NAMES)[number]

export type FaultScope = 'chat' | 'all'

export interface FaultParams {
  // http-error: HTTP status returned before any stream (default 503).
  status?: number
  // Number of upstream chunks relayed before the fault is injected. Applies to
  // the streaming faults: premature-close, stream-error-event, invalid-chunk,
  // content-filter, transient-error.
  afterChunks?: number
}

export interface ArmRequest {
  fault: FaultName
  count?: number
  params?: FaultParams
  scope?: FaultScope
}

export interface ArmState {
  fault: FaultName
  remaining: number
  params: FaultParams
  scope: FaultScope
}

export interface ClaimResult {
  fault: FaultName
  params: FaultParams
  // True when this claim drove the count to zero and disarmed the controller.
  autoDisarmed: boolean
}

export function isFaultName(value: unknown): value is FaultName {
  return typeof value === 'string' && (FAULT_NAMES as readonly string[]).includes(value)
}

// Faults that short-circuit before any upstream connection is made.
export function isPreStreamFault(fault: FaultName): boolean {
  return fault === 'http-error' || fault === 'connection-reset'
}

export class FaultController {
  private state: ArmState | null = null

  arm(request: ArmRequest): ArmState {
    const count: number = request.count && request.count > 0 ? Math.floor(request.count) : 1
    const scope: FaultScope = request.scope === 'all' ? 'all' : 'chat'
    this.state = {
      fault: request.fault,
      remaining: count,
      params: { ...(request.params ?? {}) },
      scope,
    }
    return this.snapshot() as ArmState
  }

  disarm(): void {
    this.state = null
  }

  snapshot(): ArmState | null {
    if (!this.state) {
      return null
    }
    return { ...this.state, params: { ...this.state.params } }
  }

  // Consumes one matching request. Out-of-scope requests (chat-scoped fault,
  // non-chat request) do not consume the count and return null. Returns the
  // fault to apply otherwise, disarming when the count reaches zero.
  claim(isChat: boolean): ClaimResult | null {
    if (!this.state) {
      return null
    }
    if (this.state.scope === 'chat' && !isChat) {
      return null
    }
    const result: ClaimResult = {
      fault: this.state.fault,
      params: { ...this.state.params },
      autoDisarmed: false,
    }
    this.state.remaining -= 1
    if (this.state.remaining <= 0) {
      this.state = null
      result.autoDisarmed = true
    }
    return result
  }
}
