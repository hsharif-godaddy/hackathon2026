import type { useTranslations } from '@/hooks/useTranslations';
import { DomainValidationError, type DomainValidationErrorObject } from '@/lib/mgmt-airo/types';
import { translateApiError } from '@/utils/api-errors';

/**
 * Domain-specific API error codes for domain BFF routes.
 * Generic errors (auth, site, etc.) live in @/utils/api-errors.
 */
export enum DomainApiErrorCode {
  FQDNS_REQUIRED = 'FQDNS_REQUIRED',
  FQDN_REQUIRED = 'FQDN_REQUIRED',
  DOMAIN_ERROR_NOT_FOUND = 'DOMAIN_ERROR_NOT_FOUND',
  DOMAIN_ERROR_FETCH_FAILED = 'DOMAIN_ERROR_FETCH_FAILED',
  DOMAIN_OPERATION_REQUIRED = 'DOMAIN_OPERATION_REQUIRED',
  INVALID_DOMAIN_FORMAT = 'INVALID_DOMAIN_FORMAT',
  INVALID_TRANSFER_FROM = 'INVALID_TRANSFER_FROM',
  DOMAIN_ALREADY_IN_USE = 'DOMAIN_ALREADY_IN_USE',
  DOMAIN_MODIFY_FAILED = 'DOMAIN_MODIFY_FAILED',
  TLD_NOT_SUPPORTED = 'TLD_NOT_SUPPORTED',
  CONSENT_REQUIRED = 'CONSENT_REQUIRED',
  CAA_REMEDIATION_FAILED = 'CAA_REMEDIATION_FAILED',
}

/**
 * CAA-mismatch error codes returned by the domain-error endpoint
 * (`AiroDomainError.code`). These gate the CAA remediation UI:
 *
 * - INTERNAL_MISMATCH: domain is GoDaddy-managed — we can fix the conflicting
 *   CAA records automatically with the customer's consent (consent modal).
 * - EXTERNAL_MISMATCH: domain DNS is managed off-platform — the customer must
 *   remove the conflicting CAA records themselves (self-service instructions).
 */
export const CloudflareCaaErrorCode = {
  INTERNAL_MISMATCH: 'CLOUDFLARE_CAA_INTERNAL_MISMATCH',
  EXTERNAL_MISMATCH: 'CLOUDFLARE_CAA_MISMATCH',
} as const;

/**
 * Returned by the caa-remediation endpoint when the domain turns out not to be
 * GoDaddy-managed (the consent flow's classification and the remediation
 * ownership check disagreed). The UI falls back to the self-service variant.
 */
export const CAA_REMEDIATION_NOT_GD_MANAGED = 'DOMAIN_NOT_GD_MANAGED';

export type CaaModalVariant = 'consent' | 'selfService';

/**
 * Map a domain-error code to the CAA modal variant it should drive, or null
 * when the code is not a CAA-mismatch error.
 */
export function caaVariantForCode(code: string | undefined): CaaModalVariant | null {
  if (code === CloudflareCaaErrorCode.INTERNAL_MISMATCH) return 'consent';
  if (code === CloudflareCaaErrorCode.EXTERNAL_MISMATCH) return 'selfService';
  return null;
}

