import { appFetch } from '@/lib/gasket-config';

const inflight = new Map<string, Promise<void>>();
const strategyCache = new Map<string, string>();

/**
 * Cache the sync strategy for an app so ensureFreshToken can read it
 * outside the React tree. Called by prefetchGitRemoteConfig and
 * useGitRemoteConfig when data is fetched.
 */
export function cacheSyncStrategy(appId: string, strategy: string | undefined): void {
  if (strategy) {
    strategyCache.set(appId, strategy);
  } else {
    strategyCache.delete(appId);
  }
}

export type RefreshTrigger = 'commit' | 'publish';

const triggerToStrategy: Record<RefreshTrigger, string> = {
  commit: 'on_commit',
  publish: 'on_publish',
};

/**
 * Plain async function (not a hook) that checks token expiry and
 * triggers a BFF-side refresh when needed. Deduplicates concurrent
 * calls for the same appId so WebSocket/SSE handlers can fire-and-forget.
 * Only proceeds when the cached strategy matches the trigger context.
 */
export async function ensureFreshToken(appId: string, trigger: RefreshTrigger): Promise<void> {
  const existing = inflight.get(appId);
  if (existing) return existing;

  const promise = refreshIfNeeded(appId, trigger).finally(() => inflight.delete(appId));
  inflight.set(appId, promise);
  return promise;
}

async function refreshIfNeeded(appId: string, trigger: RefreshTrigger): Promise<void> {
  const strategy = strategyCache.get(appId);
  if (!strategy || strategy === 'manual') return;
  if (strategy !== triggerToStrategy[trigger]) return;

  try {
    const statusRes = await appFetch(`/api/apps/${appId}/github/token/status`);
    if (!statusRes.ok) return;
    const { valid } = await statusRes.json() as { valid: boolean };
    if (valid) return;

    await appFetch(`/api/apps/${appId}/github/token/refresh`, { method: 'POST' });
  } catch {
    // fire-and-forget — agent retries will handle propagation delays
  }
}

