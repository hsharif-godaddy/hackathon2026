/**
 * Browser-safe Stripe formatting utilities
 *
 * This file contains ONLY browser-safe functions that don't depend on Node.js modules.
 * Import this in frontend/browser code instead of stripe.ts
 */

/**
 * Zero-decimal currencies that should NOT be divided by 100
 * @see https://docs.stripe.com/currencies#zero-decimal
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
  'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf'
]);

/**
 * Three-decimal currencies that need division by 1000 (not 100)
 * @see https://docs.stripe.com/currencies#three-decimal
 */
const THREE_DECIMAL_CURRENCIES = new Set([
  'bhd', 'jod', 'kwd', 'omr', 'tnd'
]);

function getCurrencyDivisor(currencyLower: string): number {
  if (ZERO_DECIMAL_CURRENCIES.has(currencyLower)) return 1;
  if (THREE_DECIMAL_CURRENCIES.has(currencyLower)) return 1000;
  return 100;
}

/**
 * Format price for display
 * @param amount - Amount in smallest currency unit (cents for USD, yen for JPY, fils-equivalent for KWD)
 * @param currency - Currency code (default: 'usd')
 */
export function formatPrice(amount: number, currency: string = 'usd'): string {
  const currencyLower = currency.toLowerCase();
  const divisor = getCurrencyDivisor(currencyLower);

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / divisor);
}

