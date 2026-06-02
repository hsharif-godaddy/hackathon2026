import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/apm-context', () => ({
  getApmTraceIds: () => ({}),
}));

vi.mock('@/lib/logging/client-log-buffer', () => ({
  ClientLogBuffer: { add: vi.fn(), getSessionId: vi.fn(function () { return 'test-session'; }) },
}));

import { logger, RequestContextService } from './request-context';

describe('createLogEvent context injection', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Force the production JSON log path — isDevelopment() must return false so
    // output is JSON.stringify'd and parseable. Without this, NODE_ENV=development
    // routes through prettyServerOutput (ANSI strings) and JSON.parse throws.
    vi.stubEnv('NODE_ENV', 'test');
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(function () {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('injects customerId from active request context into log output', () => {
    RequestContextService.run({ customerId: 'cid-xyz', method: 'GET', path: '/api/test' }, () => {
      logger.info('test.event', { message: 'hello' });
    });

    expect(consoleSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output.customerId).toBe('cid-xyz');
    expect(output.event).toBe('test.event');
  });

  it('injects shopperId, path, and method from active context', () => {
    RequestContextService.run({ shopperId: 'sh-abc', path: '/api/sites', method: 'POST' }, () => {
      logger.info('test.event', {});
    });

    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output.shopperId).toBe('sh-abc');
    expect(output.path).toBe('/api/sites');
    expect(output.method).toBe('POST');
  });

  it('omits context fields when no context is active', () => {
    logger.info('test.event', { message: 'no context' });

    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output).not.toHaveProperty('customerId');
    expect(output).not.toHaveProperty('shopperId');
    expect(output).not.toHaveProperty('path');
  });

  it('injects appId and userAgent from active context', () => {
    RequestContextService.run({ appId: 'app-abc', userAgent: 'TestAgent/1.0' }, () => {
      logger.info('test.event', {});
    });

    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output.appId).toBe('app-abc');
    expect(output.userAgent).toBe('TestAgent/1.0');
  });

  it('omits customerId field when context exists but customerId is undefined', () => {
    RequestContextService.run({ method: 'GET', path: '/api/test' }, () => {
      logger.info('test.event', {});
    });

    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output).not.toHaveProperty('customerId');
    expect(output.method).toBe('GET');
  });
});
