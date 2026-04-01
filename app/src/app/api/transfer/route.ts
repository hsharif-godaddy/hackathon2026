import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

const MGMT_AIRO_BASE_URL = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';

export const dynamic = 'force-dynamic';

function createClient(jwt: string) {
  return new AiroMgmtClient({ baseUrl: MGMT_AIRO_BASE_URL, jwt });
}

// POST /api/transfer — Accept transfer
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext
) => {
  try {
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    let body: { transferToken?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }

    if (!body.transferToken) {
      return NextResponse.json({ error: 'transferToken is required' }, { status: 400 });
    }

    const data = await createClient(authContext.jwt).acceptTransfer(body.transferToken);
    logger.info('transfer.accept.success', { status: data.status, appId: data.appId });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof AiroHttpError) {
      logger.error('transfer.accept.failed', { status: error.status, error: error.body });
      return NextResponse.json(error.body || { error: error.statusText }, { status: error.status });
    }
    logger.error('transfer.accept.error', {
      error: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json({ error: 'Failed to accept transfer' }, { status: 500 });
  }
}, { level: 3 });

// GET /api/transfer — Get transfer metadata by transferToken
export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext
) => {
  try {
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const transferToken = searchParams.get('transferToken');

    if (!transferToken) {
      return NextResponse.json({ error: 'transferToken is required' }, { status: 400 });
    }

    const data = await createClient(authContext.jwt).getTransferMetadataByToken(transferToken);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof AiroHttpError) {
      return NextResponse.json(error.body || { error: error.statusText }, { status: error.status });
    }
    logger.error('transfer.metadata.error', {
      error: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json({ error: 'Failed to fetch transfer metadata' }, { status: 500 });
  }
});
