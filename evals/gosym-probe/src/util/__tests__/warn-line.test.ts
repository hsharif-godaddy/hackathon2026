import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { warnLine } from '../warn-line.js';

describe('warnLine — core behavior (TTY)', () => {
  beforeEach(() => {
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes \\r\\x1B[K to stderr before console.warn when isTTY is true', () => {
    const stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(function () { return undefined; });

    warnLine('retry attempt 1');

    expect(stderrWriteSpy).toHaveBeenCalledWith('\r\x1B[K');
    expect(consoleWarnSpy).toHaveBeenCalledWith('retry attempt 1');
    expect(stderrWriteSpy.mock.invocationCallOrder[0]).toBeLessThan(
      consoleWarnSpy.mock.invocationCallOrder[0],
    );
  });

  it('calls console.warn(message, data) when data is provided', () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(function () { return undefined; });
    const data = { attempt: 1, waitMs: 30_000 };

    warnLine('retrying after rate limit', data);

    expect(consoleWarnSpy).toHaveBeenCalledWith('retrying after rate limit', data);
  });

  it('calls console.warn(message) without trailing undefined when data is omitted', () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(function () { return undefined; });

    warnLine('exhausted retries');

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).toHaveBeenCalledWith('exhausted retries');
    expect(consoleWarnSpy.mock.calls[0]).toHaveLength(1);
  });
});

describe('warnLine — non-TTY fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips \\r\\x1B[K when isTTY is false', () => {
    Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });
    const stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(function () { return undefined; });

    warnLine('ci warning');

    expect(stderrWriteSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith('ci warning');
  });

  it('skips \\r\\x1B[K when isTTY is undefined', () => {
    Object.defineProperty(process.stderr, 'isTTY', { value: undefined, configurable: true });
    const stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(function () { return undefined; });

    warnLine('piped warning');

    expect(stderrWriteSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith('piped warning');
  });
});

describe('warnLine — error resilience', () => {
  beforeEach(() => {
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not throw if process.stderr.write throws', () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(function () {
      throw new Error('broken pipe');
    });
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(function () { return undefined; });

    expect(() => warnLine('after broken pipe')).not.toThrow();
    expect(consoleWarnSpy).toHaveBeenCalledWith('after broken pipe');
  });
});
