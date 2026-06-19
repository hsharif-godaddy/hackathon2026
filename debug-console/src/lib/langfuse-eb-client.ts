// SERVER-ONLY: This module reads secret env vars (EB_LANGFUSE_SECRET_KEY).
// Do not import it from client components or client bundles.
// Add 'server-only' package as a dependency if accidental client imports become a risk.

import { logger } from '@/lib/logger';
import mgmtControlPlaneAdapter from '@/lib/mgmt-control-plane-adapter';

const EB_LANGFUSE_BASE_URL = process.env.EB_LANGFUSE_BASE_URL;
const EB_LANGFUSE_PUBLIC_KEY = process.env.EB_LANGFUSE_PUBLIC_KEY;
const EB_LANGFUSE_SECRET_KEY = process.env.EB_LANGFUSE_SECRET_KEY;

export const langfuseEbAuthHeader =
    EB_LANGFUSE_PUBLIC_KEY && EB_LANGFUSE_SECRET_KEY
        ? `Basic ${Buffer.from(`${EB_LANGFUSE_PUBLIC_KEY}:${EB_LANGFUSE_SECRET_KEY}`).toString('base64')}`
        : null;

export const langfuseEbBaseUrl = EB_LANGFUSE_BASE_URL ?? null;

export function getLangfuseEbConfig(): { baseUrl: string; authHeader: string } | null {
    if (!langfuseEbBaseUrl || !langfuseEbAuthHeader) return null;
    return { baseUrl: langfuseEbBaseUrl, authHeader: langfuseEbAuthHeader };
}

/**
 * EB stores the Airo appId at `metadata.business_data_appId` rather than the
 * `userId` field. This builds the Langfuse advanced-filter JSON shape for
 * `GET /api/public/traces?filter=...` that scopes results to a single appId.
 *
 * See: https://langfuse.com/changelog/2025-11-03-advanced-filtering-traces-and-observations-api
 */
export function buildAppIdFilter(appId: string): string {
    return JSON.stringify([
        {
            type: 'stringObject',
            column: 'metadata',
            key: 'business_data_appId',
            operator: '=',
            value: appId,
        },
    ]);
}

/**
 * Resolve an app's customerId via appId → subscription → customerId. EB stores
 * the customerId in the trace's indexed `userId` field, so pairing `userId` with
 * the appId metadata filter (see buildAppIdFilter) lets the index narrow the set
 * before the otherwise-422-prone metadata predicate runs. Requesting the
 * subscription with attributes matches the credit-ratio lookup's memo cache key,
 * so the two share a single upstream read. Returns null when unresolvable (mgmt
 * outage, or apps with no subscription record) — callers decide whether to fail
 * or fall back to a filter-only query.
 */
export async function resolveCustomerId(appId: string): Promise<string | null> {
    try {
        const app = await mgmtControlPlaneAdapter.getAppDetails(appId);
        if (!app.subscriptionId) return null;
        const sub = await mgmtControlPlaneAdapter.getSubscription(app.subscriptionId, {
            includeAttributes: true,
        });
        return sub.customerId || null;
    } catch (err) {
        logger.warn('langfuse.eb.customerId.unresolved', {
            appId,
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}
