import { logger } from '@/lib/logger';
import mgmtSSOClient from '@/lib/mgmt-sso-client';

// Short-lived dedup cache for read endpoints that get hit many times during a
// single page load (e.g. `getAppDetails(appId)` is called by app-context,
// agent-client `getAgentUrl`, and the per-app /api/mgmt/apps/[id] route —
// instrumentation showed 6 calls for the same appId in 30s). Keep the TTL
// short so reload-after-deploy still reflects fresh state quickly.
const READ_CACHE_TTL_MS = 30_000;
const READ_CACHE_MAX_ENTRIES = 500;
interface ReadCacheEntry { value: unknown; expiresAt: number }
const readCache = new Map<string, ReadCacheEntry>();
const readInFlight = new Map<string, Promise<unknown>>();

function readCacheGet<T>(key: string): T | undefined {
    const hit = readCache.get(key);
    if (!hit) return undefined;
    if (Date.now() >= hit.expiresAt) {
        readCache.delete(key);
        return undefined;
    }
    return hit.value as T;
}

function readCacheSet<T>(key: string, value: T): void {
    if (readCache.size >= READ_CACHE_MAX_ENTRIES) {
        const oldest = readCache.keys().next().value;
        if (oldest !== undefined) readCache.delete(oldest);
    }
    readCache.set(key, { value, expiresAt: Date.now() + READ_CACHE_TTL_MS });
}

/**
 * Memoize a read-only mgmt API call by `cacheKey`. Coalesces concurrent
 * fetches for the same key so 12 parallel routes triggered by one page load
 * fire one upstream call, not 12. Use only for endpoints where a 30s stale
 * read is acceptable.
 */
function readInFlightGet<T>(key: string): Promise<T> | undefined {
    const p = readInFlight.get(key);
    return p as Promise<T> | undefined;
}

async function memoizeRead<T>(cacheKey: string, loader: () => Promise<T>): Promise<T> {
    const cached = readCacheGet<T>(cacheKey);
    if (cached !== undefined) return cached;

    const inFlight = readInFlight.get(cacheKey);
    if (inFlight) return inFlight as Promise<T>;

    const promise = (async () => {
        try {
            const value = await loader();
            readCacheSet(cacheKey, value);
            return value;
        } finally {
            readInFlight.delete(cacheKey);
        }
    })();
    readInFlight.set(cacheKey, promise);
    return promise;
}

/**
 * Drop all cached entries whose key starts with the given prefix. Used by
 * write paths (e.g. `reloadApp`) to invalidate stale read snapshots so the
 * next read sees the post-mutation state.
 */
function invalidateReadCache(prefix: string): void {
    for (const key of readCache.keys()) {
        if (key.startsWith(prefix)) readCache.delete(key);
    }
}

// Re-export all types so existing server-side imports continue to work
export {
    MgmtControlPlaneError,
    type MgmtVariantLifecycle,
    type MgmtVariantWithLifecycle,
    type MgmtFilesystem,
    type MgmtDatabase,
    type MgmtResolvedImage,
    type MgmtTag,
    type MgmtDomain,
    type MgmtAppDetails,
    type MgmtImageStatusEntry,
    type MgmtImageStatus,
    type MgmtReloadStatus,
    type MgmtReloadResponse,
    type MgmtSubscription,
    type MgmtGrant,
    type MgmtSubscriptionGrants,
    type MgmtDomainErrorDetail,
    type MgmtDomainError,
    type MgmtCustomerApp,
} from '@/lib/mgmt-types';

import { MgmtControlPlaneError } from '@/lib/mgmt-types';
import type {
    MgmtAppDetails,
    MgmtImageStatus,
    MgmtSubscription,
    MgmtSubscriptionGrants,
    MgmtGrant,
    MgmtDomainError,
    MgmtReloadResponse,
    MgmtCustomerApp,
} from '@/lib/mgmt-types';

export class AgentUrlNotFoundError extends Error {
    readonly appId: string;
    constructor(appId: string) {
        super(`No agent_url found for app ${appId}`);
        this.name = 'AgentUrlNotFoundError';
        this.appId = appId;
    }
}

interface CustomerTreeApp {
    id: string;
    status: string;
    published: boolean;
}

interface CustomerTreeSystem {
    systemId: string;
    apps: CustomerTreeApp[];
}

interface CustomerTreeSubscription {
    subscriptionId: string;
    systems: CustomerTreeSystem[];
}

interface CustomerTreeResponse {
    customerId: string;
    subscriptions: CustomerTreeSubscription[];
}

export class MgmtControlPlaneAdapter {
    private async request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
        const response = await mgmtSSOClient.fetch(path, init);

        if (!response.ok) {
            throw new MgmtControlPlaneError(response.status, await response.text(), path);
        }

