import { NextRequest, NextResponse } from 'next/server';

import { createCustomerAuthError, type CustomerAuthContext, customerHasAccount, withCustomerAuth } from '@/lib/customer-auth';
import { encryptReferralId } from '@/lib/referral-crypto';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/**
 * GET /api/referral-link - Generate a secure referral ID for the authenticated user
 *
 * Creates a short referral ID using the user's shopperId (numeric, ideal for compression).
 * The ID can be used by the frontend to construct shareable referral links.
 *
 * @param request - The incoming Next.js request
 * @returns NextResponse with the generated referral ID or error
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/referral-link');
 * const data = await response.json();
 * console.log(data.referralId);
 * // "dKV2-a1b2"
 * ```
 */
export const GET = withCustomerAuth(async (
  _request: NextRequest,
  authContext: CustomerAuthContext
) => {
  try {
    const { user } = authContext;

    // Customer must have an account to generate a referral ID
    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to generate a referral link', 403);
    }

    const shopperId = user.shopperId;

    if (!shopperId) {
      logger.error('referral-link.generate.no_id', {
        hasShopperId: !!user.shopperId
      });
      return NextResponse.json(
        { error: 'Unable to generate referral ID: missing shopper identifier' },
        { status: 400 }
      );
    }

    const referralId = encryptReferralId(shopperId);

    logger.info('referral-link.generated', {
      shopperId: shopperId
    });

    return NextResponse.json({ referralId });

  } catch (error) {
    logger.error('referral-link.generate.error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return NextResponse.json(
      { error: 'Failed to generate referral ID' },
      { status: 500 }
    );
  }
});
