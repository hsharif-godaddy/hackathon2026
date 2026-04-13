import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-context', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/utils/getRootDomain', () => ({
  getRootDomainFromHeaders: vi.fn(),
}));

import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag, checkSwitchboardValue } from '@/lib/switchboard/server';
import { getRootDomainFromHeaders } from '@/utils/getRootDomain';

function okJsonResponse(body: Record<string, unknown>): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

describe('switchboard server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRootDomainFromHeaders).mockReturnValue('test-godaddy.com');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('checkSwitchboardValue', () => {
    it('returns string value from data.setting', async function returnsStringFromSetting() {
      vi.mocked(fetch).mockResolvedValue(okJsonResponse({ setting: 'my-model' }));

      await expect(
        checkSwitchboardValue('some-flag', 'jwt-token', new Headers()),
      ).resolves.toBe('my-model');

      expect(fetch).toHaveBeenCalledWith(
        'https://bff.pcx.test-godaddy.com/api/config/feature/some-flag?app=airo-app-builder',
        { headers: { Authorization: 'sso-jwt jwt-token' } },
      );
    });

    it('returns null when data.setting is missing', async function returnsNullWhenSettingMissing() {
      vi.mocked(fetch).mockResolvedValue(okJsonResponse({}));

      await expect(checkSwitchboardValue('x', 'j', new Headers())).resolves.toBeNull();
    });

    it('returns null on fetch error', async function returnsNullOnFetchError() {
      vi.mocked(fetch).mockRejectedValue(new Error('network'));

      await expect(checkSwitchboardValue('x', 'j', new Headers())).resolves.toBeNull();

      expect(logger.error).toHaveBeenCalledWith(
        'switchboard.server.fetch-error',
        expect.objectContaining({
          featureName: 'x',
          error: 'network',
        }),
      );
    });

    it('uses SERVER_LOCAL_VALUE_OVERRIDES when local features enabled', async function usesLocalValueOverrides() {
      vi.stubEnv('NEXT_PUBLIC_ENABLE_LOCAL_FEATURES', 'true');

      await expect(
        checkSwitchboardValue('appbuilder-model-override', 'jwt', new Headers()),
      ).resolves.toBe('default');

      expect(fetch).not.toHaveBeenCalled();
      expect(getRootDomainFromHeaders).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('switchboard.server.local-override', {
        featureName: 'appbuilder-model-override',
        value: 'default',
      });
    });

    it('returns null when no root domain available', async function returnsNullWithoutRootDomain() {
      vi.mocked(getRootDomainFromHeaders).mockReturnValue(null);

      await expect(checkSwitchboardValue('feat', 'j', new Headers())).resolves.toBeNull();

      expect(fetch).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'switchboard.server.no-root-domain',
        expect.objectContaining({
          featureName: 'feat',
          message: 'Cannot check feature: no root domain',
        }),
      );
    });
  });

  describe('checkSwitchboardFlag', () => {
    it('returns boolean from data.setting', async function returnsBooleanFromSetting() {
      vi.mocked(fetch).mockResolvedValue(okJsonResponse({ setting: true }));

      await expect(
        checkSwitchboardFlag('some-flag', 'jwt-token', new Headers()),
      ).resolves.toBe(true);

      expect(fetch).toHaveBeenCalledWith(
        'https://bff.pcx.test-godaddy.com/api/config/feature/some-flag?app=airo-app-builder',
        { headers: { Authorization: 'sso-jwt jwt-token' } },
      );
    });

    it('returns false when data.setting is missing', async function flagReturnsFalseWhenSettingMissing() {
      vi.mocked(fetch).mockResolvedValue(okJsonResponse({}));

      await expect(checkSwitchboardFlag('x', 'j', new Headers())).resolves.toBe(false);
    });

    it('returns false on fetch error', async function flagReturnsFalseOnFetchError() {
      vi.mocked(fetch).mockRejectedValue(new Error('network'));

      await expect(checkSwitchboardFlag('x', 'j', new Headers())).resolves.toBe(false);

      expect(logger.error).toHaveBeenCalledWith(
        'switchboard.server.fetch-error',
        expect.objectContaining({
          featureName: 'x',
          error: 'network',
        }),
      );
    });

    it('uses SERVER_LOCAL_FEATURE_OVERRIDES when local features enabled', async function usesLocalFeatureOverrides() {
      vi.stubEnv('NEXT_PUBLIC_ENABLE_LOCAL_FEATURES', 'true');

      await expect(
        checkSwitchboardFlag('appbuilder-model-selector', 'jwt', new Headers()),
      ).resolves.toBe(true);

      expect(fetch).not.toHaveBeenCalled();
      expect(getRootDomainFromHeaders).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('switchboard.server.local-override', {
        featureName: 'appbuilder-model-selector',
        value: true,
      });
    });

    it('returns false when no root domain available', async function flagReturnsFalseWithoutRootDomain() {
      vi.mocked(getRootDomainFromHeaders).mockReturnValue(null);

      await expect(checkSwitchboardFlag('feat', 'j', new Headers())).resolves.toBe(false);

      expect(fetch).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'switchboard.server.no-root-domain',
        expect.objectContaining({
          featureName: 'feat',
          message: 'Cannot check feature: no root domain',
        }),
      );
    });
  });
});
