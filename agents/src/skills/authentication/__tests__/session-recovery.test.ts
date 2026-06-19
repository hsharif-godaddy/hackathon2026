import { describe, expect, it, vi } from 'vitest';

import {
  SESSION_RECOVERY_STORAGE_KEY,
  SESSION_RECOVERY_URL,
  claimSessionRecovery,
  clearSessionRecovery,
} from '../templates/lib/auth/session-recovery';

/** Minimal in-memory stand-in for the `sessionStorage`-like interface. */
function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    has: (key: string) => store.has(key),
  };
}

describe('claimSessionRecovery', () => {
  it('recovers once, then refuses on the next call (no reload loop)', () => {
    const storage = fakeStorage();

    expect(claimSessionRecovery(storage)).toBe(true);
    expect(storage.has(SESSION_RECOVERY_STORAGE_KEY)).toBe(true);
    expect(claimSessionRecovery(storage)).toBe(false);
  });

  it('fails closed when reading storage throws', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('sessionStorage blocked');
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    expect(claimSessionRecovery(storage)).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('fails closed when writing storage throws', () => {
    const storage = {
      getItem: () => null,
      setItem: vi.fn(() => {
        throw new Error('quota exceeded');
      }),
      removeItem: vi.fn(),
    };

    expect(claimSessionRecovery(storage)).toBe(false);
  });
});

describe('clearSessionRecovery', () => {
  it('resets the guard so a later genuine failure can recover again', () => {
    const storage = fakeStorage();

    expect(claimSessionRecovery(storage)).toBe(true);
    expect(claimSessionRecovery(storage)).toBe(false);

    clearSessionRecovery(storage);

    expect(claimSessionRecovery(storage)).toBe(true);
  });

  it('never throws when storage is unavailable', () => {
    const storage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: vi.fn(() => {
        throw new Error('blocked');
      }),
    };

    expect(() => clearSessionRecovery(storage)).not.toThrow();
  });
});

describe('SESSION_RECOVERY_URL', () => {
  it('targets the server clear-cookies escape hatch', () => {
    expect(SESSION_RECOVERY_URL).toContain('clearCookies=1');
  });
});
