import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { type AiroApiError, type AiroApiErrorV2, AiroHttpError, AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';
import { ApiErrorCode } from '@/utils/api-errors';

export const dynamic = 'force-dynamic';

/**
 * GET /api/jobs/[jobId] — async job status (e.g. CDN purge) from mgmt-airo.
 *
 * Job ownership is enforced by mgmt-airo: the JWT is forwarded to the
 * management API which validates that the requesting user has access to
 * the resource associated with the job.
 *
 * Domain modification progress uses GET /api/sites/[id]/domains/job?fqdn=... instead.
 */
export const GET = withCustomerAuth(async (
  _request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ jobId: string }> }
): Promise<NextResponse> => {
  let jobId: string | undefined;

  try {
    const resolved = await params;
    jobId = resolved.jobId;

    if (!jobId) {
      return NextResponse.json(
        { error: 'Job ID is required' },
        { status: 400 }
      );
    }

    if (!authContext.jwt) {
      return NextResponse.json(
        { code: ApiErrorCode.AUTH_REQUIRED, error: 'Authentication token required' },
        { status: 401 }
      );
    }

    logger.info('jobs.get.start', { jobId });

    const baseUrl = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
    const client = new AiroMgmtClient({ baseUrl, jwt: authContext.jwt });
    const job = await client.getJob(jobId);

    logger.info('jobs.get.success', { jobId, status: job.status });

    return NextResponse.json(job);
  } catch (error) {
    if (error instanceof AiroHttpError && error.status === 404) {
      logger.info('jobs.get.not-found', { jobId, message: 'Job not found' });
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    logger.error('jobs.get.error', {
      jobId,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorBody: error instanceof AiroHttpError ? JSON.stringify(error) : undefined,
    });

    let errorMessage: string | AiroApiError | AiroApiErrorV2 = 'Unknown error';

    if (error instanceof AiroHttpError) {
      errorMessage = error.body;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }

    return NextResponse.json(
      { error: 'Failed to fetch job status', details: errorMessage },
      { status: error instanceof AiroHttpError ? error.status : 500 }
    );
  }
});
