import type { useTranslations } from '@/hooks/useTranslations';
import { DomainValidationError, type DomainValidationErrorObject } from '@/lib/mgmt-airo/types';

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
  const defaultMessage = t('builder_domain_error_default');
  if (!errors || errors.length === 0) {
    return defaultMessage;
  }

  const firstError = errors[0];
  const errorCode = firstError.code;

  switch (errorCode) {
    // Project domain errors
    case DomainValidationError.DOMAIN_FORMAT_INVALID:
      return t('builder_domain_error_format_invalid');
    case DomainValidationError.DOMAIN_LABEL_INVALID:
      return t('builder_domain_error_label_invalid');
    case DomainValidationError.DOMAIN_TOO_SHORT:
      return t('builder_domain_error_too_short');
    case DomainValidationError.DOMAIN_RESERVED:
      return t('builder_domain_error_reserved');
    case DomainValidationError.DOMAIN_PROFANITY:
      return t('builder_domain_error_profanity');
    
    // Custom domain errors
    case DomainValidationError.DOMAIN_FQDN_INVALID:
      return t('builder_domain_error_fqdn_invalid');
    case DomainValidationError.DOMAIN_SUBDOMAIN_INVALID:
      return t('builder_domain_error_subdomain_invalid');
    case DomainValidationError.DOMAIN_LABEL_TOO_LONG:
      return t('builder_domain_error_label_too_long');
    
    // Common errors
    case DomainValidationError.DOMAIN_NOT_UNIQUE:
    case DomainValidationError.DOMAIN_ALREADY_OWNED:
      return t('builder_domain_error_already_taken');
    
    default:
      return firstError.message || defaultMessage;
  }
}

