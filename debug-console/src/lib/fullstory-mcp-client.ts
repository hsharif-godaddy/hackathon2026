// SERVER-ONLY: reads secret env vars (FULLSTORY_API_KEY).
// Do not import from client components.

const FULLSTORY_MCP_URL_DEFAULT = 'https://api.fullstory.com/mcp/fullstory';

const FULLSTORY_API_KEY = process.env.FULLSTORY_API_KEY;
const FULLSTORY_MCP_URL = process.env.FULLSTORY_MCP_URL || FULLSTORY_MCP_URL_DEFAULT;

export interface FullstoryMcpConfig {
    url: string;
    authHeader: string;
}

export function getFullstoryMcpConfig(): FullstoryMcpConfig | null {
    if (!FULLSTORY_API_KEY) return null;
    return { url: FULLSTORY_MCP_URL, authHeader: `Basic ${FULLSTORY_API_KEY}` };
}

export interface FullstoryMcpCallOptions {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    signal?: AbortSignal;
}

export class FullstoryMcpError extends Error {
    readonly code?: number;
    readonly status?: number;
    constructor(message: string, opts: { code?: number; status?: number } = {}) {
        super(message);
        this.name = 'FullstoryMcpError';
        this.code = opts.code;
        this.status = opts.status;
    }
}

/**
 * FullStory session/device ids exceed Number.MAX_SAFE_INTEGER. Quote them
 * before JSON.parse so they survive as strings rather than losing precision.
 * Hardcoded alternation keeps this a literal regex (no user-controlled
 * pattern construction) and extends trivially by editing the source.
 */
const BIGINT_SAFE_FIELDS_PATTERN = /"(device_id|session_id)"\s*:\s*(\d{16,})/g;

export function parseMcpToolResultText<T = unknown>(text: string): T {
    const safe = text.replace(BIGINT_SAFE_FIELDS_PATTERN, '"$1":"$2"');
    try {
        return JSON.parse(safe) as T;
    } catch (err) {
        const preview = text.length > 200 ? `${text.slice(0, 200)}…` : text;
        throw new FullstoryMcpError(
            `MCP tool returned non-JSON payload: ${err instanceof Error ? err.message : String(err)} | preview=${preview}`,
        );
    }
}

interface JsonRpcResponse {
    jsonrpc: string;
    id?: number | string;
    result?: { content?: Array<{ type: string; text?: string }> };
    error?: { code: number; message: string };
}

function parseJsonRpcFrame(frame: string, response: Response, raw: string): JsonRpcResponse {
    try {
        return JSON.parse(frame) as JsonRpcResponse;
    } catch (err) {
        const preview = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
        throw new FullstoryMcpError(
            `MCP transport returned malformed JSON-RPC: ${err instanceof Error ? err.message : String(err)} | preview=${preview}`,
            { status: response.status },
        );
    }
}

/**
 * Parses a JSON-RPC response. MCP HTTP transport may return text/event-stream
 * with one `data:` frame, or plain application/json. Handle both and wrap
 * parse failures with a preview so a truncated or partial frame surfaces with
 * context instead of a bare SyntaxError.
 */
async function parseJsonRpc(response: Response): Promise<JsonRpcResponse> {
    const raw = await response.text();
    const trimmed = raw.trim();
    if (!trimmed) throw new FullstoryMcpError('empty response body', { status: response.status });
    if (trimmed.startsWith('{')) return parseJsonRpcFrame(trimmed, response, raw);
    // SSE: look for first `data:` line carrying JSON
    for (const line of trimmed.split('\n')) {
        const match = line.match(/^data:\s*(.+)$/);
        if (match && match[1].startsWith('{')) return parseJsonRpcFrame(match[1], response, raw);
    }
    throw new FullstoryMcpError(`unparseable response: ${trimmed.slice(0, 200)}`, { status: response.status });
}

let idCounter = 0;

/**
 * Call an MCP tool on FullStory's hosted server and return the parsed result
 * (tools return their payload as a JSON string inside `content[0].text`).
 */
