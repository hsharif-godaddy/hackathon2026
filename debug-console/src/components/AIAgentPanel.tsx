'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { renderToolCall } from '@/components/agent-tool-renderers';
import type { MessageSegment, ToolCall } from '@/lib/agent-message-types';
import { formatTimestamp } from '@/lib/date-utils';

interface Props {
    globalAppId: string;
    refreshKey: number;
    onRefresh?: () => void;
}

interface ConversationSummary {
    id: string;
    appId: string;
    agentId: string;
    title: string;
    messageCount?: number;
    createdAt: string;
    updatedAt: string;
}

interface ListResponse {
    conversations: ConversationSummary[];
    pagination?: { total?: number; hasMore?: boolean };
}

interface ConversationMessage {
    id: string;
    conversationId: string;
    sender: 'user' | 'agent';
    content: string;
    messageType?: string | null;
    toolCalls?: ToolCall[];
    segments?: MessageSegment[];
    metadata?: Record<string, unknown> & { agentName?: string; agentId?: string };
    contextAttachments?: unknown[];
    origin?: string;
    createdAt: string;
}

interface DetailPagination {
    total: number;
    hasMore: boolean;
    nextCursor: string | null;
}

interface DetailResponse {
    conversation: ConversationSummary;
    messages: ConversationMessage[];
    pagination: DetailPagination;
}

interface HealthResult {
    status?: string;
    [k: string]: unknown;
}

interface MemoryResult {
    timestamp?: string;
    heapStats?: {
        totalHeapSize?: number;
        usedHeapSize?: number;
        heapSizeLimit?: number;
        externalMemory?: number;
        mallocedMemory?: number;
        peakMallocedMemory?: number;
        totalAvailableSize?: number;
    };
    memory?: {
        rss?: number;
        heapTotal?: number;
        heapUsed?: number;
        external?: number;
        arrayBuffers?: number;
    };
    uptime?: number;
}

type HealthPhase = 'idle' | 'pinging' | 'ready' | 'unreachable';

const LIST_LIMIT = 100;
const DETAIL_PAGE_SIZE = 50;
const HEALTH_MAX_ATTEMPTS = 10;
const HEALTH_RETRY_DELAY_MS = 10_000;
const TOOL_CALLS_VISIBLE_DEFAULT = 5;

// Legacy shim: the previous agents service returns { conversation, messages }
// with no `pagination` field. Treat that as a single full page so the UI
// renders without crashing on the missing field. Remove once agents has
// rolled out the paginated detail endpoint.
function normalizeDetailResponse(raw: unknown): DetailResponse {
    const detail = (raw || {}) as Partial<DetailResponse>;
    if (!detail.pagination) {
        const messageCount = Array.isArray(detail.messages) ? detail.messages.length : 0;
        return {
            ...(detail as DetailResponse),
            pagination: { total: messageCount, hasMore: false, nextCursor: null },
        };
    }
    return detail as DetailResponse;
}

