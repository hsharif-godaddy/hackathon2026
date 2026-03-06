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

export class MgmtControlPlaneAdapter {
    private async request<T>(path: string, init?: RequestInit): Promise<T> {
        const response = await mgmtSSOClient.fetch(path, init);

        if (!response.ok) {
            throw new MgmtControlPlaneError(response.status, await response.text(), path);
        }

        return response.json() as Promise<T>;
    }

    getAppDetails(appId: string): Promise<MgmtAppDetails> {
        return this.request(`/api/airo/v1/apps/${encodeURIComponent(appId)}?includeResources=true`);
    }

    getImageStatus(appId: string, opts?: { subscriptionId?: string; systemId?: string; tryCount?: number }): Promise<MgmtImageStatus> {
        const tryCount = opts?.tryCount ?? 0;
        const path = opts?.subscriptionId && opts?.systemId
            ? `/api/airo/v1/subscriptions/${encodeURIComponent(opts.subscriptionId)}/systems/${encodeURIComponent(opts.systemId)}/apps/${encodeURIComponent(appId)}/image-status?tryCount=${tryCount}`
            : `/api/hosting/v1/apps/${encodeURIComponent(appId)}/image-status?tryCount=${tryCount}`;

        return this.request(path);
    }

    reloadApp(appId: string, opts?: { subscriptionId?: string; systemId?: string }): Promise<MgmtReloadResponse> {
        const path = opts?.subscriptionId && opts?.systemId
            ? `/api/airo/v1/subscriptions/${encodeURIComponent(opts.subscriptionId)}/systems/${encodeURIComponent(opts.systemId)}/apps/${encodeURIComponent(appId)}/reload`
            : `/api/hosting/v1/apps/${encodeURIComponent(appId)}/reload`;

        return this.request(path, { method: 'POST', body: '{}' });
    }
}

export default new MgmtControlPlaneAdapter();
