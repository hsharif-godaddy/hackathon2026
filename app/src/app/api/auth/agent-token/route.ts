/**
 * Agent Token Endpoint
 * Creates simple JWT tokens for agent communication
 * POST /api/auth/agent-token
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJWTService } from '@/lib/jwt-service';

export interface CreateAgentTokenRequest {
  siteId: string;
}

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body: CreateAgentTokenRequest = await request.json();
    
    if (!body.siteId) {
      return NextResponse.json({ 
        error: 'siteId is required' 
      }, { status: 400 });
    }

    // Create simple JWT token (no complex auth dependencies)
    const jwtService = getJWTService();
    const result = await jwtService.getToken({
      siteId: body.siteId
    });

    return NextResponse.json({
      token: result.token,
      expires: result.expires.toISOString(),
      siteId: body.siteId,
      type: 'jwt'
    });

  } catch (error) {
    return NextResponse.json({ 
      error: 'Token creation failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
