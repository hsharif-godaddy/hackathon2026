/**
 * Module-level registry of active lock release functions.
 * Installs SIGINT/SIGTERM handlers (once) to release all held locks
 * before process exit.
 */

const activeLocks = new Set<() => Promise<void>>();
let installed = false;

const SIGNAL_RELEASE_TIMEOUT_MS = 3000;

function handleSignal(signal: 'SIGINT' | 'SIGTERM'): void {
  const code = signal === 'SIGINT' ? 130 : 143;
  const locks = [...activeLocks];
  activeLocks.clear();

  const timeout = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, SIGNAL_RELEASE_TIMEOUT_MS);
    timer.unref();
  });

  void Promise.race([
    Promise.allSettled(locks.map((fn) => fn())),
    timeout,
  ]).finally(() => process.exit(code));
}

function ensureSignalHandlers(): void {
  if (installed) return;
  installed = true;

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
}

export function registerLock(release: () => Promise<void>): void {
  activeLocks.add(release);
  ensureSignalHandlers();
}

export function unregisterLock(release: () => Promise<void>): void {
  activeLocks.delete(release);
}

export function _resetForTesting(): void {
  activeLocks.clear();
  installed = false;
}
