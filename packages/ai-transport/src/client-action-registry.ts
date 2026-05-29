import { randomUUID } from 'node:crypto'

export interface ClientActionRequest {
  requestId?: string
  action: string
  params: Record<string, unknown>
  timeoutMs?: number
}

export interface ClientActionResult {
  success: boolean
  result?: unknown
  error?: string
  errorDetails?: string
  logs?: Array<{ message: string; source?: string; timestamp?: string }>
  exitCode?: number
}

export interface ClientActionHandler {
  executeAction(request: ClientActionRequest): Promise<ClientActionResult>
  resolveAction(requestId: string, result: ClientActionResult): boolean
  resetTimeout(requestId: string, newTimeoutMs?: number): boolean
  getPendingRequestIds(): string[]
  cleanup(): void
}

export interface ClientActionRegistryOptions {
  onTimeout?: (requestId: string, timeoutMs: number) => void
}

interface PendingRequest {
  resolve: (result: ClientActionResult) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
  timeoutMs: number
}

const DEFAULT_TIMEOUT_MS = 30_000

export class ClientActionRegistry implements ClientActionHandler {
  private pending = new Map<string, PendingRequest>()
  private onTimeout: ((requestId: string, timeoutMs: number) => void) | undefined

  constructor(
    private sendRequest: (request: ClientActionRequest) => void,
    options?: ClientActionRegistryOptions,
  ) {
    this.onTimeout = options?.onTimeout
  }

  executeAction(request: ClientActionRequest): Promise<ClientActionResult> {
    const requestId = request.requestId ?? randomUUID()
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS

    if (this.pending.has(requestId)) {
      return Promise.reject(new Error(`Duplicate requestId: ${requestId}`))
    }

    return new Promise<ClientActionResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        this.onTimeout?.(requestId, timeoutMs)
        reject(new Error(`Client action timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.pending.set(requestId, { resolve, reject, timeout, timeoutMs })

      try {
        this.sendRequest({ ...request, requestId })
      } catch (error) {
        clearTimeout(timeout)
        this.pending.delete(requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  resolveAction(requestId: string, result: ClientActionResult): boolean {
    const entry = this.pending.get(requestId)
    if (!entry) return false

    clearTimeout(entry.timeout)
    this.pending.delete(requestId)
    entry.resolve(result)
    return true
  }

  /** Reset the timeout for a pending action (e.g. after SSE reconnect replays the event).
   *  Falls back to the original per-request timeoutMs if newTimeoutMs is not provided. */
  resetTimeout(requestId: string, newTimeoutMs?: number): boolean {
    const entry = this.pending.get(requestId)
    if (!entry) return false

    clearTimeout(entry.timeout)
    const timeoutMs = newTimeoutMs ?? entry.timeoutMs
    entry.timeout = setTimeout(() => {
      this.pending.delete(requestId)
      this.onTimeout?.(requestId, timeoutMs)
      entry.reject(new Error(`Client action timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    return true
  }

  getPendingRequestIds(): string[] {
    return [...this.pending.keys()]
  }

  cleanup(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timeout)
      entry.reject(new Error('Client action registry cleanup'))
    }
    this.pending.clear()
  }
}
