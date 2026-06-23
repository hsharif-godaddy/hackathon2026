/**
 * Prefix applied to subscription identifiers before sending them to the agents service.
 *
 * @example
 * ```ts
 * console.log(SUBSCRIPTION_ID_PREFIX) // => 'airo-builder:sid:'
 * ```
 */
const SUBSCRIPTION_ID_PREFIX = 'airo-builder:sid:'

/**
 * Prefix subscription identifiers for agents service calls.
 *
 * @param subscriptionId - Raw subscription identifier returned by the control plane.
 * @returns Fully-qualified subscription identifier or undefined if no subscription exists.
 * @example
 * ```ts
 * const prefixed = formatSubscriptionId('sub-123') // => 'airo-builder:sid:sub-123'
 * ```
 */
export const formatSubscriptionId = (subscriptionId?: string | null): string | undefined => {
  if (!subscriptionId) return undefined
  return `${SUBSCRIPTION_ID_PREFIX}${subscriptionId}`
}

export { SUBSCRIPTION_ID_PREFIX }
