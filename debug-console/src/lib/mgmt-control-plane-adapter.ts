import mgmtSSOClient from '@/lib/mgmt-sso-client';

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

    getAppDetails(appId: string, opts?: { includeResources?: boolean }): Promise<MgmtAppDetails> {
        const includeResources = opts?.includeResources ?? true;
        let path = `/api/airo/v1/apps/${encodeURIComponent(appId)}`;
        path += includeResources ? '?includeResources=true' : '';
        return this.request(path);
    }

    async getAgentUrl(appId: string): Promise<string> {
        const details = await this.getAppDetails(appId, { includeResources: false });
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

    getSubscription(subscriptionId: string): Promise<MgmtSubscription> {
        return this.request(`/api/airo/v1/subscriptions/${encodeURIComponent(subscriptionId)}`);
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
                        const details = await this.getAppDetails(app.appId, { includeResources: false });
                        return { ...app, published: details.published };
                    } catch {
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
