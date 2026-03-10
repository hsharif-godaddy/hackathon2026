import type { useTranslations } from '@/hooks/useTranslations';
import { DomainValidationError, type DomainValidationErrorObject } from '@/lib/mgmt-airo/types';
import { translateApiError } from '@/utils/api-errors';

/**
 * Domain-specific API error codes for domain BFF routes.
 * Generic errors (auth, site, etc.) live in @/utils/api-errors.
 */
export enum DomainApiErrorCode {
  FQDN_REQUIRED = 'FQDN_REQUIRED',
  DOMAIN_ERROR_NOT_FOUND = 'DOMAIN_ERROR_NOT_FOUND',
  DOMAIN_ERROR_FETCH_FAILED = 'DOMAIN_ERROR_FETCH_FAILED',
  DOMAIN_OPERATION_REQUIRED = 'DOMAIN_OPERATION_REQUIRED',
  INVALID_DOMAIN_FORMAT = 'INVALID_DOMAIN_FORMAT',
  DOMAIN_MODIFY_FAILED = 'DOMAIN_MODIFY_FAILED',
}

const DOMAIN_API_ERROR_KEYS: Record<string, string> = {
  [DomainApiErrorCode.FQDN_REQUIRED]: 'builder_domain_api_error_fqdn_required',
  [DomainApiErrorCode.DOMAIN_ERROR_NOT_FOUND]: 'builder_domain_api_error_not_found',
  [DomainApiErrorCode.DOMAIN_ERROR_FETCH_FAILED]: 'builder_domain_api_error_fetch_failed',
  [DomainApiErrorCode.DOMAIN_OPERATION_REQUIRED]: 'builder_domain_api_error_operation_required',
  [DomainApiErrorCode.INVALID_DOMAIN_FORMAT]: 'builder_domain_api_error_invalid_format',
  [DomainApiErrorCode.DOMAIN_MODIFY_FAILED]: 'builder_domain_api_error_modify_failed',
};

/**
 * Translate a domain API error code to a user-friendly message.
 *
 * Checks domain-specific codes first, then falls back to generic API error
 * translation for shared codes like AUTH_REQUIRED or SITE_NOT_FOUND.
 */
export function translateDomainApiError(
  code: string | undefined,
  t: ReturnType<typeof useTranslations>,
  fallback?: string
): string {
  if (code) {
    const domainKey = DOMAIN_API_ERROR_KEYS[code];
    if (domainKey) return t(domainKey);
  }
  return translateApiError(code, t, fallback);
}

/**
 * Translation key mappings for project prefix domain errors
 */
const PROJECT_PREFIX_ERROR_KEYS: Record<DomainValidationError, string> = {
  [DomainValidationError.DOMAIN_FORMAT_INVALID]: 'builder_domain_error_format_invalid',
  [DomainValidationError.DOMAIN_LABEL_INVALID]: 'builder_domain_error_label_invalid',
  [DomainValidationError.DOMAIN_TOO_SHORT]: 'builder_domain_error_too_short',
  [DomainValidationError.DOMAIN_RESERVED]: 'builder_domain_error_reserved',
  [DomainValidationError.DOMAIN_PROFANITY]: 'builder_domain_error_profanity',
  [DomainValidationError.DOMAIN_NOT_UNIQUE]: 'builder_domain_error_already_taken',
  [DomainValidationError.DOMAIN_ALREADY_OWNED]: 'builder_domain_error_already_taken',
  [DomainValidationError.DOMAIN_FQDN_INVALID]: 'builder_domain_error_default',
  [DomainValidationError.DOMAIN_SUBDOMAIN_INVALID]: 'builder_domain_error_default',
  [DomainValidationError.DOMAIN_LABEL_TOO_LONG]: 'builder_domain_error_default'
};

/**
 * Translation key mappings for FQDN domain errors
 */
const FQDN_ERROR_KEYS: Record<DomainValidationError, string> = {
  [DomainValidationError.DOMAIN_FQDN_INVALID]: 'builder_domain_error_fqdn_invalid',
  [DomainValidationError.DOMAIN_SUBDOMAIN_INVALID]: 'builder_domain_error_subdomain_invalid',
  [DomainValidationError.DOMAIN_LABEL_TOO_LONG]: 'builder_domain_error_label_too_long',
  [DomainValidationError.DOMAIN_NOT_UNIQUE]: 'builder_domain_error_already_in_use',
  [DomainValidationError.DOMAIN_ALREADY_OWNED]: 'builder_domain_error_already_in_use',
  [DomainValidationError.DOMAIN_FORMAT_INVALID]: 'builder_domain_error_default',
  [DomainValidationError.DOMAIN_LABEL_INVALID]: 'builder_domain_error_default',
  [DomainValidationError.DOMAIN_TOO_SHORT]: 'builder_domain_error_default',
  [DomainValidationError.DOMAIN_RESERVED]: 'builder_domain_error_default',
  [DomainValidationError.DOMAIN_PROFANITY]: 'builder_domain_error_default'
};

/**
 * Get user-friendly error message for domain validation errors
 *
 * Maps mgmt-airo error codes to user-friendly messages.
 * Takes the first error from the errors array and returns its message.
 * Works for both project domains and custom domains.
 *
 * @param errors - Array of DomainValidationErrorObject from mgmt-airo API
 * @param t - Translation function from useTranslations hook
 * @returns User-friendly error message
 *
 * @example
 * ```typescript
 * const t = useTranslations();
 * const errors = [{
 *   code: DomainValidationError.DOMAIN_RESERVED,
 *   message: "Project prefix 'admin' is reserved",
 *   field: 'projectPrefix',
 *   value: 'admin'
 * }];
 *
 * const message = getDomainErrorMessage(errors, t);
 * // Returns: "This subdomain is reserved and cannot be used."
 * ```
 */
export function getDomainErrorMessage(errors: DomainValidationErrorObject[] | undefined, t: ReturnType<typeof useTranslations>): string {
  let defaultMessage = t('builder_domain_error_default');
  if (!errors || errors.length === 0) {
    return defaultMessage;
  }

  const firstError = errors[0];
  if (firstError.message) {
    defaultMessage = firstError.message;
  }
  const errorCode = firstError.code;
  const field = firstError.field;

  switch (field) {
    case 'projectPrefix': {
      const translationKey = PROJECT_PREFIX_ERROR_KEYS[errorCode];
      return translationKey ? t(translationKey) : defaultMessage;
    }
    case 'fqdn': {
      const translationKey = FQDN_ERROR_KEYS[errorCode];
      return translationKey ? t(translationKey) : defaultMessage;
    }
    default:
      return defaultMessage;
  }
}
