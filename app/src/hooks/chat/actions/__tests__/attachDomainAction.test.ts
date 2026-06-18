/**
 * Tests for attachDomainAction - Domain Validation
 *
 * Critical: These tests verify ReDoS vulnerability fix
 * See: SECURITY-FIXES-REDOS.md for details
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as gasketConfig from '@/lib/gasket-config';
import { attachDomainAction } from '../attachDomainAction';
import type { ClientActionContext } from '../types';

const mockContext = {} as ClientActionContext;

// Mock gasket-config
vi.mock('@/lib/gasket-config', () => ({
  appFetch: vi.fn(),
}));

// Mock logging
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

describe('attachDomainAction - Domain Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Valid domains', () => {
    it('should accept standard domain names', async () => {
      const mockFetch = vi.mocked(gasketConfig.appFetch);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ statusJobId: 'job-123', status: 'pending', message: 'Success' }),
      } as any);

      await expect(
        attachDomainAction({ appId: 'test-app', domainName: 'example.com' }, mockContext)
      ).resolves.toMatchObject({ success: true });

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should accept subdomains', async () => {
      const mockFetch = vi.mocked(gasketConfig.appFetch);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ statusJobId: 'job-123', status: 'pending', message: 'Success' }),
      } as any);

      await expect(
        attachDomainAction({ appId: 'test-app', domainName: 'sub.example.com' }, mockContext)
      ).resolves.toMatchObject({ success: true });
    });

    it('should accept domains with hyphens', async () => {
      const mockFetch = vi.mocked(gasketConfig.appFetch);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ statusJobId: 'job-123', status: 'pending', message: 'Success' }),
      } as any);

      await expect(
        attachDomainAction({ appId: 'test-app', domainName: 'my-site.example.com' }, mockContext)
      ).resolves.toMatchObject({ success: true });
    });

    it('should accept multi-level domains', async () => {
      const mockFetch = vi.mocked(gasketConfig.appFetch);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ statusJobId: 'job-123', status: 'pending', message: 'Success' }),
      } as any);

      await expect(
        attachDomainAction({ appId: 'test-app', domainName: 'a.b.c.example.com' }, mockContext)
      ).resolves.toMatchObject({ success: true });
    });
  });

  describe('Invalid domains - Security (ReDoS protection)', () => {
    it('should reject ReDoS attack payload with many hyphens (fast)', async () => {
      const start = Date.now();
      const attackPayload = 'a' + '-'.repeat(100) + '.com';

      await expect(
        attachDomainAction({ appId: 'test-app', domainName: attackPayload }, mockContext)
      ).rejects.toThrow();

      const duration = Date.now() - start;
      // Should fail in <100ms (old regex would timeout)
      expect(duration).toBeLessThan(100);
    });

    it('should reject extremely long attack payload (fast)', async () => {
      const start = Date.now();
      const attackPayload = 'a'.repeat(1000) + '.com';

      await expect(
        attachDomainAction({ appId: 'test-app', domainName: attackPayload }, mockContext)
      ).rejects.toThrow('Domain name exceeds maximum length');

      const duration = Date.now() - start;
      // Should fail immediately
      expect(duration).toBeLessThan(100);
    });
  });

  describe('Invalid domains - Format validation', () => {
    it('should reject domain with only one label', async () => {
      await expect(
        attachDomainAction({ appId: 'test-app', domainName: 'example' }, mockContext)
      ).rejects.toThrow('must have at least two labels');
    });

    it('should reject domain starting with hyphen', async () => {
      await expect(
        attachDomainAction({ appId: 'test-app', domainName: '-example.com' }, mockContext)
      ).rejects.toThrow('cannot start or end with a hyphen');
    });

    it('should reject domain ending with hyphen', async () => {
      await expect(
        attachDomainAction({ appId: 'test-app', domainName: 'example-.com' }, mockContext)
      ).rejects.toThrow('cannot start or end with a hyphen');
    });

    it('should reject domain with empty label', async () => {
      await expect(
        attachDomainAction({ appId: 'test-app', domainName: 'example..com' }, mockContext)
      ).rejects.toThrow('must be between 1 and 63 characters');
    });

    it('should reject domain with label exceeding 63 characters', async () => {
      const longLabel = 'a'.repeat(64);
      await expect(
        attachDomainAction({ appId: 'test-app', domainName: `${longLabel}.com` }, mockContext)
      ).rejects.toThrow('must be between 1 and 63 characters');
    });

    it('should reject domain exceeding 253 characters', async () => {
      const longDomain = 'a'.repeat(250) + '.com';
      await expect(
        attachDomainAction({ appId: 'test-app', domainName: longDomain }, mockContext)
      ).rejects.toThrow('exceeds maximum length');
    });

    it('should reject domain with invalid characters', async () => {
      await expect(
        attachDomainAction({ appId: 'test-app', domainName: 'example@.com' }, mockContext)
      ).rejects.toThrow('invalid characters');
    });

    it('should reject empty domain name', async () => {
      await expect(
        attachDomainAction({ appId: 'test-app', domainName: '' }, mockContext)
      ).rejects.toThrow('domainName is required');
    });

    it('should reject non-string domain name', async () => {
      await expect(
        attachDomainAction({ appId: 'test-app', domainName: 123 as any }, mockContext)
      ).rejects.toThrow('must be a string');
    });

    it('should reject domain with single-char TLD', async () => {
      await expect(
        attachDomainAction({ appId: 'test-app', domainName: 'example.a' }, mockContext)
      ).rejects.toThrow('Top-level domain must be at least 2 characters');
    });
  });

  describe('Required parameters', () => {
    it('should reject missing appId', async () => {
      await expect(
        attachDomainAction({ appId: '', domainName: 'example.com' }, mockContext)
      ).rejects.toThrow('appId is required');
    });

    it('should reject non-string appId', async () => {
      await expect(
        attachDomainAction({ appId: 123 as any, domainName: 'example.com' }, mockContext)
      ).rejects.toThrow('appId is required');
    });
  });
});
