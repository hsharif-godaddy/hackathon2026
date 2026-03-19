import type { useTranslations } from '@/hooks/useTranslations';

/**
 * Generic API error codes reusable across any BFF route.
 * These cover common precondition failures like missing auth, missing site, etc.
 */
export enum ApiErrorCode {
  SITE_ID_REQUIRED = 'SITE_ID_REQUIRED',
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  V2_CONTROL_PLANE_REQUIRED = 'V2_CONTROL_PLANE_REQUIRED',
  SITE_NOT_FOUND = 'SITE_NOT_FOUND',
  SITE_CONFIG_INCOMPLETE = 'SITE_CONFIG_INCOMPLETE',
}

const API_ERROR_KEYS: Record<string, string> = {
  [ApiErrorCode.SITE_ID_REQUIRED]: 'builder_api_error_site_id_required',
  [ApiErrorCode.AUTH_REQUIRED]: 'builder_api_error_auth_required',
  [ApiErrorCode.V2_CONTROL_PLANE_REQUIRED]: 'builder_api_error_v2_required',
  [ApiErrorCode.SITE_NOT_FOUND]: 'builder_api_error_site_not_found',
  [ApiErrorCode.SITE_CONFIG_INCOMPLETE]: 'builder_api_error_site_config_incomplete',
};

/**
 * Translate a generic API error code to a user-friendly message.
 *
 * Looks up the code in the generic API error key mapping and returns the
 * translated string. Falls back to the provided fallback or a generic default.
 */
export function translateApiError(
  code: string | undefined,
  t: ReturnType<typeof useTranslations>,
  fallback?: string
): string {
  if (code) {
    const key = API_ERROR_KEYS[code];
    if (key) {return t(key);}
  }
  return fallback || t('builder_api_error_default');
}
