'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { renderToolCall } from '@/components/agent-tool-renderers';
import type { ToolCall } from '@/lib/agent-message-types';
import { type CostSummary, extractCostAttribution, summarizeCost } from '@/lib/eb-cost';
import { langfuseEbProjectUrl, langfuseEbTraceUrl } from '@/lib/langfuse-eb-ui';
import { fullStorySessionUrl, langfuseTraceUrl } from '@/lib/langfuse-ui';

// Default-expand preference for the steps block: set by the toolbar toggle and
// consumed by each TraceTurn's initial showSteps. Persisted in localStorage.
const ExpandStepsContext = React.createContext(false);
const EXPAND_STEPS_STORAGE_KEY = 'aab.eb.expandSteps';

const PRESET_DAYS = [1, 7, 30, 90] as const;
type PresetDays = (typeof PRESET_DAYS)[number];

// Shown when the upstream public REST list query exceeds its server-side budget
// (HTTP 422) — usually a wide window over a high-volume customer.
const EB_TIMEOUT_MESSAGE =
    'Query timed out. Try again in a few minutes, or narrow the range — otherwise use the agent conversation view instead.';

const LOAD_ALL_CONFIRM = (remaining: number): string =>
    `Load all ${remaining} remaining pages?\n\n` +
    `This may take a while and is rarely needed. ` +
    `Recent conversations are usually most relevant — ` +
    `older traces may not reflect the current user experience.`;

interface EbUsageDetails {
    input?: number;
    output?: number;
    total?: number;
    input_cached?: number;
    input_cache_creation?: number;
}

interface EbObservation {
    id: string;
    name: string;
    type: string;
    model?: string;
    input?: unknown;
    output?: unknown;
    statusMessage?: string;
    level?: string;
    parentObservationId?: string;
    startTime?: string;
    endTime?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    // EB exposes usageDetails as a parsed object at the observation top level.
    // metadata.attributes['langfuse.observation.usage_details'] is the same data
    // but JSON-stringified — prefer the top-level object.
    usageDetails?: EbUsageDetails;
    calculatedTotalCost?: number | null;
    metadata?: {
        attributes?: Record<string, unknown>;
        [key: string]: unknown;
    };
}

interface EbScore {
    id: string;
    name: string;
    value?: number | string | null;
    stringValue?: string | null;
    comment?: string | null;
    dataType?: string;
    source?: string;
}

interface EbTrace {
    id: string;
    name: string | null;
    timestamp: string;
    sessionId: string | null;
    input: unknown;
    output: unknown;
    metadata: Record<string, unknown> | null;
    tags: string[];
    environment?: string | null;
    totalCost?: number | null;
    latency?: number | null;
    scores?: EbScore[];
    observations?: EbObservation[];
    /** Normalized cost summary computed by the EB sessions API. */
    cost?: CostSummary;
}

interface EbSession {
    sessionId: string;
    traces: EbTrace[];
    firstTrace: string;
    lastTrace: string;
    traceCount: number;
    totalCost: number;
}

interface SessionsResponse {
    appId: string;
    sessions: EbSession[];
    totalTraces: number;
    totalItems?: number | null;
    pagination?: {
        page: number;
        totalPages: number;
        hasMore: boolean;
    };
    warnings?: string[];
}

interface Props {
    globalAppId: string;
    refreshKey?: number;
    onRefresh?: () => void;
}

