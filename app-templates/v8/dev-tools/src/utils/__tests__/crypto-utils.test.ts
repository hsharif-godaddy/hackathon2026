import { describe, it, expect, afterEach } from 'vitest';
import { generateUniqueId } from '../crypto-utils';
import { STYLE_REPLY_TIMEOUT_MS } from '../elementStyleListeners';

describe('generateUniqueId', () => {
  let originalCrypto: Crypto;

  afterEach(() => {
    if (originalCrypto !== undefined) {
      Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true });
    }
  });

  it('returns a non-empty string', () => {
    expect(typeof generateUniqueId()).toBe('string');
    expect(generateUniqueId().length).toBeGreaterThan(0);
  });

  it('returns unique values on successive calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateUniqueId()));
    expect(ids.size).toBe(100);
  });

  it('uses crypto.randomUUID when available (UUID v4 format)', () => {
    const id = generateUniqueId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('falls back to time+random when crypto.randomUUID is unavailable', () => {
    originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      value: { ...globalThis.crypto, randomUUID: undefined },
      configurable: true,
    });

    const id = generateUniqueId();
    expect(id).toMatch(/^\d+-[a-z0-9]+$/);
  });

  it('fallback ids are still unique', () => {
    originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      value: { ...globalThis.crypto, randomUUID: undefined },
      configurable: true,
    });

    const ids = new Set(Array.from({ length: 50 }, () => generateUniqueId()));
    expect(ids.size).toBe(50);
  });
});

describe('STYLE_REPLY_TIMEOUT_MS', () => {
  it('is 30 seconds', () => {
    expect(STYLE_REPLY_TIMEOUT_MS).toBe(30_000);
  });
});
