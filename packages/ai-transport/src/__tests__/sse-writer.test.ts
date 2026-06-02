import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import zlib from 'node:zlib'
import { createSSEWriter } from '../sse-writer.js'

// Minimal ServerResponse stand-in. createSSEWriter only needs writeHead + the
// 'close' / 'error' event channel + pipe sink behavior, so a writable Emitter
// with the handful of properties we touch is enough.
function makeMockRes(): any {
  const emitter: any = new EventEmitter()
  emitter.writeHead = vi.fn()
  emitter.flushHeaders = vi.fn()
  emitter.write = vi.fn().mockReturnValue(true)
  emitter.end = vi.fn()
  emitter.writableEnded = false
  emitter.destroyed = false
  // zlib pipes into this; accept data silently.
  emitter.on('pipe', (src: any) => { emitter._src = src })
  return emitter
}

function makeReq(acceptEncoding?: string): any {
  return { headers: acceptEncoding ? { 'accept-encoding': acceptEncoding } : {} }
}

describe('createSSEWriter — identity encoding', () => {
  it('writes through to res.write when Accept-Encoding omits compression', () => {
    const res = makeMockRes()
    const writer = createSSEWriter(makeReq(), res)

    expect(writer.encoding).toBe('identity')
    writer.write('event: x\n\n')
    expect(res.write).toHaveBeenCalledWith('event: x\n\n')
  })

  it('flushes headers immediately when supported by the response', () => {
    const res = makeMockRes()
    createSSEWriter(makeReq(), res)

    expect(res.flushHeaders).toHaveBeenCalledOnce()
  })

  it('swallows synchronous res.write throws and logs sse.writer.write_failed', () => {
    const res = makeMockRes()
    const warn = vi.fn()
    const writer = createSSEWriter(makeReq(), res, { logger: { warn } })
    res.write = vi.fn(function () { throw new Error('socket hang up') })

    expect(() => writer.write('event: x\n\n')).not.toThrow()
    expect(warn).toHaveBeenCalledWith('sse.writer.write_failed', expect.objectContaining({
      encoding: 'identity',
      error: 'socket hang up',
    }))
  })

  it('isClosed reflects res.writableEnded / res.destroyed', () => {
    const res = makeMockRes()
    const writer = createSSEWriter(makeReq(), res)
    expect(writer.isClosed()).toBe(false)

    res.destroyed = true
    expect(writer.isClosed()).toBe(true)
  })

  it('reports res.writableLength as the backlog and 0 once closed', () => {
    const res = makeMockRes()
    res.writableLength = 4096
    const writer = createSSEWriter(makeReq(), res)
    expect(writer.getBacklogBytes()).toBe(4096)

    res.destroyed = true
    expect(writer.getBacklogBytes()).toBe(0)
  })
})

describe('createSSEWriter — compressed encoding (gzip)', () => {
  let originalOff: string | undefined
  beforeEach(() => {
    originalOff = process.env.SSE_COMPRESSION
    process.env.SSE_COMPRESSION = 'on'
  })
  afterEach(() => {
    if (originalOff === undefined) delete process.env.SSE_COMPRESSION
    else process.env.SSE_COMPRESSION = originalOff
  })

  it('selects gzip when Accept-Encoding advertises it, and sets Content-Encoding', () => {
    const res = makeMockRes()
    const writer = createSSEWriter(makeReq('gzip'), res)

    expect(writer.encoding).toBe('gzip')
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Encoding': 'gzip',
    }))
  })

  it('isClosed returns true when the zlib stream is destroyed even if res is alive', () => {
    // This is the novel isClosedCompressed arm — it prevents silent no-op writes
    // after a zlib error while res is still open.
    const res = makeMockRes()
    const writer = createSSEWriter(makeReq('gzip'), res)
    expect(writer.isClosed()).toBe(false)

    // Grab the piped zlib stream from res._src and destroy it.
    const stream = res._src as zlib.Gzip
    stream.destroy()
    expect(writer.isClosed()).toBe(true)
  })

  it("destroys the zlib stream when res emits 'close' so it cannot leak", () => {
    const res = makeMockRes()
    createSSEWriter(makeReq('gzip'), res)
    const stream = res._src as zlib.Gzip
    expect(stream.destroyed).toBe(false)

    res.emit('close')
    expect(stream.destroyed).toBe(true)
  })

  it('does not log EPIPE stream errors (expected client-disconnect signal)', () => {
    const res = makeMockRes()
    const warn = vi.fn()
    createSSEWriter(makeReq('gzip'), res, { logger: { warn } })
    const stream = res._src as zlib.Gzip

    const err: NodeJS.ErrnoException = new Error('write EPIPE')
    err.code = 'EPIPE'
    stream.emit('error', err)

    expect(warn).not.toHaveBeenCalled()
  })

  it('logs non-EPIPE stream errors via the injected logger', () => {
    const res = makeMockRes()
    const warn = vi.fn()
    createSSEWriter(makeReq('gzip'), res, { logger: { warn } })
    const stream = res._src as zlib.Gzip

    const err: NodeJS.ErrnoException = new Error('zlib internal error')
    err.code = 'ERR_ZLIB_BINDING_CLOSED'
    stream.emit('error', err)

    expect(warn).toHaveBeenCalledWith('sse.writer.stream_error', expect.objectContaining({
      encoding: 'gzip',
      error: 'zlib internal error',
    }))
  })

  it('reports backlog as compressor + socket buffered bytes, and 0 once closed', () => {
    const res = makeMockRes()
    res.writableLength = 1024
    const writer = createSSEWriter(makeReq('gzip'), res)
    const stream = res._src as zlib.Gzip
    Object.defineProperty(stream, 'writableLength', { value: 2048, configurable: true })

    expect(writer.getBacklogBytes()).toBe(3072)

    stream.destroy()
    expect(writer.getBacklogBytes()).toBe(0)
  })

  it('swallows synchronous stream.write throws and logs sse.writer.write_failed', () => {
    // Between isClosedCompressed() and stream.write(), stream state can drift
    // (e.g. writable ended). If stream.write throws synchronously, the
    // contract is that write() must NOT escape to call sites — otherwise
    // asyncHandler catches it after SSE headers are already sent and the
    // client hangs. This test guarantees the swallow + log path.
    const res = makeMockRes()
    const warn = vi.fn()
    const writer = createSSEWriter(makeReq('gzip'), res, { logger: { warn } })
    const stream = res._src as zlib.Gzip
    stream.write = vi.fn(function () { throw new Error('ERR_STREAM_DESTROYED') }) as any

    expect(() => writer.write('event: x\n\n')).not.toThrow()
    expect(warn).toHaveBeenCalledWith('sse.writer.write_failed', expect.objectContaining({
      encoding: 'gzip',
      error: 'ERR_STREAM_DESTROYED',
    }))
  })
})

