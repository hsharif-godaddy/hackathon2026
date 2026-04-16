import 'server-only'

/**
 * Server-side feature flags read from environment variables at runtime.
 *
 * Use this for feature flags that:
 * - Need to be configurable per deployment without rebuilding
 * - Must work for unauthenticated users (unlike Switchboard)
 * - Are used in server components or passed to client components
 *
 * For authenticated user features, use Switchboard
 */

export interface ServerFeatureFlags {
  showPricingSection: boolean
  // Add more server-side feature flags here
}

/**
 * Get all server-side feature flags.
 * Call this in server components and pass to client components as props.
 */
export function getServerFeatureFlags(): ServerFeatureFlags {
  return {
    showPricingSection: process.env.SHOW_PRICING_SECTION === 'true',
    // Add more flags here as needed
  }
}
