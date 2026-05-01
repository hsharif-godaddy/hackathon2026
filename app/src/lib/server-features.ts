import 'server-only'

import { checkSwitchboardFlag, type SwitchboardRequest } from '@/lib/switchboard/server';

/**
 * Server-side feature flags resolved from Switchboard and passed to client
 * components that cannot read `window.gasketData` during server render.
 */

export interface ServerFeatureFlags {
  showPricingSection: boolean
}

/**
 * Get all server-side feature flags.
 * Call this in server components and pass to client components as props.
 *
 * Returns false on Switchboard error rather than throwing. Do not use this
 * helper for security or paywall gates; use `checkSwitchboardFlag` directly
 * for those so callers can fail closed with their own handling.
 */
export async function getServerFeatureFlags(req: SwitchboardRequest): Promise<ServerFeatureFlags> {
  let showPricingSection = false;

  try {
    showPricingSection = await checkSwitchboardFlag('appbuilder-pricing-section', req);
  } catch {
    // `checkSwitchboardFlag` logs lookup failures before re-throwing.
  }

  return {
    showPricingSection,
  }
}
