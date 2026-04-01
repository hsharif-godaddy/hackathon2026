import { NextRequest, NextResponse } from 'next/server';

import { CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/** GET /api/projects - Stub: always returns empty projects (grants always enabled) */
export const GET = withCustomerAuth(
  async (_request: NextRequest, authContext: CustomerAuthContext) => {
    const { user } = authContext;
    logger.info('api.projects.get.skipped', {
      message: 'Projects endpoint disabled, grants always enabled',
      customerId: user.customerId,
    });
    return NextResponse.json({
      success: true,
      data: {
        projects: {
          edges: [],
          pageInfo: {
            hasNextPage: false,
            endCursor: null,
          },
        },
      },
    });
  }
);
