// Client-readable Langfuse UI configuration. Values are inlined at build time
// from NEXT_PUBLIC_* env vars so trace/user deep links can be environment-aware
// without an extra round-trip to the server. Server-side API calls still use
// LANGFUSE_BASE_URL / LANGFUSE_PROJECT_ID (see langfuse-client.ts).
//
// Defaults intentionally point at the test Langfuse instance so local dev keeps
// working without extra setup; prod/dev deployments must override via env.
const DEFAULT_BASE_URL = 'https://agentobser-agent-obs-langfuse-test.agentobser-test.prod.onkatana.net';
const DEFAULT_PROJECT_ID = 'cmk538rgi000ftt371isic2m4';

const BASE_URL = process.env.NEXT_PUBLIC_LANGFUSE_BASE_URL || DEFAULT_BASE_URL;
const PROJECT_ID = process.env.NEXT_PUBLIC_LANGFUSE_PROJECT_ID || DEFAULT_PROJECT_ID;

export function langfuseTraceUrl(traceId: string): string {
    return `${BASE_URL}/project/${PROJECT_ID}/traces/${traceId}`;
}

export function langfuseUserUrl(userId: string): string {
    return `${BASE_URL}/project/${PROJECT_ID}/users/${userId}`;
}
