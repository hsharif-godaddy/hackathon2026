import { describe, it, expect, vi } from 'vitest';

// Provide a fixed key so the HMAC is deterministic and no env var is required.
vi.mock('../../services/token-crypto.js', () => ({
  getEncryptionKey: () => Buffer.alloc(32, 7),
}));

import {
  hashWithSalt,
  UTM_SALT,
  buildCampaignToken,
  buildContentToken,
  UTM_CAMPAIGN_PREFIX,
  UTM_CONTENT_PREFIX,
} from '../campaign-utm-signer.js';

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

  it('buildCampaignToken prefixes the hash with cmp_ and never leaks the raw id', () => {
    const token: string = buildCampaignToken('camp_abc123');
    expect(token.startsWith(UTM_CAMPAIGN_PREFIX)).toBe(true);
    expect(token).toBe(`${UTM_CAMPAIGN_PREFIX}${hashWithSalt('camp_abc123', UTM_SALT)}`);
    expect(token).not.toContain('camp_abc123');
  });

  it('buildContentToken prefixes the hash with act_ and never leaks the raw id', () => {
    const token: string = buildContentToken('sp_xyz789');
    expect(token.startsWith(UTM_CONTENT_PREFIX)).toBe(true);
    expect(token).toBe(`${UTM_CONTENT_PREFIX}${hashWithSalt('sp_xyz789', UTM_SALT)}`);
    expect(token).not.toContain('sp_xyz789');
  });

  it('tokens are deterministic and distinct per id', () => {
    expect(buildCampaignToken('camp_1')).toBe(buildCampaignToken('camp_1'));
    expect(buildCampaignToken('camp_1')).not.toBe(buildCampaignToken('camp_2'));
    expect(buildContentToken('sp_1')).toBe(buildContentToken('sp_1'));
    expect(buildContentToken('sp_1')).not.toBe(buildContentToken('sp_2'));
  });
});
