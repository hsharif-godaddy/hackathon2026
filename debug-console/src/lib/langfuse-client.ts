// SERVER-ONLY: This module reads secret env vars (LANGFUSE_SECRET_KEY).
// Do not import it from client components or client bundles.
// Add 'server-only' package as a dependency if accidental client imports become a risk.

const LANGFUSE_BASE_URL = process.env.LANGFUSE_BASE_URL;
const LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;

// Auth header computed once at module load — not rebuilt per request
export const langfuseAuthHeader =
    LANGFUSE_PUBLIC_KEY && LANGFUSE_SECRET_KEY
        ? `Basic ${Buffer.from(`${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}`).toString('base64')}`
        : null;

export const langfuseBaseUrl = LANGFUSE_BASE_URL ?? null;

export function getLangfuseConfig(): { baseUrl: string; authHeader: string } | null {
    if (!langfuseBaseUrl || !langfuseAuthHeader) {return null;}
    return { baseUrl: langfuseBaseUrl, authHeader: langfuseAuthHeader };
}
