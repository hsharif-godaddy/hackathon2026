import { NextResponse } from 'next/server';

import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag, type SwitchboardRequest } from '@/lib/switchboard/server';
import { SWITCHBOARD_FLAG } from './constants';

/**
 * Check if GitHub sync feature is enabled for the current request.
 * Fails closed — Switchboard errors result in false.
 */
export async function isEnabled(request: SwitchboardRequest): Promise<boolean> {
  try {
    return await checkSwitchboardFlag(SWITCHBOARD_FLAG, request);
  } catch (err) {
    logger.error('github.gate.switchboard.error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Returns a 403 response if the feature is disabled, or null if it's enabled.
 */
export async function enforce(request: SwitchboardRequest): Promise<NextResponse | null> {
  if (await isEnabled(request)) return null;
  return NextResponse.json(
    { error: 'GitHub sync is not currently enabled' },
    { status: 403 },
  );
}
