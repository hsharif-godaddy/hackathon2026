import { DomainValidationError, type DomainValidationErrorObject } from '@/lib/mgmt-airo/types';

/**
 * Get user-friendly error message for domain validation errors
 * 
 * Maps mgmt-airo error codes to user-friendly messages.
 * Takes the first error from the errors array and returns its message.
 * Works for both project domains and custom domains.
 * 
 * @param errors - Array of DomainValidationErrorObject from mgmt-airo API
 * @returns User-friendly error message
 * 
 * @example
 * ```typescript
 * const errors = [{
 *   code: DomainValidationError.DOMAIN_RESERVED,
 *   message: "Project prefix 'admin' is reserved",
 *   field: 'projectPrefix',
 *   value: 'admin'
 * }];
 * 
 * const message = getDomainErrorMessage(errors);
 * // Returns: "This subdomain is reserved and cannot be used."
 * ```
 */
export function getDomainErrorMessage(errors?: DomainValidationErrorObject[]): string {
    const defaultMessage = 'Domain is not available. Please enter a different domain.';
  if (!errors || errors.length === 0) {
    return defaultMessage;
  }

  // Use the first error to determine the message
  const firstError = errors[0];
  const errorCode = firstError.code;

  switch (errorCode) {
    // Project domain errors
    case DomainValidationError.DOMAIN_FORMAT_INVALID:
      return 'Subdomain must use only letters, numbers, and hyphens. Must start and end with a letter or number (minimum 5 characters).';
    case DomainValidationError.DOMAIN_LABEL_INVALID:
      return 'Invalid subdomain. Must start and end with a letter or number, and cannot contain consecutive hyphens.';
    case DomainValidationError.DOMAIN_TOO_SHORT:
      return 'Subdomain must be at least 5 characters long.';
    case DomainValidationError.DOMAIN_RESERVED:
      return 'This subdomain is reserved and cannot be used.';
    case DomainValidationError.DOMAIN_PROFANITY:
      return 'This subdomain contains inappropriate language. Please choose a different one.';
    
    // Custom domain errors
    case DomainValidationError.DOMAIN_FQDN_INVALID:
      return 'Invalid domain format. Please enter a valid fully qualified domain name.';
    case DomainValidationError.DOMAIN_SUBDOMAIN_INVALID:
      return 'Invalid subdomain format in the domain name.';
    case DomainValidationError.DOMAIN_LABEL_TOO_LONG:
      return 'Domain label exceeds the maximum length of 63 characters.';
    
    // Common errors
    case DomainValidationError.DOMAIN_NOT_UNIQUE:
    case DomainValidationError.DOMAIN_ALREADY_OWNED:
      return 'This subdomain is already taken. Please choose a different one.';
    
    default:
      // Fallback to API-provided message if available
      return firstError.message || defaultMessage;
  }
}

