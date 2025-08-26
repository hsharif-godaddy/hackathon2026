// Gasket configuration for Airo App Builder authentication
export const gasketConfig = {
  auth: {
    realm: 'idp', // Use 'idp' for customer auth, 'jomax' for employee auth
    risk: 'low',   // Security risk level: low, medium, high
    type: ['basic'], // Auth types allowed
    // Dev flag to bypass authentication entirely
    disableInDev: process.env.NODE_ENV === 'development' 
      ? process.env.NEXT_PUBLIC_AUTH_IN_DEV !== 'true' 
      : false,
  },
  // SSO configuration
  sso: {
    loginUrl: process.env.NEXT_PUBLIC_SSO_LOGIN_URL || 'https://sso.test-godaddy.com/login',
    logoutUrl: process.env.NEXT_PUBLIC_SSO_LOGOUT_URL || 'https://sso.test-godaddy.com/logout',
  },
  // Redirect URLs configuration
  redirects: {
    loginRedirectUrl: process.env.NEXT_PUBLIC_LOGIN_REDIRECT_URL || 'https://airo-builder.test-godaddy.com/',
    logoutRedirectUrl: process.env.NEXT_PUBLIC_LOGOUT_REDIRECT_URL || 'https://airo-builder.test-godaddy.com/',
  }
};

// Auth configuration options for different parts of the app
export const authConfigs = {
  // Basic user access for most pages
  user: {
    realm: 'idp',
    risk: 'low',
    type: ['basic']
  },
  // Admin access for administrative functions
  admin: {
    realm: 'jomax',
    risk: 'medium',
    groups: ['admin', 'developer']
  },
  // High security for sensitive operations
  sensitive: {
    realm: 'idp',
    risk: 'high',
    type: ['basic']
  }
};

// Helper function to get login URL with redirect
export function getLoginUrl(returnUrl?: string): string {
  const baseUrl = gasketConfig.sso.loginUrl;
  // Use configured redirect URL or provided returnUrl
  const redirectUrl = returnUrl || gasketConfig.redirects.loginRedirectUrl;
  const params = new URLSearchParams({
    app: 'airo-builder',
    redirect: redirectUrl
  });
  return `${baseUrl}?${params.toString()}`;
}

// Helper function to get logout URL
export function getLogoutUrl(): string {
  const baseUrl = gasketConfig.sso.logoutUrl;
  const params = new URLSearchParams({
    app: 'airo-builder',
    redirect: gasketConfig.redirects.logoutRedirectUrl
  });
  return `${baseUrl}?${params.toString()}`;
}

// Helper function to check if auth is disabled in dev
export function isAuthDisabled(): boolean {
  return gasketConfig.auth.disableInDev;
}

// Helper function to use appropriate fetch method
export async function appFetch(url: string, options?: RequestInit): Promise<Response> {
  if (isAuthDisabled()) {
    return fetch(url, options);
  }
  
  // Import authFetch dynamically to avoid loading it when not needed
  const { authFetch } = await import('@godaddy/gasket-auth');
  return authFetch(url, options);
}