export default function AIAgentPanel({ globalAppId, refreshKey, onRefresh }: Props) {
    const [healthPhase, setHealthPhase] = useState<HealthPhase>('idle');
    const [healthAttempt, setHealthAttempt] = useState(0);
    const [healthResult, setHealthResult] = useState<HealthResult | null>(null);
    const [healthError, setHealthError] = useState<string | null>(null);

    const [memoryResult, setMemoryResult] = useState<MemoryResult | null>(null);
    const [memoryError, setMemoryError] = useState<string | null>(null);
    const [memoryLoading, setMemoryLoading] = useState(false);

    const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
    const [listError, setListError] = useState<string | null>(null);
    const [listLoading, setListLoading] = useState(false);
    const [listTruncatedTotal, setListTruncatedTotal] = useState<number | null>(null);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<DetailResponse | null>(null);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const detailRunIdRef = useRef(0);
    const listRunIdRef = useRef(0);

    const healthRunIdRef = useRef(0);

    const runHealthCheck = useCallback(async function runHealthCheck() {
        if (!globalAppId) return;
        const runId = ++healthRunIdRef.current;
        setHealthPhase('pinging');
        setHealthAttempt(0);
        setHealthResult(null);
        setHealthError(null);

        for (let attempt = 1; attempt <= HEALTH_MAX_ATTEMPTS; attempt += 1) {
            if (healthRunIdRef.current !== runId) return;
            setHealthAttempt(attempt);
            try {
                const res = await fetch(
                    `/api/agent/health/${encodeURIComponent(globalAppId)}`,
                    { credentials: 'include', cache: 'no-store' }
                );
                const data = await res.json().catch(function safe() { return null; });
                if (healthRunIdRef.current !== runId) return;
                if (res.ok) {
                    setHealthResult((data || {}) as HealthResult);
                    setHealthError(null);
                    setHealthPhase('ready');
                    return;
                }
                const message = (data && (data.error as string)) || `HTTP ${res.status}`;
                setHealthError(message);
            } catch (err) {
                if (healthRunIdRef.current !== runId) return;
                setHealthError(err instanceof Error ? err.message : String(err));
            }
            if (attempt < HEALTH_MAX_ATTEMPTS) {
                await new Promise(function delay(resolve) {
                    setTimeout(resolve, HEALTH_RETRY_DELAY_MS);
                });
            }
        }

        if (healthRunIdRef.current !== runId) return;
        setHealthPhase('unreachable');
    }, [globalAppId]);

    useEffect(function startHealthCheck() {
        if (!globalAppId) {
            healthRunIdRef.current += 1;
            setHealthPhase('idle');
            setHealthAttempt(0);
            setHealthResult(null);
            setHealthError(null);
            setMemoryResult(null);
            setMemoryError(null);
            setConversations(null);
            setSelectedId(null);
            setDetail(null);
            return;
        }
        runHealthCheck();
        return function cleanup() {
            healthRunIdRef.current += 1;
        };
    }, [globalAppId, refreshKey, runHealthCheck]);

    useEffect(function fetchMemoryWhenReady() {
        if (healthPhase !== 'ready' || !globalAppId) return;
        let cancelled = false;
        setMemoryLoading(true);
        setMemoryError(null);
        fetch(
            `/api/agent/diagnostics/memory/${encodeURIComponent(globalAppId)}`,
            { credentials: 'include', cache: 'no-store' }
        )
            .then(async function handle(res) {
                const data = await res.json().catch(function safe() { return null; });
                if (cancelled) return;
                if (!res.ok) {
                    throw new Error((data && (data.error as string)) || `HTTP ${res.status}`);
                }
                setMemoryResult((data || {}) as MemoryResult);
            })
            .catch(function onError(err) {
                if (cancelled) return;
                setMemoryError(err instanceof Error ? err.message : String(err));
                setMemoryResult(null);
            })
            .finally(function done() {
                if (cancelled) return;
                setMemoryLoading(false);
            });
        return function cleanup() {
            cancelled = true;
        };
    }, [globalAppId, healthPhase, refreshKey]);

    const fetchList = useCallback(async function fetchList() {
        if (!globalAppId) {
            setConversations(null);
            setListError(null);
            return;
        }
        // Same pattern as loadDetail: bump a monotonic run id, treat any
        // response landing under a stale id as a discarded race so that an
        // in-flight list call does not overwrite state for a different app.
        const runId = ++listRunIdRef.current;
        setListLoading(true);
        setListError(null);
        try {
            const res = await fetch(
                `/api/agent/conversations/${encodeURIComponent(globalAppId)}?limit=${LIST_LIMIT}`,
                { credentials: 'include', cache: 'no-store' }
            );
            const data = await res.json().catch(function safe() { return null; });
            if (listRunIdRef.current !== runId) return;
            if (!res.ok) {
                throw new Error((data && (data.error as string)) || `HTTP ${res.status}`);
            }
            const payload = (data || {}) as ListResponse;
            const list = payload.conversations || [];
            setConversations(list);
            // Surface a truncation note when the agents service indicates more
            // conversations exist beyond LIST_LIMIT. Without this the operator
            // sees a silently-capped list and assumes the app has <= 100
            // conversations.
            if (payload.pagination?.hasMore) {
                setListTruncatedTotal(payload.pagination.total ?? null);
            } else {
                setListTruncatedTotal(null);
            }
            if (list.length === 1) {
                setSelectedId(list[0].id);
            } else {
                setSelectedId(null);
                setDetail(null);
            }
        } catch (err) {
            if (listRunIdRef.current !== runId) return;
            setListError(err instanceof Error ? err.message : String(err));
            setConversations(null);
            setListTruncatedTotal(null);
            setSelectedId(null);
            setDetail(null);
        } finally {
            if (listRunIdRef.current === runId) {
                setListLoading(false);
            }
        }
    }, [globalAppId]);

    // App switch invalidates any in-flight list fetch — bump the run id so
    // late responses for the previous appId never reach setState.
    useEffect(function invalidateListOnAppChange() {
        listRunIdRef.current += 1;
    }, [globalAppId]);

    useEffect(function fetchListWhenReady() {
        if (healthPhase !== 'ready') return;
        fetchList();
    }, [fetchList, healthPhase]);

    useEffect(function clearDetailOnSelectionChange() {
        detailRunIdRef.current += 1;
        setDetail(null);
        setDetailError(null);
        setDetailLoading(false);
    }, [globalAppId, selectedId]);

    const loadDetail = useCallback(async function loadDetail() {
        if (!globalAppId || !selectedId) return;
        const runId = ++detailRunIdRef.current;
        setDetailLoading(true);
        setDetailError(null);
        try {
            const res = await fetch(
                `/api/agent/conversations/${encodeURIComponent(globalAppId)}/${encodeURIComponent(selectedId)}?limit=${DETAIL_PAGE_SIZE}`,
                { credentials: 'include', cache: 'no-store' }
            );
            const data = await res.json().catch(function safe() { return null; });
            if (detailRunIdRef.current !== runId) return;
            if (!res.ok) {
                throw new Error((data && (data.error as string)) || `HTTP ${res.status}`);
            }
            setDetail(normalizeDetailResponse(data));
        } catch (err) {
            if (detailRunIdRef.current !== runId) return;
            setDetailError(err instanceof Error ? err.message : String(err));
            setDetail(null);
        } finally {
            if (detailRunIdRef.current === runId) {
                setDetailLoading(false);
            }
        }
    }, [globalAppId, selectedId]);

    const loadOlderDetail = useCallback(async function loadOlderDetail() {
        if (!globalAppId || !selectedId || !detail || !detail.pagination.hasMore || !detail.pagination.nextCursor) return;
        const runId = ++detailRunIdRef.current;
        const cursor = detail.pagination.nextCursor;
        setDetailLoading(true);
        setDetailError(null);
        try {
            const res = await fetch(
                `/api/agent/conversations/${encodeURIComponent(globalAppId)}/${encodeURIComponent(selectedId)}?limit=${DETAIL_PAGE_SIZE}&before=${encodeURIComponent(cursor)}`,
                { credentials: 'include', cache: 'no-store' }
            );
            const data = await res.json().catch(function safe() { return null; });
            if (detailRunIdRef.current !== runId) return;
            if (!res.ok) {
                throw new Error((data && (data.error as string)) || `HTTP ${res.status}`);
            }
            const next = normalizeDetailResponse(data);
            setDetail(function merge(prev) {
                if (!prev) return next;
                return {
                    conversation: next.conversation,
                    messages: [...next.messages, ...prev.messages],
                    pagination: next.pagination,
                };
            });
        } catch (err) {
            if (detailRunIdRef.current !== runId) return;
            setDetailError(err instanceof Error ? err.message : String(err));
        } finally {
            if (detailRunIdRef.current === runId) {
                setDetailLoading(false);
            }
        }
    }, [globalAppId, selectedId, detail]);

    const showBackButton = (conversations?.length ?? 0) > 1 && selectedId !== null;
    const canRefresh = healthPhase !== 'pinging' && !listLoading;

    const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
    const [downloadError, setDownloadError] = useState<string | null>(null);

    const triggerDownload = useCallback(async function triggerDownload(
        key: string,
        url: string,
        _fallbackFilename: string
    ) {
        if (!globalAppId || downloadingKey) return;
        setDownloadingKey(key);
        setDownloadError(null);
        // Preflight: do a real GET (the export routes don't support HEAD) but
        // abort as soon as the headers come back. This lets us surface a
        // JSON error to the operator without buffering the full archive,
        // then hand off the actual download to the browser via
        // `window.location.assign`. The browser's download manager streams
        // straight to disk and respects Content-Disposition. Net cost is one
        // extra round-trip for headers; the previous res.blob() approach
        // forced the entire archive into RAM and defeated server streaming.
        const controller = new AbortController();
        try {
            const res = await fetch(url, {
                credentials: 'include',
                cache: 'no-store',
                signal: controller.signal,
            });
            if (!res.ok) {
                // Read the JSON error before aborting; the body is small.
                const data = await res.json().catch(function safe() { return null; });
                throw new Error((data && (data.error as string)) || `HTTP ${res.status}`);
            }
            // Headers look good — abandon this fetch and let the browser
            // re-issue a GET that streams to the download manager.
            controller.abort();
            window.location.assign(url);
        } catch (err) {
            if ((err as Error)?.name === 'AbortError') return;
            setDownloadError(err instanceof Error ? err.message : String(err));
        } finally {
            setDownloadingKey(null);
        }
    }, [globalAppId, downloadingKey]);

    const safeAppId = globalAppId.replace(/[^a-zA-Z0-9_-]/g, '_');

    const onDownloadSource = useCallback(function downloadSource() {
        triggerDownload(
            'source',
            `/api/agent/zip/${encodeURIComponent(globalAppId)}`,
            `app-source-${safeAppId}.zip`
        );
    }, [globalAppId, safeAppId, triggerDownload]);

    const onDownloadJson = useCallback(function downloadJson() {
        triggerDownload(
            'json',
            `/api/agent/conversations-export/${encodeURIComponent(globalAppId)}?format=json`,
            `conversations-${safeAppId}.zip`
        );
    }, [globalAppId, safeAppId, triggerDownload]);

    const onDownloadMarkdown = useCallback(function downloadMarkdown() {
        triggerDownload(
            'markdown',
            `/api/agent/conversations-export/${encodeURIComponent(globalAppId)}?format=markdown&detail=full`,
            `conversations-${safeAppId}.md`
        );
    }, [globalAppId, safeAppId, triggerDownload]);

    if (!globalAppId) {
        return (
            <div style={{ padding: '1rem', color: '#6b7280' }}>
                Enter an App ID in the search bar to view agent conversations.
            </div>
        );
    }

    return (
        <div style={{ padding: '0 0.25rem' }}>
            <div style={toolbarStyle}>
                <div style={toolbarLeftStyle}>
                    {showBackButton && (
                        <button
                            type="button"
                            onClick={() => setSelectedId(null)}
                            style={secondaryButtonStyle}
                        >
                            ← All conversations
                        </button>
                    )}
                    <span style={{ color: '#64748b', fontSize: '0.8rem' }}>
                        App <code style={inlineCodeStyle}>{globalAppId}</code>
                    </span>
                    <HealthBadge
                        phase={healthPhase}
                        attempt={healthAttempt}
                        error={healthError}
                        onRetry={runHealthCheck}
                    />
                </div>
                <div style={toolbarRightStyle}>
                    {healthPhase === 'ready' && (
                        <>
                            <DownloadButton
                                onClick={onDownloadJson}
                                label={downloadingKey === 'json' ? 'Raw…' : 'Raw'}
                                title="Download all conversations as a streaming zip of per-conversation JSON files"
                                disabled={downloadingKey !== null}
                            />
                            <DownloadButton
                                onClick={onDownloadMarkdown}
                                label={downloadingKey === 'markdown' ? 'Text…' : 'Text'}
                                title="Download all conversations as a single markdown file"
                                disabled={downloadingKey !== null}
                            />
                            <DownloadButton
                                onClick={onDownloadSource}
                                label={downloadingKey === 'source' ? 'App Code…' : 'App Code'}
                                title="Download app source as zip from the agents service (requires app to have local files)"
                                disabled={downloadingKey !== null}
                            />
                        </>
                    )}
                    {onRefresh && (
                        <button
                            type="button"
                            onClick={onRefresh}
                            style={refreshButtonStyle}
                            disabled={!canRefresh}
                        >
                            {listLoading ? 'Refreshing…' : 'Refresh'}
                        </button>
                    )}
                </div>
            </div>

            {downloadError && (
                <ErrorBanner message={`Download failed: ${downloadError}`} />
            )}

            {healthPhase === 'pinging' && (
                <HealthStatusCard
                    title="Waking up agent…"
                    description={`Pinging /health (attempt ${healthAttempt}/${HEALTH_MAX_ATTEMPTS}). Containers can take up to ~90s to wake from sleep.`}
                    error={healthError}
                />
            )}
            {healthPhase === 'unreachable' && (
                <HealthStatusCard
                    title="Agent unreachable"
                    description={`Failed to reach the agent after ${HEALTH_MAX_ATTEMPTS} attempts.`}
                    error={healthError}
                    onRetry={runHealthCheck}
                />
            )}

            {healthPhase === 'ready' && (
                <AgentStatusCard
                    health={healthResult}
                    memory={memoryResult}
                    memoryError={memoryError}
                    memoryLoading={memoryLoading}
                />
            )}

            {healthPhase === 'ready' && (
                <>
                    {listError && (
                        <ErrorBanner message={`Failed to load conversations: ${listError}`} />
                    )}

                    {!listError && listLoading && conversations === null && (
                        <div style={{ color: '#64748b', fontSize: '0.875rem' }}>Loading conversations…</div>
                    )}

                    {!listError && conversations !== null && conversations.length === 0 && (
                        <div style={emptyStyle}>No agent conversations found for this app.</div>
                    )}

                    {!listError && listTruncatedTotal !== null && (
                        <div style={truncationNoticeStyle}>
                            Showing first {LIST_LIMIT} conversations
                            {listTruncatedTotal > 0 ? ` of ${listTruncatedTotal}` : ''}.
                            Use the JSON or Text export above for the complete history.
                        </div>
                    )}

                    {!listError && selectedId === null && conversations && conversations.length > 1 && (
                        <ConversationList
                            conversations={conversations}
                            onSelect={setSelectedId}
                        />
                    )}

                    {!listError && selectedId !== null && (
                        <ConversationDetail
                            summary={conversations?.find((c) => c.id === selectedId) ?? null}
                            detail={detail}
                            error={detailError}
                            loading={detailLoading}
                            onRender={loadDetail}
                            onLoadOlder={loadOlderDetail}
                        />
                    )}
                </>
            )}
        </div>
    );
}

