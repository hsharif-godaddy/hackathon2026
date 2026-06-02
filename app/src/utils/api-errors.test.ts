import { describe, expect, it, vi } from 'vitest';

import { ApiErrorCode, translateApiError } from './api-errors';

describe('translateApiError', () => {
  const createMockTranslations = () => {
    const t = vi.fn(function (key: string) { return key; });
    return t as unknown as ReturnType<typeof import('@/hooks/useTranslations').useTranslations>;
  };

  it('should translate known generic error codes', () => {
    const t = createMockTranslations();
    expect(translateApiError(ApiErrorCode.SITE_ID_REQUIRED, t)).toBe('builder_api_error_site_id_required');
    expect(translateApiError(ApiErrorCode.AUTH_REQUIRED, t)).toBe('builder_api_error_auth_required');
    expect(translateApiError(ApiErrorCode.V2_CONTROL_PLANE_REQUIRED, t)).toBe('builder_api_error_v2_required');
    expect(translateApiError(ApiErrorCode.SITE_NOT_FOUND, t)).toBe('builder_api_error_site_not_found');
    expect(translateApiError(ApiErrorCode.SITE_CONFIG_INCOMPLETE, t)).toBe('builder_api_error_site_config_incomplete');
  });

  it('should return fallback for unknown error codes', () => {
    const t = createMockTranslations();
    expect(translateApiError('UNKNOWN_CODE', t, 'Fallback')).toBe('Fallback');
  });

  it('should return default message when code is undefined and no fallback', () => {
    const t = createMockTranslations();
    expect(translateApiError(undefined, t)).toBe('builder_api_error_default');
  });

  it('should return fallback when code is undefined', () => {
    const t = createMockTranslations();
    expect(translateApiError(undefined, t, 'Custom fallback')).toBe('Custom fallback');
  });

  it('should translate all defined generic error codes', () => {
    const t = createMockTranslations();
    for (const code of Object.values(ApiErrorCode)) {
      const result = translateApiError(code, t);
      expect(result).not.toBe('builder_api_error_default');
    }
  });
});