export default function LangfuseEbPanel({ globalAppId, refreshKey = 0, onRefresh }: Props) {
    const [sessions, setSessions] = useState<EbSession[]>([]);
    const [warnings, setWarnings] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [loadingAll, setLoadingAll] = useState(false);
    const [loadAllProgress, setLoadAllProgress] = useState({ loaded: 0, total: 0 });
    const [error, setError] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    const [totalItems, setTotalItems] = useState<number | null>(null);
    const [hasMore, setHasMore] = useState(true);
    const [days, setDays] = useState<PresetDays>(7);
    // Toolbar prefs: default-expand the steps block (persisted) + terms legend.
    const [expandSteps, setExpandSteps] = useState(false);
    const [showLegend, setShowLegend] = useState(false);

    const loadingMoreRef = useRef(false);
    const loadAllAbortRef = useRef<AbortController | null>(null);
    const prefetchedRef = useRef(new Map<number, SessionsResponse>());
    const prefetchingRef = useRef(new Set<number>());
    const inFlightRef = useRef<AbortController | null>(null);

    // Load the persisted expand-steps preference once on mount (client-only, so
    // it doesn't affect SSR/hydration).
    useEffect(function loadExpandStepsPref() {
        try {
            setExpandSteps(window.localStorage.getItem(EXPAND_STEPS_STORAGE_KEY) === '1');
        } catch {
            // localStorage may be unavailable; fall back to the default (collapsed).
        }
    }, []);
    const toggleExpandSteps = useCallback(function toggle() {
        setExpandSteps(function flip(prev) {
            const next = !prev;
            try {
                window.localStorage.setItem(EXPAND_STEPS_STORAGE_KEY, next ? '1' : '0');
            } catch {
                // Persisting is best-effort.
            }
            return next;
        });
    }, []);

    const mergeSessions = useCallback(function merge(
        existing: EbSession[],
        incoming: EbSession[],
    ): EbSession[] {
        const map = new Map<string, EbSession>();
        for (const s of existing) {
            map.set(s.sessionId, { ...s, traces: [...s.traces] });
        }
        for (const s of incoming) {
            const prev = map.get(s.sessionId);
            if (prev) {
                const seen = new Set(prev.traces.map(function id(t) { return t.id; }));
                const merged = [...prev.traces];
                for (const t of s.traces) {
                    if (!seen.has(t.id)) merged.push(t);
                }
                merged.sort(function asc(a, b) {
                    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
                });
                prev.traces = merged;
                prev.traceCount = merged.length;
                prev.totalCost = merged.reduce(function add(sum, t) { return sum + (t.totalCost ?? 0); }, 0);
                if (new Date(s.firstTrace) < new Date(prev.firstTrace)) prev.firstTrace = s.firstTrace;
                if (new Date(s.lastTrace) > new Date(prev.lastTrace)) prev.lastTrace = s.lastTrace;
            } else {
                map.set(s.sessionId, { ...s, traces: [...s.traces] });
            }
        }
        return Array.from(map.values()).sort(function desc(a, b) {
            return new Date(b.lastTrace).getTime() - new Date(a.lastTrace).getTime();
        });
    }, []);

    const prefetch = useCallback(
        async function prefetchPage(target: number, knownTotal?: number) {
            if (!globalAppId) return;
            if (target < 1) return;
            if (knownTotal && target > knownTotal) return;
            if (prefetchedRef.current.has(target) || prefetchingRef.current.has(target)) return;
            // Capture the app id at start; if the operator switches apps
            // before the response lands, drop the result so the new app
            // does not consume a cached page from the previous one.
            const startedFor = globalAppId;
            prefetchingRef.current.add(target);
            try {
                const from: string = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
                const res = await fetch(
                    `/api/eb-langfuse/sessions/${encodeURIComponent(globalAppId)}?page=${target}&fromTimestamp=${encodeURIComponent(from)}`,
                    { credentials: 'include', cache: 'no-store' },
                );
                if (!res.ok) return;
                if (startedFor !== globalAppId) return;
                const body = (await res.json()) as SessionsResponse;
                if (startedFor !== globalAppId) return;
                prefetchedRef.current.set(target, body);
            } catch {
                // Prefetch is best-effort; main path remains the fallback.
            } finally {
                prefetchingRef.current.delete(target);
            }
        },
        [globalAppId, days],
    );

    const fetchPage = useCallback(
        async function fetchPageData(
            target: number,
            options?: { isLoadMore?: boolean; forceRefresh?: boolean },
        ) {
            if (!globalAppId) return;
            const isLoadMore = options?.isLoadMore ?? false;
            const forceRefresh = options?.forceRefresh ?? false;
            if (loadingMoreRef.current && !forceRefresh) return;

            inFlightRef.current?.abort();
            const controller = new AbortController();
            inFlightRef.current = controller;

            if (isLoadMore) {
                setLoadingMore(true);
                loadingMoreRef.current = true;
            } else {
                setLoading(true);
                setSessions([]);
                setWarnings([]);
            }
            setError(null);

            try {
                let body: SessionsResponse | undefined = prefetchedRef.current.get(target);
                if (body) {
                    prefetchedRef.current.delete(target);
                } else {
                    const from: string = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
                    const res = await fetch(
                        `/api/eb-langfuse/sessions/${encodeURIComponent(globalAppId)}?page=${target}&fromTimestamp=${encodeURIComponent(from)}`,
                        { credentials: 'include', cache: 'no-store', signal: controller.signal },
                    );
                    if (!res.ok) {
                        if (res.status === 422) throw new Error(EB_TIMEOUT_MESSAGE);
                        const errBody = await res.json().catch(function safe() { return null; });
                        throw new Error((errBody && (errBody.error as string)) || `HTTP ${res.status}`);
                    }
                    body = (await res.json()) as SessionsResponse;
                }

                const totalPagesValue = body.pagination?.totalPages ?? 1;
                setTotalPages(totalPagesValue);
                setTotalItems(body.totalItems ?? body.totalTraces ?? null);
                setCurrentPage(target);
                setHasMore(target < totalPagesValue);
                setSessions(function update(prev) {
                    return isLoadMore ? mergeSessions(prev, body!.sessions) : body!.sessions;
                });
                if (body.warnings && body.warnings.length > 0) {
                    setWarnings(body.warnings);
                }
                prefetch(target + 1, totalPagesValue);
            } catch (err) {
                if (err instanceof DOMException && err.name === 'AbortError') return;
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                if (!controller.signal.aborted) {
                    if (!isLoadMore) setLoading(false);
                    setLoadingMore(false);
                    loadingMoreRef.current = false;
                }
            }
        },
        [globalAppId, days, mergeSessions, prefetch],
    );

    const fetchAllPages = useCallback(async function fetchAll() {
        if (!globalAppId || loadingMoreRef.current) return;

        const controller = new AbortController();
        loadAllAbortRef.current = controller;
        setLoadingAll(true);
        setLoadingMore(true);
        loadingMoreRef.current = true;

        try {
            const from: string = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
            let next = currentPage + 1;
            while (next <= totalPages) {
                if (controller.signal.aborted) break;
                setLoadAllProgress({ loaded: next - currentPage, total: totalPages - currentPage });
                const res = await fetch(
                    `/api/eb-langfuse/sessions/${encodeURIComponent(globalAppId)}?page=${next}&fromTimestamp=${encodeURIComponent(from)}`,
                    { credentials: 'include', cache: 'no-store', signal: controller.signal },
                );
                if (!res.ok) {
                    if (res.status === 422) throw new Error(EB_TIMEOUT_MESSAGE);
                    throw new Error(`Failed to fetch page ${next}: ${res.status}`);
                }
                const body = (await res.json()) as SessionsResponse;

                const totalPagesValue = body.pagination?.totalPages ?? 1;
                setTotalPages(totalPagesValue);
                setTotalItems(body.totalItems ?? body.totalTraces ?? null);
                setSessions(function update(prev) { return mergeSessions(prev, body.sessions); });
                setCurrentPage(next);
                if (next >= totalPagesValue) {
                    setHasMore(false);
                    break;
                }
                next++;
            }
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
                // Cancelled by user; not surfaced as an error.
            } else {
                setError(err instanceof Error ? err.message : String(err));
            }
        } finally {
            setLoadingAll(false);
            setLoadingMore(false);
            loadingMoreRef.current = false;
            loadAllAbortRef.current = null;
            setLoadAllProgress({ loaded: 0, total: 0 });
        }
    }, [globalAppId, currentPage, totalPages, mergeSessions, days]);

    const stopLoadAll = useCallback(function stop() {
        loadAllAbortRef.current?.abort();
    }, []);

    useEffect(() => {
        if (globalAppId) {
            prefetchedRef.current.clear();
            prefetchingRef.current.clear();
            fetchPage(1);
        } else {
            setSessions([]);
            setWarnings([]);
            setCurrentPage(0);
            setTotalPages(1);
            setTotalItems(null);
            setHasMore(true);
            prefetchedRef.current.clear();
            prefetchingRef.current.clear();
        }
        return () => inFlightRef.current?.abort();
    }, [globalAppId, fetchPage]);

    useEffect(() => {
        if (refreshKey > 0 && globalAppId) {
            loadingMoreRef.current = false;
            setSessions([]);
            setWarnings([]);
            setCurrentPage(0);
            setTotalPages(1);
            setHasMore(true);
            prefetchedRef.current.clear();
            prefetchingRef.current.clear();
            fetchPage(1, { forceRefresh: true });
        }
    }, [refreshKey, globalAppId, fetchPage]);

    const remainingPages = Math.max(0, totalPages - currentPage);
    const totals = useMemo(function compute() { return aggregatePanelTotals(sessions); }, [sessions]);

    return (
        <div style={panelStyle}>
            <div style={toolbarStyle}>
                <div style={toolbarLeftStyle}>
                    <h2 style={titleStyle}>
                        <span style={{ fontSize: '1.25rem' }}>💬</span>
                        Conversation
                    </h2>
                    {globalAppId && (
                        <span style={appIdChipStyle}>
                            {globalAppId}
                        </span>
                    )}
                    {globalAppId && !loading && sessions.length > 0 && (
                        <span style={pageStatusStyle(hasMore)}>
                            {hasMore ? `Page ${currentPage} of ${totalPages}` : '✓ All loaded'}
                        </span>
                    )}
                    {loading && <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Loading…</span>}
                </div>
                <div style={toolbarRightStyle}>
                    <div style={presetChipsWrapperStyle}>
                        {PRESET_DAYS.map(function chip(d) {
                            return (
                                <button
                                    key={d}
                                    type="button"
                                    onClick={function select() { setDays(d); }}
                                    style={presetChipStyle(d === days)}
                                    title={`Show last ${d} days`}
                                >
                                    {d}d
                                </button>
                            );
                        })}
                    </div>
                    <label style={toggleLabelStyle} title="Expand the steps block by default in every turn">
                        <input type="checkbox" checked={expandSteps} onChange={toggleExpandSteps} />
                        Expand steps
                    </label>
                    <span style={legendAnchorStyle}>
                        <button
                            type="button"
                            onClick={function toggle() { setShowLegend(function flip(s) { return !s; }); }}
                            style={legendButtonStyle}
                            title="What do these terms mean?"
                            aria-label="Explain terms"
                        >
                            ?
                        </button>
                        {showLegend && (
                            <div style={legendPopoverStyle}>
                                <TermsLegend />
                            </div>
                        )}
                    </span>
                    {onRefresh && (
                        <button
                            type="button"
                            onClick={onRefresh}
                            disabled={loading || !globalAppId}
                            style={refreshButtonStyle(loading || !globalAppId)}
                        >
                            Refresh
                        </button>
                    )}
                </div>
            </div>

            {sessions.length > 0 && (
                <div style={statsRowStyle}>
                    <span>👤 {totals.userMessages}</span>
                    <span>🤖 {totals.assistantMessages}</span>
                    <span>🔧 {totals.toolCalls}</span>
                    {totals.toolErrors > 0 && (
                        <span style={{ color: '#dc2626', fontWeight: 600 }} title="Tool errors">
                            ⚠️ {totals.toolErrors}
                        </span>
                    )}
                    <span style={{ color: '#64748b' }}>|</span>
                    <span style={{ color: '#64748b' }}>
                        {totals.traceCount}{totalItems != null && totalItems !== totals.traceCount ? ` of ${totalItems}` : ''} traces
                    </span>
                    {totals.usage.input > 0 && (
                        <span style={{ color: '#334155', fontWeight: 600 }}>
                            📥 {formatNumber(totals.usage.input)}
                            {totals.usage.cacheRead > 0 && (
                                <span style={{ color: '#8b5cf6', fontWeight: 400, marginLeft: '0.3rem' }}>
                                    +{formatNumber(totals.usage.cacheRead)} c.read
                                    {totals.usage.input > 0 && (
                                        <span style={{ color: '#7c3aed', marginLeft: '0.25rem' }}>
                                            ({Math.round((totals.usage.cacheRead / totals.usage.input) * 100)}%)
                                        </span>
                                    )}
                                </span>
                            )}
                            {totals.usage.cacheWrite > 0 && (
                                <span style={{ color: '#d97706', fontWeight: 400, marginLeft: '0.3rem' }}>
                                    +{formatNumber(totals.usage.cacheWrite)} c.write
                                </span>
                            )}
                        </span>
                    )}
                    {totals.usage.output > 0 && (
                        <span style={{ color: '#334155', fontWeight: 600 }}>
                            📤 {formatNumber(totals.usage.output)}
                        </span>
                    )}
                    {totals.cost > 0 && (
                        <span style={{ color: '#059669', fontWeight: 600 }}>
                            💰 {formatCost(totals.cost)}
                        </span>
                    )}
                    <a
                        href={langfuseEbProjectUrl()}
                        target="_blank"
                        rel="noreferrer"
                        style={langfuseLinkStyle}
                    >
                        Langfuse ↗
                    </a>
                </div>
            )}

            {error && (
                <div style={errorBannerStyle}>
                    {error}
                </div>
            )}

            {warnings.map(function warn(w, i) {
                return (
                    <div key={i} style={warningBannerStyle}>
                        {w}
                    </div>
                );
            })}

            {!error && !loading && globalAppId && sessions.length === 0 && (
                <div style={emptyStateStyle}>
                    No EB traces found for this app.
                </div>
            )}

            {sessions.length > 0 && hasMore && (
                <div style={loadMoreRowStyle}>
                    <button
                        type="button"
                        onClick={function loadMore() { fetchPage(currentPage + 1, { isLoadMore: true }); }}
                        disabled={loadingMore}
                        style={loadOlderButtonStyle(loadingMore)}
                    >
                        {loadingMore && !loadingAll
                            ? '⏳ Loading...'
                            : `Load older traces (page ${currentPage + 1} of ${totalPages})`}
                    </button>
                    {remainingPages > 1 && (
                        loadingAll ? (
                            <button
                                type="button"
                                onClick={stopLoadAll}
                                style={stopButtonStyle}
                            >
                                ⏳ Loading {loadAllProgress.loaded}/{loadAllProgress.total}... Stop
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={function loadAll() {
                                    if (window.confirm(LOAD_ALL_CONFIRM(remainingPages))) fetchAllPages();
                                }}
                                disabled={loadingMore}
                                style={loadAllButtonStyle(loadingMore)}
                            >
                                Load all
                            </button>
                        )
                    )}
                </div>
            )}

            {sessions.length > 0 && hasMore && (
                <div style={loadMoreHelperStyle}>
                    Each page fetches 20 traces in parallel from Langfuse EB, and the next page is prefetched. Only fetch older messages if you really need them.
                </div>
            )}

            {sessions.length > 0 && (
                <ExpandStepsContext.Provider value={expandSteps}>
                    <div style={threadStyle}>
                        {sessions.map(function eachSession(session) {
                            return (
                                <SessionBlock key={session.sessionId} session={session} />
                            );
                        })}
                    </div>
                </ExpandStepsContext.Provider>
            )}
        </div>
    );
}

