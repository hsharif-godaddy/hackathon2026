/**
 * Auth-at-Edge SSO credential pointer-name resolution.
 *
 * The customer's IdP `client_id` and `client_secret` are stored in hosting
 * as TWO `auth`-class pointer rows named after the bound enterprise SSO
 * config's `client_id_secret_name` / `client_secret_secret_name` columns
 * (mhp-core schema). Those names are admin-overridable per config, so AAB
 * MUST read them dynamically from the per-app metadata airo-go surfaces.
 *
 * mhp-core PR #738 added `clientIdSecretName` / `clientSecretSecretName`
 * to the `GET /apps/:appId` response (populated when an SSO config is
 * bound; nil when unbound). AAB reads them off `SiteInfo`.
 *
 * The Phase-1 GD bootstrap config uses `GD_SSO_OAUTH_CLIENT_ID` /
 * `GD_SSO_OAUTH_CLIENT_SECRET` as the column defaults — kept here as
 * `DEFAULT_*` fallbacks so the BFF stays correct against environments
 * that haven't yet propagated the per-config names (older airo-go
 * builds, local-control-plane stub). Once both paths surface the
 * dynamic fields, the defaults can be deleted.
 *
 * SECURITY: callers must NEVER accept these names from the client
 * payload. A client-supplied pointer name would route credentials into
 * an attacker-chosen secret slot. Always resolve from `SiteInfo` (or
 * fall back to the defaults below) on the server.
 */

import type { SiteInfo } from '@/lib/control-plane/types';

//nolint:gosec — these are the reserved pointer-NAME defaults, not credentials.
export const DEFAULT_CLIENT_ID_SECRET_NAME: string = 'GD_SSO_OAUTH_CLIENT_ID';
//nolint:gosec — these are the reserved pointer-NAME defaults, not credentials.
export const DEFAULT_CLIENT_SECRET_SECRET_NAME: string = 'GD_SSO_OAUTH_CLIENT_SECRET';

export interface SsoCredentialPointerNames {
  clientIdSecretName: string;
  clientSecretSecretName: string;
}

/**
 * Resolve the per-app SSO credential pointer names from a `SiteInfo`,
 * falling back to the Phase-1 GD defaults when the per-config names
 * aren't surfaced (older airo-go, local-control-plane stub).
 *
 * Caller is responsible for verifying the app has a bound SSO config
 * (`site.ssoConfigId`) before calling — this function returns names
 * unconditionally for backstop simplicity.
 *
 * Defense-in-depth: the two names must differ (otherwise the second
 * write would clobber the first), and neither may collide with the
 * reserved cache-row name `SSO_OAUTH_CONFIG`. Both invariants are
 * enforced server-side by mhp-core's validator; this is a fast-fail
 * on AAB to surface misconfigured upstream data with a clear error.
 */
export function resolveSsoPointerNames(site: Pick<SiteInfo, 'clientIdSecretName' | 'clientSecretSecretName'>): SsoCredentialPointerNames {
  const clientIdSecretName: string = site.clientIdSecretName || DEFAULT_CLIENT_ID_SECRET_NAME;
  const clientSecretSecretName: string = site.clientSecretSecretName || DEFAULT_CLIENT_SECRET_SECRET_NAME;
  if (clientIdSecretName === clientSecretSecretName) {
    throw new Error('SSO pointer-names must differ');
  }
  const lowered: string[] = [clientIdSecretName.toLowerCase(), clientSecretSecretName.toLowerCase()];
  if (lowered.includes('sso_oauth_config')) {
    throw new Error('SSO pointer-name must not collide with the reserved cache row');
  }
  return { clientIdSecretName, clientSecretSecretName };
}
