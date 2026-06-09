import { logger } from '@/lib/request-context';
import { get as getConfig } from './config';
import { proxy } from './proxy';
import { resolve } from './tokens';

interface GitHubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
}

export type GitHubConnectionStatus =
  | { connected: false; user?: undefined; appInstalled: boolean; repositorySelection?: undefined; appInstallUrl: string }
  | { connected: true; user: GitHubUser; appInstalled: boolean; repositorySelection?: 'all' | 'selected'; appInstallUrl: string };

export async function check(appId: string, jwt: string): Promise<GitHubConnectionStatus> {
  const config = getConfig();

  let token: string;
  try {
    token = await resolve(appId, jwt);
  } catch {
    return { connected: false, appInstalled: false, appInstallUrl: config.installUrl };
  }

  let userRes: Response;
  try {
    userRes = await proxy('/user', token);
  } catch (err) {
    logger.warn('github.status.user-check.network-error', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { connected: false, appInstalled: false, appInstallUrl: config.installUrl };
  }

  if (!userRes.ok) {
    logger.warn('github.status.user-check.failed', { appId, status: userRes.status });
    return { connected: false, appInstalled: false, appInstallUrl: config.installUrl };
  }

  const userData = await userRes.json();

  let appInstalled = false;
  let repositorySelection: 'all' | 'selected' | undefined;

  try {
    const installRes = await proxy('/user/installations', token, {
      params: { per_page: '100' },
    });

    if (installRes.ok) {
      const installData = await installRes.json();
      const matching = installData.installations?.find(
        (i: { app_slug: string }) => i.app_slug === config.appSlug,
      );
      if (matching) {
        appInstalled = true;
        repositorySelection = matching.repository_selection;
      }
    }
  } catch (err) {
    logger.warn('github.status.install-check.failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    connected: true,
    user: {
      login: userData.login,
      name: userData.name,
      avatarUrl: userData.avatar_url,
    },
    appInstalled,
    repositorySelection,
    appInstallUrl: config.installUrl,
  };
}
