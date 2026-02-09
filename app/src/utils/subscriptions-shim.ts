/**
 * Subscriptions Shim API utilities
 *
 * Shared utilities for interacting with the subscriptions-shim API.
 */

/**
 * Get the subscriptions-shim base URL based on environment
 */
export function getSubscriptionsShimBaseUrl(rootDomain: string | null): string {
  if (rootDomain === 'godaddy.com') {
    return 'https://subscriptions-shim-ext.cp.api.prod.godaddy.com';
  }
  const match = rootDomain?.match(/^(dev|test)-godaddy\.com$/);
  const env = match?.[1] || 'prod';
  return `https://subscriptions-shim-ext.cp.api.${env}.godaddy.com`;
}
