/**
 * Domain Name Validation Utility
 *
 * Validates domain names according to RFC 1035 standards.
 * Uses ReDoS-safe validation patterns.
 */

export interface DomainValidationResult {
  valid: boolean
  error?: string
}

/**
 * Validate domain name format (ReDoS-safe)
 *
 * SECURITY: Using explicit checks instead of complex regex to prevent ReDoS attacks
 *
 * Validates according to RFC 1035:
 * - Maximum length: 253 characters
 * - Valid characters: letters, numbers, dots, hyphens
 * - Minimum 2 labels (e.g., example.com)
 * - Each label: 1-63 characters
 * - Labels cannot start or end with hyphen
 * - TLD must be at least 2 characters
 *
 * @param domainName - The domain name to validate
 * @returns Validation result with success status and optional error message
 *
 * @example
 * ```typescript
 * const result = validateDomainName('example.com')
 * if (!result.valid) {
 *   console.error(result.error)
 * }
 * ```
 */
export function validateDomainName(domainName: string): DomainValidationResult {
  // Type check
  if (typeof domainName !== 'string') {
    return { valid: false, error: 'Domain name must be a string' }
  }

  // Length check (max 253 characters per RFC 1035)
  if (domainName.length > 253) {
    return { valid: false, error: 'Domain name exceeds maximum length of 253 characters' }
  }

  // Basic character validation (allows letters, numbers, dots, hyphens)
  const basicDomainRegex = /^[a-z0-9.-]+$/i
  if (!basicDomainRegex.test(domainName)) {
    return { valid: false, error: 'Domain name contains invalid characters' }
  }

  // Structure validation - at least 2 labels (e.g., example.com)
  const labels = domainName.split('.')
  if (labels.length < 2) {
    return { valid: false, error: 'Domain name must have at least two labels (e.g., example.com)' }
  }

  // Validate each label
  for (const label of labels) {
    // Each label must be 1-63 characters (RFC 1035)
    if (label.length === 0 || label.length > 63) {
      return { valid: false, error: 'Each domain label must be between 1 and 63 characters' }
    }
    // Labels cannot start or end with hyphen
    if (label.startsWith('-') || label.endsWith('-')) {
      return { valid: false, error: 'Domain labels cannot start or end with a hyphen' }
    }
  }

  // TLD must be at least 2 characters (no single-char TLDs exist in practice)
  const tld = labels[labels.length - 1]
  if (!tld || tld.length < 2) {
    return { valid: false, error: 'Top-level domain must be at least 2 characters' }
  }

  return { valid: true }
}
