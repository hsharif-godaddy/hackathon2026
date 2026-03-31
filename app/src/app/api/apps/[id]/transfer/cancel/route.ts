import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

const MGMT_AIRO_BASE_URL = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';

export const dynamic = 'force-dynamic';

// POST /api/apps/:id/transfer/cancel — Cancel transfer (POST to avoid CDN blocking DELETE)
export const POST = withCustomerAuth(async (
  _request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  try {
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const data = await new AiroMgmtClient({ baseUrl: MGMT_AIRO_BASE_URL, jwt: authContext.jwt }).cancelTransfer(id);
    logger.info('transfer.cancel.success', { appId: id });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof AiroHttpError) {
      logger.error('transfer.cancel.failed', { appId: id, status: error.status, error: error.body });
      return NextResponse.json(error.body || { error: error.statusText }, { status: error.status });
    }
    logger.error('transfer.cancel.error', {
      appId: id,
      error: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json({ error: 'Failed to cancel transfer' }, { status: 500 });
  }
}, { level: 3 });