function DownloadButton({ onClick, label, title, disabled }: {
    onClick: () => void;
    label: string;
    title?: string;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title}
            style={{
                ...downloadButtonStyle,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1,
            }}
        >
            <DownloadIcon />
            {label}
        </button>
    );
}

function DownloadIcon() {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
    );
}

function HealthBadge({ phase, attempt, error, onRetry }: {
    phase: HealthPhase;
    attempt: number;
    error: string | null;
    onRetry: () => void;
}) {
    if (phase === 'idle') return null;
    if (phase === 'pinging') {
        return (
            <span style={{ ...badgeStyle, backgroundColor: '#fef3c7', color: '#92400e', borderColor: '#fde68a' }}>
                ⏳ Pinging agent ({attempt}/{HEALTH_MAX_ATTEMPTS})
            </span>
        );
    }
    if (phase === 'unreachable') {
        return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ ...badgeStyle, backgroundColor: '#fee2e2', color: '#991b1b', borderColor: '#fecaca' }}>
                    ❌ Unreachable
                </span>
                <button type="button" onClick={onRetry} style={secondaryButtonStyle}>Retry</button>
                {error && <span style={{ fontSize: '0.7rem', color: '#991b1b' }}>{error}</span>}
            </span>
        );
    }
    return null;
}

