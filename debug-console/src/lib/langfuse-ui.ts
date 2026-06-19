// Client-readable Langfuse "Native" UI configuration. Values are inlined at
// build time from NEXT_PUBLIC_* env vars so the per-trace "Native ↗" deep link
// (rendered in LangfuseEbPanel) can be environment-aware. The Native instance is
// no longer queried server-side — debug-console reads traces from Langfuse EB —
// these vars only power the deep link to the raw AI-SDK trace.
//
// Defaults intentionally point at the configured Native instance so local dev
// keeps working without extra setup; prod/dev deployments must override via env.
const DEFAULT_BASE_URL = 'https://agentobser-agent-obs-langfuse-test.agentobser-test.prod.onkatana.net';
const DEFAULT_PROJECT_ID = 'cmk538rgi000ftt371isic2m4';

const BASE_URL = process.env.NEXT_PUBLIC_LANGFUSE_BASE_URL || DEFAULT_BASE_URL;
const PROJECT_ID = process.env.NEXT_PUBLIC_LANGFUSE_PROJECT_ID || DEFAULT_PROJECT_ID;

export function langfuseTraceUrl(traceId: string): string {
    return `${BASE_URL}/project/${PROJECT_ID}/traces/${traceId}`;
}

// FullStory replay deep link. EB traces carry the session identifier in
// `metadata.context_fullStorySessionId` as the already-URL-encoded triplet
// `{uid}%3A{sessionId}%3A{ts}` — exactly the path segment FullStory expects
// after `/client-session/`. The org id (YKBRC) is the only piece not in the
// data; it's an org-level constant. Override via NEXT_PUBLIC_FULLSTORY_ORG_ID.
const FULLSTORY_ORG_ID = process.env.NEXT_PUBLIC_FULLSTORY_ORG_ID || 'YKBRC';

export function fullStorySessionUrl(sessionId: string): string {
    // sessionId is already percent-encoded (%3A); concatenate as-is — do not
    // re-encode or the colons would become %253A.
    return `https://app.fullstory.com/ui/${FULLSTORY_ORG_ID}/client-session/${sessionId}`;
}
