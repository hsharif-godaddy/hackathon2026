import { NextRequest, NextResponse } from 'next/server';
import { JWTValidator } from '@/lib/jwt-validator';
import { isAuthDisabled } from '@/lib/gasket-config';
import path from 'path';

const CERT_DIR = process.env.CERT_DIR || path.join(process.cwd(), 'certs');
const jwtValidator = new JWTValidator(CERT_DIR);

export async function GET(request: NextRequest) {
  try {
    // Skip JWT validation if auth is disabled in development
    if (isAuthDisabled()) {
      console.log('🔧 Auth validation bypassed - development mode (NEXT_PUBLIC_AUTH_IN_DEV=false)');
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
    // Get token from Authorization header or cookies
    let token = null;
    
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (authHeader?.includes('idp-jwt ')) {
      token = authHeader.split('idp-jwt ')[1];
    }
    
    if (!token) {
      const cookieToken = request.cookies.get('auth_idp')?.value;
      if (cookieToken) {
        token = cookieToken;
      }
    }

    if (!token) {
      return NextResponse.json({ valid: false, reason: 'No token provided' }, { status: 401 });
    }

    const result = await jwtValidator.validateJWT(token);
    
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
