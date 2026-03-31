import { NextRequest, NextResponse } from 'next/server';

import {
  type CustomerAuthContext,
  withCustomerAuth
} from '@/lib/customer-auth';
import { AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

// Job ownership is enforced by mgmt-airo: the JWT is forwarded to the
// management API which validates that the requesting user has access to
// the resource associated with the job.
export const GET = withCustomerAuth(async (
  _request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ jobId: string }> }
): Promise<NextResponse> => {
  const { jobId } = await params;
  const { jwt } = authContext;

  try {
    if (!jobId) {
      return NextResponse.json(
        { error: 'Job ID is required' },
        { status: 400 }
      );
    }

    if (!jwt) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const job = await new AiroMgmtClient({ baseUrl, jwt }).getJob(jobId);

    return NextResponse.json(job);

  } catch (error) {
    logger.error('jobs.get.error', {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });

    const status = error instanceof AiroHttpError ? error.status : 500;
    return NextResponse.json(
      { error: 'Failed to fetch job status' },
      { status }
    );
  }
});
