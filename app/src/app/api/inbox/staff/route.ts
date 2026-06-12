/**
 * GET /api/inbox/staff?brandId={uuid}
 *   Fetch the authenticated staff member (self) from Reamaze.
 *
 * PUT /api/inbox/staff
 *   Body: { brandId, staffId, notificationEmail }
 *   Update the staff member's notification email.
 */

import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { getReamazeHost, UUID_RE } from '@/lib/inbox/reamaze-host';
import { logger } from '@/lib/request-context';
import { ApiErrorCode } from '@/utils/api-errors';

export const dynamic = 'force-dynamic';

export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
): Promise<NextResponse> => {
  if (!authContext.jwt) {
    return NextResponse.json(
      { code: ApiErrorCode.AUTH_REQUIRED, error: 'Authentication token required' },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get('brandId');

  if (!brandId || !UUID_RE.test(brandId)) {
    return NextResponse.json({ error: 'brandId (valid UUID) is required' }, { status: 400 });
  }

  const REAMAZE_HOST = getReamazeHost();
  const url = `https://${brandId}.${REAMAZE_HOST}/api/v2/staff/self`;

  logger.info('inbox.staff.fetch.start', { brandId });

  const upstream = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `sso-jwt ${authContext.jwt}` },
  }).catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.staff.fetch.exception', { brandId, error: e.message });
    return null;
  });

  if (!upstream) {
    return NextResponse.json({ error: 'Failed to fetch staff from Reamaze' }, { status: 502 });
  }

  if (!upstream.ok) {
    const errorData = await upstream.json().catch(() => ({}));
    logger.warn('inbox.staff.fetch.error', { brandId, status: upstream.status, error: errorData });
    return NextResponse.json(
      { error: errorData.error || `Reamaze returned ${upstream.status}` },
      { status: upstream.status },
    );
  }

  const data = await upstream.json().catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.staff.parse.exception', { brandId, error: e.message });
    return null;
  });

  if (!data || typeof data !== 'object') {
    return NextResponse.json({ error: 'Invalid response from Reamaze' }, { status: 502 });
  }

  logger.info('inbox.staff.fetch.success', { brandId });
  return NextResponse.json(data);
});

interface UpdateStaffBody {
  brandId?: string;
  staffId?: number;
  notificationEmail?: string;
}

export const PUT = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
): Promise<NextResponse> => {
  if (!authContext.jwt) {
    return NextResponse.json(
      { code: ApiErrorCode.AUTH_REQUIRED, error: 'Authentication token required' },
      { status: 401 },
    );
  }

  const parsed = await request.json().catch(() => null) as UpdateStaffBody | null;
  if (!parsed) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { brandId, staffId, notificationEmail } = parsed;

  if (!brandId || !UUID_RE.test(brandId)) {
    return NextResponse.json({ error: 'brandId (valid UUID) is required' }, { status: 400 });
  }

  if (typeof staffId !== 'number' || !Number.isInteger(staffId) || staffId <= 0) {
    return NextResponse.json({ error: 'staffId (positive integer) is required' }, { status: 400 });
  }

  if (typeof notificationEmail !== 'string' || notificationEmail.trim().length === 0) {
    return NextResponse.json({ error: 'notificationEmail is required' }, { status: 400 });
  }

  const REAMAZE_HOST = getReamazeHost();
  const url = `https://${brandId}.${REAMAZE_HOST}/api/v2/staff/${staffId}`;

  logger.info('inbox.staff.update.start', { brandId, staffId });

  const upstream = await fetch(url, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `sso-jwt ${authContext.jwt}`,
    },
    body: JSON.stringify({ notification_email: notificationEmail.trim() }),
  }).catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.staff.update.exception', { brandId, staffId, error: e.message });
    return null;
  });

  if (!upstream) {
    return NextResponse.json({ error: 'Failed to update staff in Reamaze' }, { status: 502 });
  }

  if (!upstream.ok) {
    const errorData = await upstream.json().catch(() => ({}));
    logger.warn('inbox.staff.update.error', { brandId, staffId, status: upstream.status, error: errorData });
    return NextResponse.json(
      { error: errorData.error || `Reamaze returned ${upstream.status}` },
      { status: upstream.status },
    );
  }

  const data = await upstream.json().catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.staff.update.parse.exception', { brandId, staffId, error: e.message });
    return null;
  });

  if (!data || typeof data !== 'object') {
    return NextResponse.json({ error: 'Invalid response from Reamaze' }, { status: 502 });
  }

  logger.info('inbox.staff.update.success', { brandId, staffId });
  return NextResponse.json(data);
});