const DOMAIN_API_ERROR_KEYS: Record<string, string> = {
  [DomainApiErrorCode.FQDNS_REQUIRED]: 'builder_domain_api_error_fqdn_required',
  [DomainApiErrorCode.FQDN_REQUIRED]: 'builder_domain_api_error_fqdn_required',
  [DomainApiErrorCode.DOMAIN_ERROR_NOT_FOUND]: 'builder_domain_api_error_not_found',
  [DomainApiErrorCode.DOMAIN_ERROR_FETCH_FAILED]: 'builder_domain_api_error_fetch_failed',
  [DomainApiErrorCode.DOMAIN_OPERATION_REQUIRED]: 'builder_domain_api_error_operation_required',
  [DomainApiErrorCode.INVALID_DOMAIN_FORMAT]: 'builder_domain_api_error_invalid_format',
  [DomainApiErrorCode.INVALID_TRANSFER_FROM]: 'builder_domain_error_invalid_transfer',
  [DomainApiErrorCode.DOMAIN_ALREADY_IN_USE]: 'builder_domain_api_error_already_in_use',
  [DomainApiErrorCode.DOMAIN_MODIFY_FAILED]: 'builder_domain_api_error_modify_failed',
  [DomainApiErrorCode.TLD_NOT_SUPPORTED]: 'builder_domain_error_tld_not_supported',
  [DomainApiErrorCode.CONSENT_REQUIRED]: 'builder_domain_api_error_consent_required',
  [DomainApiErrorCode.CAA_REMEDIATION_FAILED]: 'builder_domain_api_error_caa_remediation_failed',
};

const DOMAIN_API_ERROR_DEFAULT_MESSAGES: Partial<Record<DomainApiErrorCode, string>> = {
  [DomainApiErrorCode.INVALID_TRANSFER_FROM]: 'Invalid domain transfer request.',
  [DomainApiErrorCode.TLD_NOT_SUPPORTED]: 'The top-level domain is not supported.',
  [DomainApiErrorCode.CONSENT_REQUIRED]: 'Your consent is required to continue.',
  [DomainApiErrorCode.CAA_REMEDIATION_FAILED]: 'We could not update the CAA records. Please try again.',
};

/**
 * Resolve the i18n key for a domain API error code.
 *
 * DOMAIN_ALREADY_IN_USE's product-specific message interpolates
 * {conflictingProduct}. When the API omits that field, fall back to the
 * placeholder-free key so react-intl never renders a literal {conflictingProduct}.
 */
function resolveDomainApiErrorKey(
  code: string,
  variables?: Record<string, unknown>
): string | undefined {
  if (code === DomainApiErrorCode.DOMAIN_ALREADY_IN_USE && !variables?.conflictingProduct) {
    return 'builder_domain_error_already_in_use';
  }
  return DOMAIN_API_ERROR_KEYS[code];
}

/**
 * Translate a domain API error code to a user-friendly message.
 *
 * Checks domain-specific codes first, then falls back to generic API error
 * translation for shared codes like AUTH_REQUIRED or SITE_NOT_FOUND.
 */
export function translateDomainApiError(
  code: string | undefined,
  t: ReturnType<typeof useTranslations>,
  fallback?: string,
  variables?: Record<string, unknown>
): string {
  if (code) {
    const domainKey = resolveDomainApiErrorKey(code, variables);
    if (domainKey) {
      const defaultMessage = DOMAIN_API_ERROR_DEFAULT_MESSAGES[code as DomainApiErrorCode];
      return t(domainKey, variables, defaultMessage);
    }
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
  [DomainValidationError.DOMAIN_LABEL_TOO_LONG]: 'builder_domain_error_default',
  [DomainValidationError.TLD_NOT_SUPPORTED]: 'builder_domain_error_default',
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
  [DomainValidationError.DOMAIN_PROFANITY]: 'builder_domain_error_default',
  [DomainValidationError.TLD_NOT_SUPPORTED]: 'builder_domain_error_tld_not_supported',
};

/**
 * Whether validation errors indicate the project prefix is already taken.
 */
export function isProjectPrefixTakenError(
  errors: DomainValidationErrorObject[] | undefined,
): boolean {
  if (!errors?.length) {
    return false;
  }

  const code = errors[0].code;
  return (
    code === DomainValidationError.DOMAIN_NOT_UNIQUE ||
    code === DomainValidationError.DOMAIN_ALREADY_OWNED
  );
}

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
      if (!translationKey) return defaultMessage;
      return t(translationKey, firstError.tld ? { tld: firstError.tld } : undefined);
    }
    default:
      return defaultMessage;
  }
}
