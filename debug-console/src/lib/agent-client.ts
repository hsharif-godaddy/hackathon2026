/**
 * Agents service HTTP client (read-only debug usage).
 *
 * Resolves the per-app agent_url via mgmt control plane, mints a short-lived
 * agents JWT scoped to the appId, and proxies a GET to the agents service.
 */

import { mintAgentToken } from '@/lib/agent-jwt';
import { logger } from '@/lib/logger';
import mgmtControlPlaneAdapter from '@/lib/mgmt-control-plane-adapter';

interface FetchAgentOptions {
    appId: string;
    path: string;
    query?: Record<string, string | undefined>;
}

interface StreamAgentOptions extends FetchAgentOptions {
    canDownload?: boolean;
    canPublish?: boolean;
    canPurchaseDomain?: boolean;
}

export interface AgentStreamResponse {
    status: number;
    body: ReadableStream<Uint8Array> | null;
    headers: Headers;
}

export interface AgentResponse {
    status: number;
    body: unknown;
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, string | undefined>): string {
    const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    if (query) {
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined && value !== '') {
                url.searchParams.set(key, value);
            }
        }
    }
    return url.toString();
}

function safeParseJson(text: string): unknown {
    if (text.length === 0) return null;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

export async function fetchAgentJson(
    options: FetchAgentOptions & { timeoutMs?: number; signal?: AbortSignal }
): Promise<AgentResponse> {
    const { appId, path, query, timeoutMs, signal } = options;

    const agentUrl = await mgmtControlPlaneAdapter.getAgentUrl(appId);
    const { token } = await mintAgentToken({ appId });
    const url = buildUrl(agentUrl, path, query);

    logger.info('agent-client.fetch', { appId, path });

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = timeoutMs && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            cache: 'no-store',
            signal: controller.signal,
        });
        const text = await response.text();
        return { status: response.status, body: safeParseJson(text) };
    } finally {
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
    }
}

/**
 * Issue a fetch that aborts if response headers do not arrive within
 * `timeoutMs` and that propagates the caller's `signal` for the lifetime of
 * the body stream. The header timer is cleared as soon as the response
 * resolves, so streaming a large body is not subject to it; body-stall
 * protection is the upstream proxy's responsibility.
 */
async function streamFetchWithTimeout(
    url: string,
    init: RequestInit,
    options: { timeoutMs?: number; signal?: AbortSignal },
): Promise<Response> {
    const { timeoutMs, signal } = options;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = timeoutMs && timeoutMs > 0
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        if (timer) clearTimeout(timer);
        // Leave the abort listener installed; controller.signal continues to
        // back response.body so the caller's cancellation must keep flowing.
    }
}

/**
 * Stream an authenticated GET response (typically a binary file) from the
 * agents service. Mints a builder-signed JWT scoped to the appId; callers may
 * request elevated permissions (e.g. canDownload) needed by routes like
 * GET /apps/:id/zip.
 */
export async function streamAgentResponse(
    options: StreamAgentOptions & { timeoutMs?: number; signal?: AbortSignal }
): Promise<AgentStreamResponse> {
    const { appId, path, query, canDownload, canPublish, canPurchaseDomain, timeoutMs, signal } = options;

    const agentUrl = await mgmtControlPlaneAdapter.getAgentUrl(appId);
    const { token } = await mintAgentToken({ appId, canDownload, canPublish, canPurchaseDomain });
    const url = buildUrl(agentUrl, path, query);

    logger.info('agent-client.stream', { appId, path });

    const response = await streamFetchWithTimeout(
        url,
        {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: '*/*',
            },
            cache: 'no-store',
        },
        { timeoutMs, signal },
    );

    return {
        status: response.status,
        body: response.body,
        headers: response.headers,
    };
}

/**
 * Stream an authenticated GET response from a JOMAX-protected agents endpoint
 * (e.g. /diagnostics/conversations/export). Returns the upstream Web stream
 * untouched so callers can pipe it directly into a zip archive or response.
 */
export async function streamAgentWithJomax(
    options: FetchAgentOptions & { jomaxToken: string; timeoutMs?: number; signal?: AbortSignal }
): Promise<AgentStreamResponse> {
    const { appId, path, query, jomaxToken, timeoutMs, signal } = options;

    const agentUrl = await mgmtControlPlaneAdapter.getAgentUrl(appId);
    const url = buildUrl(agentUrl, path, query);

    logger.info('agent-client.jomax.stream', { appId, path });

    const response = await streamFetchWithTimeout(
        url,
        {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${jomaxToken}`,
                Accept: '*/*',
            },
            cache: 'no-store',
        },
        { timeoutMs, signal },
    );

    return {
        status: response.status,
        body: response.body,
        headers: response.headers,
    };
}

/**
 * Fetch an endpoint on the agents service that authenticates JOMAX tokens
 * directly (e.g. /diagnostics/*). Forwards the operator's JOMAX token rather
 * than minting a builder-signed JWT.
 */
export async function fetchAgentWithJomax(
    options: FetchAgentOptions & { jomaxToken: string; timeoutMs?: number }
): Promise<AgentResponse> {
    const { appId, path, query, jomaxToken, timeoutMs } = options;

    const agentUrl = await mgmtControlPlaneAdapter.getAgentUrl(appId);
    const url = buildUrl(agentUrl, path, query);

    logger.info('agent-client.jomax.fetch', { appId, path });

    const controller = new AbortController();
    const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${jomaxToken}`,
                Accept: 'application/json',
            },
            cache: 'no-store',
            signal: controller.signal,
        });
        const text = await response.text();
        return { status: response.status, body: safeParseJson(text) };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * Fetch a public (unauthenticated) endpoint on the agents service such as
 * /health. Resolves agent_url via mgmt but does not mint or send a JWT.
 */
export async function fetchAgentPublicJson(options: FetchAgentOptions & { timeoutMs?: number }): Promise<AgentResponse> {
    const { appId, path, query, timeoutMs } = options;

    const agentUrl = await mgmtControlPlaneAdapter.getAgentUrl(appId);
    const url = buildUrl(agentUrl, path, query);

    logger.info('agent-client.public.fetch', { appId, path });

    const controller = new AbortController();
    const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
        });
        const text = await response.text();
        return { status: response.status, body: safeParseJson(text) };
    } finally {
        if (timer) clearTimeout(timer);
    }
}
