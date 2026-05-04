// SERVER-ONLY: This module reads secret env vars (EB_LANGFUSE_SECRET_KEY).
// Do not import it from client components or client bundles.
// Add 'server-only' package as a dependency if accidental client imports become a risk.

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
