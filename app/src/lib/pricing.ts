/**
 * Formats a price from the Offer Graph API
 *
 * Offer Graph returns prices with 6 decimal places of precision (e.g., 119880000 = $119.88)
 * This function converts the price to the actual value and formats it according to the
 * currency and market locale.
 *
 * @param priceWithPrecision - Price with 6 decimal places (e.g., 119880000)
 * @param currency - ISO 4217 currency code (e.g., 'USD', 'EUR', 'GBP')
 * @param marketId - Market/locale identifier (e.g., 'en-US', 'en-GB')
 * @returns Formatted price string (e.g., '$119.88', '€119.88')
 *
 * @example
 * formatOfferPrice(119880000, 'USD', 'en-US') // Returns: '$119.88'
 * formatOfferPrice(99990000, 'EUR', 'de-DE') // Returns: '99,99 €'
 */
export function formatOfferPrice(
  priceWithPrecision: number,
  currency: string,
  marketId: string
): string {
  // Divide by 1,000,000 to get actual price (6 decimal places of precision)
  const actualPrice = priceWithPrecision / 1000000

  // Get locale from market ID, fallback to en-US
  const locale = marketId || 'en-US'

  // Format using Intl.NumberFormat with error handling
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency,
    }).format(actualPrice)
  } catch (error) { // eslint-disable-line @typescript-eslint/no-unused-vars
    // Fall back to en-US locale and USD currency if invalid values provided
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(actualPrice)
  }
}
