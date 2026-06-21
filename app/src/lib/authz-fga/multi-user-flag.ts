import type { NextRequest } from 'next/server';

import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';

/**
 * Resolve the `aab-multi-user` Switchboard flag for a request.
 *
 * Centralizes the let/try/catch that every gated route would otherwise
 * duplicate, and — critically — treats a Switchboard outage as "off" (the safe
 * default). With the flag off, callers thread `false` into the control-plane
 * adapter so all shared-app discovery (the shared-apps listing) is skipped: no
 * extra latency, no chance of a shared row leaking into the GA population, and
 * existing single-user behavior is preserved exactly.
 */
export async function resolveMultiUserFlag(request: NextRequest): Promise<boolean> {
  try {
    return await checkSwitchboardFlag('aab-multi-user', request);
  } catch (err) {
    logger.warn('aab-multi-user.flag.lookupError', {
      error: err instanceof Error ? err.message : 'Unknown switchboard error',
    });
    return false;
  }
}
