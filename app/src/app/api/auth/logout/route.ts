import { NextResponse } from 'next/server';

export async function POST() {
  try {
    // For Gasket auth, we just need to acknowledge the logout
    // The actual logout happens via SSO redirect in the client
    console.log('Logout API called');
   
    return NextResponse.json(
      { success: true, message: 'Logout acknowledged' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Logout API error:', error);
    return NextResponse.json(
      { success: false, error: 'Logout failed' },
      { status: 500 }
    );
  }
}
