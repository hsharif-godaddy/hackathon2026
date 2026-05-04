// Client-readable Langfuse EB UI configuration. Values are inlined at build
// time from NEXT_PUBLIC_* env vars so trace deep links can be environment-aware
// without an extra round-trip to the server. Server-side API calls use
// EB_LANGFUSE_BASE_URL / EB_LANGFUSE_PROJECT_ID (see langfuse-eb-client.ts).
//
// Defaults intentionally point at the EB instance currently configured in
// env.example so local dev keeps working without extra setup; prod/dev
// deployments must override via env.
const DEFAULT_BASE_URL = 'https://agentobser-langfuse.int.godaddy.com';
const DEFAULT_PROJECT_ID = 'cmj7ew7m20026tr41gsi9knd4';

const BASE_URL = process.env.NEXT_PUBLIC_EB_LANGFUSE_BASE_URL || DEFAULT_BASE_URL;
const PROJECT_ID = process.env.NEXT_PUBLIC_EB_LANGFUSE_PROJECT_ID || DEFAULT_PROJECT_ID;

export function langfuseEbTraceUrl(traceId: string): string {
    return `${BASE_URL}/project/${PROJECT_ID}/traces/${traceId}`;
}

export function langfuseEbSessionUrl(sessionId: string): string {
    return `${BASE_URL}/project/${PROJECT_ID}/sessions/${sessionId}`;
}

export function langfuseEbProjectUrl(): string {
    return `${BASE_URL}/project/${PROJECT_ID}`;
}
