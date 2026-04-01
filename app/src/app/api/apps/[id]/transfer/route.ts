import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

const MGMT_AIRO_BASE_URL = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';

export const dynamic = 'force-dynamic';

function createClient(jwt: string) {
  return new AiroMgmtClient({ baseUrl: MGMT_AIRO_BASE_URL, jwt });
}

// POST /api/apps/:id/transfer — Initiate transfer
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  try {
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    let body: { targetEmail?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }

    if (!body.targetEmail) {
      return NextResponse.json({ error: 'targetEmail is required' }, { status: 400 });
    }

    const data = await createClient(authContext.jwt).initiateTransfer(id, body.targetEmail);
    logger.info('transfer.initiate.success', { appId: id, status: data.status });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    if (error instanceof AiroHttpError) {
      logger.error('transfer.initiate.failed', { appId: id, status: error.status, error: error.body });
      return NextResponse.json(error.body || { error: error.statusText }, { status: error.status });
    }
    logger.error('transfer.initiate.error', {
      appId: id,
      error: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json({ error: 'Failed to initiate transfer' }, { status: 500 });
  }
}, { level: 3 });

// GET /api/apps/:id/transfer — Get transfer metadata (initiator)
export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  try {
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const transferToken = new URL(request.url).searchParams.get('transferToken') || undefined;
    const data = await createClient(authContext.jwt).getTransferMetadata(id, transferToken);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof AiroHttpError) {
      return NextResponse.json(error.body || { error: error.statusText }, { status: error.status });
    }
    logger.error('transfer.metadata.error', {
      appId: id,
      error: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json({ error: 'Failed to get transfer metadata' }, { status: 500 });
  }
});

// DELETE /api/apps/:id/transfer — Cancel transfer
export const DELETE = withCustomerAuth(async (
  _request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  try {
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const data = await createClient(authContext.jwt).cancelTransfer(id);
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
