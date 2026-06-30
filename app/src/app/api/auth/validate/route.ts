import { NextRequest, NextResponse } from 'next/server';

import { withApmRoute } from '@/lib/apm-context';
import {
  getAccountNameFromRequestInfoIdpCookies,
  getEmailFromRequestInfoIdpCookies,
} from '@/lib/auth/info-idp-cookie';
import { isFeatureEnabled } from '@/lib/features';
import { MOCK_USER } from '@/lib/mock-auth';
import { logger } from '@/lib/request-context';

interface ValidatePayload {
  shopperId?: string;
  cid?: string;
  email?: string;
  name?: string;
  authType?: string;
  exp?: number;
  iat?: number;
  hbi?: number;
  per?: boolean;
}

interface AuthDetails {
  cid?: string;
  customerId?: string;
  shopperId?: string;
  email?: string;
  accountName?: string;
  type?: string;
}

function toAuthDetails(payload: ValidatePayload): AuthDetails {
  return {
    cid: payload.cid,
    customerId: payload.cid,
    shopperId: payload.shopperId,
    email: payload.email,
    accountName: payload.name,
    type: payload.authType,
  };
}

function enrichPayload(
  payload: ValidatePayload,
  cookies: { get: (name: string) => { value: string } | undefined },
): ValidatePayload {
  return {
    ...payload,
    email: payload.email ?? getEmailFromRequestInfoIdpCookies(cookies),
    name: payload.name ?? getAccountNameFromRequestInfoIdpCookies(cookies),
  };
}

async function validateHandler(request: NextRequest) {
  try {
    // Handle mock authentication
    if (isFeatureEnabled.mockLogin()) {
      try {
        // In mock mode, we check for a header or assume user is authenticated
        // The client-side should have already validated the user is logged in
        const payload: ValidatePayload = {
          shopperId: MOCK_USER.id,
          cid: MOCK_USER.id,
          email: MOCK_USER.email,
          name: MOCK_USER.name,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        };

        return NextResponse.json({
          valid: true,
          payload,
          details: toAuthDetails(payload),
          reason: 'Mock authentication - development mode'
        }, { status: 200 });
      } catch (error) {
        logger.error('auth.validate.mock.error', {
          message: 'Mock auth validation failed',
          error: error instanceof Error ? error.message : String(error)
        });
        return NextResponse.json(
          {
            valid: false,
            reason: `Mock authentication setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`
          },
          { status: 500 }
        );
      }
    }

    // Extract token using gd-auth service (lazy import)
    const { gdAuthService } = await import('@/lib/gd-auth-service');
    const token = gdAuthService.extractTokenFromRequest(request);

    if (!token) {
      return NextResponse.json({ valid: false, reason: 'No token provided' }, { status: 401 });
    }

    const levelParam = request.nextUrl.searchParams.get('level');
    const level: 1 | 2 | 3 = levelParam === '3' ? 3 : levelParam === '2' ? 2 : 1;

    // Use gd-auth for authentication (includes automatic heartbeat)
    const result = await gdAuthService.authenticate(token, level);
    const payload = result.payload
      ? enrichPayload(result.payload as ValidatePayload, request.cookies)
      : undefined;

    return NextResponse.json({
      valid: result.valid,
      payload,
      ...(payload ? { details: toAuthDetails(payload) } : {}),
      reason: result.reason,
      ...(result.authReason !== undefined ? { authReason: result.authReason } : {}),
      ...(payload?.authType ? { authType: payload.authType } : {})
    }, {
      status: result.valid ? 200 : 401
    });

  } catch (error) {
    return NextResponse.json(
      { valid: false, reason: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}

export const GET = withApmRoute(validateHandler);

// Handle POST requests as well (some auth flows might use POST)
export const POST = withApmRoute(validateHandler);
