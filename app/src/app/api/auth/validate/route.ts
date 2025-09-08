import { NextRequest, NextResponse } from 'next/server';
import { gdAuthService } from '@/lib/gd-auth-service';
import { isAuthDisabled } from '@/lib/gasket-config';
import { isFeatureEnabled } from '@/lib/features';
import { MOCK_USER } from '@/lib/mock-auth';
import { ensureTestUserExists } from '@/lib/database/seed-test-user';

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 Auth validation called - checking feature flags:', {
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_USE_MOCK_LOGIN: process.env.NEXT_PUBLIC_USE_MOCK_LOGIN,
      mockLoginEnabled: isFeatureEnabled.mockLogin(),
      authDisabled: isAuthDisabled()
    });

    // Handle mock authentication
    if (isFeatureEnabled.mockLogin()) {
      console.log('🚀 Mock auth validation - feature enabled');
      
      try {
        // Ensure test user account exists in database
        await ensureTestUserExists();
        console.log('✅ Test user ensured in database');
        
        // In mock mode, we check for a header or assume user is authenticated
        // The client-side should have already validated the user is logged in
        console.log('🚀 Mock auth validation - using test user');
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
        console.error('❌ Mock auth validation error:', error);
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
    if (isAuthDisabled()) {
      console.log('🔧 Auth validation bypassed - development mode (NEXT_PUBLIC_AUTH_IN_DEV=true)');
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
    // Extract token using gd-auth service
    const token = gdAuthService.extractTokenFromRequest(request);
    
    if (!token) {
      return NextResponse.json({ valid: false, reason: 'No token provided' }, { status: 401 });
    }

    // Use gd-auth for authentication (includes automatic heartbeat)
    const result = await gdAuthService.authenticate(token);

    // Log validation result
    console.log(result.valid ? '✅ [VALIDATE] Token is VALID' : '❌ [VALIDATE] Token is INVALID:', result.reason);

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
