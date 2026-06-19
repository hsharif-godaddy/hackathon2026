export interface AuthzFgaConfig {
  baseUrl: string;
  storeId: string;
  oauthTokenUrl: string;
  clientId: string;
  clientSecret: string;
  modelId?: string;
}

function trimEnv(name: string): string | undefined {
  const v = process.env[name];
  if (v === undefined || v === '') {
    return undefined;
  }
  return v.trim();
}

/**
 * Whether the FGA local-mock bypass is active.
 *
 * `AUTHZ_FGA_LOCAL_MOCK=true` makes every FGA primitive a no-op (check → true,
 * enforce → allow, write → skip). That is an *auth bypass*, so it must only be
 * honored in local development — never in a deployed environment, where a
 * leaked env var would silently pass every authorization check.
 *
 * We key the deployed-vs-local decision on `NODE_ENV` only: every deployed
 * Gasket environment (development/test/production) is served from a `next build`
 * artifact, so `NODE_ENV === 'production'` there. Local dev runs `next dev`
 * (`NODE_ENV=development`) and unit tests run with `NODE_ENV=test`, both of which
 * legitimately honor the mock. (We deliberately do NOT read the Gasket env token
 * here — Gasket's webpack plugin forbids that server-only token in any module
 * that can reach a browser bundle, and `NODE_ENV` fully captures the
 * deployed-vs-local distinction anyway.)
 */
export function isAuthzFgaLocalMock(): boolean {
  if (process.env.AUTHZ_FGA_LOCAL_MOCK !== 'true') {
    return false;
  }
  if (process.env.NODE_ENV === 'production') {
    // Misconfiguration: ignore the bypass rather than disabling all auth.
    console.error('authz-fga: AUTHZ_FGA_LOCAL_MOCK ignored in deployed (production) build');
    return false;
  }
  return true;
}

/**
 * OpenFGA + OAuth settings for BFF → authz-fga (client_credentials).
 * Returns null when not configured (caller should skip FGA checks).
 */
export function getAuthzFgaConfig(): AuthzFgaConfig | null {
  if (isAuthzFgaLocalMock()) {
    return {
      baseUrl: 'http://localhost:8080',
      storeId: 'local-mock',
      oauthTokenUrl: 'http://localhost:8080/token',
      clientId: 'mock',
      clientSecret: 'mock',
    };
  }

  const baseUrl = trimEnv('AUTHZ_FGA_BASE_URL');
  const storeId = trimEnv('AUTHZ_FGA_STORE_ID');
  const oauthTokenUrl = trimEnv('AUTHZ_FGA_OAUTH_TOKEN_URL');
  const clientId = trimEnv('AUTHZ_FGA_CLIENT_ID');
  const clientSecret = trimEnv('AUTHZ_FGA_CLIENT_SECRET');
  if (!baseUrl || !storeId || !oauthTokenUrl || !clientId || !clientSecret) {
    return null;
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    storeId,
    oauthTokenUrl,
    clientId,
    clientSecret,
    modelId: trimEnv('AUTHZ_FGA_MODEL_ID'),
  };
}
