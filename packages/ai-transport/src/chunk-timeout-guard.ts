export const DEFAULT_CHUNK_TIMEOUT_MS = 180_000
export const CHUNK_GAP_WARNING_THRESHOLDS_MS = [
  120_000, 150_000,
]

interface ChunkTimeoutLogger {
  warn: (event: string, data?: unknown) => void
}

export interface ChunkTimeoutDeps {
  abortController: AbortController
  logger: ChunkTimeoutLogger
  socketId: string
  agentName: string
  modelName: string
}

export class ChunkTimeoutGuard {
  private readonly deps: ChunkTimeoutDeps
  private readonly timeoutMs: number
  private timerId: ReturnType<typeof setTimeout> | null = null
  private warningTimerIds: Array<ReturnType<typeof setTimeout>> = []

  constructor(
    deps: ChunkTimeoutDeps,
    timeoutMs = DEFAULT_CHUNK_TIMEOUT_MS
  ) {
    this.deps = deps
    this.timeoutMs = timeoutMs
  }

  arm(): void {
    if (this.deps.abortController.signal.aborted) return
    this.schedule()
    this.deps.abortController.signal.addEventListener(
      'abort',
      () => this.clearTimers(),
      { once: true }
    )
  }

  reset(): void {
    this.clearTimers()
    if (this.deps.abortController.signal.aborted) return
    this.schedule()
  }

  pause(): void {
    this.clearTimers()
  }

  dispose(): void {
    this.clearTimers()
  }

  private clearTimers(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId)
      this.timerId = null
    }
    for (const id of this.warningTimerIds) {
      clearTimeout(id)
    }
    this.warningTimerIds = []
  }

  private schedule(): void {
    const {
      abortController, logger, socketId, agentName, modelName,
    } = this.deps
    this.timerId = setTimeout(() => {
      this.timerId = null
      if (abortController.signal.aborted) return
      logger.warn('stream.chunk.timeout.transport', {
        socketId,
        agentName,
        modelName,
        timeoutMs: this.timeoutMs,
      })
      abortController.abort('chunk_timeout')
    }, this.timeoutMs)
    this.scheduleWarnings()
  }

  private scheduleWarnings(): void {
    const {
      abortController, logger, socketId, agentName, modelName,
    } = this.deps
    for (const thresholdMs of CHUNK_GAP_WARNING_THRESHOLDS_MS) {
      if (thresholdMs >= this.timeoutMs) continue
      const id = setTimeout(() => {
        if (abortController.signal.aborted) return
        logger.warn('stream.chunk.gap_warning', {
          socketId,
          agentName,
          modelName,
          elapsedMs: thresholdMs,
          timeoutMs: this.timeoutMs,
        })
      }, thresholdMs)
      this.warningTimerIds.push(id)
    }
  }
}
