/**
 * GET /api/switchboard
 *
 * Returns the Gasket switchboard tree for the authenticated user, split into
 * two objects: `hivemind` (experiment assignments) and `switchboard` (all other 
 * feature-flag values). Use whitelists to only return the keys that are allowed.
 */

import { NextRequest, NextResponse } from 'next/server';

import { CORS_ROUTES, createCorsOptionsHandler } from '@/lib/cors';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';
import { getSwitchboardTree } from '@/lib/switchboard/server';

const ALLOWED_EXPERIMENT_IDS: string[] = [];
const ALLOWED_SWITCHBOARD_CONFIGS: string[] = [];

export const dynamic = 'force-dynamic';

export const OPTIONS = createCorsOptionsHandler(CORS_ROUTES.GET_SWITCHBOARD);

export const GET = withCustomerAuth(
  async (request: NextRequest, _authContext: CustomerAuthContext): Promise<NextResponse> => {
    try {
      const tree = await getSwitchboardTree(request);

      const hivemind: Record<string, unknown> = {};
      const switchboard: Record<string, unknown> = {};

      for (const key of ALLOWED_EXPERIMENT_IDS) {
        if (key in tree) hivemind[key] = tree[key];
      }
      for (const key of ALLOWED_SWITCHBOARD_CONFIGS) {
        if (key in tree) switchboard[key] = tree[key];
      }

      return NextResponse.json({ hivemind, switchboard });
    } catch (error) {
      logger.error('api.switchboard.get.error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json({ error: 'Failed to fetch experiments and configs' }, { status: 500 });
    }
  },
  { addCorsHeaders: true, corsRoute: CORS_ROUTES.GET_SWITCHBOARD }
);
