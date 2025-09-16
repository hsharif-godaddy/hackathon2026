import { NextResponse } from 'next/server';
import { logger } from '@/lib/request-context';

export async function POST() {
  try {
    // For Gasket auth, we just need to acknowledge the logout
    // The actual logout happens via SSO redirect in the client
    logger.info('auth_logout', 'Logout API called');
   
    return NextResponse.json(
      { success: true, message: 'Logout acknowledged' },
      { status: 200 }
    );
  } catch (error) {
    logger.error('auth_logout', 'Logout API error', { error: error as Error });
    return NextResponse.json(
      { success: false, error: 'Logout failed' },
      { status: 500 }
    );
  }
}
