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
  cleanup(): void
}

interface PendingRequest {
  resolve: (result: ClientActionResult) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

const DEFAULT_TIMEOUT_MS = 30_000

export class ClientActionRegistry implements ClientActionHandler {
  private pending = new Map<string, PendingRequest>()

  constructor(private sendRequest: (request: ClientActionRequest) => void) {}

  executeAction(request: ClientActionRequest): Promise<ClientActionResult> {
    const requestId = request.requestId ?? randomUUID()
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS

    if (this.pending.has(requestId)) {
      return Promise.reject(new Error(`Duplicate requestId: ${requestId}`))
    }

    return new Promise<ClientActionResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`Client action timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.pending.set(requestId, { resolve, reject, timeout })

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

  cleanup(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timeout)
      entry.reject(new Error('Client action registry cleanup'))
    }
    this.pending.clear()
  }
}
