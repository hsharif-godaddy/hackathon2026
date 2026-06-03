import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  registerLock,
  unregisterLock,
  _resetForTesting,
} from '../lock-registry.js';

describe('lock-registry', () => {
  const capturedHandlers = new Map<string, (...args: unknown[]) => void>();
  const originalProcessOn = process.on.bind(process);
  const originalProcessExit = process.exit;

  beforeEach(() => {
    _resetForTesting();
    capturedHandlers.clear();
    process.on = vi.fn(((event: string, handler: (...args: unknown[]) => void) => {
      capturedHandlers.set(event, handler);
      return process;
    }) as typeof process.on);
    process.exit = vi.fn() as unknown as typeof process.exit;
  });

  afterEach(() => {
    process.on = originalProcessOn as typeof process.on;
    process.exit = originalProcessExit;
    _resetForTesting();
  });

  it('registers a lock and calls it on SIGINT', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    registerLock(release);

    const handler = capturedHandlers.get('SIGINT');
    expect(handler).toBeDefined();

    handler!();
    // Allow microtasks to flush
    await vi.waitFor(() => {
      expect(process.exit).toHaveBeenCalledWith(130);
    });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('exits with 143 on SIGTERM', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    registerLock(release);

    const handler = capturedHandlers.get('SIGTERM');
    expect(handler).toBeDefined();

    handler!();
    await vi.waitFor(() => {
      expect(process.exit).toHaveBeenCalledWith(143);
    });
  });

  it('calls all registered release functions', async () => {
    const release1 = vi.fn().mockResolvedValue(undefined);
    const release2 = vi.fn().mockResolvedValue(undefined);
    registerLock(release1);
    registerLock(release2);

    capturedHandlers.get('SIGINT')!();
    await vi.waitFor(() => {
      expect(process.exit).toHaveBeenCalled();
    });
    expect(release1).toHaveBeenCalledTimes(1);
    expect(release2).toHaveBeenCalledTimes(1);
  });

  it('tolerates release() rejections and still exits', async () => {
    const failingRelease = vi.fn().mockRejectedValue(new Error('rm failed'));
    const goodRelease = vi.fn().mockResolvedValue(undefined);
    registerLock(failingRelease);
    registerLock(goodRelease);

    capturedHandlers.get('SIGINT')!();
    await vi.waitFor(() => {
      expect(process.exit).toHaveBeenCalledWith(130);
    });
    expect(failingRelease).toHaveBeenCalled();
    expect(goodRelease).toHaveBeenCalled();
  });

  it('does not call releases twice on double signal (set already cleared)', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    registerLock(release);

    const handler = capturedHandlers.get('SIGINT')!;
    handler();
    handler();

    await vi.waitFor(() => {
      expect(process.exit).toHaveBeenCalled();
    });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('unregisterLock prevents the function from being called', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    registerLock(release);
    unregisterLock(release);

    capturedHandlers.get('SIGINT')!();
    await vi.waitFor(() => {
      expect(process.exit).toHaveBeenCalledWith(130);
    });
    expect(release).not.toHaveBeenCalled();
  });

  it('same function registered twice is only called once (Set semantics)', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    registerLock(release);
    registerLock(release);

    capturedHandlers.get('SIGINT')!();
    await vi.waitFor(() => {
      expect(process.exit).toHaveBeenCalled();
    });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('installs signal handlers only once even with multiple registrations', () => {
    const r1 = vi.fn().mockResolvedValue(undefined);
    const r2 = vi.fn().mockResolvedValue(undefined);
    registerLock(r1);
    registerLock(r2);

    const mockOn = process.on as unknown as ReturnType<typeof vi.fn>;
    const sigintCalls = (mockOn.mock.calls as unknown[][]).filter(
      (args) => args[0] === 'SIGINT',
    );
    expect(sigintCalls).toHaveLength(1);
  });
});
