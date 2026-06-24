import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockFindByAppAndPlatform = vi.fn();

vi.mock('../../../../logging/index.js', () => {
  const instance = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => instance,
  };
  return {
    logger: instance,
    Logger: { create: () => instance },
  };
});

vi.mock('../../../../database/repositories/SocialAssociationRepository.js', () => {
  return {
    SocialAssociationRepository: class {
      findByAppAndPlatform(...args: unknown[]) {
        return mockFindByAppAndPlatform(...args);
      }
    },
  };
});

import { getGbpProfileTool } from '../get-gbp-profile.js';
import { GBP_PROFILE_READY } from '../../../../types/social.js';

const SAMPLE_PROFILE = {
  name: 'Acme Plumbing',
  primaryPhone: '(555) 123-4567',
  websiteUri: 'https://acme-plumbing.com',
  storefrontAddress: { addressLines: ['123 Main St'], locality: 'Phoenix', administrativeArea: 'AZ' },
  regularHours: { periods: [{ openDay: 'MONDAY', closeDay: 'MONDAY' }] },
};

function runGetGbpProfile(context?: Record<string, unknown>) {
  return getGbpProfileTool.execute({}, context);
}

describe('google-business-profile-sync getGbpProfile tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindByAppAndPlatform.mockReset();
  });

  describe('execute', () => {
    it('returns error when appId is missing', async () => {
      const result = await runGetGbpProfile({ metadata: {} });

      expect(result).toMatchObject({ success: false, error: 'App ID is required', needsReconnect: false });
    });

    it('returns the profile from the context attachment (pass 2)', async () => {
      const result = await runGetGbpProfile({
        metadata: { appId: 'test-app' },
        contextAttachments: [{ type: GBP_PROFILE_READY, data: { profile: SAMPLE_PROFILE } }],
      });

      expect(result).toMatchObject({ success: true, profile: SAMPLE_PROFILE });
      // Pass 2 must not hit the repository
      expect(mockFindByAppAndPlatform).not.toHaveBeenCalled();
    });

    it('surfaces a read failure carried on the attachment (pass 2) instead of stalling', async () => {
      const result = await runGetGbpProfile({
        metadata: { appId: 'test-app' },
        contextAttachments: [{ type: GBP_PROFILE_READY, data: { error: 'Failed to fetch Google Business Profile: 401' } }],
      });

      expect(result).toMatchObject({ success: false, needsReconnect: true });
      expect((result as { error: string }).error).toContain('401');
      expect(mockFindByAppAndPlatform).not.toHaveBeenCalled();
    });

    it('returns the getGbpProfile signal when no attachment (pass 1)', async () => {
      mockFindByAppAndPlatform.mockReturnValue([{ socialId: 'gbp-123' }]);

      const result = await runGetGbpProfile({ metadata: { appId: 'test-app' }, contextAttachments: [] });

      expect(result).toMatchObject({
        action: 'getGbpProfile',
        success: true,
        appId: 'test-app',
        socialId: 'gbp-123',
        locationCount: 1,
      });
      expect(mockFindByAppAndPlatform).toHaveBeenCalledWith('test-app', 'GOOGLE_BUSINESS_PROFILE');
    });

    it('returns error with needsReconnect when GBP not connected', async () => {
      mockFindByAppAndPlatform.mockReturnValue([]);

      const result = await runGetGbpProfile({ metadata: { appId: 'test-app' } });

      expect(result).toMatchObject({ success: false, needsReconnect: true });
      expect(result.error).toContain('No Google Business Profile connection');
    });

    it('uses the first association when multiple locations exist', async () => {
      mockFindByAppAndPlatform.mockReturnValue([{ socialId: 'gbp-first' }, { socialId: 'gbp-second' }]);

      const result = await runGetGbpProfile({ metadata: { appId: 'test-app' } });

      expect(result).toMatchObject({ socialId: 'gbp-first', locationCount: 2 });
    });

    it('returns transient error (no reconnect) on repository exception', async () => {
      mockFindByAppAndPlatform.mockImplementation(() => {
        throw new Error('Database failure');
      });

      const result = await runGetGbpProfile({ metadata: { appId: 'test-app' } });

      expect(result).toMatchObject({ success: false, error: 'Database failure', needsReconnect: false });
    });
  });

  describe('computeState', () => {
    it('returns fetching-profile on pass 1 signal', () => {
      const state = getGbpProfileTool.computeState?.({}, { action: 'getGbpProfile', socialId: 'gbp-123' });

      expect(state).toMatchObject({
        workflowState: 'fetching-profile',
        nextStep: 'wait-for-context-attachment',
        lastError: null,
      });
      expect(state?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('returns fetch-failed with reconnect when needsReconnect is true', () => {
      const state = getGbpProfileTool.computeState?.(
        {},
        { success: false, error: 'No connection', needsReconnect: true }
      );

      expect(state).toMatchObject({
        workflowState: 'fetch-failed',
        lastError: 'No connection',
        nextStep: 'reconnect-gbp',
      });
    });

    it('returns fetch-failed with retry when needsReconnect is false', () => {
      const state = getGbpProfileTool.computeState?.(
        {},
        { success: false, error: 'API error', needsReconnect: false }
      );

      expect(state?.nextStep).toBe('retry-get-profile');
    });

    it('returns profile-fetched on success', () => {
      const state = getGbpProfileTool.computeState?.({}, { success: true, profile: SAMPLE_PROFILE });

      expect(state).toMatchObject({
        workflowState: 'profile-fetched',
        nextStep: 'get-site-business-info',
        lastError: null,
      });
    });

    it('returns null for unexpected output', () => {
      const state = getGbpProfileTool.computeState?.({}, { unexpected: 'output' });
      expect(state).toBeNull();
    });
  });

  describe('parameter schema validation', () => {
    it('accepts empty parameters object', () => {
      expect(() => getGbpProfileTool.parameters.parse({})).not.toThrow();
    });
  });
});
