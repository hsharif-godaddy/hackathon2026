import mgmtSSOClient from '@/lib/mgmt-sso-client';

export class MgmtControlPlaneError extends Error {
    readonly statusCode: number;
    readonly responseBody: string;
    readonly responseJson: unknown;
    readonly path: string;

    constructor(statusCode: number, responseBody: string, path: string) {
        let responseJson: Record<string, unknown> | null = null;
        try {
            responseJson = JSON.parse(responseBody);
        } catch {
            console.warn('[mgmt-control-plane] Non-JSON error response', { statusCode, path, body: responseBody.slice(0, 200) });
        }
        const message = responseJson && typeof responseJson === 'object'
            ? String(responseJson['message'] ?? responseJson['error'] ?? `mgmt control plane returned ${statusCode} for ${path}`)
            : `mgmt control plane returned ${statusCode} for ${path}`;

        super(message);
        this.name = 'MgmtControlPlaneError';
        this.statusCode = statusCode;
        this.responseBody = responseBody;
        this.responseJson = responseJson;
        this.path = path;
    }
}

export interface MgmtVariantLifecycle {
    lifecycleState: string;
    reason: string;
    stateChangedAt: string;
    metadata?: Record<string, unknown>;
}

export interface MgmtVariantWithLifecycle {
    variant: string;
    status: string;
    lifecycle: MgmtVariantLifecycle;
}

export interface MgmtFilesystem {
    id: string;
    filesystemId: string;
    mountPath: string;
    containerMountPath: string;
    resourceUnitsAllocated: number;
    status: string;
    createdAt: string;
    updatedAt: string;
}

export interface MgmtDatabase {
    databaseId: string;
    resourceUnitsAllocated: number;
    status: string;
    createdAt: string;
    updatedAt: string;
}

export interface MgmtResolvedImage {
    imageType: string;
    repository: string;
    imageName: string;
    tag: string;
    fullImage: string;
    source: string;
}

export interface MgmtTag {
    key: string;
    value: string;
    createdAt: string;
    updatedAt: string;
}

export interface MgmtDomain {
    fqdn: string;
    domainType: string;
    prefix: string | null;
    isPrimary: boolean;
    status: string;
    createdAt: string;
    updatedAt: string;
}

export interface MgmtAppDetails {
    id: string;
    appTemplateName: string;
    cellId: string;
    status: string;
    published: boolean;
    createdAt: string;
    updatedAt: string;
    systemId: string;
    subscriptionId: string;
    shopperId: string;
    entitlementId: string;
    compositionId: string;
    compositionVersion: string;
    provisionType: string;
    uid: number;
    environments: string[];
    variants: string[];
    variantsWithLifecycle: MgmtVariantWithLifecycle[];
    variables: Record<string, string>;
    urls: Record<string, string>;
    filesystems: MgmtFilesystem[];
    databases: MgmtDatabase[];
    tags: MgmtTag[];
    domains: MgmtDomain[];
    imageOverrides: unknown[];
    resolvedImages: MgmtResolvedImage[];
}

export interface MgmtImageStatusEntry {
    imageType: string;
    deployedTag: string;
    expectedTag: string;
    match: boolean;
}

export interface MgmtImageStatus {
    appId: string;
    compositionId: string;
    compositionVersion: string;
    unifiedVariantJob: boolean;
    status: string;
    images?: MgmtImageStatusEntry[];
}

export type MgmtReloadStatus = 'current' | 'stale' | 'reloading' | 'unknown' | 'unavailable';

export interface MgmtReloadResponse {
    appId: string;
    status: MgmtReloadStatus;
    message: string;
    jobId?: string;
    startedAt?: string;
    failedAt?: string;
}

export interface MgmtSubscription {
    id: string;
    productId: string;
    customerId: string;
    status: string;
    isTrial: boolean;
    tokenBudgetId: string;
    builderEntitlementId: string;
    plan: string;
    createdAt: string;
    updatedAt: string;
}

export interface MgmtGrant {
    id: string;
    subscriptionId: string;
    type: string;
    source: string;
    creditsMax: number;
    creditsSpent: number;
    creditsSpentRaw: number;
    isAvailable: boolean;
    finalState: string | null;
    useBefore: string;
    llmBudgetUserId: string;
    llmBudgetId: string;
    profitCoefficient: number;
    creditsReportedForConsumption: number;
    createdAt: string;
    updatedAt: string;
    removedAt: string | null;
}

export interface MgmtSubscriptionGrants {
    grants: MgmtGrant[];
    activeGrant: string | null;
}

export interface MgmtDomainErrorDetail {
    code: string;
    message: string;
    action: string;
    canRetry: boolean;
}

export interface MgmtDomainError {
    appId: string;
    fqdn: string;
    jobId: string;
    status: string;
    error: MgmtDomainErrorDetail;
    affectedDomains: string[];
    failedStep: string;
    completedAt: string;
}

export interface MgmtCustomerApp {
    appId: string;
    subscriptionId: string;
    systemId: string;
    status: string;
    published: boolean;
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

        const apps: MgmtCustomerApp[] = [];
        for (const sub of tree.subscriptions ?? []) {
            for (const sys of sub.systems ?? []) {
                for (const app of sys.apps ?? []) {
                    apps.push({
                        appId: app.id,
                        subscriptionId: sub.subscriptionId,
                        systemId: sys.systemId,
                        status: app.status,
                        published: app.published,
                    });
                }
            }
        }
        return apps;
    }
}

export default new MgmtControlPlaneAdapter();
