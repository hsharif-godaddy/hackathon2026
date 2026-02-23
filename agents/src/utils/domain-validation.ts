/**
 * Domain Name Validation Utility
 *
 * RFC 1123-compliant domain name validation.
 * Uses ReDoS-safe validation patterns.
 *
 * RFC 1123 relaxed RFC 1035 to allow labels starting with digits,
 * which is standard for modern hostnames and domain names.
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
 * Validates according to RFC 1123:
 * - Input is trimmed before validation
 * - Must not be empty or whitespace-only
 * - Maximum length: 253 characters
 * - Valid characters: letters, numbers, dots, hyphens
 * - Minimum 2 labels (e.g., example.com)
 * - Each label: 1-63 characters
 * - Labels cannot start or end with hyphen
 */
export function validateDomainName(domainName: string): DomainValidationResult {
  if (typeof domainName !== 'string') {
    return { valid: false, error: 'Domain name must be a string' }
  }

  const trimmed = domainName.trim()

  if (trimmed.length === 0) {
    return { valid: false, error: 'Domain name cannot be empty' }
  }

  if (trimmed.length > 253) {
    return { valid: false, error: 'Domain name exceeds maximum length of 253 characters' }
  }

  if (!/^[a-z0-9.-]+$/i.test(trimmed)) {
    return { valid: false, error: 'Domain name contains invalid characters' }
  }

  const labels = trimmed.split('.')
  if (labels.length < 2) {
    return { valid: false, error: 'Domain name must have at least two labels (e.g., example.com)' }
  }

  for (const label of labels) {
    if (label.length === 0 || label.length > 63) {
      return { valid: false, error: 'Each domain label must be between 1 and 63 characters' }
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      return { valid: false, error: 'Domain labels cannot start or end with a hyphen' }
    }
  }

  return { valid: true }
}