        return response.json() as Promise<T>;
    }

    /**
     * Always fetches with `?includeResources=true` — the full response is a
     * strict superset of the lite one, so lite-only consumers (`getAgentUrl`,
     * credit-pack flows, etc.) read what they need and ignore the extras.
     * Telemetry showed two near-simultaneous fetches for the same appId
     * 3-6ms apart when the lite/full distinction was honored: the lite call
     * firing first defeated cache + in-flight coalescing for the full call.
     * The extra ~2-5× payload is cheap relative to the mgmt round-trip.
     */
    getAppDetails(appId: string): Promise<MgmtAppDetails> {
        const cacheKey = `getAppDetails:${appId}`;
        const path = `/api/airo/v1/apps/${encodeURIComponent(appId)}?includeResources=true`;
        return memoizeRead(cacheKey, () => this.request<MgmtAppDetails>(path));
    }

    async getAgentUrl(appId: string): Promise<string> {
        const details = await this.getAppDetails(appId);
        const url = details.urls?.agent;
        if (!url) {
            throw new AgentUrlNotFoundError(appId);
        }
        return url;
    }

    getImageStatus(appId: string, opts?: { subscriptionId?: string; systemId?: string; tryCount?: number }): Promise<MgmtImageStatus> {
        const tryCount = opts?.tryCount ?? 0;
        const path = opts?.subscriptionId && opts?.systemId
            ? `/api/airo/v1/subscriptions/${encodeURIComponent(opts.subscriptionId)}/systems/${encodeURIComponent(opts.systemId)}/apps/${encodeURIComponent(appId)}/image-status?tryCount=${tryCount}`
            : `/api/hosting/v1/apps/${encodeURIComponent(appId)}/image-status?tryCount=${tryCount}`;

        return this.request(path);
    }

    /**
     * Per-page-load read coalescing: a single panel render fans out to both
     * /api/mgmt/subscriptions/{id} (AppDetailsPanel) and /api/bms/spend
     * (which calls getSubscription server-side). Memoizing here turns those
     * two near-simultaneous fetches into one upstream call. includeAttributes
     * varies the cache key so an attribute-less call doesn't poison a richer
     * one cached after it.
     */
    getSubscription(
        subscriptionId: string,
        opts?: { includeAttributes?: boolean }
    ): Promise<MgmtSubscription> {
        const includeAttrs = opts?.includeAttributes ?? false;
        const qs = includeAttrs ? '?includeAttributes=true' : '';
        const cacheKey = `getSubscription:${subscriptionId}:${includeAttrs ? 'attrs' : 'plain'}`;
        return memoizeRead(cacheKey, () =>
            this.request<MgmtSubscription>(
                `/api/airo/v1/subscriptions/${encodeURIComponent(subscriptionId)}${qs}`
            )
        );
    }

    getSubscriptionGrants(subscriptionId: string): Promise<MgmtSubscriptionGrants> {
        return this.request(`/api/airo/v1/subscriptions/${encodeURIComponent(subscriptionId)}/credits/grants`);
    }

    getDomainError(appId: string, fqdn: string, opts: { subscriptionId: string; systemId: string }): Promise<MgmtDomainError> {
        return this.request(
            `/api/airo/v1/subscriptions/${encodeURIComponent(opts.subscriptionId)}/systems/${encodeURIComponent(opts.systemId)}/apps/${encodeURIComponent(appId)}/domain-error?fqdn=${encodeURIComponent(fqdn)}`
        );
    }

    addCreditGrant(subscriptionId: string, grant: { type: string; creditsMax: number; useBefore: string }): Promise<{grant: MgmtGrant}> {
        return this.request(`/api/airo/v1/subscriptions/${encodeURIComponent(subscriptionId)}/credits/grants`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(grant),
        });
    }

    reloadApp(appId: string, opts?: { subscriptionId?: string; systemId?: string }): Promise<MgmtReloadResponse> {
        const path = opts?.subscriptionId && opts?.systemId
            ? `/api/airo/v1/subscriptions/${encodeURIComponent(opts.subscriptionId)}/systems/${encodeURIComponent(opts.systemId)}/apps/${encodeURIComponent(appId)}/reload`
            : `/api/hosting/v1/apps/${encodeURIComponent(appId)}/reload`;

        // Reload mutates the app's deployed state — drop any cached snapshot
        // for this app so the next read fetches fresh.
        invalidateReadCache(`getAppDetails:${appId}`);
        return this.request(path, { method: 'POST', body: '{}' });
    }

    async getCustomerApps(customerId: string): Promise<MgmtCustomerApp[]> {
        const tree = await this.request<CustomerTreeResponse>(
            `/api/airo/v1/customers/${encodeURIComponent(customerId)}/tree?ownerProduct=AiroAppBuilder`,
            { timeoutMs: 30000 }
        );

        const baseApps: MgmtCustomerApp[] = [];
        for (const sub of tree.subscriptions ?? []) {
            for (const sys of sub.systems ?? []) {
                for (const app of sys.apps ?? []) {
                    baseApps.push({
                        appId: app.id,
                        subscriptionId: sub.subscriptionId,
                        systemId: sys.systemId,
                        status: app.status,
                        published: app.published,
                    });
                }
            }
        }

        // The tree endpoint returns stale/incorrect published values. Fetch the
        // correct value from the individual app endpoint for each app, batching
        // so a customer with many apps doesn't fire off an unbounded burst of
        // concurrent requests at the management API.
        const CONCURRENCY = 10;
        const results: MgmtCustomerApp[] = [];
        for (let i = 0; i < baseApps.length; i += CONCURRENCY) {
            const batch = baseApps.slice(i, i + CONCURRENCY);
            const resolved = await Promise.all(
                batch.map(async (app): Promise<MgmtCustomerApp> => {
                    try {
                        const details = await this.getAppDetails(app.appId);
                        return { ...app, published: details.published };
                    } catch (error) {
                        // Per-app lookup failure → fall back to the tree's
                        // (known stale) `published` value so the customer
                        // page still renders. Log so an operator can see the
                        // regression without changing behavior.
                        logger.warn('mgmt.getCustomerApps.appLookupFailed', {
                            appId: app.appId,
                            error: error instanceof Error ? error.message : String(error),
                        });
                        return app;
                    }
                })
            );
            results.push(...resolved);
        }
        return results;
    }
}

const mgmtControlPlaneAdapter = new MgmtControlPlaneAdapter();
export default mgmtControlPlaneAdapter;