function SessionBlock({ session }: { session: EbSession }) {
    const items: React.ReactNode[] = [];
    let prevDay: string | null = null;
    for (const trace of session.traces) {
        if (!prevDay || !sameDay(prevDay, trace.timestamp)) {
            items.push(
                <div key={`day-${trace.id}`} style={daySeparatorStyle}>
                    <div style={daySeparatorLineStyle} />
                    <span style={daySeparatorTextStyle}>{formatDayLabel(trace.timestamp)}</span>
                    <div style={daySeparatorLineStyle} />
                </div>,
            );
            prevDay = trace.timestamp;
        }
        items.push(<TraceTurn key={trace.id} trace={trace} />);
    }

    return (
        <section style={sessionBlockStyle}>
            <div style={turnsStyle}>{items}</div>
        </section>
    );
}

function TraceTurn({ trace }: { trace: EbTrace }) {
    const [showScores, setShowScores] = useState(false);
    // Steps (tool calls + intermediate generations) collapse into one block.
    // Initial expanded state follows the toolbar's persisted preference; toggling
    // that preference re-applies to every turn (users can still toggle per-turn).
    const expandStepsDefault = React.useContext(ExpandStepsContext);
    const [showSteps, setShowSteps] = useState(expandStepsDefault);
    useEffect(function syncExpandDefault() { setShowSteps(expandStepsDefault); }, [expandStepsDefault]);

    // EB returns observations newest-first; sort by startTime to render in chat order.
    const sortedObs = useMemo(
        function sort() { return sortObservationsByStartTime(trace.observations ?? []); },
        [trace.observations],
    );
    const model = sortedObs.find(function hasModel(o) { return o.type === 'GENERATION' && !!o.model; })?.model;
    const usage = useMemo(function compute() { return aggregateTraceUsage(trace); }, [trace]);

    const inputText = formatChatContent(trace.input);
    const outputText = extractAssistantContent(trace, sortedObs);
    const steps = useMemo(function build() { return buildSteps(sortedObs); }, [sortedObs]);
    const showAssistantTurn = steps.length > 0 || !!outputText;
    const stepToolCount = steps.reduce(function sum(n, s) { return n + s.tools.length; }, 0);
    const stepErrorCount = steps.reduce(function sum(n, s) {
        return n + s.tools.filter((t) => t.level === 'ERROR' || (typeof t.statusMessage === 'string' && t.statusMessage.length > 0)).length;
    }, 0);

    const metadata = useMemo(function meta() { return trace.metadata ?? {}; }, [trace.metadata]);
    const executionOutcome = typeof metadata.executionOutcome === 'string' ? metadata.executionOutcome : null;

    // Cost summary is computed by the EB sessions API (incl. credits); fall back to a
    // client-side derive (no credits) for older payloads that predate it.
    const cost = useMemo(
        function summarize() {
            return trace.cost ?? summarizeCost(trace, extractCostAttribution(sortedObs), null);
        },
        [trace, sortedObs],
    );
    // Key eval scores surfaced inline (the rest stay behind the scores toggle).
    const keyScores = useMemo(function picks() { return pickKeyScores(trace.scores); }, [trace.scores]);
    const metaLinks = useMemo(function links() { return extractMetaLinks(metadata); }, [metadata]);

    return (
        <div style={turnGroupStyle}>
            {inputText && (
                <Turn
                    role="user"
                    timestamp={trace.timestamp}
                    content={inputText}
                    headerRight={
                        <>
                            {usage.input > 0 && (
                                <span style={tokenInChipStyle}>in: {formatNumber(usage.input)}</span>
                            )}
                            {usage.cacheRead > 0 && (
                                <span style={tokenCacheReadChipStyle}>
                                    c.read: {formatNumber(usage.cacheRead)}
                                    {usage.input > 0 && ` (${Math.round((usage.cacheRead / usage.input) * 100)}%)`}
                                </span>
                            )}
                            {usage.cacheWrite > 0 && (
                                <span style={tokenCacheWriteChipStyle}>
                                    c.write: {formatNumber(usage.cacheWrite)}
                                </span>
                            )}
                        </>
                    }
                />
            )}
            <div style={assistantGroupStyle}>
            {showAssistantTurn && (
                <Turn
                    role="assistant"
                    timestamp={trace.timestamp}
                    content={steps.length === 0 ? (outputText || '(no text — see tools below)') : undefined}
                    body={steps.length > 0 ? (
                        <div style={stepsBlockStyle}>
                            <button
                                type="button"
                                onClick={function toggle() { setShowSteps(function flip(s) { return !s; }); }}
                                style={stepsToggleStyle}
                            >
                                {showSteps ? '▾' : '▸'} {steps.length} step{steps.length === 1 ? '' : 's'}
                                {stepToolCount > 0 && ` · ${stepToolCount} tool${stepToolCount === 1 ? '' : 's'}`}
                                {stepErrorCount > 0 && (
                                    <span style={stepsErrorCountStyle}> · {stepErrorCount} error{stepErrorCount === 1 ? '' : 's'}</span>
                                )}
                            </button>
                            {showSteps && (
                                <div style={stepListStyle}>
                                    {steps.map(function block(step) {
                                        return <StepBlock key={step.generation?.id ?? `step-${step.index}`} step={step} />;
                                    })}
                                </div>
                            )}
                        </div>
                    ) : undefined}
                    headerExtras={
                        <>
                            {trace.latency != null && (
                                <span style={turnHeaderMutedStyle}>{formatLatency(trace.latency)}</span>
                            )}
                            {executionOutcome && executionOutcome.toUpperCase() !== 'SUCCESS' && (
                                <span style={outcomeBadgeStyle(executionOutcome)}>
                                    {executionOutcome.toLowerCase()}
                                </span>
                            )}
                            {keyScores.map(function chip(s) {
                                return (
                                    <span key={s.name} style={keyScoreChipStyle(s.tone)} title={s.title}>
                                        {s.label}
                                    </span>
                                );
                            })}
                            {trace.tags.filter(isUsefulTag).map(function tag(t) {
                                return <span key={t} style={tagChipStyle} title={t}>{t.replace(/^airo-app-builder-/, '')}</span>;
                            })}
                        </>
                    }
                    headerRight={
                        <>
                            {usage.output > 0 && (
                                <span style={tokenOutChipStyle}>out: {formatNumber(usage.output)}</span>
                            )}
                            {cost.total != null && (
                                <span style={tokenCostChipStyle}>
                                    cost: {formatCost(cost.total)}
                                    {cost.hasSplit && (
                                        <span style={costSplitStyle}>
                                            {' '}(cust: {formatCost(cost.customer)}
                                            {cost.credits != null && ` ≈${formatCredits(cost.credits)}cr${cost.mixedRatios ? '*' : ''}`}
                                            {' '}+ gd: {formatCost(cost.godaddy)})
                                        </span>
                                    )}
                                </span>
                            )}
                        </>
                    }
                    footer={
                        <div style={turnFooterStyle}>
                            {model && <span style={turnFooterMutedStyle}>{model}</span>}
                            <a
                                href={langfuseEbTraceUrl(trace.id)}
                                target="_blank"
                                rel="noreferrer"
                                style={turnFooterLinkStyle}
                                title={`Langfuse (EB) trace — ${trace.id}`}
                            >
                                Langfuse ↗
                            </a>
                            <a
                                href={langfuseTraceUrl(trace.id)}
                                target="_blank"
                                rel="noreferrer"
                                style={turnFooterLinkStyle}
                                title={`Raw AI-SDK trace in Langfuse Native — ${trace.id}`}
                            >
                                Native LF ↗
                            </a>
                            {metaLinks.publishedUrl && (
                                <a href={metaLinks.publishedUrl} target="_blank" rel="noreferrer" style={turnFooterLinkStyle}>
                                    published ↗
                                </a>
                            )}
                            {metaLinks.deploymentId && (
                                <span style={turnFooterMutedStyle} title="deploymentId">deploy {truncMiddle(metaLinks.deploymentId, 12)}</span>
                            )}
                            {metaLinks.fullStorySessionId && (
                                <a
                                    href={fullStorySessionUrl(metaLinks.fullStorySessionId)}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={turnFooterLinkStyle}
                                    title="FullStory session replay ↗"
                                >
                                    FullStory ↗
                                </a>
                            )}
                            {metaLinks.errorType && (
                                <span style={errorBadgeStyle} title={metaLinks.errorPhase ? `phase: ${metaLinks.errorPhase}${metaLinks.isRetryable ? ' · retryable' : ''}` : undefined}>
                                    {metaLinks.errorType}
                                </span>
                            )}
                        </div>
                    }
                />
            )}

            {(trace.scores?.length ?? 0) > 0 && (
                <div style={evalsBlockStyle}>
                    <button
                        type="button"
                        onClick={function toggle() { setShowScores(function flip(s) { return !s; }); }}
                        style={stepsToggleStyle}
                    >
                        {showScores ? '▾' : '▸'} {trace.scores!.length} eval{trace.scores!.length === 1 ? '' : 's'}
                    </button>
                    {showScores &&
                        trace.scores!.map(function row(score) {
                            return <ScoreRow key={score.id} score={score} />;
                        })}
                </div>
            )}
            </div>

        </div>
    );
}

