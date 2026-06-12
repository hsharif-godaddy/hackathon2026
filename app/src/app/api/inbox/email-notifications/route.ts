/**
 * GET /api/inbox/email-notifications?brandId={uuid}
 *   Fetch the email-notifications on/off setting from Reamaze.
 *
 * PUT /api/inbox/email-notifications
 *   Body: { brandId, emailNotifications }
 *   Update the email-notifications on/off setting.
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
  const url = `https://${brandId}.${REAMAZE_HOST}/api/v2/email_notifications`;

  logger.info('inbox.emailNotifications.fetch.start', { brandId });

  const upstream = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `sso-jwt ${authContext.jwt}` },
  }).catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.emailNotifications.fetch.exception', { brandId, error: e.message });
    return null;
  });

  if (!upstream) {
    return NextResponse.json({ error: 'Failed to fetch email notifications from Reamaze' }, { status: 502 });
  }

  if (!upstream.ok) {
    const errorData = await upstream.json().catch(() => ({}));
    logger.warn('inbox.emailNotifications.fetch.error', { brandId, status: upstream.status, error: errorData });
    return NextResponse.json(
      { error: errorData.error || `Reamaze returned ${upstream.status}` },
      { status: upstream.status },
    );
  }

  const data = await upstream.json().catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.emailNotifications.parse.exception', { brandId, error: e.message });
    return null;
  });

  if (!data || typeof data !== 'object') {
    return NextResponse.json({ error: 'Invalid response from Reamaze' }, { status: 502 });
  }

  logger.info('inbox.emailNotifications.fetch.success', { brandId });
  return NextResponse.json(data);
});

interface UpdateEmailNotificationsBody {
  brandId?: string;
  emailNotifications?: boolean;
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

  const parsed = await request.json().catch(() => null) as UpdateEmailNotificationsBody | null;
  if (!parsed) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { brandId, emailNotifications } = parsed;

  if (!brandId || !UUID_RE.test(brandId)) {
    return NextResponse.json({ error: 'brandId (valid UUID) is required' }, { status: 400 });
  }

  if (typeof emailNotifications !== 'boolean') {
    return NextResponse.json({ error: 'emailNotifications (boolean) is required' }, { status: 400 });
  }

  const REAMAZE_HOST = getReamazeHost();
  const url = `https://${brandId}.${REAMAZE_HOST}/api/v2/email_notifications`;

  logger.info('inbox.emailNotifications.update.start', { brandId, emailNotifications });

  const upstream = await fetch(url, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `sso-jwt ${authContext.jwt}`,
    },
    body: JSON.stringify({ email_notifications: emailNotifications }),
  }).catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.emailNotifications.update.exception', { brandId, error: e.message });
    return null;
  });

  if (!upstream) {
    return NextResponse.json({ error: 'Failed to update email notifications in Reamaze' }, { status: 502 });
  }

  if (!upstream.ok) {
    const errorData = await upstream.json().catch(() => ({}));
    logger.warn('inbox.emailNotifications.update.error', { brandId, status: upstream.status, error: errorData });
    return NextResponse.json(
      { error: errorData.error || `Reamaze returned ${upstream.status}` },
      { status: upstream.status },
    );
  }

  const data = await upstream.json().catch((err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error('inbox.emailNotifications.update.parse.exception', { brandId, error: e.message });
    return null;
  });

  if (!data || typeof data !== 'object') {
    return NextResponse.json({ error: 'Invalid response from Reamaze' }, { status: 502 });
  }

  logger.info('inbox.emailNotifications.update.success', { brandId });
  return NextResponse.json(data);
});
