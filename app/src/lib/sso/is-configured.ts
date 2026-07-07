import type { SiteInfo } from '@/lib/control-plane/types';
import type { AiroMgmtClient } from '@/lib/mgmt-airo';
import { logger } from '@/lib/request-context';
import { resolveSsoPointerNames } from './pointer-names';

/**
 * Server-side check: are both SSO credential pointer rows (client_id +
 * client_secret) present in the app's `auth` secret group on hosting?
 *
 * Fails safe — any error returns `false` so callers block the operation
 * rather than falsely allowing it.
 */
export async function isSsoConfigured(
  client: AiroMgmtClient,
  site: SiteInfo,
  appId: string,
): Promise<boolean> {
  if (!site.ssoConfigId || !site.subscription_id || !site.system_id) {
    return false;
  }
  try {
    const names = resolveSsoPointerNames(site);
    const raw = await client.getSecrets(site.subscription_id, site.system_id, appId);
    const authSecrets = raw.auth?.secrets ?? [];
    const secretNames = new Set<string>(
      authSecrets
        .map((s) => (typeof s.name === 'string' ? s.name.toLowerCase() : undefined))
        .filter((n): n is string => typeof n === 'string'),
    );
    return secretNames.has(names.clientIdSecretName.toLowerCase())
      && secretNames.has(names.clientSecretSecretName.toLowerCase());
  } catch (err) {
    logger.warn('sso.is-configured.check-failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
