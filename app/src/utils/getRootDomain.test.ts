import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * @vitest-environment jsdom
 */

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getRootDomain, getRootDomainFromHeaders } from './getRootDomain';

describe('getRootDomain', () => {
  const originalWindow = global.window;

  afterEach(() => {
    // Restore window after each test
    global.window = originalWindow;
  });

  describe('server-side rendering', () => {
    it('should return null when window is undefined', () => {
      global.window = undefined;
      expect(getRootDomain()).toBeNull();
    });
  });

  describe('client-side with valid GoDaddy hostnames', () => {
    it('should extract root domain from subdomain', () => {
      global.window = {
        location: { hostname: 'airo-builder.test-godaddy.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('test-godaddy.com');
    });

    it('should handle production domain', () => {
      global.window = {
        location: { hostname: 'airo-builder.godaddy.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('godaddy.com');
    });

    it('should handle dev domain', () => {
      global.window = {
        location: { hostname: 'airo-builder.dev-godaddy.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('dev-godaddy.com');
    });

    it('should handle stg domain', () => {
      global.window = {
        location: { hostname: 'airo-builder.stg-godaddy.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('stg-godaddy.com');
    });

    it('should fall back to godaddy.com for non-GoDaddy domains', () => {
      global.window = {
        location: { hostname: 'www.example.com' },
      } as Window & typeof globalThis;

      // Client-side falls back to godaddy.com since window.location can't be spoofed
      expect(getRootDomain()).toBe('godaddy.com');
    });

    it('should fall back to godaddy.com for arbitrary domains', () => {
      global.window = {
        location: { hostname: 'api.staging.example.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('godaddy.com');
    });
  });

  describe('ote to stg replacement', () => {
    it('should replace "ote" with "stg" for ote-godaddy.com', () => {
      global.window = {
        location: { hostname: 'airo-builder.ote-godaddy.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('stg-godaddy.com');
    });

    it('should not replace "ote" when not present', () => {
      global.window = {
        location: { hostname: 'airo-builder.godaddy.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('godaddy.com');
    });
  });

  describe('edge cases', () => {
    it('should return dev fallback for localhost', () => {
      global.window = {
        location: { hostname: 'localhost' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('dev-godaddy.com');
    });

    it('should return dev fallback for 127.0.0.1', () => {
      global.window = {
        location: { hostname: '127.0.0.1' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('dev-godaddy.com');
    });

    it('should return dev fallback for local.gasket.dev-godaddy.com', () => {
      global.window = {
        location: { hostname: 'local.gasket.dev-godaddy.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('dev-godaddy.com');
    });

    it('should fall back to godaddy.com for single word hostname', () => {
      global.window = {
        location: { hostname: 'singleword' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('godaddy.com');
    });

    it('should fall back to godaddy.com for IP addresses', () => {
      global.window = {
        location: { hostname: '192.168.1.1' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('godaddy.com');
    });

    it('should fall back to godaddy.com for non-GoDaddy domains with numbers', () => {
      global.window = {
        location: { hostname: 'app.example123.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('godaddy.com');
    });
  });

  describe('real-world examples', () => {
    it('should handle godaddy.com domain', () => {
      global.window = {
        location: { hostname: 'airo.godaddy.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('godaddy.com');
    });

    it('should handle test-godaddy.com domain', () => {
      global.window = {
        location: { hostname: 'airo-builder.test-godaddy.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('test-godaddy.com');
    });

    it('should transform ote environment to stg', () => {
      global.window = {
        location: { hostname: 'airo-builder.ote-godaddy.com' },
      } as Window & typeof globalThis;

      expect(getRootDomain()).toBe('stg-godaddy.com');
    });
  });

  describe('consistency', () => {
    it('should return consistent results for same hostname', () => {
      global.window = {
        location: { hostname: 'airo-builder.godaddy.com' },
      } as Window & typeof globalThis;

      const result1 = getRootDomain();
      const result2 = getRootDomain();

      expect(result1).toBe(result2);
      expect(result1).toBe('godaddy.com');
    });
  });
});

describe('getRootDomainFromHeaders', () => {
  it('should extract root domain from headers', () => {
    const headers = new Headers({ host: 'airo-builder.test-godaddy.com' });
    expect(getRootDomainFromHeaders(headers)).toBe('test-godaddy.com');
  });

  it('should handle host with port number', () => {
    const headers = new Headers({ host: 'airo-builder.test-godaddy.com:3000' });
    expect(getRootDomainFromHeaders(headers)).toBe('test-godaddy.com');
  });

  it('should handle production domain', () => {
    const headers = new Headers({ host: 'airo-builder.godaddy.com' });
    expect(getRootDomainFromHeaders(headers)).toBe('godaddy.com');
  });

  it('should return dev fallback for localhost', () => {
    const headers = new Headers({ host: 'localhost:3000' });
    expect(getRootDomainFromHeaders(headers)).toBe('dev-godaddy.com');
  });

  it('should return dev fallback for 127.0.0.1', () => {
    const headers = new Headers({ host: '127.0.0.1:8080' });
    expect(getRootDomainFromHeaders(headers)).toBe('dev-godaddy.com');
  });

  it('should return dev fallback for local.gasket.dev-godaddy.com', () => {
    const headers = new Headers({ host: 'local.gasket.dev-godaddy.com' });
    expect(getRootDomainFromHeaders(headers)).toBe('dev-godaddy.com');
  });

  it('should return null when host header is missing', () => {
    const headers = new Headers();
    expect(getRootDomainFromHeaders(headers)).toBeNull();
  });

  it('should replace ote with stg', () => {
    const headers = new Headers({ host: 'airo-builder.stg-godaddy.com' });
    expect(getRootDomainFromHeaders(headers)).toBe('stg-godaddy.com');
  });

  it('should return null for invalid hostname', () => {
    const headers = new Headers({ host: 'singleword' });
    expect(getRootDomainFromHeaders(headers)).toBeNull();
  });

  describe('domain validation (defense-in-depth)', () => {
    it.each([
      'godaddy.com',
      'dev-godaddy.com',
      'test-godaddy.com',
      'stg-godaddy.com',
      'ote-godaddy.com',
    ])('should allow valid GoDaddy domain: %s', (domain) => {
      const headers = new Headers({ host: `airo-builder.${domain}` });
      // ote gets replaced with stg
      const expected = domain.replace('ote', 'stg');
      expect(getRootDomainFromHeaders(headers)).toBe(expected);
    });

    it('should reject unknown domains as defense-in-depth', () => {
      const headers = new Headers({ host: 'airo-builder.evil-attacker.com' });
      expect(getRootDomainFromHeaders(headers)).toBeNull();
    });

    it('should reject arbitrary .com domains', () => {
      const headers = new Headers({ host: 'api.example.com' });
      expect(getRootDomainFromHeaders(headers)).toBeNull();
    });
  });
});
