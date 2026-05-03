/**
 * UPP (Universal Purchase Path) Configuration
 *
 * Constants for domain purchase flow integration with GoDaddy UPP.
 * Update these values based on environment and UPP integration requirements.
 */

import { PAYWALL_ITC } from '@/lib/paywall/shared';

/**
 * Build UPP domain search URL
 * @param rootDomain - Root domain (e.g., godaddy.com, godaddy-dev.com)
 * @param domain - Domain name to check
 * @returns Full UPP URL for domain search
 */
export function buildUPPDomainSearchUrl(rootDomain: string, domain: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_UPP_BASE_URL || `https://www.${rootDomain}`;
  return `${baseUrl}/domainsearch/find?domainToCheck=${encodeURIComponent(domain)}&checkAvailability=true&itc=${encodeURIComponent(PAYWALL_ITC.ATTACH_DOMAIN)}`;
}

/**
 * UPP allowed origins for postMessage validation
 * @param rootDomain - Root domain (e.g., godaddy.com, godaddy-dev.com)
 * @returns Array of allowed origins
 */
export function getUPPAllowedOrigins(rootDomain: string): string[] {
  return [
    `https://www.${rootDomain}`,
    `https://cart.${rootDomain}`,
    `https://checkout.${rootDomain}`,
  ];
}

/**
 * UPP postMessage event types
 */
export const UPP_MESSAGE_TYPES = {
  PURCHASE_COMPLETE: ['UPP_PURCHASE_COMPLETE', 'PURCHASE_SUCCESS'],
  PURCHASE_CANCELLED: ['UPP_PURCHASE_CANCELLED', 'PURCHASE_CANCELLED'],
  PURCHASE_ERROR: ['UPP_PURCHASE_ERROR', 'PURCHASE_ERROR'],
  CLOSE: ['UPP_CLOSE', 'CLOSE'],
} as const;
