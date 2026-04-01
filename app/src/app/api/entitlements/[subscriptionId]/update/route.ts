import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// Deprecated: grants replaced entitlement updates. Remove this route once
// entitlements.api.update.disabled logs reach zero in production.

export const PUT = withCustomerAuth(async (_request: NextRequest, _authContext: CustomerAuthContext): Promise<NextResponse> => {
  logger.info('entitlements.api.update.disabled', {
    message: 'Entitlement update endpoint deprecated, grants always enabled',
  });
  return NextResponse.json(
    { error: 'This endpoint is deprecated. Use subscription plans for access control.' },
    { status: 410 }
  );
}, { level: 3 });
