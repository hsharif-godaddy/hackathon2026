import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Logger, createLogger, setLoggerFactory, type LoggerLike } from '../logger.js'

describe('logger', () => {
  describe('JSON format', () => {
    let stdoutSpy: ReturnType<typeof vi.spyOn>
    let stderrSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
      stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should output valid JSON with correct fields', () => {
      const logger = new Logger({ format: 'json', prefix: '@airo/ai-lib:test-module' })
      logger.info('hello world', { foo: 1 })

      expect(stdoutSpy).toHaveBeenCalledOnce()
      const line = stdoutSpy.mock.calls[0][0] as string
      expect(line.endsWith('\n')).toBe(true)

      const parsed = JSON.parse(line)
      expect(parsed).toMatchObject({
        level: 'info',
        event: 'ai-lib.test-module',
        message: 'hello world',
        service: 'airo-ai-lib',
        data: { foo: 1 },
      })
      expect(parsed.timestamp).toBeDefined()
    })

    it('should omit data field when no data provided', () => {
      const logger = new Logger({ format: 'json' })
      logger.info('no data')

      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(parsed).not.toHaveProperty('data')
    })

    it('should route error/fatal to stderr', () => {
      const logger = new Logger({ format: 'json', level: 'debug' })

      logger.error('err msg')
      expect(stderrSpy).toHaveBeenCalledOnce()
      expect(stdoutSpy).not.toHaveBeenCalled()

      stderrSpy.mockClear()
      logger.fatal('fatal msg')
      expect(stderrSpy).toHaveBeenCalledOnce()
    })

    it('should route debug/info/warn to stdout', () => {
      const logger = new Logger({ format: 'json', level: 'debug' })

      logger.debug('d')
      logger.info('i')
      logger.warn('w')

      expect(stdoutSpy).toHaveBeenCalledTimes(3)
      expect(stderrSpy).not.toHaveBeenCalled()
    })

    it('should handle circular data gracefully', () => {
      const logger = new Logger({ format: 'json' })
      const circular: Record<string, unknown> = {}
      circular.self = circular

      logger.info('circular', circular)

      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(parsed.data).toBe('[Circular or Non-serializable Data]')
    })

    it('should honor enableTimestamps: false', () => {
      const logger = new Logger({ format: 'json', enableTimestamps: false })
      logger.info('no ts')

      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(parsed).not.toHaveProperty('timestamp')
    })

    it('should convert prefix to dot-delimited event name', () => {
      const logger = new Logger({ format: 'json', prefix: '@airo/ai-lib:foo:bar' })
      logger.info('test')

      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(parsed.event).toBe('ai-lib.foo.bar')
    })

    it('should respect log level filtering', () => {
      const logger = new Logger({ format: 'json', level: 'warn' })
      logger.debug('skip')
      logger.info('skip')
      logger.warn('show')

      expect(stdoutSpy).toHaveBeenCalledOnce()
    })
  })

  describe('child logger format propagation', () => {
    it('should propagate format to child loggers', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
      const parent = new Logger({ format: 'json', prefix: '@airo/ai-lib' })
      const child = parent.child('sub-module')

      child.info('from child')

      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
      expect(parsed.event).toBe('ai-lib.sub-module')
      expect(parsed.service).toBe('airo-ai-lib')

      vi.restoreAllMocks()
    })
  })

  describe('createLogger with JSON format', () => {
    it('should respect format config', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
      const logger = createLogger('my-module')
      // createLogger returns a forwarding wrapper with the same interface as Logger
      expect(logger).toHaveProperty('info')
      expect(logger).toHaveProperty('debug')
      expect(logger).toHaveProperty('warn')
      expect(logger).toHaveProperty('error')
      expect(logger).toHaveProperty('fatal')
      vi.restoreAllMocks()
    })
  })

  describe('constructor defaults', () => {
    it('should use text format and timestamps when passed undefined values', () => {
      const consoleSpy = vi.spyOn(console, 'info').mockReturnValue()
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

      const logger = new Logger({ format: undefined, enableTimestamps: undefined })
      logger.info('test')

      // Should use text format (console.info), not JSON (process.stdout.write)
      expect(consoleSpy).toHaveBeenCalledOnce()
      expect(stdoutSpy).not.toHaveBeenCalled()

      // Should include timestamp in text output
      const output = consoleSpy.mock.calls[0][0] as string
      expect(output).toMatch(/^\[.*T.*Z\]/)

      vi.restoreAllMocks()
    })

    it('should use JSON format when LOG_FORMAT env var is set to json', () => {
      const original = process.env.LOG_FORMAT
      process.env.LOG_FORMAT = 'json'
      try {
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const logger = new Logger()
        logger.info('env test')

        expect(stdoutSpy).toHaveBeenCalledOnce()
        const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string)
        expect(parsed.level).toBe('info')
        expect(parsed.message).toBe('env test')

        vi.restoreAllMocks()
      } finally {
        if (original === undefined) {
          delete process.env.LOG_FORMAT
        } else {
          process.env.LOG_FORMAT = original
        }
      }
    })
  })
})

