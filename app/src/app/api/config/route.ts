import { NextResponse } from 'next/server';

// Server-side configuration that can access actual environment variables
const getServerConfig = () => {
  return {
    auth: {
      realm: 'idp',
      risk: 'low',
      type: ['basic'],
      disableInDev: process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_AUTH_IN_DEV === 'true'
    },
    sso: {
      loginUrl: process.env.NEXT_PUBLIC_SSO_LOGIN_URL || 'https://sso.test-godaddy.com/login',
      logoutUrl: process.env.NEXT_PUBLIC_SSO_LOGOUT_URL || 'https://sso.test-godaddy.com/logout'
    },
    redirects: {
      loginRedirectUrl: process.env.NEXT_PUBLIC_LOGIN_REDIRECT_URL || 'https://airo-builder.test-godaddy.com/',
      logoutRedirectUrl: process.env.NEXT_PUBLIC_LOGOUT_REDIRECT_URL || 'https://airo-builder.test-godaddy.com/'
    }
  };
};

export async function GET() {
  try {
    const config = getServerConfig();

    return NextResponse.json(config, {
      headers: {
        // Cache for 5 minutes to avoid excessive requests
        'Cache-Control': 'public, max-age=300'
      },
    });
  } catch (error) {
    console.error('Error fetching server config:', error);
    return NextResponse.json(
      { error: 'Failed to fetch configuration' },
      { status: 500 }
    );
  }
}
