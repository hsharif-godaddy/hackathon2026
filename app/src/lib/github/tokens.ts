import { getControlPlaneAdapter } from '@/lib/control-plane';
import { logger } from '@/lib/request-context';
import {
  ALL_GITHUB_SECRETS,
  GITHUB_REFRESH_TOKEN_SECRET,
  GITHUB_TOKEN_EXPIRES_AT_SECRET,
  GITHUB_TOKEN_SECRET,
  TOKEN_REFRESH_BUFFER_SECONDS,
} from './constants';
import { refreshAccessToken } from './oauth';

export interface GitHubTokenData {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
}

export async function load(appId: string, jwt: string): Promise<GitHubTokenData | null> {
  const adapter = getControlPlaneAdapter();
  const result = await adapter.getProtectedSecrets(appId, jwt);

  const secretMap = new Map(result.secrets.map((s: { name: string; value?: string }) => [s.name, s.value]));

  const accessToken = secretMap.get(GITHUB_TOKEN_SECRET);
  if (!accessToken) return null;

  const rawExpiry = secretMap.get(GITHUB_TOKEN_EXPIRES_AT_SECRET);
  return {
    accessToken,
    refreshToken: secretMap.get(GITHUB_REFRESH_TOKEN_SECRET) || null,
    expiresAt: rawExpiry ? Number(rawExpiry) : null,
  };
}

export function isExpired(tokenData: GitHubTokenData): boolean {
  if (tokenData.expiresAt === null) return false;
  return Math.floor(Date.now() / 1000) >= (tokenData.expiresAt - TOKEN_REFRESH_BUFFER_SECONDS);
}

export async function save(appId: string, jwt: string, tokenData: GitHubTokenData): Promise<void> {
  const adapter = getControlPlaneAdapter();
  const additions = [
    { name: GITHUB_TOKEN_SECRET, value: tokenData.accessToken },
  ];
  if (tokenData.refreshToken) {
    additions.push({ name: GITHUB_REFRESH_TOKEN_SECRET, value: tokenData.refreshToken });
  }
  if (tokenData.expiresAt !== null) {
    additions.push({ name: GITHUB_TOKEN_EXPIRES_AT_SECRET, value: String(tokenData.expiresAt) });
  }
  await adapter.updateProtectedSecrets(appId, ['preview', 'publish'], { additions }, jwt);
}

export async function remove(appId: string, jwt: string): Promise<void> {
  const adapter = getControlPlaneAdapter();
  await adapter.updateProtectedSecrets(appId, ['preview', 'publish'], {
    deletions: [...ALL_GITHUB_SECRETS],
  }, jwt);
}

/**
 * Resolve a valid GitHub access token for the given app.
 * Automatically refreshes if expired.
 */
export async function resolve(appId: string, jwt: string): Promise<string> {
  const tokenData = await load(appId, jwt);
  if (!tokenData) {
    throw new Error('No GitHub token found');
  }

  if (isExpired(tokenData) && tokenData.refreshToken) {
    logger.info('github.tokens.refreshing', { appId });
    const refreshed = await refreshAccessToken(tokenData.refreshToken);

    const updated: GitHubTokenData = {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresAt: Math.floor(Date.now() / 1000) + refreshed.expires_in,
    };

    await save(appId, jwt, updated);
    return updated.accessToken;
  }

  return tokenData.accessToken;
}
