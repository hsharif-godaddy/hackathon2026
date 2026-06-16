import { describe, it, expect, vi } from 'vitest';

// Provide a fixed key so the HMAC is deterministic and no env var is required.
vi.mock('../../services/token-crypto.js', () => ({
  getEncryptionKey: () => Buffer.alloc(32, 7),
}));

import { hashWithSalt, UTM_SALT } from '../campaign-utm-signer.js';

describe('campaign-utm-signer', () => {
  it('exposes a non-empty static global salt', () => {
    expect(UTM_SALT.length).toBeGreaterThan(0);
    expect(UTM_SALT).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashWithSalt is deterministic for the same value + salt', () => {
    expect(hashWithSalt('camp_123', UTM_SALT)).toBe(hashWithSalt('camp_123', UTM_SALT));
  });

  it('changing the salt or the value changes the hash', () => {
    const base = hashWithSalt('camp_123', UTM_SALT);
    expect(hashWithSalt('camp_123', 'other-salt')).not.toBe(base);
    expect(hashWithSalt('camp_999', UTM_SALT)).not.toBe(base);
  });

  it('does not leak the raw value', () => {
    expect(hashWithSalt('camp_secret', UTM_SALT)).not.toContain('camp_secret');
  });
});
