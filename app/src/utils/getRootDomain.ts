/**
 * Get the root domain from the current window location
 * 
 * @returns Root domain with 'ote' replaced by 'stg', or null if running server-side
 * 
 * @example
 * ```typescript
 * // On airo-builder.test-godaddy.com
 * getRootDomain() // 'test-godaddy.com'
 * 
 * // On localhost:3000
 * getRootDomain() // ''
 * ```
 */
export function getRootDomain() {
  if (typeof window === 'undefined') return null;

  const { hostname } = window.location;

  const matches = hostname.match(/([\w-]+\.\w+)$/);

  return matches ? matches[0].replace('ote', 'stg') : '';
}

