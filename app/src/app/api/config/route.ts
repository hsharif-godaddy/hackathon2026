import { NextResponse } from 'next/server';
import { logger } from '@/lib/request-context';
import { auth, authUtils } from '@/lib/features';

// Server-side configuration that can access actual environment variables
const getServerConfig = () => {
  // Use server-side environment variables (runtime, not build-time)
  const loginUrl = process.env.SSO_LOGIN_URL;
  const logoutUrl = process.env.SSO_LOGOUT_URL;
  const loginRedirectUrl = process.env.LOGIN_REDIRECT_URL;
  const logoutRedirectUrl = process.env.LOGOUT_REDIRECT_URL;

  return {
    auth: {
      realm: 'idp',
      risk: 'low',
      type: authUtils.getSupportedAuthTypes(),
      authType: auth.getType(),
      isDisabled: auth.isDisabled(),
      isMock: auth.isMock(),
      isJWT: auth.isJWT(),
      allowHeartbeat: true,
      use12HourExpiration: true
    },
    sso: {
      loginUrl: loginUrl || 'https://sso.test-godaddy.com/login',
      logoutUrl: logoutUrl || 'https://sso.test-godaddy.com/logout'
    },
    redirects: {
      loginRedirectUrl: loginRedirectUrl || 'https://airo-builder.test-godaddy.com/',
      logoutRedirectUrl: logoutRedirectUrl || 'https://airo-builder.test-godaddy.com/'
    }
  };
};

// Force dynamic rendering to ensure runtime environment variables are used
export const dynamic = 'force-dynamic';

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
    logger.error('api_config', 'Error fetching server config', { error: error as Error });
    return NextResponse.json(
      { error: 'Failed to fetch configuration' },
      { status: 500 }
    );
  }
}
