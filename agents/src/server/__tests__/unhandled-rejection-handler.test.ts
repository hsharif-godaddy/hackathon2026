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
      expect.any(Object)
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
      expect.any(Object)
    );
  });

  it('DOES call shutdown for null/undefined reasons', () => {
    const deps = makeDeps();

    handleUnhandledRejection(undefined, Promise.resolve(), deps);

    expect(deps.shutdown).toHaveBeenCalledOnce();
    expect(deps.shutdown).toHaveBeenCalledWith('unhandledRejection');
  });
});
