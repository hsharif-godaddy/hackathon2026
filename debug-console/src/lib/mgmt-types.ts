/**
 * Mgmt control plane types — safe to import from client components.
 * Separated from mgmt-control-plane-adapter.ts to avoid pulling
 * server-only dependencies (gd-auth-client → @aws-sdk) into the browser bundle.
 */

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
    lifecycle?: MgmtVariantLifecycle;
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
