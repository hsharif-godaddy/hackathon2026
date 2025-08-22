import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const realm = searchParams.get('realm') || 'idp';
    const risk = searchParams.get('risk') || 'low';
    
    // Check for authentication indicators
    const cookies = request.cookies;
    const authIdpCookie = cookies.get('auth_idp'); // Real GoDaddy SSO cookie
    const hasAuthHeaders = request.headers.get('authorization');
    
    // Determine if user is authenticated
    let isAuthenticated = false;
    let userDetails = null;
    let reason = 'No valid authentication found';

    if (authIdpCookie) {
      // Found GoDaddy SSO auth_idp cookie - mock validation (return authenticated)
      isAuthenticated = true;
      userDetails = {
        accountName: 'SSO User',
        email: 'ssouser@godaddy.com',
        customerId: 'sso_' + Date.now(),
        plid: 'plid_' + Date.now(),
        groups: ['user']
      };
      reason = 'Valid GoDaddy SSO authentication';
    } else if (hasAuthHeaders) {
      // Fallback for other auth methods
      isAuthenticated = true;
      userDetails = {
        accountName: 'Authenticated User',
        email: 'user@godaddy.com',
        customerId: 'cust_' + Date.now(),
        groups: ['user']
      };
      reason = 'Valid authentication token found';
    }

    const authState = {
      valid: isAuthenticated,
      realm,
      risk,
      reason,
      details: userDetails,
      timestamp: Date.now()
    };

    // Return JSON response that Gasket auth expects
    return NextResponse.json(authState, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
    
  } catch {
    // Return error state in expected format
    return NextResponse.json(
      {
        valid: false,
        realm: 'idp',
        risk: 'low',
        reason: 'Authentication check failed',
        details: null,
        timestamp: Date.now()
      },
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  }
}

// Handle POST requests as well (some auth flows might use POST)
export async function POST(request: NextRequest) {
  return GET(request);
}
