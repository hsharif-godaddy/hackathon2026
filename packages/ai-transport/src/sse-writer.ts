import type { IncomingMessage, ServerResponse } from 'node:http'
import zlib from 'node:zlib'
import Negotiator from 'negotiator'

export type SSEEncoding = 'br' | 'gzip' | 'identity'

export interface SSEWriter {
  readonly encoding: SSEEncoding
  write(text: string): void
  comment(text: string): void
  retry(ms: number): void
  end(): void
  isClosed(): boolean
  /**
   * Approximate bytes currently buffered downstream (compressor + socket).
   * Used by the coalescer to widen its flush window when the client is slow.
   * Returns 0 when the writer is closed.
   */
  getBacklogBytes(): number
}

export interface SSEWriterLogger {
  warn(event: string, data?: Record<string, unknown>): void
}

export interface SSEWriterOptions {
  headers?: Record<string, string>
  logger?: SSEWriterLogger
}

function resolveEncoding(req: Pick<IncomingMessage, 'headers'>): SSEEncoding {
  if (process.env.SSE_COMPRESSION !== 'on') return 'identity'
  const chosen = new Negotiator({ headers: req.headers as Record<string, string> })
    .encoding(['br', 'gzip', 'identity'])
  return (chosen as SSEEncoding) ?? 'identity'
}

export function createSSEWriter(
  req: Pick<IncomingMessage, 'headers'>,
  res: ServerResponse,
  options?: SSEWriterOptions,
): SSEWriter {
  const encoding = resolveEncoding(req)

  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Vary': 'Accept-Encoding',
    ...(options?.headers ?? {}),
  }
  if (encoding !== 'identity') headers['Content-Encoding'] = encoding
  res.writeHead(200, headers)
  res.flushHeaders?.()

  const isClosed = () => res.writableEnded || res.destroyed

  if (encoding === 'identity') {
    // Symmetric with the compressed path: res.write rarely throws synchronously
    // but can in edge states (headers already sent incorrectly, socket torn
    // down mid-write). Swallow + log so call sites never see the throw.
    const write = (text: string) => {
      if (isClosed()) return
      try {
        res.write(text)
      } catch (err) {
        options?.logger?.warn('sse.writer.write_failed', {
          encoding,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return {
      encoding,
      write,
      comment: (text) => write(`: ${text}\n\n`),
      retry: (ms) => write(`retry: ${ms}\n\n`),
      end: () => { if (!res.writableEnded) res.end() },
      isClosed,
      getBacklogBytes: () => isClosed() ? 0 : res.writableLength,
    }
  }

  const stream: zlib.BrotliCompress | zlib.Gzip = encoding === 'br'
    ? zlib.createBrotliCompress({
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
          [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
        },
      })
    : zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED })

  stream.on('error', (err: NodeJS.ErrnoException) => {
    // EPIPE is the expected client-disconnect signal; res close path handles teardown.
    // Surface everything else so zlib allocation failures / internal errors don't vanish.
    if (err.code !== 'EPIPE') {
      options?.logger?.warn('sse.writer.stream_error', { encoding, error: err.message })
    }
  })
  stream.pipe(res)
  res.on('close', () => { if (!stream.destroyed) stream.destroy() })

  // For compressed writers, the stream can be destroyed (e.g. zlib error) while
  // res remains open. Callers treat isClosed === false as "safe to write", so
  // include stream state to prevent silent no-op writes and to let
  // SSESubscriber.isConnected() surface the dead connection for pruning.
  const isClosedCompressed = () => res.writableEnded || res.destroyed || stream.destroyed

  const flushKind = encoding === 'br'
    ? zlib.constants.BROTLI_OPERATION_FLUSH
    : zlib.constants.Z_SYNC_FLUSH

  const write = (text: string) => {
    if (isClosedCompressed()) return
    // stream.write / stream.flush can throw ERR_STREAM_DESTROYED (or similar)
    // if internal state is inconsistent with our destroyed check (e.g. writable
    // ended but not yet destroyed). Swallow so call sites never throw; the
    // 'error' listener above surfaces anything actionable.
    try {
      stream.write(text)
      stream.flush(flushKind)
    } catch (err) {
      options?.logger?.warn('sse.writer.write_failed', {
        encoding,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return {
    encoding,
    write,
    comment: (text) => write(`: ${text}\n\n`),
    retry: (ms) => write(`retry: ${ms}\n\n`),
    end: () => { if (!stream.destroyed && !stream.writableEnded) stream.end() },
    isClosed: isClosedCompressed,
    // Backlog can sit in either the zlib input queue or the socket. Sum both
    // so the coalescer sees the true wall of buffered data.
    getBacklogBytes: () => isClosedCompressed() ? 0 : stream.writableLength + res.writableLength,
  }
}
