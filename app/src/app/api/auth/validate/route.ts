import { NextRequest, NextResponse } from 'next/server';
// Lazy import to avoid initializing gd-auth during module loading
import { isAuthDisabled } from '@/lib/gasket-config';
import { isFeatureEnabled } from '@/lib/features';
import { MOCK_USER } from '@/lib/mock-auth';
import { logger } from '@/lib/request-context';
import { ensureTestUserExists } from '@/lib/database/seed-test-user';

export async function GET(request: NextRequest) {
  try {
    logger.debug('auth.validate.check', {
      message: 'Auth validation called - checking feature flags',
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_USE_MOCK_LOGIN: process.env.NEXT_PUBLIC_USE_MOCK_LOGIN,
      mockLoginEnabled: isFeatureEnabled.mockLogin(),
      authDisabled: await isAuthDisabled()
    });

    // Handle mock authentication
    if (isFeatureEnabled.mockLogin()) {
      logger.info('auth.validate.mock.enabled', { message: 'Mock auth validation - feature enabled' });

      try {
        // Ensure test user account exists in database
        await ensureTestUserExists();

        // In mock mode, we check for a header or assume user is authenticated
        // The client-side should have already validated the user is logged in
        return NextResponse.json({
          valid: true,
          payload: {
            shopperId: MOCK_USER.id,
            cid: MOCK_USER.id,
            email: MOCK_USER.email,
            name: MOCK_USER.name,
            exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
            iat: Math.floor(Date.now() / 1000)
          },
          reason: 'Mock authentication - development mode'
        }, { status: 200 });
      } catch (error) {
        logger.error('❌ Mock auth validation error:', error);
        return NextResponse.json(
          {
            valid: false,
            reason: `Mock authentication setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`
          },
          { status: 500 }
        );
      }
    }

    // Skip JWT validation if auth is disabled in development
    if (await isAuthDisabled()) {
      logger.info('auth.validate.dev.bypassed', { message: 'Auth validation bypassed - development mode' });
      return NextResponse.json({
        valid: true,
        payload: {
          shopperId: "dev-user",
          cid: "dev-customer-123",
          exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
          iat: Math.floor(Date.now() / 1000)
        },
        reason: 'Development mode - authentication disabled'
      }, { status: 200 });
    }
    // Extract token using gd-auth service (lazy import)
    const { gdAuthService } = await import('@/lib/gd-auth-service');
    const token = gdAuthService.extractTokenFromRequest(request);

    if (!token) {
      return NextResponse.json({ valid: false, reason: 'No token provided' }, { status: 401 });
    }

    // Use gd-auth for authentication (includes automatic heartbeat)
    const result = await gdAuthService.authenticate(token);

    // Log validation result
    if (result.valid) {
      logger.info('auth.validate.token.valid', { message: 'Token is VALID' });
    } else {
      logger.warn('auth.validate.token.invalid', { message: 'Token is INVALID', reason: result.reason });
    }

    // Since the authorization check is being removed, default to authorized.

    return NextResponse.json({
      valid: result.valid,
      payload: result.payload,
      reason: result.reason
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

// Handle POST requests as well (some auth flows might use POST)
export async function POST(request: NextRequest) {
  return GET(request);
}