function Turn({
    role,
    timestamp,
    content,
    body,
    headerExtras,
    headerRight,
    footer,
}: {
    role: 'user' | 'assistant';
    timestamp: string;
    content?: string;
    body?: React.ReactNode;
    headerExtras?: React.ReactNode;
    headerRight?: React.ReactNode;
    footer?: React.ReactNode;
}) {
    const isUser = role === 'user';
    return (
        <div style={turnRowStyle}>
            <div style={bubbleAvatarStyle(isUser)} aria-label={isUser ? 'User' : 'Assistant'}>
                {isUser ? '👤' : '🤖'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={turnHeaderRowStyle}>
                    <span style={turnRoleStyle(isUser)}>{isUser ? 'User' : 'Assistant'}</span>
                    <span style={turnHeaderMutedStyle}>{formatTurnTime(timestamp)}</span>
                    {headerExtras}
                    {headerRight && <span style={turnHeaderRightStyle}>{headerRight}</span>}
                </div>
                {footer}
                {body !== undefined ? body : <div style={bubbleStyle(isUser)}>{content}</div>}
            </div>
        </div>
    );
}

function StepBlock({ step }: { step: Step }) {
    const gen = step.generation;
    const usage = gen ? generationUsage(gen) : null;
    const cost = gen?.calculatedTotalCost ?? null;
    const duration = gen?.startTime && gen.endTime
        ? (Date.parse(gen.endTime) - Date.parse(gen.startTime))
        : null;

    return (
        <div style={stepBlockStyle}>
            <div style={stepHeaderStyle}>
                <span style={stepBadgeStyle}>Step {step.index}</span>
                {duration != null && duration > 0 && (
                    <span style={stepHeaderMutedStyle}>{formatMs(duration)}</span>
                )}
                {usage && usage.input > 0 && (
                    <span style={stepHeaderMutedStyle}>in: {formatNumber(usage.input)}</span>
                )}
                {usage && usage.cacheRead > 0 && (
                    <span style={{ ...stepHeaderMutedStyle, color: '#7c3aed' }}>
                        c.read: {formatNumber(usage.cacheRead)}
                    </span>
                )}
                {usage && usage.output > 0 && (
                    <span style={stepHeaderMutedStyle}>out: {formatNumber(usage.output)}</span>
                )}
                {cost != null && cost > 0 && (
                    <span style={{ ...stepHeaderMutedStyle, color: '#059669' }}>{formatCost(cost)}</span>
                )}
            </div>
            {step.text && <div style={stepTextStyle}>{step.text}</div>}
            {step.tools.length > 0 && (
                <div style={stepToolsStyle}>
                    {step.tools.map(function row(tool) {
                        return <ToolRow key={tool.id} tool={tool} />;
                    })}
                </div>
            )}
        </div>
    );
}

function formatMs(ms: number): string {
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${ms}ms`;
}

// EB observations and agents ToolCalls share the same `input` / timing shape,
// so we adapt to ToolCall and reuse the agent renderer registry.
function ebObsToToolCall(obs: EbObservation): ToolCall {
    const duration = obs.startTime && obs.endTime
        ? Date.parse(obs.endTime) - Date.parse(obs.startTime)
        : undefined;
    return {
        id: obs.id,
        name: obs.name,
        input: obs.input,
        result: obs.output,
        status: obs.level === 'ERROR' ? 'error' : (obs.statusMessage ? 'warning' : 'completed'),
        startTime: obs.startTime,
        endTime: obs.endTime,
        duration,
    };
}

function ToolRow({ tool }: { tool: EbObservation }) {
    const [expanded, setExpanded] = useState(false);
    const isError = tool.level === 'ERROR' || (typeof tool.statusMessage === 'string' && tool.statusMessage.length > 0);
    const adapted = useMemo(function adapt() { return ebObsToToolCall(tool); }, [tool]);
    const { summary, body } = useMemo(function render() { return renderToolCall(adapted); }, [adapted]);
    const duration = adapted.duration;

    return (
        <div style={toolRowStyle(isError)}>
            <button
                type="button"
                onClick={function toggle() { setExpanded(function flip(s) { return !s; }); }}
                style={toolHeaderButtonStyle}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, flex: 1 }}>
                    <span style={{ color: '#94a3b8' }}>{expanded ? '▾' : '▸'}</span>
                    <strong style={{ fontSize: '0.7rem' }}>{tool.name}</strong>
                    {summary && (
                        <span
                            style={{ color: '#475569', fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
                            title={typeof summary === 'string' ? summary : undefined}
                        >
                            {summary}
                        </span>
                    )}
                    {isError && <span style={errorTagStyle}>error</span>}
                </span>
                {typeof duration === 'number' && duration > 0 && (
                    <span style={{ color: '#64748b', fontSize: '0.65rem', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                        {duration}ms
                    </span>
                )}
            </button>
            {body}
            {expanded && (
                <div style={toolBodyStyle}>
                    {tool.statusMessage && (
                        <div style={toolStatusStyle}>{tool.statusMessage}</div>
                    )}
                    {tool.input != null && (
                        <div>
                            <div style={toolKvLabelStyle}>input</div>
                            <pre style={toolKvPreStyle}>{stringifyPreview(tool.input)}</pre>
                        </div>
                    )}
                    {tool.output != null && (
                        <div>
                            <div style={toolKvLabelStyle}>output</div>
                            <pre style={toolKvPreStyle}>{stringifyPreview(tool.output)}</pre>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function ScoreRow({ score }: { score: EbScore }) {
    const display = score.stringValue ?? (score.value == null ? '—' : String(score.value));
    return (
        <div style={scoreRowStyle}>
            <div style={scoreHeaderStyle}>
                <strong style={{ fontSize: '0.72rem', color: '#0f172a' }}>{score.name}</strong>
                <span style={scoreValueStyle}>{display}</span>
                {score.dataType && <span style={badgeNeutralStyle}>{score.dataType.toLowerCase()}</span>}
                {score.source && <span style={badgeNeutralStyle}>{score.source.toLowerCase()}</span>}
            </div>
            {score.comment && (
                <div style={scoreCommentStyle}>{score.comment}</div>
            )}
        </div>
    );
}

// ---- helpers ----

function formatChatContent(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        return value
            .map(function each(v) { return formatChatContent(v); })
            .filter(Boolean)
            .join('\n');
    }
    if (typeof value === 'object') {
        // Common AI-SDK / LangChain shapes wrap content under recognized keys.
        const obj = value as Record<string, unknown>;
        if (typeof obj.content === 'string') return obj.content;
        if (typeof obj.text === 'string') return obj.text;
        if (Array.isArray(obj.content)) {
            return obj.content
                .map(function part(p) {
                    if (typeof p === 'string') return p;
                    if (p && typeof p === 'object') {
                        const part = p as Record<string, unknown>;
                        if (typeof part.text === 'string') return part.text;
                    }
                    return '';
                })
                .filter(Boolean)
                .join('\n');
        }
        if (Object.keys(obj).length === 0) return '';
        return JSON.stringify(value, null, 2);
    }
    return String(value);
}

// EB returns observations newest-first; chronological order matches the chat thread.
function sortObservationsByStartTime(obs: EbObservation[]): EbObservation[] {
    return [...obs].sort(function byStart(a, b) {
        const ta = a.startTime ? Date.parse(a.startTime) : 0;
        const tb = b.startTime ? Date.parse(b.startTime) : 0;
        return ta - tb;
    });
}

interface Step {
    index: number;
    generation: EbObservation | null;
    text: string;
    tools: EbObservation[];
}

// Walk sortedObs chronologically. Each GENERATION starts a new step; TOOLs that
// follow before the next GENERATION are grouped under it. Steps with neither
// text nor tools are dropped to avoid rendering empty placeholders.
function buildSteps(sortedObs: EbObservation[]): Step[] {
    const steps: Step[] = [];
    let pending: Step | null = null;
    function flush() {
        if (pending && (pending.text || pending.tools.length > 0)) {
            pending.index = steps.length + 1;
            steps.push(pending);
        }
        pending = null;
    }
    for (const o of sortedObs) {
        if (o.type === 'GENERATION') {
            flush();
            pending = { index: 0, generation: o, text: formatChatContent(o.output), tools: [] };
        } else if (o.type === 'TOOL') {
            if (!pending) {
                pending = { index: 0, generation: null, text: '', tools: [] };
            }
            pending.tools.push(o);
        }
    }
    flush();
    return steps;
}

// EB sometimes leaves trace.output empty but the assistant text is captured in
// child GENERATION observations. Fall back to those when needed.
function extractAssistantContent(trace: EbTrace, sortedObs?: EbObservation[]): string {
    const direct = formatChatContent(trace.output);
    if (direct) return direct;
    const obs = sortedObs ?? sortObservationsByStartTime(trace.observations ?? []);
    const parts: string[] = [];
    for (const o of obs) {
        if (o.type !== 'GENERATION') continue;
        const text = formatChatContent(o.output);
        if (text) parts.push(text);
    }
    return parts.join('\n\n');
}

function stringifyPreview(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function truncMiddle(value: string, max: number): string {
    if (value.length <= max) return value;
    const head = Math.ceil((max - 1) / 2);
    const tail = Math.floor((max - 1) / 2);
    return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

function formatCost(value: number | null | undefined): string {
    if (value == null) return '$0.00';
    if (value < 0.01) return `$${value.toFixed(4)}`;
    return `$${value.toFixed(2)}`;
}

function formatCredits(n: number): string {
    return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

// Constant infra/plumbing tags that carry no per-turn signal. Matched as exact
// values (not prefixes) so an anomalous value — e.g. a non-c1 userType or a
// non-lambda phase — still surfaces as a chip. `cost-attribution` is redundant
// with the rendered cost strip; `develop` is the constant builder-phase tag.
const NOISE_TAGS = new Set([
    'userType:c1',
    'phase:lambda',
    'producer:agent-events-nodejs',
    'airo-app-builder-cost-attribution',
    'airo-app-builder-develop',
]);

function isUsefulTag(tag: string): boolean {
    return !NOISE_TAGS.has(tag);
}

type ScoreTone = 'good' | 'bad' | 'warn' | 'neutral';

// Scores surfaced inline as chips; the rest stay behind the `▸ N scores` toggle.
function pickKeyScores(
    scores: EbScore[] | undefined,
): Array<{ name: string; label: string; title: string; tone: ScoreTone }> {
    if (!scores || scores.length === 0) return [];
    const out: Array<{ name: string; label: string; title: string; tone: ScoreTone }> = [];
    const seen = new Set<string>();
    for (const s of scores) {
        const value = s.stringValue ?? (s.value == null ? '' : String(s.value));
        if (!value) continue;
        if (s.name === 'user_satisfied' && !seen.has('user_satisfied')) {
            seen.add('user_satisfied');
            const tone: ScoreTone =
                value === 'satisfied' ? 'good' : value === 'dissatisfied' ? 'bad' : 'neutral';
            const emoji = value === 'satisfied' ? '😊' : value === 'dissatisfied' ? '😞' : '😐';
            out.push({ name: s.name, label: emoji, title: `user_satisfied: ${value}`, tone });
        } else if (s.name === 'tool-error-eval' && !seen.has('tool-error-eval')) {
            seen.add('tool-error-eval');
            out.push({ name: s.name, label: `tool err: ${value}`, title: s.name, tone: 'warn' });
        }
    }
    return out;
}

interface MetaLinks {
    publishedUrl?: string;
    deploymentId?: string;
    fullStorySessionId?: string;
    errorType?: string;
    errorPhase?: string;
    isRetryable?: boolean;
}

function str(v: unknown): string | undefined {
    return typeof v === 'string' && v.length > 0 ? v : undefined;
}

// Guarded extraction of high-value metadata into displayable links/badges.
function extractMetaLinks(metadata: Record<string, unknown>): MetaLinks {
    const links: MetaLinks = {
        fullStorySessionId: str(metadata.context_fullStorySessionId),
        errorType: str(metadata.errorType),
        errorPhase: str(metadata.errorPhase),
        isRetryable: metadata.isRetryable === true || metadata.isRetryable === 'true',
    };
    // responseData[].output may carry a published URL / deployment id.
    const responseData = metadata.responseData;
    if (Array.isArray(responseData)) {
        for (const item of responseData) {
            const output = (item as { output?: unknown })?.output;
            if (output && typeof output === 'object') {
                const o = output as Record<string, unknown>;
                links.publishedUrl ??= str(o.publishedUrl);
                links.deploymentId ??= str(o.deploymentId);
            }
        }
    }
    return links;
}

// Toolbar `?` glossary explaining the header/cost terms.
const LEGEND_TERMS: Array<[string, string]> = [
    ['in', 'Input tokens sent to the model this turn.'],
    ['out', 'Output tokens the model generated this turn.'],
    ['c.read', 'Cached input tokens reused from a prior turn (cheap). The % is the share of input served from cache.'],
    ['c.write', 'Tokens written to the prompt cache this turn (cache creation).'],
    ['cust', "Cost charged to the customer's credits."],
    ['gd', 'Cost absorbed by GoDaddy — the customer is not charged.'],
    ['cost ≈ / cr', 'Cost and credits are approximate (rounded). A trailing * means the budget mixes credit ratios, so the credit figure is an estimate.'],
];

function TermsLegend() {
    return (
        <div style={legendPanelStyle}>
            <div style={legendIntroStyle}>What the numbers mean</div>
            {LEGEND_TERMS.map(([term, desc]) => (
                <div key={term} style={legendRowStyle}>
                    <span style={legendTermStyle}>{term}</span>
                    <span style={legendDescStyle}>{desc}</span>
                </div>
            ))}
        </div>
    );
}

function formatLatency(seconds: number | null | undefined): string {
    if (seconds == null) return '—';
    if (seconds < 1) return `${(seconds * 1000).toFixed(0)} ms`;
    if (seconds < 60) return `${seconds.toFixed(2)}s`;
    const m = Math.floor(seconds / 60);
    const s = (seconds - m * 60).toFixed(0);
    return `${m}m ${s}s`;
}

function formatNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

interface TokenUsage {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
}

function emptyUsage(): TokenUsage {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

// EB GENERATION observations expose token usage in three places:
//   1. obs.usageDetails — parsed object {input, output, input_cached, input_cache_creation}.
//   2. obs.metadata.attributes['langfuse.observation.usage_details'] — same data, JSON-encoded string.
//   3. obs.promptTokens / completionTokens — flat aggregates (older / non-cache flavors).
// Prefer (1), parse (2) as a fallback, then (3) as a last resort.
function generationUsage(obs: EbObservation): TokenUsage {
    const usage = emptyUsage();
    const detailed = obs.usageDetails ?? parseAttrUsageDetails(obs);
    if (detailed) {
        if (typeof detailed.input === 'number') usage.input = detailed.input;
        if (typeof detailed.output === 'number') usage.output = detailed.output;
        if (typeof detailed.input_cached === 'number') usage.cacheRead = detailed.input_cached;
        if (typeof detailed.input_cache_creation === 'number') usage.cacheWrite = detailed.input_cache_creation;
        return usage;
    }
    if (typeof obs.promptTokens === 'number') usage.input = obs.promptTokens;
    if (typeof obs.completionTokens === 'number') usage.output = obs.completionTokens;
    return usage;
}

function parseAttrUsageDetails(obs: EbObservation): EbUsageDetails | null {
    const raw = obs.metadata?.attributes?.['langfuse.observation.usage_details'];
    if (typeof raw !== 'string' || raw.length === 0) return null;
    try {
        return JSON.parse(raw) as EbUsageDetails;
    } catch {
        return null;
    }
}

function aggregateTraceUsage(trace: EbTrace): TokenUsage {
    const total = emptyUsage();
    for (const obs of trace.observations ?? []) {
        if (obs.type !== 'GENERATION') continue;
        const u = generationUsage(obs);
        total.input += u.input;
        total.output += u.output;
        total.cacheRead += u.cacheRead;
        total.cacheWrite += u.cacheWrite;
    }
    return total;
}

interface PanelTotals {
    traceCount: number;
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    toolErrors: number;
    cost: number;
    usage: TokenUsage;
}

function aggregatePanelTotals(sessions: EbSession[]): PanelTotals {
    const t: PanelTotals = {
        traceCount: 0,
        userMessages: 0,
        assistantMessages: 0,
        toolCalls: 0,
        toolErrors: 0,
        cost: 0,
        usage: emptyUsage(),
    };
    for (const s of sessions) {
        for (const trace of s.traces) {
            t.traceCount += 1;
            t.cost += trace.totalCost ?? 0;
            if (formatChatContent(trace.input)) t.userMessages += 1;
            const assistantText = extractAssistantContent(trace);
            let traceTools = 0;
            for (const obs of trace.observations ?? []) {
                if (obs.type !== 'TOOL') continue;
                traceTools += 1;
                t.toolCalls += 1;
                if (obs.level === 'ERROR' || (typeof obs.statusMessage === 'string' && obs.statusMessage.length > 0)) {
                    t.toolErrors += 1;
                }
            }
            if (assistantText || traceTools > 0) t.assistantMessages += 1;
            const u = aggregateTraceUsage(trace);
            t.usage.input += u.input;
            t.usage.output += u.output;
            t.usage.cacheRead += u.cacheRead;
            t.usage.cacheWrite += u.cacheWrite;
        }
    }
    return t;
}

function sameDay(a: string, b: string): boolean {
    const da = new Date(a);
    const db = new Date(b);
    return (
        da.getFullYear() === db.getFullYear() &&
        da.getMonth() === db.getMonth() &&
        da.getDate() === db.getDate()
    );
}

function formatDayLabel(value: string): string {
    try {
        return new Date(value).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    } catch {
        return value;
    }
}

// Renders timestamps like "May 1, 01:29 AM GMT+5:30".
function formatTurnTime(value: string): string {
    try {
        return new Date(value).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZoneName: 'short',
        });
    } catch {
        return value;
    }
}

// ---- styles ----

const panelStyle: React.CSSProperties = {
    backgroundColor: '#ffffff',
    padding: '0.75rem',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
};

const toolbarStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.75rem',
    flexWrap: 'wrap',
};

const toolbarLeftStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexWrap: 'wrap',
};

const toolbarRightStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
};

const toggleLabelStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
    fontSize: '0.72rem',
    color: '#475569',
    cursor: 'pointer',
    userSelect: 'none',
};

const legendAnchorStyle: React.CSSProperties = {
    position: 'relative',
    display: 'inline-flex',
};

const legendButtonStyle: React.CSSProperties = {
    fontSize: '0.72rem',
    fontWeight: 700,
    lineHeight: 1,
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    backgroundColor: '#f1f5f9',
    color: '#475569',
    border: '1px solid #cbd5e1',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
};

const legendPopoverStyle: React.CSSProperties = {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    right: 0,
    zIndex: 40,
    width: '320px',
    maxWidth: '80vw',
    padding: '0.6rem 0.75rem',
    backgroundColor: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    boxShadow: '0 6px 18px rgba(15, 23, 42, 0.18)',
    textAlign: 'left',
    cursor: 'default',
};

const legendPanelStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem',
};

const legendIntroStyle: React.CSSProperties = {
    fontSize: '0.72rem',
    fontWeight: 700,
    color: '#0f172a',
};

const legendRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'baseline',
    gap: '0.5rem',
    fontSize: '0.68rem',
    color: '#475569',
    lineHeight: 1.4,
};

const legendTermStyle: React.CSSProperties = {
    flexShrink: 0,
    minWidth: '58px',
    fontFamily: 'monospace',
    fontWeight: 600,
    color: '#0f172a',
};

const legendDescStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
};

function pageStatusStyle(hasMore: boolean): React.CSSProperties {
    return {
        fontSize: '0.7rem',
        color: hasMore ? '#6b7280' : '#16a34a',
    };
}

const loadMoreRowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.4rem 0',
};

const loadMoreHelperStyle: React.CSSProperties = {
    textAlign: 'center',
    fontSize: '0.7rem',
    color: '#6b7280',
    fontStyle: 'italic',
};

function loadOlderButtonStyle(loadingMore: boolean): React.CSSProperties {
    return {
        padding: '0.4rem 1rem',
        backgroundColor: loadingMore ? '#e5e7eb' : '#f0f9ff',
        color: loadingMore ? '#9ca3af' : '#3b82f6',
        border: `1px solid ${loadingMore ? '#d1d5db' : '#93c5fd'}`,
        borderRadius: '6px',
        cursor: loadingMore ? 'not-allowed' : 'pointer',
        fontSize: '0.75rem',
        fontWeight: 500,
    };
}

function loadAllButtonStyle(loadingMore: boolean): React.CSSProperties {
    return {
        padding: '0.4rem 1rem',
        backgroundColor: loadingMore ? '#e5e7eb' : '#fefce8',
        color: loadingMore ? '#9ca3af' : '#a16207',
        border: `1px solid ${loadingMore ? '#d1d5db' : '#fde047'}`,
        borderRadius: '6px',
        cursor: loadingMore ? 'not-allowed' : 'pointer',
        fontSize: '0.75rem',
        fontWeight: 500,
    };
}

const stopButtonStyle: React.CSSProperties = {
    padding: '0.4rem 1rem',
    backgroundColor: '#fef2f2',
    color: '#dc2626',
    border: '1px solid #fca5a5',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.75rem',
    fontWeight: 500,
};

function refreshButtonStyle(disabled: boolean): React.CSSProperties {
    return {
        padding: '0.625rem 1.25rem',
        fontSize: '0.875rem',
        fontWeight: 500,
        backgroundColor: disabled ? '#9ca3af' : '#3b82f6',
        color: 'white',
        border: 'none',
        borderRadius: '6px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
    };
}

const titleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: '1rem',
    fontWeight: 600,
    color: '#1a1a1a',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
};

const appIdChipStyle: React.CSSProperties = {
    backgroundColor: '#dbeafe',
    color: '#1e40af',
    padding: '0.125rem 0.5rem',
    borderRadius: '4px',
    fontSize: '0.75rem',
    fontWeight: 500,
};

const statsRowStyle: React.CSSProperties = {
    padding: '0.6rem 1rem',
    borderRadius: '6px',
    backgroundColor: '#f0f9ff',
    display: 'flex',
    gap: '1rem',
    fontSize: '0.8rem',
    flexWrap: 'wrap',
    alignItems: 'center',
};

const langfuseLinkStyle: React.CSSProperties = {
    fontSize: '0.7rem',
    color: '#3b82f6',
    textDecoration: 'none',
    marginLeft: 'auto',
};

const errorBannerStyle: React.CSSProperties = {
    backgroundColor: '#fef2f2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    padding: '0.5rem 0.75rem',
    fontSize: '0.75rem',
};

const warningBannerStyle: React.CSSProperties = {
    backgroundColor: '#fffbeb',
    color: '#92400e',
    border: '1px solid #fde68a',
    borderRadius: '6px',
    padding: '0.4rem 0.65rem',
    fontSize: '0.7rem',
};

const emptyStateStyle: React.CSSProperties = {
    padding: '2rem',
    textAlign: 'center',
    color: '#64748b',
    fontSize: '0.8rem',
};

const threadStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
};

const sessionBlockStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
};

const turnsStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
};

const turnGroupStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
};

const turnRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: '0.75rem',
    alignItems: 'flex-start',
};

const turnHeaderRowStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '0.4rem',
    marginBottom: '0.25rem',
};

function turnRoleStyle(isUser: boolean): React.CSSProperties {
    return {
        fontSize: '0.85rem',
        fontWeight: 600,
        color: isUser ? '#1e40af' : '#166534',
    };
}

const turnHeaderMutedStyle: React.CSSProperties = {
    fontSize: '0.7rem',
    color: '#64748b',
};

const turnHeaderRightStyle: React.CSSProperties = {
    marginLeft: 'auto',
    display: 'inline-flex',
    flexWrap: 'wrap',
    gap: '0.35rem',
    alignItems: 'center',
};

const turnFooterStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.4rem',
    alignItems: 'center',
    marginTop: '0.3rem',
    fontSize: '0.7rem',
    color: '#475569',
};

const turnFooterMutedStyle: React.CSSProperties = {
    fontSize: '0.7rem',
    color: '#64748b',
    fontFamily: 'monospace',
};

const turnFooterLinkStyle: React.CSSProperties = {
    fontSize: '0.7rem',
    color: '#1d4ed8',
    textDecoration: 'none',
    fontFamily: 'monospace',
};

const daySeparatorStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    margin: '1rem 0',
};

const daySeparatorLineStyle: React.CSSProperties = {
    flex: 1,
    height: '1px',
    backgroundColor: '#e5e7eb',
};

const daySeparatorTextStyle: React.CSSProperties = {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#94a3b8',
    textTransform: 'uppercase',
};

function outcomeBadgeStyle(outcome: string): React.CSSProperties {
    const isSuccess = outcome.toUpperCase() === 'SUCCESS';
    return {
        fontSize: '0.6rem',
        padding: '0.1rem 0.35rem',
        borderRadius: '3px',
        backgroundColor: isSuccess ? '#dcfce7' : '#fee2e2',
        color: isSuccess ? '#166534' : '#991b1b',
        textTransform: 'lowercase',
    };
}

function bubbleAvatarStyle(_isUser: boolean): React.CSSProperties {
    return {
        width: '32px',
        height: '32px',
        fontSize: '1.4rem',
        lineHeight: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    };
}

function bubbleStyle(isUser: boolean): React.CSSProperties {
    return {
        backgroundColor: isUser ? '#eff6ff' : '#f0fdf4',
        color: isUser ? '#1e3a8a' : '#14532d',
        borderRadius: '12px',
        borderTopLeftRadius: '2px',
        padding: '0.75rem 1rem',
        fontSize: '0.9rem',
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
    };
}

const tokenInChipStyle: React.CSSProperties = {
    fontSize: '0.7rem',
    color: '#334155',
    fontWeight: 600,
};

const tokenCacheReadChipStyle: React.CSSProperties = {
    fontSize: '0.7rem',
    color: '#7c3aed',
    fontWeight: 500,
};

const tokenCacheWriteChipStyle: React.CSSProperties = {
    fontSize: '0.7rem',
    color: '#d97706',
    fontWeight: 500,
};

const tokenOutChipStyle: React.CSSProperties = {
    fontSize: '0.7rem',
    color: '#334155',
    fontWeight: 600,
};

const tokenCostChipStyle: React.CSSProperties = {
    fontSize: '0.7rem',
    color: '#059669',
    fontWeight: 600,
};

const badgeNeutralStyle: React.CSSProperties = {
    fontSize: '0.65rem',
    padding: '0.1rem 0.4rem',
    borderRadius: '3px',
    backgroundColor: '#f1f5f9',
    color: '#475569',
    fontFamily: 'monospace',
};

const tagChipStyle: React.CSSProperties = {
    fontSize: '0.6rem',
    padding: '0.1rem 0.35rem',
    borderRadius: '3px',
    backgroundColor: '#eef2ff',
    color: '#4338ca',
    border: '1px solid #e0e7ff',
};

function keyScoreChipStyle(tone: ScoreTone): React.CSSProperties {
    const palette: Record<ScoreTone, { bg: string; fg: string; bd: string }> = {
        good: { bg: '#dcfce7', fg: '#166534', bd: '#bbf7d0' },
        bad: { bg: '#fee2e2', fg: '#991b1b', bd: '#fecaca' },
        warn: { bg: '#fffbeb', fg: '#92400e', bd: '#fde68a' },
        neutral: { bg: '#f3f4f6', fg: '#475569', bd: '#e5e7eb' },
    };
    const c = palette[tone];
    return {
        fontSize: '0.6rem',
        padding: '0.1rem 0.35rem',
        borderRadius: '3px',
        backgroundColor: c.bg,
        color: c.fg,
        border: `1px solid ${c.bd}`,
        fontWeight: 600,
    };
}

const errorBadgeStyle: React.CSSProperties = {
    fontSize: '0.6rem',
    padding: '0.1rem 0.35rem',
    borderRadius: '3px',
    backgroundColor: '#fef2f2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    fontFamily: 'monospace',
};

// Muted breakdown text shown inside the cost chip — "(cust: $… + gd: $…)".
const costSplitStyle: React.CSSProperties = {
    fontWeight: 400,
    color: '#64748b',
};

// Groups the assistant turn with its evals block at a tight gap, so the evals
// pill sits just under the steps pill rather than a full turn-gap (1.25rem) away.
const assistantGroupStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
};

// Eval toggle + expanded score rows, stacked below the steps block. Indented to
// align with the message content column: avatar width (32px) + turn row gap
// (0.75rem ≈ 12px) = 44px.
const evalsBlockStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
    paddingLeft: '44px',
};

const stepsBlockStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
};

const stepsToggleStyle: React.CSSProperties = {
    alignSelf: 'flex-start',
    padding: '0.2rem 0.5rem',
    fontSize: '0.72rem',
    fontWeight: 600,
    color: '#475569',
    backgroundColor: '#f1f5f9',
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    cursor: 'pointer',
};

const stepsErrorCountStyle: React.CSSProperties = {
    color: '#dc2626',
};

const stepListStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
};

const stepBlockStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem',
    padding: '0.55rem 0.75rem',
    backgroundColor: '#f0fdf4',
    border: '1px solid #d1fae5',
    borderRadius: '8px',
};

const stepHeaderStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.7rem',
};

const stepBadgeStyle: React.CSSProperties = {
    fontSize: '0.65rem',
    fontWeight: 700,
    color: '#065f46',
    backgroundColor: '#a7f3d0',
    padding: '0.1rem 0.4rem',
    borderRadius: '3px',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
};

const stepHeaderMutedStyle: React.CSSProperties = {
    fontSize: '0.65rem',
    color: '#475569',
    fontFamily: 'monospace',
};

const stepTextStyle: React.CSSProperties = {
    fontSize: '0.85rem',
    color: '#14532d',
    lineHeight: 1.55,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
};

const stepToolsStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
};

function toolRowStyle(isError: boolean): React.CSSProperties {
    return {
        border: `1px solid ${isError ? '#fecaca' : '#e5e7eb'}`,
        borderRadius: '6px',
        backgroundColor: isError ? '#fef2f2' : '#ffffff',
    };
}

const toolHeaderButtonStyle: React.CSSProperties = {
    width: '100%',
    textAlign: 'left',
    padding: '0.35rem 0.5rem',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
};

const errorTagStyle: React.CSSProperties = {
    fontSize: '0.6rem',
    color: '#991b1b',
    fontWeight: 600,
};

const toolBodyStyle: React.CSSProperties = {
    padding: '0 0.5rem 0.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
};

const toolStatusStyle: React.CSSProperties = {
    fontSize: '0.7rem',
    color: '#991b1b',
    fontFamily: 'monospace',
    backgroundColor: '#fef2f2',
    padding: '0.25rem 0.4rem',
    borderRadius: '3px',
};

const toolKvLabelStyle: React.CSSProperties = {
    fontSize: '0.65rem',
    color: '#64748b',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
};

const toolKvPreStyle: React.CSSProperties = {
    fontSize: '0.6rem',
    backgroundColor: '#f8fafc',
    padding: '0.35rem 0.5rem',
    borderRadius: '3px',
    overflow: 'auto',
    maxHeight: '160px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    margin: '0.25rem 0 0',
    border: '1px solid #e5e7eb',
};

const scoreRowStyle: React.CSSProperties = {
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    backgroundColor: '#ffffff',
    padding: '0.4rem 0.55rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.2rem',
};

const scoreHeaderStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '0.35rem',
};

const scoreValueStyle: React.CSSProperties = {
    fontSize: '0.7rem',
    fontWeight: 600,
    color: '#0f172a',
    fontFamily: 'monospace',
    backgroundColor: '#f1f5f9',
    padding: '0.1rem 0.4rem',
    borderRadius: '3px',
};

const scoreCommentStyle: React.CSSProperties = {
    fontSize: '0.7rem',
    color: '#475569',
    lineHeight: 1.4,
};

const presetChipsWrapperStyle: React.CSSProperties = {
    display: 'inline-flex',
    gap: '0.2rem',
    alignItems: 'center',
};

function presetChipStyle(active: boolean): React.CSSProperties {
    return {
        padding: '0.15rem 0.45rem',
        fontSize: '0.7rem',
        fontWeight: active ? 700 : 400,
        borderRadius: '4px',
        border: `1px solid ${active ? '#3b82f6' : '#d1d5db'}`,
        backgroundColor: active ? '#dbeafe' : '#f9fafb',
        color: active ? '#1d4ed8' : '#6b7280',
        cursor: active ? 'default' : 'pointer',
    };
}