describe('createSSEWriter — compressed encoding (br)', () => {
  // Brotli is a separate branch from gzip: different createBrotliCompress +
  // BROTLI_OPERATION_FLUSH constant. Mirror the gzip suite so a regression
  // to the flush constant (which would silently buffer events instead of
  // streaming them per-write) is caught.
  let originalOff: string | undefined
  beforeEach(() => {
    originalOff = process.env.SSE_COMPRESSION
    process.env.SSE_COMPRESSION = 'on'
  })
  afterEach(() => {
    if (originalOff === undefined) delete process.env.SSE_COMPRESSION
    else process.env.SSE_COMPRESSION = originalOff
  })

  it('selects brotli when Accept-Encoding advertises it, and sets Content-Encoding', () => {
    const res = makeMockRes()
    const writer = createSSEWriter(makeReq('br'), res)

    expect(writer.encoding).toBe('br')
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Encoding': 'br',
    }))
  })

  it('isClosed returns true when the brotli stream is destroyed even if res is alive', () => {
    const res = makeMockRes()
    const writer = createSSEWriter(makeReq('br'), res)
    expect(writer.isClosed()).toBe(false)

    const stream = res._src as zlib.BrotliCompress
    stream.destroy()
    expect(writer.isClosed()).toBe(true)
  })

  it("destroys the brotli stream when res emits 'close' so it cannot leak", () => {
    const res = makeMockRes()
    createSSEWriter(makeReq('br'), res)
    const stream = res._src as zlib.BrotliCompress
    expect(stream.destroyed).toBe(false)

    res.emit('close')
    expect(stream.destroyed).toBe(true)
  })

  it('swallows synchronous stream.write throws on the brotli path', () => {
    const res = makeMockRes()
    const warn = vi.fn()
    const writer = createSSEWriter(makeReq('br'), res, { logger: { warn } })
    const stream = res._src as zlib.BrotliCompress
    stream.write = vi.fn(function () { throw new Error('ERR_STREAM_DESTROYED') }) as any

    expect(() => writer.write('event: x\n\n')).not.toThrow()
    expect(warn).toHaveBeenCalledWith('sse.writer.write_failed', expect.objectContaining({
      encoding: 'br',
      error: 'ERR_STREAM_DESTROYED',
    }))
  })
})

describe('createSSEWriter — compression defaults', () => {
  it('defaults to identity even when Accept-Encoding advertises br/gzip', () => {
    const original = process.env.SSE_COMPRESSION
    delete process.env.SSE_COMPRESSION
    try {
      const res = makeMockRes()
      const writer = createSSEWriter(makeReq('gzip, br'), res)
      expect(writer.encoding).toBe('identity')
    } finally {
      if (original === undefined) delete process.env.SSE_COMPRESSION
      else process.env.SSE_COMPRESSION = original
    }
  })

  it('forces identity when SSE_COMPRESSION=off', () => {
    const original = process.env.SSE_COMPRESSION
    process.env.SSE_COMPRESSION = 'off'
    try {
      const res = makeMockRes()
      const writer = createSSEWriter(makeReq('gzip, br'), res)
      expect(writer.encoding).toBe('identity')
    } finally {
      if (original === undefined) delete process.env.SSE_COMPRESSION
      else process.env.SSE_COMPRESSION = original
    }
  })
})
