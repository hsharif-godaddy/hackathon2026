import { describe, it, expect, vi } from 'vitest';

import { handleUnhandledRejection } from '../unhandled-rejection-handler.js';

function makeDeps() {
  return {
    logger: { warn: vi.fn(), error: vi.fn() },
    shutdown: vi.fn(),
  };
}

describe('handleUnhandledRejection', () => {
  it('does NOT call shutdown for AbortError by name', () => {
    const deps = makeDeps();
    const err = new Error('aborted');
    err.name = 'AbortError';

    handleUnhandledRejection(err, Promise.reject(err).catch(() => {}), deps);

    expect(deps.shutdown).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      'server.unhandled.rejection.abort',
      expect.objectContaining({ name: 'AbortError', stack: err.stack })
    );
  });

  it('does NOT call shutdown for errors with code=ABORT_ERR', () => {
    const deps = makeDeps();
    const err = Object.assign(new Error('aborted'), { code: 'ABORT_ERR' });

    handleUnhandledRejection(err, Promise.reject(err).catch(() => {}), deps);

    expect(deps.shutdown).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it('DOES call shutdown for a plain Error', () => {
    const deps = makeDeps();
    const err = new Error('boom');

    handleUnhandledRejection(err, Promise.reject(err).catch(() => {}), deps);

    expect(deps.shutdown).toHaveBeenCalledOnce();
    expect(deps.shutdown).toHaveBeenCalledWith('unhandledRejection');
    expect(deps.logger.error).toHaveBeenCalledWith(
      'server.unhandled.rejection',
      expect.objectContaining({
        reason: 'Error: boom',
        name: 'Error',
        stack: err.stack,
        promise: expect.any(String),
      })
    );
  });

  it('logs stack, system code, and nested cause for root-cause triage', () => {
    const deps = makeDeps();
    const cause = Object.assign(new Error('connect timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' });
    const err = Object.assign(new Error('fetch failed'), { code: 'ECONNRESET', cause });

    handleUnhandledRejection(err, Promise.reject(err).catch(() => {}), deps);

    expect(deps.logger.error).toHaveBeenCalledWith(
      'server.unhandled.rejection',
      expect.objectContaining({
        stack: err.stack,
        code: 'ECONNRESET',
        cause: expect.stringContaining('connect timeout'),
        causeCode: 'UND_ERR_CONNECT_TIMEOUT',
      })
    );
  });

  it('DOES call shutdown for null/undefined reasons', () => {
    const deps = makeDeps();

    handleUnhandledRejection(undefined, Promise.resolve(), deps);

    expect(deps.shutdown).toHaveBeenCalledOnce();
    expect(deps.shutdown).toHaveBeenCalledWith('unhandledRejection');
  });
});