function AgentStatusCard({ health, memory, memoryError, memoryLoading }: {
    health: HealthResult | null;
    memory: MemoryResult | null;
    memoryError: string | null;
    memoryLoading: boolean;
}) {
    const status = health?.status as string | undefined;
    const uptime = typeof health?.uptime === 'number' ? (health.uptime as number) : null;

    const heapUsed = memory?.heapStats?.usedHeapSize ?? memory?.memory?.heapUsed;
    const heapLimit = memory?.heapStats?.heapSizeLimit;
    const heapTotal = memory?.heapStats?.totalHeapSize ?? memory?.memory?.heapTotal;
    const rss = memory?.memory?.rss;
    const externalMem = memory?.memory?.external;
    const heapPct = (typeof heapUsed === 'number' && typeof heapLimit === 'number' && heapLimit > 0)
        ? (heapUsed / heapLimit) * 100
        : null;
    const heapBarColor = heapPct === null ? '#94a3b8' : heapPct > 85 ? '#dc2626' : heapPct > 65 ? '#d97706' : '#16a34a';

    const versions = collectVersions(health);

    return (
        <div style={statusCardStyle}>
            <div style={statusRowStyle}>
                <StatusMetric label="Status" value={status ?? 'unknown'} valueColor={status === 'healthy' ? '#16a34a' : '#d97706'} />
                <StatusMetric label="Uptime" value={uptime !== null ? formatUptime(uptime) : '—'} />
                <StatusMetric label="RSS" value={typeof rss === 'number' ? formatBytes(rss) : '—'} />
                <StatusMetric label="External" value={typeof externalMem === 'number' ? formatBytes(externalMem) : '—'} />
            </div>

            <div style={{ marginTop: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#475569', marginBottom: '0.25rem' }}>
                    <span>
                        Heap{' '}
                        <strong>
                            {typeof heapUsed === 'number' ? formatBytes(heapUsed) : '—'}
                        </strong>
                        {' / '}
                        {typeof heapLimit === 'number' ? formatBytes(heapLimit) : '—'}
                        {typeof heapTotal === 'number' && (
                            <span style={{ color: '#94a3b8' }}> · alloc {formatBytes(heapTotal)}</span>
                        )}
                    </span>
                    <span style={{ color: heapBarColor, fontWeight: 600 }}>
                        {heapPct !== null ? `${heapPct.toFixed(1)}%` : ''}
                    </span>
                </div>
                <div style={heapBarTrackStyle}>
                    <div
                        style={{
                            ...heapBarFillStyle,
                            width: `${heapPct === null ? 0 : Math.min(100, Math.max(0, heapPct))}%`,
                            backgroundColor: heapBarColor,
                        }}
                    />
                </div>
            </div>

            {memoryError && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#991b1b' }}>
                    Memory diagnostics unavailable: {memoryError}
                </div>
            )}
            {memoryLoading && !memoryError && memory === null && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#64748b' }}>
                    Loading memory diagnostics…
                </div>
            )}

            {versions.length > 0 && (
                <div style={{ marginTop: '0.625rem', display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                    {versions.map(function renderVersion(v) {
                        return (
                            <span key={v.label} style={versionChipStyle} title={`${v.label}: ${v.value}`}>
                                {v.label}: {v.value}
                            </span>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function StatusMetric({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
    return (
        <div style={statusMetricStyle}>
            <div style={statusMetricLabelStyle}>{label}</div>
            <div style={{ ...statusMetricValueStyle, color: valueColor ?? statusMetricValueStyle.color }}>{value}</div>
        </div>
    );
}

interface VersionEntry {
    label: string;
    value: string;
}

function collectVersions(health: HealthResult | null): VersionEntry[] {
    if (!health) return [];
    const candidates: Array<[string, unknown]> = [
        ['agent', health.agent_version],
        ['preview', health.preview_app_version],
        ['publish', health.publish_app_version],
        ['pre_start', health.pre_start_version],
        ['app', health.version],
    ];
    return candidates
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0 && entry[1] !== 'unknown')
        .map(([label, value]) => ({ label, value }));
}

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes)) return '—';
    const mb = bytes / 1024 / 1024;
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatUptime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '—';
    const total = Math.floor(seconds);
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const parts: string[] = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m && d === 0) parts.push(`${m}m`);
    if (!d && !h && !m) parts.push(`${s}s`);
    return parts.join(' ') || '0s';
}

function HealthStatusCard({ title, description, error, onRetry }: {
    title: string;
    description: string;
    error: string | null;
    onRetry?: () => void;
}) {
    return (
        <div style={metadataCardStyle}>
            <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '0.95rem' }}>{title}</div>
            <div style={{ marginTop: '0.4rem', color: '#475569', fontSize: '0.85rem' }}>{description}</div>
            {error && (
                <div style={{ marginTop: '0.5rem', color: '#991b1b', fontSize: '0.8rem' }}>
                    Last error: {error}
                </div>
            )}
            {onRetry && (
                <div style={{ marginTop: '0.75rem' }}>
                    <button type="button" onClick={onRetry} style={primaryButtonStyle}>Retry</button>
                </div>
            )}
        </div>
    );
}

function ConversationList({ conversations, onSelect }: {
    conversations: ConversationSummary[];
    onSelect: (id: string) => void;
}) {
    const sorted = useMemo(function sortByUpdated() {
        return [...conversations].sort((a, b) => {
            const ta = Date.parse(a.updatedAt) || 0;
            const tb = Date.parse(b.updatedAt) || 0;
            return tb - ta;
        });
    }, [conversations]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ color: '#475569', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                {sorted.length} conversations
            </div>
            {sorted.map(function renderRow(c) {
                return (
                    <button
                        key={c.id}
                        type="button"
                        onClick={() => onSelect(c.id)}
                        style={listRowStyle}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                            <span style={{ fontWeight: 600, color: '#0f172a', textAlign: 'left' }}>
                                {c.title || c.id}
                            </span>
                            <span style={{ color: '#64748b', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                                {formatTimestamp(c.updatedAt)}
                            </span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                            <code style={inlineCodeStyle}>{c.id}</code>
                            <span>agent: {c.agentId}</span>
                            {typeof c.messageCount === 'number' && <span>{c.messageCount} messages</span>}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

function ConversationDetail({ summary, detail, error, loading, onRender, onLoadOlder }: {
    summary: ConversationSummary | null;
    detail: DetailResponse | null;
    error: string | null;
    loading: boolean;
    onRender: () => void;
    onLoadOlder: () => void;
}) {
    const header = detail?.conversation ?? summary;
    if (!header) {
        if (error) {
            return <ErrorBanner message={`Failed to load conversation: ${error}`} />;
        }
        if (loading) {
            return <div style={{ color: '#64748b', fontSize: '0.875rem' }}>Loading conversation…</div>;
        }
        return <div style={{ color: '#64748b', fontSize: '0.875rem' }}>Conversation not found in this list.</div>;
    }

    const messages = detail?.messages ?? null;
    const totalMessages = detail?.pagination?.total ?? null;
    const loadedCount = messages !== null ? messages.length : null;
    const displayCount = totalMessages !== null
        ? `${loadedCount}/${totalMessages}`
        : (typeof summary?.messageCount === 'number' ? `${summary.messageCount}` : null);
    const userCount = messages?.filter((m) => m.sender === 'user').length ?? null;
    const agentCount = messages !== null && userCount !== null ? messages.length - userCount : null;

    return (
        <div>
            <div style={metadataCardStyle}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                    {!detail && (
                        <button
                            type="button"
                            onClick={onRender}
                            disabled={loading}
                            style={{ ...refreshButtonStyle, opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
                        >
                            {loading ? 'Loading…' : 'Show'}
                        </button>
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>
                            {header.title || header.id}
                        </h3>
                        <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.25rem 0.75rem', fontSize: '0.8rem', color: '#475569' }}>
                            <span style={metadataKeyStyle}>ID:</span>
                            <code style={inlineCodeStyle}>{header.id}</code>
                            <span style={metadataSeparatorStyle}>·</span>
                            <span style={metadataKeyStyle}>Agent:</span>
                            <code style={inlineCodeStyle}>{header.agentId}</code>
                            <span style={metadataSeparatorStyle}>·</span>
                            <span style={metadataKeyStyle}>Created:</span>
                            <span>{formatTimestamp(header.createdAt)}</span>
                            <span style={metadataSeparatorStyle}>·</span>
                            <span style={metadataKeyStyle}>Updated:</span>
                            <span>{formatTimestamp(header.updatedAt)}</span>
                            <span style={metadataSeparatorStyle}>·</span>
                            <span style={metadataKeyStyle}>Messages:</span>
                            <span>
                                {displayCount === null
                                    ? '—'
                                    : userCount !== null && agentCount !== null
                                        ? `${displayCount} (${userCount} user, ${agentCount} agent)`
                                        : displayCount}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {error && !detail && (
                <div style={{ marginTop: '0.75rem' }}>
                    <ErrorBanner message={`Failed to load conversation: ${error}`} />
                </div>
            )}

            {detail && detail.pagination.hasMore && (
                <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'center' }}>
                    <button
                        type="button"
                        onClick={onLoadOlder}
                        disabled={loading}
                        style={{
                            ...secondaryButtonStyle,
                            opacity: loading ? 0.6 : 1,
                            cursor: loading ? 'not-allowed' : 'pointer',
                        }}
                    >
                        {loading ? 'Loading older messages…' : 'Load older messages'}
                    </button>
                </div>
            )}

            {detail && messages && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.75rem' }}>
                    {messages.map(function renderMessage(m) {
                        return <MessageBubble key={m.id} message={m} />;
                    })}
                </div>
            )}
        </div>
    );
}

function MessageBubble({ message }: { message: ConversationMessage }) {
    const [showRaw, setShowRaw] = useState(false);
    const isUser = message.sender === 'user';
    const toolCalls = message.toolCalls || [];
    const agentName = (message.metadata?.agentName as string | undefined) || message.metadata?.agentId as string | undefined;

    const avatarIcon = isUser ? '👤' : '🤖';
    const labelText = isUser ? 'User' : (agentName ? `Assistant (${agentName})` : 'Assistant');
    const labelColor = isUser ? '#1e40af' : '#047857';
    const bubbleBg = isUser ? '#eff6ff' : '#f0fdf4';
    const bubbleText = isUser ? '#1e3a8a' : '#14532d';

    const steps = useMemo(
        function build() { return isUser ? [] : buildAgentSteps(message); },
        [isUser, message],
    );

    return (
        <div style={messageRowStyle}>
            <div style={avatarStyle}>{avatarIcon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={messageHeaderStyle}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: labelColor }}>
                        {labelText}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                        {formatTimestamp(message.createdAt)}
                    </span>
                    {!isUser && steps.length > 0 && (
                        <span style={stepsBadgeStyle}>
                            {steps.length} step{steps.length === 1 ? '' : 's'}
                        </span>
                    )}
                    {!isUser && steps.length === 0 && toolCalls.length > 0 && (
                        <span style={stepsBadgeStyle}>
                            {toolCalls.length} tool call{toolCalls.length === 1 ? '' : 's'}
                        </span>
                    )}
                </div>

                {!isUser && steps.length > 0 ? (
                    <div style={agentStepListStyle}>
                        {steps.map(function renderStep(step) {
                            return <AgentStepBlock key={`step-${step.index}`} step={step} />;
                        })}
                    </div>
                ) : (
                    (message.content || toolCalls.length > 0) && (
                        <div
                            style={{
                                backgroundColor: bubbleBg,
                                color: bubbleText,
                                borderRadius: '12px',
                                borderTopLeftRadius: '2px',
                                padding: '0.75rem 1rem',
                                fontSize: '0.9rem',
                                lineHeight: 1.6,
                            }}
                        >
                            {message.content && (
                                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                    {message.content}
                                </div>
                            )}
                            {toolCalls.length > 0 && (
                                <ToolCallsList toolCalls={toolCalls} />
                            )}
                        </div>
                    )
                )}

                <button
                    type="button"
                    onClick={() => setShowRaw((v) => !v)}
                    style={rawToggleStyle}
                >
                    {showRaw ? 'Hide raw JSON' : 'Show raw JSON'}
                </button>
                {showRaw && (
                    <pre style={rawJsonStyle}>{JSON.stringify(message, null, 2)}</pre>
                )}
            </div>
        </div>
    );
}

interface AgentStep {
    index: number;
    text: string;
    tools: ToolCall[];
}

// Walk message.segments chronologically. Each transition from a tool_call back
// to content (or the start of a content block after tools) opens a new step;
// content tokens accumulate into the current step's text and tool_calls
// accumulate into its tools list. Falls back to a single-step lump when the
// message has no segments (older payloads).
function buildAgentSteps(message: ConversationMessage): AgentStep[] {
    const segments = message.segments ?? [];
    if (segments.length === 0) {
        if (!message.content && (message.toolCalls?.length ?? 0) === 0) return [];
        return [{ index: 1, text: message.content ?? '', tools: message.toolCalls ?? [] }];
    }

    const steps: AgentStep[] = [];
    let pending: AgentStep | null = null;
    let lastWasTool = false;
    function flush() {
        if (pending && (pending.text || pending.tools.length > 0)) {
            pending.index = steps.length + 1;
            steps.push(pending);
        }
        pending = null;
    }

    for (const seg of segments) {
        if (seg.type === 'content') {
            if (lastWasTool) flush();
            if (!pending) pending = { index: 0, text: '', tools: [] };
            pending.text += seg.content ?? '';
            lastWasTool = false;
        } else if (seg.type === 'tool_call') {
            if (!pending) pending = { index: 0, text: '', tools: [] };
            if (seg.toolCall) pending.tools.push(seg.toolCall);
            lastWasTool = true;
        }
    }
    flush();
    return steps;
}

function AgentStepBlock({ step }: { step: AgentStep }) {
    const startTime = step.tools[0]?.startTime;
    const lastTool = step.tools[step.tools.length - 1];
    const endTime = lastTool?.endTime;
    const duration = startTime && endTime
        ? Date.parse(endTime) - Date.parse(startTime)
        : null;

    return (
        <div style={agentStepBlockStyle}>
            <div style={agentStepHeaderStyle}>
                <span style={agentStepBadgeStyle}>Step {step.index}</span>
                {duration != null && duration > 0 && (
                    <span style={agentStepHeaderMutedStyle}>{formatStepDuration(duration)}</span>
                )}
                {step.tools.length > 0 && (
                    <span style={agentStepHeaderMutedStyle}>
                        {step.tools.length} tool{step.tools.length === 1 ? '' : 's'}
                    </span>
                )}
            </div>
            {step.text && (
                <div style={agentStepTextStyle}>{step.text}</div>
            )}
            {step.tools.length > 0 && (
                <div style={agentStepToolsStyle}>
                    <ToolCallsList toolCalls={step.tools} hideHeader />
                </div>
            )}
        </div>
    );
}

function formatStepDuration(ms: number): string {
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${ms}ms`;
}

function ToolCallsList({ toolCalls, hideHeader = false }: { toolCalls: ToolCall[]; hideHeader?: boolean }) {
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [showAll, setShowAll] = useState(false);

    const visibleCalls = showAll ? toolCalls : toolCalls.slice(0, TOOL_CALLS_VISIBLE_DEFAULT);
    const hiddenCount = toolCalls.length - visibleCalls.length;

    return (
        <div style={{ marginTop: hideHeader ? 0 : '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {!hideHeader && (
                <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>
                    {toolCalls.length} tool call{toolCalls.length === 1 ? '' : 's'}
                    {hiddenCount > 0 && ` · showing first ${visibleCalls.length}`}
                </div>
            )}
            {visibleCalls.map(function renderToolCall(tc) {
                const open = expanded[tc.id];
                return (
                    <ToolCallRow
                        key={tc.id}
                        toolCall={tc}
                        open={open}
                        onToggle={() => setExpanded((prev) => ({ ...prev, [tc.id]: !prev[tc.id] }))}
                    />
                );
            })}
            {toolCalls.length > TOOL_CALLS_VISIBLE_DEFAULT && (
                <button
                    type="button"
                    onClick={() => setShowAll((v) => !v)}
                    style={{ ...rawToggleStyle, alignSelf: 'flex-start', marginTop: '0.25rem' }}
                >
                    {showAll
                        ? `Show fewer (${TOOL_CALLS_VISIBLE_DEFAULT})`
                        : `Show all ${toolCalls.length} tool calls`}
                </button>
            )}
        </div>
    );
}

function ToolCallRow({ toolCall, open, onToggle }: {
    toolCall: ToolCall;
    open: boolean;
    onToggle: () => void;
}) {
    const { summary, body } = useMemo(function buildRendered() {
        return renderToolCall(toolCall);
    }, [toolCall]);

    return (
        <div style={toolCallRowStyle}>
            <button type="button" onClick={onToggle} style={toolCallHeaderStyle}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, flex: 1 }}>
                    <span style={{ color: '#94a3b8' }}>{open ? '▾' : '▸'}</span>
                    <code style={inlineCodeStyle}>{toolCall.name}</code>
                    {summary && (
                        <span
                            style={{ color: '#475569', fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
                            title={typeof summary === 'string' ? summary : undefined}
                        >
                            {summary}
                        </span>
                    )}
                </span>
                <span style={{ color: '#64748b', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                    {toolCall.status || 'unknown'}{typeof toolCall.duration === 'number' ? ` · ${toolCall.duration}ms` : ''}
                </span>
            </button>
            {body}
            {open && (
                <div style={{ padding: '0.5rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div>
                        <div style={toolCallSubLabelStyle}>input</div>
                        <pre style={inlinePreStyle}>{JSON.stringify(toolCall.input, null, 2)}</pre>
                    </div>
                    {toolCall.result !== undefined && (
                        <div>
                            <div style={toolCallSubLabelStyle}>result</div>
                            <pre style={inlinePreStyle}>{
                                typeof toolCall.result === 'string'
                                    ? toolCall.result
                                    : JSON.stringify(toolCall.result, null, 2)
                            }</pre>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function ErrorBanner({ message }: { message: string }) {
    return (
        <div style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: '0.75rem 1rem',
            borderRadius: '6px',
            fontSize: '0.875rem',
            marginBottom: '0.75rem',
        }}>
            {message}
        </div>
    );
}

const primaryButtonStyle: React.CSSProperties = {
    padding: '0.5rem 0.875rem',
    backgroundColor: '#0f766e',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.8rem',
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
};

const secondaryButtonStyle: React.CSSProperties = {
    padding: '0.4rem 0.75rem',
    backgroundColor: '#e2e8f0',
    color: '#1e293b',
    border: '1px solid #cbd5e1',
    borderRadius: '6px',
    fontSize: '0.8rem',
    fontWeight: 500,
    cursor: 'pointer',
};

const inlineCodeStyle: React.CSSProperties = {
    backgroundColor: '#f1f5f9',
    padding: '1px 6px',
    borderRadius: '4px',
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    fontSize: '0.75rem',
    color: '#0f172a',
};

const emptyStyle: React.CSSProperties = {
    padding: '2rem 1rem',
    textAlign: 'center',
    color: '#64748b',
    backgroundColor: '#f8fafc',
    border: '1px dashed #cbd5e1',
    borderRadius: '8px',
    fontSize: '0.875rem',
};

const truncationNoticeStyle: React.CSSProperties = {
    marginBottom: '0.75rem',
    padding: '0.5rem 0.75rem',
    backgroundColor: '#fef3c7',
    border: '1px solid #fcd34d',
    borderRadius: '6px',
    color: '#92400e',
    fontSize: '0.8rem',
};

const listRowStyle: React.CSSProperties = {
    backgroundColor: 'white',
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    padding: '0.75rem 1rem',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
};

const metadataCardStyle: React.CSSProperties = {
    backgroundColor: 'white',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    padding: '1rem 1.25rem',
    marginBottom: '0.75rem',
};

const metadataKeyStyle: React.CSSProperties = {
    color: '#94a3b8',
    fontWeight: 500,
};

const metadataSeparatorStyle: React.CSSProperties = {
    color: '#cbd5e1',
};

const messageRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: '0.6rem',
    alignItems: 'flex-start',
};

const avatarStyle: React.CSSProperties = {
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.4rem',
    flexShrink: 0,
};

const messageHeaderStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.3rem',
    flexWrap: 'wrap',
};

const stepsBadgeStyle: React.CSSProperties = {
    fontSize: '0.6rem',
    fontWeight: 600,
    color: '#047857',
    backgroundColor: '#d1fae5',
    padding: '0.1rem 0.35rem',
    borderRadius: '4px',
};

const agentStepListStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
};

const agentStepBlockStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem',
    padding: '0.55rem 0.75rem',
    backgroundColor: '#f0fdf4',
    border: '1px solid #d1fae5',
    borderRadius: '8px',
};

const agentStepHeaderStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.7rem',
};

const agentStepBadgeStyle: React.CSSProperties = {
    fontSize: '0.65rem',
    fontWeight: 700,
    color: '#065f46',
    backgroundColor: '#a7f3d0',
    padding: '0.1rem 0.4rem',
    borderRadius: '3px',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
};

const agentStepHeaderMutedStyle: React.CSSProperties = {
    fontSize: '0.65rem',
    color: '#475569',
    fontFamily: 'monospace',
};

const agentStepTextStyle: React.CSSProperties = {
    fontSize: '0.85rem',
    color: '#14532d',
    lineHeight: 1.55,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
};

const agentStepToolsStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
};

const rawToggleStyle: React.CSSProperties = {
    marginTop: '0.5rem',
    padding: '0.15rem 0.5rem',
    fontSize: '0.7rem',
    color: '#64748b',
    backgroundColor: 'transparent',
    border: '1px solid #cbd5e1',
    borderRadius: '4px',
    cursor: 'pointer',
};

const rawJsonStyle: React.CSSProperties = {
    marginTop: '0.5rem',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    padding: '0.75rem',
    borderRadius: '6px',
    fontSize: '0.7rem',
    maxHeight: '400px',
    overflow: 'auto',
};

const toolbarStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.75rem',
    marginBottom: '0.75rem',
    flexWrap: 'wrap',
};

const toolbarLeftStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexWrap: 'wrap',
    minWidth: 0,
};

const toolbarRightStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexWrap: 'wrap',
    marginLeft: 'auto',
};

const downloadButtonStyle: React.CSSProperties = {
    padding: '0.5rem 0.875rem',
    backgroundColor: '#059669',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.813rem',
    fontWeight: 500,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.375rem',
    fontFamily: 'inherit',
};

const refreshButtonStyle: React.CSSProperties = {
    padding: '0.625rem 1.25rem',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: 500,
    fontFamily: 'inherit',
};

const statusCardStyle: React.CSSProperties = {
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    padding: '0.75rem 1rem',
    marginBottom: '0.75rem',
};

const statusRowStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '0.75rem',
};

const statusMetricStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.15rem',
    minWidth: 0,
};

const statusMetricLabelStyle: React.CSSProperties = {
    fontSize: '0.7rem',
    color: '#94a3b8',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
};

const statusMetricValueStyle: React.CSSProperties = {
    fontSize: '0.875rem',
    color: '#0f172a',
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
};

const heapBarTrackStyle: React.CSSProperties = {
    width: '100%',
    height: '6px',
    backgroundColor: '#f1f5f9',
    borderRadius: '999px',
    overflow: 'hidden',
};

const heapBarFillStyle: React.CSSProperties = {
    height: '100%',
    transition: 'width 200ms ease-out',
};

const versionChipStyle: React.CSSProperties = {
    fontSize: '0.7rem',
    color: '#475569',
    backgroundColor: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '4px',
    padding: '0.15rem 0.4rem',
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};

const badgeStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    padding: '0.2rem 0.55rem',
    borderRadius: '999px',
    border: '1px solid',
    fontSize: '0.75rem',
    fontWeight: 500,
};

const toolCallRowStyle: React.CSSProperties = {
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    backgroundColor: '#ffffff',
};

const toolCallHeaderStyle: React.CSSProperties = {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.4rem 0.75rem',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.8rem',
    color: '#0f172a',
};

const toolCallSubLabelStyle: React.CSSProperties = {
    fontSize: '0.7rem',
    color: '#64748b',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: '0.25rem',
};

const inlinePreStyle: React.CSSProperties = {
    margin: 0,
    backgroundColor: '#f8fafc',
    padding: '0.5rem',
    borderRadius: '4px',
    fontSize: '0.7rem',
    overflow: 'auto',
    maxHeight: '300px',
};