export async function callFullstoryMcpTool<T = unknown>(
    config: FullstoryMcpConfig,
    toolName: string,
    args: Record<string, unknown>,
    options: FullstoryMcpCallOptions = {},
): Promise<T> {
    const fetchImpl = options.fetchImpl || fetch;
    const timeoutMs = options.timeoutMs ?? 60_000;
    idCounter += 1;
    const body = {
        jsonrpc: '2.0',
        id: idCounter,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
    };

    // Compose a single AbortSignal covering both the optional caller signal
    // and our own timeout. AbortSignal.timeout stays active across the full
    // request lifecycle (connect + headers + body read), unlike a manual
    // setTimeout that fires once headers arrive and leaves response.text()
    // free to hang indefinitely.
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const abortSignal = options.signal
        ? AbortSignal.any([options.signal, timeoutSignal])
        : timeoutSignal;

    const response = await fetchImpl(config.url, {
        method: 'POST',
        headers: {
            Authorization: config.authHeader,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(body),
        signal: abortSignal,
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new FullstoryMcpError(
            `MCP HTTP ${response.status}: ${text.slice(0, 300)}`,
            { status: response.status },
        );
    }

    const rpc = await parseJsonRpc(response);
    if (rpc.error) {
        throw new FullstoryMcpError(`MCP tool ${toolName} failed: ${rpc.error.message}`, { code: rpc.error.code });
    }

    const text = rpc.result?.content?.find((item) => item.type === 'text')?.text;
    if (!text) {
        throw new FullstoryMcpError(`MCP tool ${toolName} returned no text content`);
    }
    return parseMcpToolResultText<T>(text);
}

/**
 * FullStory has two URL shapes for a single session:
 *   - Active-tab (numeric IDs):  /ui/{org}/session/{device}:{session}:{ts}
 *   - Share link (UUID IDs):     /ui/{org}/client-session/{uuid}%3A{uuid}%3A{ts}
 *
 * Only numeric IDs work against `get_session_events`; UUIDs are not resolvable
 * via any public API, so callers should fall back to segment discovery.
 * `kind` lets the caller make that decision without re-parsing.
 */
export interface ParsedFullstoryUrl {
    deviceId: string;
    sessionId: string;
    kind: 'numeric' | 'uuid';
    /**
     * Optional third segment of the session path: `/session/{dev}:{sess}:{ts}`.
     * FullStory's `getSessionAsync({format: 'url.now'})` — which the feedback
     * form uses — embeds the epoch-millis of the moment the URL was captured.
     * If present, we can use it as a real-world anchor to convert transcript
     * offsets into UTC timestamps that correlate with Loki/Langfuse events.
     */
    anchorEpochMs?: number;
}

export function parseFullstorySessionUrl(url: string): ParsedFullstoryUrl | null {
    try {
        const parsed = new URL(url);
        const pathname = decodeURIComponent(parsed.pathname);
        const match = pathname.match(/\/(?:client-session|session)\/([^/:?#]+):([^/:?#]+)(?::(\d+))?/);
        if (!match) return null;
        const deviceId = match[1];
        const sessionId = match[2];
        const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
        const kind: 'numeric' | 'uuid' = isUuid(deviceId) || isUuid(sessionId) ? 'uuid' : 'numeric';
        const anchorRaw = match[3];
        const anchorEpochMs = anchorRaw && /^\d{10,}$/.test(anchorRaw) ? Number(anchorRaw) : undefined;
        return { deviceId, sessionId, kind, ...(anchorEpochMs ? { anchorEpochMs } : {}) };
    } catch {
        return null;
    }
}

/**
 * Build the natural-language segment query used by both the airo-sre-feedback
 * skill and this evidence collector: sessions visiting /develop/{appId}.
 */
export function buildAiroSegmentQuery(appId: string, lookbackDays = 7): string {
    return `users who visited a page containing /develop/${appId} in the last ${lookbackDays} days`;
}