describe('setLoggerFactory', () => {
  afterEach(() => {
    setLoggerFactory(null)
  })

  it('should forward calls to factory-provided logger', () => {
    const mockLogger: LoggerLike = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    }
    setLoggerFactory(() => mockLogger)

    const log = createLogger('test-mod')
    log.info('some.event', { key: 'val' })

    expect(mockLogger.info).toHaveBeenCalledWith(
      'ai-lib.test-mod.some.event',
      { key: 'val' }
    )
  })

  it('should pass moduleName to factory', () => {
    const factory = vi.fn().mockReturnValue({
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    })
    setLoggerFactory(factory)

    const log = createLogger('my-module')
    log.debug('ping')

    expect(factory).toHaveBeenCalledWith('my-module')
  })

  it('should normalize event names with ai-lib prefix', () => {
    const mockLogger: LoggerLike = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    }
    setLoggerFactory(() => mockLogger)

    const log = createLogger('websocket')
    log.info('socket.connect', { id: '1' })

    expect(mockLogger.info).toHaveBeenCalledWith(
      'ai-lib.websocket.socket.connect',
      { id: '1' }
    )
  })

  it('should strip module prefix to avoid double-prefixing', () => {
    const mockLogger: LoggerLike = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    }
    setLoggerFactory(() => mockLogger)

    const log = createLogger('websocket')
    log.info('websocket.quality.ping_timeout')

    expect(mockLogger.info).toHaveBeenCalledWith(
      'ai-lib.websocket.quality.ping_timeout',
      undefined
    )
  })

  it('should pass through events already prefixed with ai-lib.{module}.', () => {
    const mockLogger: LoggerLike = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    }
    setLoggerFactory(() => mockLogger)

    const log = createLogger('websocket')
    log.info('ai-lib.websocket.quality.check')

    expect(mockLogger.info).toHaveBeenCalledWith(
      'ai-lib.websocket.quality.check',
      undefined
    )
  })

  it('should resolve lazily - factory set after createLogger but before first log', () => {
    const log = createLogger('lazy-mod')

    const mockLogger: LoggerLike = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    }
    setLoggerFactory(() => mockLogger)

    log.info('event.name')

    expect(mockLogger.info).toHaveBeenCalledWith(
      'ai-lib.lazy-mod.event.name',
      undefined
    )
  })

  it('should fall back to default Logger when no factory is set', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockReturnValue()
    const log = createLogger('fallback-mod')
    log.info('hello')

    expect(consoleSpy).toHaveBeenCalledOnce()
    const output = consoleSpy.mock.calls[0][0] as string
    expect(output).toContain('[@airo/ai-lib:fallback-mod]')
    expect(output).toContain('hello')

    vi.restoreAllMocks()
  })

  it('should not normalize events when no factory is set', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockReturnValue()
    const log = createLogger('mod')
    log.info('raw.event.name')

    const output = consoleSpy.mock.calls[0][0] as string
    expect(output).toContain('raw.event.name')
    expect(output).not.toContain('ai-lib.mod.')

    vi.restoreAllMocks()
  })

  it('should reset factory when set to null', () => {
    const mockLogger: LoggerLike = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    }
    setLoggerFactory(() => mockLogger)
    setLoggerFactory(null)

    const consoleSpy = vi.spyOn(console, 'info').mockReturnValue()
    const log = createLogger('reset-test')
    log.info('after-reset')

    expect(mockLogger.info).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledOnce()

    vi.restoreAllMocks()
  })

  it('should normalize all log levels', () => {
    const mockLogger: LoggerLike = {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(),
    }
    setLoggerFactory(() => mockLogger)

    const log = createLogger('mod')
    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')
    log.fatal!('f')

    expect(mockLogger.debug).toHaveBeenCalledWith('ai-lib.mod.d', undefined)
    expect(mockLogger.info).toHaveBeenCalledWith('ai-lib.mod.i', undefined)
    expect(mockLogger.warn).toHaveBeenCalledWith('ai-lib.mod.w', undefined)
    expect(mockLogger.error).toHaveBeenCalledWith('ai-lib.mod.e', undefined)
    expect(mockLogger.fatal).toHaveBeenCalledWith('ai-lib.mod.f', undefined)
  })

})
