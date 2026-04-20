import { NextRequest, NextResponse } from 'next/server';

import { gdAuthService } from '@/lib/gd-auth-service';

export async function GET(request: NextRequest) {
  try {
    const token = gdAuthService.extractTokenFromRequest(request);

    if (!token) {
      return NextResponse.json(
        { valid: false, reason: 'No authentication token found' },
        { status: 401 }
      );
    }

    const result = await gdAuthService.authenticate(token);

    if (!result.valid) {
      return NextResponse.json(
        { valid: false, reason: result.reason || 'Authentication failed' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      valid: true,
      payload: result.payload,
      reason: 'Token validated'
    }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        valid: false,
        reason: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
