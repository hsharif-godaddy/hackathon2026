/**
 * Browser-safe Stripe formatting utilities
 *
 * This file contains ONLY browser-safe functions that don't depend on Node.js modules.
 * Import this in frontend/browser code instead of stripe.ts
 */

/**
 * Format price for display
 * @param amount - Amount in cents (or smallest currency unit)
 * @param currency - Currency code (default: 'usd')
 */
export function formatPrice(amount: number, currency: string = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

