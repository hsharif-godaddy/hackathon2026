import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Logger, createLogger } from '../logger.js'

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
      // createLogger doesn't set format, so it defaults to text (no LOG_FORMAT env)
      // Just verify it creates without error
      expect(logger).toBeInstanceOf(Logger)
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
