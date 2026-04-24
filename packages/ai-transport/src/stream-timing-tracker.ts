export interface StreamTimingData {
  timeToFirstTextChunkMs: number | null
  maxChunkGapMs: number
  chunksRead: number
  streamDurationMs: number
}

export const SLOW_CHUNK_GAP_THRESHOLD_MS = 90_000

interface StreamSocket {
  id: string
  emit: (event: string, data: unknown) => void
}

interface StreamTimingLogger {
  warn: (event: string, data?: unknown) => void
}

export interface StreamTimingDeps {
  socket: StreamSocket
  agentName: string
  modelName: string
  logger: StreamTimingLogger
  abortController?: { signal: { aborted: boolean } }
}

export class StreamTimingTracker {
  private readonly startTime: number
  private lastChunkTime: number | null = null
  private _chunksRead = 0
  private maxChunkGapMs = 0
  private timeToFirstTextChunkMs: number | null = null
  private _textChunkRecorded = false
  private readonly deps: StreamTimingDeps
  private pauseStartTime: number | null = null
  private pausedToolName: string | undefined

  constructor(deps: StreamTimingDeps) {
    this.deps = deps
    this.startTime = Date.now()
  }

  get chunksRead(): number {
    return this._chunksRead
  }

  get streamElapsedMs(): number {
    return Date.now() - this.startTime
  }

  recordChunk(): void {
    this._chunksRead++
    const chunkArrivalTime = Date.now()
    const { socket, agentName, modelName, logger } = this.deps

    if (this.lastChunkTime === null) {
      this.lastChunkTime = chunkArrivalTime
      return
    }

    const gapMs = chunkArrivalTime - this.lastChunkTime
    if (gapMs > this.maxChunkGapMs) {
      this.maxChunkGapMs = gapMs
    }
    if (gapMs > SLOW_CHUNK_GAP_THRESHOLD_MS) {
      const slowGapData = {
        socketId: socket.id,
        agentName,
        modelName,
        gapMs,
        chunksRead: this._chunksRead,
        streamElapsedMs: chunkArrivalTime - this.startTime,
      }
      logger.warn('stream.chunk.slow_gap', slowGapData)
      if (process.env.SOCKET_DIAGNOSTICS === 'true') {
        socket.emit('stream.chunk.slow_gap', slowGapData)
      }
    }
    this.lastChunkTime = chunkArrivalTime
  }

  recordTextChunk(): void {
    if (this._textChunkRecorded) return
    this._textChunkRecorded = true
    this.timeToFirstTextChunkMs = Date.now() - this.startTime
  }

  pauseGapTracking(toolName?: string): void {
    this.lastChunkTime = null
    this.pauseStartTime = Date.now()
    this.pausedToolName = toolName
  }

  resumeGapTracking(): void {
    if (this.pauseStartTime !== null) {
      const toolDurationMs = Date.now() - this.pauseStartTime
      if (toolDurationMs >= SLOW_CHUNK_GAP_THRESHOLD_MS) {
        const {
          socket, agentName, modelName, logger,
        } = this.deps
        logger.warn('stream.tool.slow_execution', {
          socketId: socket.id,
          agentName,
          modelName,
          toolName: this.pausedToolName,
          toolDurationMs,
        })
      }
      this.pauseStartTime = null
      this.pausedToolName = undefined
    }
    this.lastChunkTime = Date.now()
  }

  recordTimeout(errorMessage: string): void {
    const { socket, agentName, modelName, logger } = this.deps
    const timeoutData = {
      socketId: socket.id,
      agentName,
      modelName,
      error: errorMessage,
      chunksRead: this._chunksRead,
      streamElapsedMs: Date.now() - this.startTime,
      timeToFirstTextChunkMs: this.timeToFirstTextChunkMs,
      maxChunkGapMs: this.maxChunkGapMs,
    }
    logger.warn('stream.chunk.timeout', timeoutData)
    if (process.env.SOCKET_DIAGNOSTICS === 'true') {
      socket.emit('stream.chunk.timeout', timeoutData)
    }
  }

  finalize(): StreamTimingData {
    return {
      timeToFirstTextChunkMs: this.timeToFirstTextChunkMs,
      maxChunkGapMs: this.maxChunkGapMs,
      chunksRead: this._chunksRead,
      streamDurationMs: Date.now() - this.startTime,
    }
  }
}
