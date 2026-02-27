/**
 * Domain parsing and validation utilities
 */

const AIRO_SUBDOMAINS = ['.airoapp.ai', '.test-airoapp.ai', '.dev-airoapp.ai'];

/**
 * Whether a URL belongs to an airoapp.ai subdomain (including test/dev variants).
 * Used to determine if features like "Custom Domain" buttons should be shown.
 */
export function isAiroSubdomain(url: string): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return AIRO_SUBDOMAINS.some(suffix => hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

/**
 * Resolve the public FQDN for a site with fallback priority:
 *  1. Custom domain (domainType !== 'prefix')
 *  2. Prefix domain (domainType === 'prefix')
 *  3. published_url
 *
 * Always returns a full URL with https:// protocol, or empty string.
 */
export function resolveSiteFqdn(site: {
  domains?: { fqdn: string; domainType?: string }[];
  published_url?: string | null;
} | null | undefined): string {
  const customDomain = site?.domains?.find(d => d.domainType !== 'prefix');
  const prefixDomain = site?.domains?.find(d => d.domainType === 'prefix');
  const raw = customDomain?.fqdn || prefixDomain?.fqdn || site?.published_url || '';
  if (!raw) return '';
  return raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
}

/**
 * Parsed domain information
 */
export interface ParsedDomain {
  /** Full domain as entered (cleaned) */
  fqdn: string;
  /** Root domain (e.g., example.com) */
  rootDomain: string;
  /** Subdomain if present (e.g., blog, www, api.staging) */
  subdomain: string | null;
  /** Whether this is a subdomain */
  isSubdomain: boolean;
  /** Top-level domain (e.g., com, org, co.uk) */
  tld: string;
}

/**
 * Domain validation result
 */
export interface DomainValidationResult {
  /** Whether the domain is valid */
  isValid: boolean;
  /** Error message if invalid */
  error?: string;
  /** Parsed domain if valid */
  parsed?: ParsedDomain;
}

/**
 * Remove protocol (http://, https://) and trailing slashes from domain input
 *
 * @param input - Raw domain input from user
 * @returns Cleaned domain string
 *
 * @example
 * sanitizeDomainInput('https://example.com/') // 'example.com'
 * sanitizeDomainInput('http://blog.example.com') // 'blog.example.com'
 * sanitizeDomainInput('example.com') // 'example.com'
 */
export function sanitizeDomainInput(input: string): string {
  if (!input) return '';

  let cleaned = input.trim();

  // Remove protocol
  cleaned = cleaned.replace(/^https?:\/\//i, '');

  // Remove trailing slashes and paths
  cleaned = cleaned.split('/')[0];

  // Remove port numbers
  cleaned = cleaned.split(':')[0];

  return cleaned;
}

/**
 * Parse a domain string into its components
 * Returns null if the domain cannot be parsed
 *
 * @param domain - Domain string to parse
 * @returns Parsed domain information or null if invalid
 *
 * @example
 * parseDomain('example.com') // { fqdn: 'example.com', rootDomain: 'example.com', subdomain: null, isSubdomain: false, tld: 'com' }
 * parseDomain('www.example.com') // { fqdn: 'www.example.com', rootDomain: 'example.com', subdomain: 'www', isSubdomain: true, tld: 'com' }
 * parseDomain('api.staging.example.com') // { fqdn: 'api.staging.example.com', rootDomain: 'example.com', subdomain: 'api.staging', isSubdomain: true, tld: 'com' }
 */
export function parseDomain(domain: string): ParsedDomain | null {
  const fqdn = sanitizeDomainInput(domain);
  const parts = fqdn.split('.');

  // Handle invalid domains
  if (parts.length < 2) {
    return null;
  }

  // Common two-part TLDs (co.uk, com.au, etc.)
  const twoPartTlds = ['co.uk', 'com.au', 'co.nz', 'co.za', 'com.br', 'co.in'];
  const lastTwo = parts.slice(-2).join('.');
  const isTwoPartTld = twoPartTlds.includes(lastTwo);

  let tld: string;
  let rootDomain: string;
  let subdomain: string | null;

  if (isTwoPartTld) {
    // For two-part TLDs like co.uk
    if (parts.length === 3) {
      // example.co.uk - no subdomain
      tld = lastTwo;
      rootDomain = fqdn;
      subdomain = null;
    } else if (parts.length > 3) {
      // www.example.co.uk - has subdomain
      tld = lastTwo;
      rootDomain = parts.slice(-3).join('.');
      subdomain = parts.slice(0, -3).join('.');
    } else {
      // Invalid: only 2 parts for a two-part TLD
      return null;
    }
  } else {
    // Regular TLDs (.com, .org, etc.)
    tld = parts[parts.length - 1];

    if (parts.length === 2) {
      // example.com - no subdomain
      rootDomain = fqdn;
      subdomain = null;
    } else {
      // www.example.com or api.staging.example.com - has subdomain
      rootDomain = parts.slice(-2).join('.');
      subdomain = parts.slice(0, -2).join('.');
    }
  }

  return {
    fqdn,
    rootDomain,
    subdomain,
    isSubdomain: subdomain !== null,
    tld,
  };
}

/**
 * Validate a domain and return detailed validation result
 *
 * @param domain - Domain string to validate
 * @returns Validation result with error message if invalid
 *
 * @example
 * validateDomain('example.com') // { isValid: true, parsed: {...} }
 * validateDomain('www.example.com') // { isValid: true, parsed: {...} }
 * validateDomain('not-a-domain') // { isValid: false, error: 'Invalid domain format' }
 * validateDomain('http://example.com') // { isValid: true, parsed: {...} }
 */
export function validateDomain(domain: string): DomainValidationResult {
  if (!domain || !domain.trim()) {
    return {
      isValid: false,
      error: 'Domain is required',
    };
  }

  const cleaned = sanitizeDomainInput(domain);

  // Basic format validation
  const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/i;

  if (!domainRegex.test(cleaned)) {
    return {
      isValid: false,
      error: 'Invalid domain format. Please enter a valid domain (e.g., example.com)',
    };
  }

  // Try to parse it
  const parsed = parseDomain(cleaned);

  if (!parsed) {
    return {
      isValid: false,
      error: 'Domain must have at least a domain name and extension (e.g., example.com)',
    };
  }

  return {
    isValid: true,
    parsed,
  };
}

/**
 * Check if a domain is owned by the customer
 * This includes checking if the domain or its root domain is in the customer's domain list
 *
 * @param domainToCheck - Domain to check (could be root domain or subdomain)
 * @param customerDomains - List of customer domains
 * @returns True if the domain or its root domain is owned by the customer
 *
 * @example
 * isCustomerDomain('example.com', ['example.com']) // true
 * isCustomerDomain('blog.example.com', ['example.com']) // true (subdomain of owned domain)
 * isCustomerDomain('other.com', ['example.com']) // false
 */
export function isCustomerDomain(
  domainToCheck: string,
  customerDomains: Array<{ domain?: string; name?: string; internationalDisplayName?: string }>
): boolean {
  const parsed = parseDomain(domainToCheck);
  if (!parsed) return false;

  // Check if the exact domain matches
  const exactMatch = customerDomains.some((customerDomain) => {
    const customerDomainName = customerDomain.domain || customerDomain.name || customerDomain.internationalDisplayName;
    return customerDomainName === parsed.fqdn;
  });

  if (exactMatch) return true;

  // If it's a subdomain, check if the root domain is owned by the customer
  if (parsed.isSubdomain) {
    return customerDomains.some((customerDomain) => {
      const customerDomainName = customerDomain.domain || customerDomain.name || customerDomain.internationalDisplayName;
      return customerDomainName === parsed.rootDomain;
    });
  }

  return false;
}

/**
 * Get DNS record recommendations for a domain
 *
 * @param domain - Domain to get DNS records for
 * @param anycastIp - The anycast IP address to point to
 * @param certificateValidationCname - The certificate validation CNAME value to use for the CNAME record
 * @returns DNS record recommendations
 */
export function getDnsRecords(domain: string, anycastIp: string, certificateValidationCname?: string): {
  aRecord: { type: 'A'; name: string; value: string; ttl: number };
  cnameRecord: { type: 'CNAME'; name: string; value: string; ttl: number } | null;
  dcvRecord: { type: 'CNAME'; name: string; value: string; ttl: number } | null;
} {
  const parsed = parseDomain(domain);

  if (!parsed) {
    // Fallback for invalid domains (shouldn't happen if validated first)
    return {
      aRecord: {
        type: 'A',
        name: '@',
        value: anycastIp,
        ttl: 3600,
      },
      cnameRecord: null,
      dcvRecord: null,
    };
  }

  if (parsed.isSubdomain) {
    // For subdomains (e.g., blog.example.com), only show A record
    // The user should point the subdomain directly to the IP
    const dcvRecord = certificateValidationCname ? {
      type: 'CNAME' as const,
      name: `_acme-challenge.${parsed.subdomain}`,
      value: certificateValidationCname,
      ttl: 3600,
    } : null;

    return {
      aRecord: {
        type: 'A',
        name: parsed.subdomain!, // The subdomain part (e.g., 'blog')
        value: anycastIp,
        ttl: 3600,
      },
      cnameRecord: null, // No www CNAME needed for subdomains
      dcvRecord,
    };
  } else {
    // For root domains (e.g., example.com), show A record + www CNAME
    const dcvRecord = certificateValidationCname ? {
      type: 'CNAME' as const,
      name: '_acme-challenge',
      value: certificateValidationCname,
      ttl: 3600,
    } : null;

    return {
      aRecord: {
        type: 'A',
        name: '@', // Root domain
        value: anycastIp,
        ttl: 3600,
      },
      cnameRecord: {
        type: 'CNAME',
        name: 'www',
        value: parsed.fqdn,
        ttl: 3600,
      },
      dcvRecord,
    };
  }
}
