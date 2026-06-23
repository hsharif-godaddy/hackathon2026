'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, CheckCircle, ChevronDown,
    ChevronLeft, ChevronRight, ChevronUp, CloudDownload, Columns, Database,
    ExternalLink, Info, RefreshCw, Volume2, XCircle,
} from 'lucide-react';
import sp from '@/components/supportplane/sp.module.css';

// ── Types ──────────────────────────────────────────────────────────

type ActiveTab = 'ops' | 'browse';

interface SyncProgress {
    phase: 'scanning' | 'ingesting' | 'aggregating' | 'done' | 'error';
    currentSource?: 'athena' | 's3';
    totalFiles: number;
    processed: number;
    skipped: number;
    newRows: number;
    errors: number;
    currentFile?: string;
    message?: string;
}

interface IngestionStatus {
    totalFiles: number;
    successFiles: number;
    errorFiles: number;
    lastSync: string | null;
    totalRows: number;
    dbPath: string;
}

interface DataCoverage {
    earliest: string | null;
    latest: string | null;
    totalRows: number;
    monthsCovered: string[];
    athenaRows: number;
    s3OnlyRows: number;
    bothRows: number;
}

interface LogEntry {
    id: number;
    s3_url: string;
    source: string;
    status: string;
    rows_written: number;
    error_msg: string | null;
    ingested_at: string;
}

interface FeedbackRow {
    feedback_id: string;
    data_source: string | null;
    app_id: string | null;
    customer_id: string | null;
    feedback_utc_ts: string | null;
    feedback_text: string | null;
    rating: number | null;
    feedback_category: string | null;
    feedback_topic_list: string | null;
    plan_type_name: string | null;
    subscription_id: string | null;
    subscription_status: string | null;
    total_credit_cnt: number | null;
    available_credit_cnt: number | null;
    feedback_origin_name: string | null;
    app_publish_flag: number | null;
    publish_url: string | null;
    cln_create_utc_ts: string | null;
    full_story_url: string | null;
    shopper_id: string | null;
    device_type: string | null;
    browser_type: string | null;
    page_url: string | null;
    session_id: string | null;
    app_name: string | null;
    app_version: string | null;
}

// ── Column configuration ────────────────────────────────────────────

const OPTIONAL_COLS = [
    { key: 'app_id',              label: 'App ID',       sortable: true,  defaultOn: true  },
    { key: 'plan_type_name',      label: 'Plan',         sortable: true,  defaultOn: true  },
    { key: 'feedback_origin_name',label: 'Origin',       sortable: true,  defaultOn: true  },
    { key: 'device_type',         label: 'Device',       sortable: true,  defaultOn: true  },
    { key: 'data_source',         label: 'Source',       sortable: false, defaultOn: true  },
    { key: 'subscription_status', label: 'Sub Status',   sortable: true,  defaultOn: false },
    { key: 'browser_type',        label: 'Browser',      sortable: false, defaultOn: false },
    { key: 'app_version',         label: 'App Version',  sortable: false, defaultOn: false },
    { key: 'app_name',            label: 'App Name',     sortable: false, defaultOn: false },
    { key: 'customer_id',         label: 'Customer ID',  sortable: false, defaultOn: false },
    { key: 'shopper_id',          label: 'Shopper ID',   sortable: false, defaultOn: false },
    { key: 'total_credit_cnt',    label: 'Credits',      sortable: false, defaultOn: false },
    { key: 'subscription_id',     label: 'Sub ID',       sortable: false, defaultOn: false },
] as const;

type OptColKey = typeof OPTIONAL_COLS[number]['key'];

const COL_STORAGE_KEY = 'sp-fb-visible-cols';

function defaultVisibleCols(): Set<OptColKey> {
    try {
        const saved = localStorage.getItem(COL_STORAGE_KEY);
        if (saved) return new Set(JSON.parse(saved) as OptColKey[]);
    } catch { /* ignore */ }
    return new Set(OPTIONAL_COLS.filter(c => c.defaultOn).map(c => c.key));
}

function saveVisibleCols(cols: Set<OptColKey>): void {
    try { localStorage.setItem(COL_STORAGE_KEY, JSON.stringify([...cols])); } catch { /* ignore */ }
}

// ── Helpers ────────────────────────────────────────────────────────

const PAGE_SIZES = [100, 250, 500, 1000] as const;
const DEFAULT_PAGE_SIZE = 250;

function fmtDate(iso: string | null): string {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return iso; }
}

function fmtTs(ts: string | null): string {
    if (!ts) return '—';
    try {
        return new Date(ts).toLocaleString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch { return ts; }
}

function ratingColor(r: number | null): string {
    if (!r) return 'var(--sp-txm)';
    if (r >= 5) return 'var(--green)';
    if (r <= 2) return 'var(--red)';
    return 'var(--sp-warning)';
}

function shortUrl(url: string): string {
    const parts = url.split('/');
    const file = parts.at(-1) ?? url;
    const yearPart  = parts.find(p => p.startsWith('year='))  ?? '';
    const monthPart = parts.find(p => p.startsWith('month=')) ?? '';
    const dayPart   = parts.find(p => p.startsWith('day='))   ?? '';
    if (yearPart) return `${yearPart}/${monthPart}/${dayPart}/…/${file}`;
    return file;
}

function phaseLabel(p: SyncProgress): string {
    if (p.phase === 'scanning')    return 'Scanning S3 partitions…';
    if (p.phase === 'ingesting')   return p.currentSource === 'athena' ? 'Querying Athena…' : 'Downloading parquet files…';
    if (p.phase === 'aggregating') return 'Recomputing daily stats…';
    if (p.phase === 'done')        return `Done — ${p.newRows} new rows ingested`;
    if (p.phase === 'error')       return `Error: ${p.message ?? 'unknown'}`;
    return p.message ?? '…';
}

function playSuccessBeep(): void {
    try {
        const ctx = new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

        // Three-note ascending arpeggio: C5 → E5 → G5, then sustained G5 fade
        const notes: [number, number, number][] = [
            // [freq, startTime, duration]
            [523.25, 0.00, 0.35],   // C5
            [659.25, 0.28, 0.35],   // E5
            [783.99, 0.56, 1.20],   // G5 — sustained
        ];

        for (const [freq, start, dur] of notes) {
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
            gain.gain.setValueAtTime(0, ctx.currentTime + start);
            gain.gain.linearRampToValueAtTime(0.38, ctx.currentTime + start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
            osc.start(ctx.currentTime + start);
            osc.stop(ctx.currentTime + start + dur + 0.05);
        }
    } catch { /* browser blocked audio or no AudioContext */ }
}

// ── Sub-components ─────────────────────────────────────────────────

function KpiTile({ value, label, sub, color }: { value: string; label: string; sub: string; color: string }) {
    return (
        <div className={sp.kpiCard}>
            <div className={sp.kpiValue} style={{ color }}>{value}</div>
            <div className={sp.kpiLabel}>{label}</div>
            <div className={sp.kpiSub}>{sub}</div>
        </div>
    );
}

// ── Main component ─────────────────────────────────────────────────

export default function FeedbackBrowsePanel({ syncTrigger = 0 }: { syncTrigger?: number }) {
    // ── Tab state ──
    const [activeTab, setActiveTab] = useState<ActiveTab>('ops');

    // ── Data source state ──
    const [status,   setStatus]   = useState<IngestionStatus | null>(null);
    const [coverage, setCoverage] = useState<DataCoverage | null>(null);
    const [log,      setLog]      = useState<LogEntry[]>([]);
    const [statusLoading, setStatusLoading] = useState(true);
    const [statusError,   setStatusError]   = useState<string | null>(null);

    // ── Sync state ──
    const [syncing,         setSyncing]         = useState(false);
    const [syncProgress,    setSyncProgress]    = useState<SyncProgress | null>(null);
    const [syncDone,        setSyncDone]        = useState<string | null>(null);
    const [syncError,       setSyncError]       = useState<string | null>(null);
    const [syncCollapsed,   setSyncCollapsed]   = useState(false);
    const [streamDropped,   setStreamDropped]   = useState(false);
    const readerRef   = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
    const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
    const syncingRef  = useRef(false);
    const forceResyncRef = useRef(false);

    // ── Log panel ──
    const [logOpen, setLogOpen] = useState(false);

    // ── Browse state ──
    const [rows,    setRows]    = useState<FeedbackRow[]>([]);
    const [total,   setTotal]   = useState(0);
    const [page,    setPage]    = useState(0);
    const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
    const [browseLoading, setBrowseLoading] = useState(false);
    const [expanded, setExpanded] = useState<string | null>(null);

    const [filterCat,    setFilterCat]    = useState('');
    const [filterRating, setFilterRating] = useState('');
    const [filterApp,    setFilterApp]    = useState('');
    const [filterDays,   setFilterDays]   = useState('90');

    // ── Sort state ──
    const [sortCol, setSortCol] = useState<string>('feedback_utc_ts');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    // ── Column chooser ──
    const [visibleCols, setVisibleCols] = useState<Set<OptColKey>>(new Set(OPTIONAL_COLS.filter(c => c.defaultOn).map(c => c.key)));
    const [colPickerOpen, setColPickerOpen] = useState(false);
    const colPickerRef = useRef<HTMLDivElement>(null);

    // Init from localStorage after mount
    useEffect(() => { setVisibleCols(defaultVisibleCols()); }, []);

    // Close col picker when clicking outside
    useEffect(() => {
        if (!colPickerOpen) return;
        const handler = (e: MouseEvent) => {
            if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) {
                setColPickerOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [colPickerOpen]);

    // ── Load ingestion status ──────────────────────────────────────

    const loadStatus = useCallback(async () => {
        setStatusLoading(true); setStatusError(null);
        try {
            const res = await fetch('/api/supportplane/feedback/sync');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const d = await res.json() as { status: IngestionStatus; coverage: DataCoverage; log: LogEntry[] };
            setStatus(d.status);
            setCoverage(d.coverage);
            setLog(d.log ?? []);
        } catch (e) {
            setStatusError((e as Error).message);
        } finally {
            setStatusLoading(false);
        }
    }, []);

    useEffect(() => { void loadStatus(); }, [loadStatus]);

    // When syncTrigger increments (from another panel's Sync button), switch to Data Ops tab and start sync.
    const prevTriggerRef = useRef(syncTrigger);
    useEffect(() => {
        if (syncTrigger > 0 && syncTrigger !== prevTriggerRef.current) {
            prevTriggerRef.current = syncTrigger;
            setActiveTab('ops');
            void startSync();
        }
    // startSync is stable (useCallback with no deps that change); syncTrigger is the only signal.
    }, [syncTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Load browse rows ───────────────────────────────────────────

    const loadBrowse = useCallback(async (p = 0) => {
        setBrowseLoading(true);
        const params = new URLSearchParams({ limit: String(pageSize), offset: String(p * pageSize), days: filterDays, sort: sortCol, order: sortDir });
        if (filterCat)    params.set('category', filterCat);
        if (filterRating) params.set('rating',   filterRating);
        if (filterApp)    params.set('app_id',   filterApp);
        try {
            const res = await fetch(`/api/supportplane/feedback/browse?${params}`);
            if (res.ok) {
                const d = await res.json() as { rows: FeedbackRow[]; total: number };
                setRows(d.rows ?? []);
                setTotal(d.total ?? 0);
            }
        } finally {
            setBrowseLoading(false);
        }
    }, [filterCat, filterRating, filterApp, filterDays, pageSize, sortCol, sortDir]);

    useEffect(() => { setPage(0); void loadBrowse(0); }, [filterCat, filterRating, filterApp, filterDays, pageSize, sortCol, sortDir]);
    useEffect(() => { void loadBrowse(page); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── SSE sync ───────────────────────────────────────────────────

    const stopPoll = useCallback(() => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }, []);

    const startPoll = useCallback(() => {
        stopPoll();
        pollRef.current = setInterval(async () => {
            if (!syncingRef.current) { stopPoll(); return; }
            try {
                const res = await fetch('/api/supportplane/feedback/sync');
                if (!res.ok) return;
                const d = await res.json() as { status: IngestionStatus; coverage: DataCoverage; log: LogEntry[] };
                setStatus(d.status);
                setCoverage(d.coverage);
                if (!forceResyncRef.current) setLog(d.log ?? []);
            } catch { /* ignore poll errors */ }
        }, 5000);
    }, [stopPoll]);

    const runStream = useCallback(async (url: string): Promise<'done' | 'dropped' | 'error'> => {
        try {
            const res = await fetch(url);
            if (!res.ok || !res.body) {
                setSyncError(`HTTP ${res.status}: ${await res.text()}`);
                return 'error';
            }
            const reader = res.body.getReader();
            readerRef.current = reader;
            const decoder = new TextDecoder();
            let buf = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                const lines = buf.split('\n');
                buf = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const p = JSON.parse(line.slice(6)) as SyncProgress;
                        setStreamDropped(false);
                        if (p.phase === 'done') {
                            setSyncProgress(p);
                            const msg = `Sync complete — ${p.newRows} new rows from ${p.processed} files`;
                            setSyncDone(msg);
                            playSuccessBeep();
                            setTimeout(() => setSyncCollapsed(true), 4000);
                            return 'done';
                        }
                        if (p.phase === 'error') {
                            setSyncError(p.message ?? 'Unknown error');
                            return 'error';
                        }
                        setSyncProgress(p);
                    } catch { /* malformed SSE line */ }
                }
            }
            return 'dropped';
        } catch {
            return 'dropped';
        } finally {
            readerRef.current = null;
        }
    }, []);

    const startSync = useCallback(async (force = false) => {
        if (syncing) return;
        setSyncing(true);
        syncingRef.current = true;
        setSyncProgress(null);
        setSyncDone(null);
        setSyncError(null);
        setSyncCollapsed(false);
        setStreamDropped(false);
        if (force) { setLog([]); forceResyncRef.current = true; }

        const baseUrl = force
            ? '/api/supportplane/feedback/sync/stream?force=true'
            : '/api/supportplane/feedback/sync/stream';

        try {
            let attempt = 0;
            while (syncingRef.current) {
                const result = await runStream(baseUrl);
                if (result === 'done' || result === 'error') break;

                attempt++;
                setStreamDropped(true);
                if (attempt === 1) startPoll();

                await new Promise<void>(r => setTimeout(r, 3000));
                if (!syncingRef.current) break;
            }
        } finally {
            syncingRef.current = false;
            forceResyncRef.current = false;
            setSyncing(false);
            stopPoll();
            void loadStatus();
            void loadBrowse(0);
        }
    }, [syncing, runStream, startPoll, stopPoll, loadStatus, loadBrowse]);

    const abortSync = useCallback(() => {
        syncingRef.current = false;
        readerRef.current?.cancel().catch(() => null);
        stopPoll();
    }, [stopPoll]);

    // ── Computed ───────────────────────────────────────────────────

    const totalPages = Math.ceil(total / pageSize);
    const progressPct = syncProgress && syncProgress.totalFiles > 0
        ? Math.min(100, Math.round(((syncProgress.processed + syncProgress.skipped) / syncProgress.totalFiles) * 100))
        : (syncProgress?.phase === 'aggregating' ? 95 : syncProgress?.phase === 'done' ? 100 : 0);

    const hasData = (coverage?.totalRows ?? 0) > 0;
    const showSyncPanel = syncing || (syncProgress && !syncCollapsed);

    return (
        <div className={sp.panelRoot}>

            {/* ── Header ── */}
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>Data Source — Feedback</div>
                    <div className={sp.panelSub}>
                        Athena + S3 → DynamoDB ·
                        {hasData
                            ? ` ${coverage!.totalRows.toLocaleString()} rows · ${fmtDate(coverage!.earliest)} – ${fmtDate(coverage!.latest)}`
                            : ' No data loaded yet'}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button className={sp.btnSecondary} onClick={loadStatus} disabled={statusLoading} title="Refresh status">
                        <RefreshCw size={13} className={statusLoading ? sp.spin : ''} />
                    </button>
                    {syncing ? (
                        <button className={sp.btnSecondary} onClick={abortSync}>
                            <XCircle size={13} /> Abort
                        </button>
                    ) : (
                        <>
                            <button
                                className={sp.btnSecondary}
                                onClick={() => { if (confirm('Drop all local data and re-fetch everything from Athena + S3?')) startSync(true); }}
                                title="Wipe local data and re-ingest everything from scratch"
                                style={{ fontSize: 11 }}
                            >
                                <RefreshCw size={12} /> Full Resync
                            </button>
                            <button className={sp.btnPrimary} onClick={() => startSync(false)}>
                                <CloudDownload size={13} />
                                {syncDone ? 'Re-sync' : 'Sync Data'}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {statusError && (
                <div className={sp.alertError} style={{ marginBottom: 12 }}>
                    <AlertCircle size={13} /> {statusError}
                </div>
            )}

            {/* ── KPI tiles — 6 tiles: coverage + source breakdown ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8, marginBottom: 14 }}>
                <KpiTile
                    value={coverage?.totalRows.toLocaleString() ?? '—'}
                    label="Total Records"
                    sub={`${status ? `${status.successFiles} files ingested` : '—'}`}
                    color="var(--blue)"
                />
                <KpiTile
                    value={fmtDate(coverage?.earliest ?? null)}
                    label="Earliest Record"
                    sub="start of data range"
                    color="var(--sp-tx2)"
                />
                <KpiTile
                    value={fmtDate(coverage?.latest ?? null)}
                    label="Latest Record"
                    sub={status?.lastSync ? `Synced ${fmtDate(status.lastSync)}` : 'not yet synced'}
                    color="var(--green)"
                />
                <KpiTile
                    value={coverage?.athenaRows.toLocaleString() ?? '—'}
                    label="Athena Rows"
                    sub={coverage ? `${coverage.bothRows.toLocaleString()} enriched by S3` : 'includes enriched'}
                    color="#7c3aed"
                />
                <KpiTile
                    value={coverage?.s3OnlyRows.toLocaleString() ?? '—'}
                    label="S3-Only Rows"
                    sub="not in Athena CLN"
                    color="#0891b2"
                />
                <KpiTile
                    value={coverage?.bothRows.toLocaleString() ?? '—'}
                    label="Enriched (Both)"
                    sub="Athena + S3 merged"
                    color="#059669"
                />
            </div>

            {/* ── Sync collapsed bar (click to re-expand) ── */}
            {!syncing && syncCollapsed && syncDone && (
                <div className={sp.syncCollapsedBar} onClick={() => setSyncCollapsed(false)}>
                    <CheckCircle size={13} style={{ color: 'var(--green)', flexShrink: 0 }} />
                    <span style={{ flex: 1, color: 'var(--sp-tx1)' }}>{syncDone}</span>
                    <Volume2 size={12} style={{ color: 'var(--sp-txm)' }} />
                    <ChevronDown size={13} style={{ color: 'var(--sp-txm)' }} />
                </div>
            )}

            {/* ── Tab bar ── */}
            <div className={sp.tabBar}>
                <button className={`${sp.tab} ${activeTab === 'ops' ? sp.tabActive : ''}`} onClick={() => setActiveTab('ops')}>
                    Data Ops
                </button>
                <button className={`${sp.tab} ${activeTab === 'browse' ? sp.tabActive : ''}`} onClick={() => setActiveTab('browse')}>
                    Browse Data {hasData && <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>({coverage!.totalRows.toLocaleString()})</span>}
                </button>
            </div>

            {/* ════════════════════════════════════════════════════
                TAB: DATA OPS
            ════════════════════════════════════════════════════ */}
            {activeTab === 'ops' && (
                <>
                    {/* No-data empty state */}
                    {!statusLoading && !hasData && (
                        <div className={sp.emptyState} style={{ marginBottom: 14 }}>
                            <CloudDownload size={28} style={{ marginBottom: 8, color: 'var(--sp-txm)' }} />
                            <div style={{ fontWeight: 600 }}>No feedback data in DynamoDB</div>
                            <div style={{ fontSize: 12, color: 'var(--sp-txm)', marginTop: 6, maxWidth: 400, lineHeight: 1.6 }}>
                                Click <strong>Sync Data</strong> to pull from Athena + S3.<br />
                                Set <code>ATHENA_OUTPUT_BUCKET</code> in <code>.env.local</code> to enable Athena (Apr 1–27 data). Ensure <code>aws sso login --profile GD-AiroBuilder-Prod-Ops</code> is active.
                            </div>
                        </div>
                    )}

                    {/* Sync progress panel */}
                    {showSyncPanel && (
                        <div className={sp.card} style={{ marginBottom: 14 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                <span className={sp.cardLabel} style={{ margin: 0 }}>
                                    <RefreshCw size={12} className={syncing ? sp.spin : ''} />
                                    {streamDropped ? 'Reconnecting to sync stream…' : 'Sync in progress'}
                                    {syncProgress && !streamDropped && (
                                        <span style={{ marginLeft: 8, fontFamily: 'var(--mono)', fontWeight: 400, color: 'var(--sp-txm)' }}>
                                            {syncProgress.processed + syncProgress.skipped}/{syncProgress.totalFiles} files ·{' '}
                                            {syncProgress.newRows} new · {syncProgress.skipped} skipped
                                            {syncProgress.errors > 0 && <span style={{ color: 'var(--red)' }}> · {syncProgress.errors} errors</span>}
                                        </span>
                                    )}
                                    {streamDropped && coverage && (
                                        <span style={{ marginLeft: 8, fontFamily: 'var(--mono)', fontWeight: 400, color: 'var(--sp-txm)' }}>
                                            {coverage.totalRows.toLocaleString()} rows so far
                                        </span>
                                    )}
                                </span>
                                {!syncing && (
                                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sp-txm)', padding: 2 }}
                                        onClick={() => setSyncCollapsed(true)} title="Collapse">
                                        <ChevronUp size={13} />
                                    </button>
                                )}
                                {syncing && (
                                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sp-txm)', padding: 2, fontSize: 10 }}
                                        onClick={abortSync} title="Stop sync">
                                        <XCircle size={13} />
                                    </button>
                                )}
                            </div>

                            <div style={{ background: 'var(--sp-s3)', borderRadius: 4, height: 6, overflow: 'hidden', marginBottom: 8 }}>
                                <div style={{
                                    width: streamDropped ? '100%' : `${progressPct}%`,
                                    height: 6, borderRadius: 4,
                                    background: syncProgress?.phase === 'error'
                                        ? 'var(--red)'
                                        : streamDropped
                                            ? 'var(--sp-txm)'
                                            : 'var(--blue)',
                                    transition: streamDropped ? 'none' : 'width .3s ease',
                                    opacity: streamDropped ? 0.4 : 1,
                                    backgroundImage: streamDropped
                                        ? 'repeating-linear-gradient(90deg,transparent,transparent 8px,rgba(255,255,255,.15) 8px,rgba(255,255,255,.15) 16px)'
                                        : 'none',
                                }} />
                            </div>

                            {!streamDropped && (
                                <div style={{ fontSize: 11, color: 'var(--sp-tx2)', display: 'flex', justifyContent: 'space-between' }}>
                                    <span>{syncProgress ? phaseLabel(syncProgress) : 'Starting…'}</span>
                                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--sp-txm)' }}>{progressPct}%</span>
                                </div>
                            )}

                            {streamDropped && (
                                <div style={{ fontSize: 11, color: 'var(--sp-txm)', display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <AlertCircle size={11} style={{ flexShrink: 0 }} />
                                    Stream disconnected — sync is still running on the server. Reconnecting automatically… Row count updates every 5 s.
                                </div>
                            )}

                            {syncProgress?.currentFile && !streamDropped && (
                                <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--sp-txm)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {shortUrl(syncProgress.currentFile)}
                                </div>
                            )}

                            {syncDone && <div className={sp.alertSuccess} style={{ marginTop: 8 }}><CheckCircle size={11} /> {syncDone}</div>}
                            {syncError && (
                                <div className={sp.alertError} style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
                                    <AlertCircle size={11} /> {syncError}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Non-syncing idle error/done when panel is collapsed */}
                    {!syncing && syncCollapsed && syncError && (
                        <div className={sp.alertError} style={{ marginBottom: 12, whiteSpace: 'pre-wrap' }}>
                            <AlertCircle size={11} /> {syncError}
                        </div>
                    )}

                    {/* Ingestion log */}
                    {log.length > 0 && (
                        <div className={sp.card} style={{ padding: 0, overflow: 'hidden' }}>
                            <button
                                onClick={() => setLogOpen(o => !o)}
                                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sp-tx1)' }}
                            >
                                <span className={sp.cardLabel} style={{ margin: 0 }}>
                                    <Database size={12} />
                                    Ingestion log — {log.length} entries
                                    {(status?.errorFiles ?? 0) > 0 && (
                                        <span style={{ marginLeft: 8, color: 'var(--red)', fontSize: 10 }}>
                                            {status!.errorFiles} errors
                                        </span>
                                    )}
                                </span>
                                {logOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            </button>

                            {logOpen && (
                                <div style={{ overflowX: 'auto', borderTop: '1px solid var(--sp-border)' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                                        <thead>
                                            <tr style={{ background: 'var(--sp-s2)' }}>
                                                {['Source', 'File / Key', 'Rows', 'Status', 'Ingested At'].map(h => (
                                                    <th key={h} style={{ textAlign: 'left', padding: '7px 10px', color: 'var(--sp-txm)', fontWeight: 500, whiteSpace: 'nowrap', borderBottom: '1px solid var(--sp-border)' }}>
                                                        {h}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {log.map(entry => (
                                                <tr key={entry.id} className={sp.tableRow}>
                                                    <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                                                        <span style={{
                                                            background: entry.source === 'athena' ? '#7c3aed18' : '#0891b218',
                                                            color: entry.source === 'athena' ? '#7c3aed' : '#0891b2',
                                                            border: `1px solid ${entry.source === 'athena' ? '#7c3aed40' : '#0891b240'}`,
                                                            borderRadius: 4, padding: '1px 6px', fontSize: 10,
                                                        }}>
                                                            {entry.source}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '6px 10px', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--sp-txm)', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                                        title={entry.s3_url}>
                                                        {shortUrl(entry.s3_url)}
                                                    </td>
                                                    <td style={{ padding: '6px 10px', fontFamily: 'var(--mono)', color: 'var(--sp-tx2)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                        {entry.rows_written ?? 0}
                                                    </td>
                                                    <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                                                        {entry.status === 'success'
                                                            ? <CheckCircle size={12} style={{ color: 'var(--green)' }} />
                                                            : <span title={entry.error_msg ?? ''}><XCircle size={12} style={{ color: 'var(--red)' }} /></span>}
                                                    </td>
                                                    <td style={{ padding: '6px 10px', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--sp-txm)', whiteSpace: 'nowrap' }}>
                                                        {fmtTs(entry.ingested_at)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}

            {/* ════════════════════════════════════════════════════
                TAB: BROWSE DATA
            ════════════════════════════════════════════════════ */}
            {activeTab === 'browse' && (
                <>
                    {/* Athena gap notice — shown when data starts after Apr 15 */}
                    {coverage?.earliest && coverage.earliest > '2026-04-15' && (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', background: 'var(--sp-warning-bg, #78350f18)', border: '1px solid var(--sp-warning-bd, #78350f40)', borderRadius: 6, marginBottom: 10, fontSize: 11, color: 'var(--sp-warning, #d97706)' }}>
                            <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                            <span>
                                <strong>Apr 1–27 data missing.</strong> S3 parquet starts Apr 28. To fill the gap, set{' '}
                                <code style={{ fontSize: 10 }}>ATHENA_OUTPUT_BUCKET</code> in <code style={{ fontSize: 10 }}>.env.local</code> and re-sync.
                                Suggested bucket: <code style={{ fontSize: 10 }}>airo-builder-feedback-prod/athena-results</code>
                            </span>
                        </div>
                    )}

                    {/* Sticky filter bar + column chooser */}
                    <div className={sp.stickyFilters}>
                        <select value={filterDays} onChange={e => setFilterDays(e.target.value)} className={sp.select}>
                            <option value="7">Last 7 days</option>
                            <option value="14">Last 14 days</option>
                            <option value="30">Last 30 days</option>
                            <option value="60">Last 60 days</option>
                            <option value="90">Last 90 days</option>
                            <option value="">All time</option>
                        </select>
                        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className={sp.select}>
                            <option value="">All categories</option>
                            <option value="feedback">Product Feedback</option>
                            <option value="issue">Issue / Bug</option>
                            <option value="support">SOS Support</option>
                        </select>
                        <select value={filterRating} onChange={e => setFilterRating(e.target.value)} className={sp.select}>
                            <option value="">All ratings</option>
                            {[1,2,3,4,5,6,7].map(r => <option key={r} value={r}>★ {r}</option>)}
                        </select>
                        <input className={sp.searchInput} style={{ minWidth: 160 }}
                            placeholder="Filter by App ID…"
                            value={filterApp} onChange={e => setFilterApp(e.target.value)} />

                        {/* Column chooser */}
                        <div ref={colPickerRef} style={{ marginLeft: 'auto', position: 'relative' }}>
                            <button className={sp.btnSecondary} onClick={() => setColPickerOpen(o => !o)}
                                title="Choose columns" style={{ gap: 4 }}>
                                <Columns size={12} />
                                Columns
                            </button>
                            {colPickerOpen && (
                                <div style={{
                                    position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 100,
                                    background: 'var(--sp-s1)', border: '1px solid var(--sp-border)', borderRadius: 8,
                                    padding: '10px 14px', minWidth: 220, boxShadow: '0 4px 16px rgba(0,0,0,.25)',
                                }}>
                                    <div style={{ fontSize: 10, color: 'var(--sp-txm)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        Always shown: Date · ★ · Category · Text
                                    </div>
                                    {OPTIONAL_COLS.map(col => (
                                        <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer', fontSize: 12, color: 'var(--sp-tx1)' }}>
                                            <input type="checkbox"
                                                checked={visibleCols.has(col.key)}
                                                onChange={e => {
                                                    const next = new Set(visibleCols);
                                                    if (e.target.checked) next.add(col.key); else next.delete(col.key);
                                                    setVisibleCols(next);
                                                    saveVisibleCols(next);
                                                }}
                                                style={{ accentColor: 'var(--sp-accent)' }}
                                            />
                                            {col.label}
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Count + page-size row */}
                    <div className={sp.pageSizeRow}>
                        <span>{total.toLocaleString()} matching records · page {page + 1}/{Math.max(1, totalPages)}</span>
                        <span style={{ marginLeft: 'auto' }}>Rows per page:</span>
                        {PAGE_SIZES.map(s => (
                            <button key={s}
                                onClick={() => { setPageSize(s); setPage(0); }}
                                style={{
                                    padding: '2px 8px', border: '1px solid var(--sp-border)', borderRadius: 4,
                                    background: pageSize === s ? 'var(--sp-accent)' : 'var(--sp-s2)',
                                    color: pageSize === s ? '#fff' : 'var(--sp-tx2)',
                                    fontWeight: pageSize === s ? 600 : 400,
                                    cursor: 'pointer', fontSize: 11,
                                }}
                            >
                                {s}
                            </button>
                        ))}
                        <button className={sp.btnSecondary} onClick={() => loadBrowse(page)} disabled={browseLoading} style={{ fontSize: 11, marginLeft: 4 }}>
                            <RefreshCw size={11} className={browseLoading ? sp.spin : ''} />
                        </button>
                    </div>

                    {/* Grid with sticky sortable header */}
                    <div className={sp.gridScroll}>
                        {((): React.ReactNode => {
                            const optVisible = OPTIONAL_COLS.filter(c => visibleCols.has(c.key));
                            const colCount = 4 + optVisible.length + 1; // frozen(4) + optional + FS(1)

                            const SortTh = ({ col, label }: { col: string; label: string }) => {
                                const active = sortCol === col;
                                const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
                                return (
                                    <th
                                        onClick={() => {
                                            if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                                            else { setSortCol(col); setSortDir('desc'); }
                                            setPage(0);
                                        }}
                                        style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                                    >
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                            {label}
                                            <Icon size={10} style={{ opacity: active ? 1 : 0.35, color: active ? 'var(--blue)' : 'inherit' }} />
                                        </span>
                                    </th>
                                );
                            };

                            const StaticTh = ({ label }: { label: string }) => <th style={{ whiteSpace: 'nowrap' }}>{label}</th>;

                            return (
                                <table>
                                    <thead>
                                        <tr>
                                            {/* Frozen columns */}
                                            <SortTh col="feedback_utc_ts" label="Date" />
                                            <SortTh col="rating" label="★" />
                                            <SortTh col="feedback_category" label="Category" />
                                            {/* Optional columns */}
                                            {optVisible.map(c => c.sortable
                                                ? <SortTh key={c.key} col={c.key} label={c.label} />
                                                : <StaticTh key={c.key} label={c.label} />
                                            )}
                                            {/* Feedback text + FS — always last */}
                                            <StaticTh label="Feedback" />
                                            <StaticTh label="" />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {browseLoading ? (
                                            <tr><td colSpan={colCount} style={{ textAlign: 'center', padding: 32, color: 'var(--sp-txm)' }}>Loading…</td></tr>
                                        ) : rows.length === 0 ? (
                                            <tr>
                                                <td colSpan={colCount} style={{ textAlign: 'center', padding: 32, color: 'var(--sp-txm)' }}>
                                                    {hasData ? 'No records match the current filters' : 'No data — sync first'}
                                                </td>
                                            </tr>
                                        ) : rows.map(row => (
                                            <React.Fragment key={row.feedback_id}>
                                                <tr
                                                    onClick={() => setExpanded(expanded === row.feedback_id ? null : row.feedback_id)}
                                                    style={{ borderBottom: '1px solid var(--sp-s3)', cursor: 'pointer' }}
                                                    className={sp.tableRow}
                                                >
                                                    {/* Frozen */}
                                                    <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', color: 'var(--sp-txm)', whiteSpace: 'nowrap', fontSize: 10 }}>
                                                        {fmtTs(row.feedback_utc_ts)}
                                                    </td>
                                                    <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', fontWeight: 700, color: ratingColor(row.rating), whiteSpace: 'nowrap' }}>
                                                        {row.rating != null ? `★${row.rating}` : '—'}
                                                    </td>
                                                    <td style={{ padding: '7px 10px' }}>
                                                        <span style={{ background: 'var(--sp-s2)', border: '1px solid var(--sp-border)', borderRadius: 4, padding: '1px 5px', fontSize: 10, color: 'var(--sp-tx2)' }}>
                                                            {row.feedback_category ?? '—'}
                                                        </span>
                                                    </td>
                                                    {/* Optional */}
                                                    {optVisible.map(c => {
                                                        const val = row[c.key as keyof FeedbackRow];
                                                        const display = val != null ? String(val) : '—';
                                                        if (c.key === 'app_id') return (
                                                            <td key={c.key} style={{ padding: '7px 10px', color: 'var(--blue)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{display}</td>
                                                        );
                                                        if (c.key === 'data_source') {
                                                            const src = String(val ?? 's3');
                                                            const srcColor = src === 'both' ? '#059669' : src === 'athena' ? '#7c3aed' : '#0891b2';
                                                            return (
                                                                <td key={c.key} style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                                                                    <span style={{ background: `${srcColor}18`, color: srcColor, border: `1px solid ${srcColor}40`, borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 500 }}>
                                                                        {display}
                                                                    </span>
                                                                </td>
                                                            );
                                                        }
                                                        return (
                                                            <td key={c.key} style={{ padding: '7px 10px', color: 'var(--sp-tx2)', whiteSpace: 'nowrap', fontSize: 10, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{display}</td>
                                                        );
                                                    })}
                                                    {/* Feedback text */}
                                                    <td style={{ padding: '7px 10px', color: 'var(--sp-tx1)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {row.feedback_text || <span style={{ color: 'var(--sp-txm)' }}>No text</span>}
                                                    </td>
                                                    {/* FullStory link */}
                                                    <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                                                        {row.full_story_url && (
                                                            <a href={row.full_story_url} target="_blank" rel="noopener noreferrer"
                                                                onClick={e => e.stopPropagation()}
                                                                style={{ color: 'var(--blue)' }}>
                                                                <ExternalLink size={11} />
                                                            </a>
                                                        )}
                                                    </td>
                                                </tr>

                                                {expanded === row.feedback_id && (
                                                    <tr>
                                                        <td colSpan={colCount} style={{ background: 'var(--sp-s2)', padding: '12px 16px', borderBottom: '1px solid var(--sp-border)' }}>
                                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                                                                <div>
                                                                    <div style={{ fontSize: 10, color: 'var(--sp-txm)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Feedback Text</div>
                                                                    <div style={{ fontSize: 12, color: 'var(--sp-tx1)', lineHeight: 1.6 }}>{row.feedback_text || '—'}</div>
                                                                </div>
                                                                <div>
                                                                    <div style={{ fontSize: 10, color: 'var(--sp-txm)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Topics</div>
                                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                                        {((): React.ReactNode => {
                                                                            try {
                                                                                const topics = JSON.parse(row.feedback_topic_list ?? '[]') as string[];
                                                                                return topics.filter(Boolean).map(t => (
                                                                                    <span key={t} style={{ background: '#0891b218', color: '#0891b2', border: '1px solid #0891b240', borderRadius: 4, padding: '1px 6px', fontSize: 10 }}>{t}</span>
                                                                                ));
                                                                            } catch { return <span style={{ color: 'var(--sp-txm)' }}>—</span>; }
                                                                        })()}
                                                                    </div>
                                                                    <div style={{ fontSize: 10, color: 'var(--sp-txm)', marginTop: 8, marginBottom: 2, textTransform: 'uppercase' }}>Origin</div>
                                                                    <div style={{ fontSize: 11 }}>{row.feedback_origin_name ?? '—'}</div>
                                                                </div>
                                                                <div>
                                                                    <div style={{ fontSize: 10, color: 'var(--sp-txm)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Customer / Shopper</div>
                                                                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--sp-txm)' }}>{row.customer_id ?? row.shopper_id ?? '—'}</div>
                                                                    <div style={{ fontSize: 10, color: 'var(--sp-txm)', marginTop: 8, marginBottom: 2, textTransform: 'uppercase' }}>Plan · Status</div>
                                                                    <div style={{ fontSize: 11 }}>{row.plan_type_name ?? '—'} · {row.subscription_status ?? '—'}</div>
                                                                    <div style={{ fontSize: 10, color: 'var(--sp-txm)', marginTop: 8, marginBottom: 2, textTransform: 'uppercase' }}>Credits (total / avail)</div>
                                                                    <div style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>{row.total_credit_cnt ?? '—'} / {row.available_credit_cnt ?? '—'}</div>
                                                                    <div style={{ fontSize: 10, color: 'var(--sp-txm)', marginTop: 8, marginBottom: 2, textTransform: 'uppercase' }}>Device · Browser</div>
                                                                    <div style={{ fontSize: 11 }}>{row.device_type ?? '—'} · {row.browser_type ?? '—'}</div>
                                                                </div>
                                                                <div>
                                                                    <div style={{ fontSize: 10, color: 'var(--sp-txm)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Feedback ID</div>
                                                                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--sp-txm)', wordBreak: 'break-all' }}>{row.feedback_id}</div>
                                                                    <div style={{ fontSize: 10, color: 'var(--sp-txm)', marginTop: 8, marginBottom: 4, textTransform: 'uppercase' }}>Data Source</div>
                                                                    {((): React.ReactNode => {
                                                                        const src = row.data_source ?? 's3';
                                                                        const srcColor = src === 'both' ? '#059669' : src === 'athena' ? '#7c3aed' : '#0891b2';
                                                                        return <span style={{ background: `${srcColor}18`, color: srcColor, border: `1px solid ${srcColor}40`, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 500 }}>{src}</span>;
                                                                    })()}
                                                                    <div style={{ fontSize: 10, color: 'var(--sp-txm)', marginTop: 8, marginBottom: 2, textTransform: 'uppercase' }}>App Version · Name</div>
                                                                    <div style={{ fontSize: 11 }}>{row.app_version ?? '—'} · {row.app_name ?? '—'}</div>
                                                                    {row.page_url && (
                                                                        <>
                                                                            <div style={{ fontSize: 10, color: 'var(--sp-txm)', marginTop: 8, marginBottom: 2, textTransform: 'uppercase' }}>Page URL</div>
                                                                            <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--blue)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.page_url}>{row.page_url}</div>
                                                                        </>
                                                                    )}
                                                                    {row.full_story_url && (
                                                                        <>
                                                                            <div style={{ fontSize: 10, color: 'var(--sp-txm)', marginTop: 8, marginBottom: 2, textTransform: 'uppercase' }}>FullStory</div>
                                                                            <a href={row.full_story_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)', fontSize: 11 }}>
                                                                                Open session <ExternalLink size={10} style={{ display: 'inline', verticalAlign: 'middle' }} />
                                                                            </a>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        ))}
                                    </tbody>
                                </table>
                            );
                        })()}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10 }}>
                            <button className={sp.btnSecondary} onClick={() => setPage(p => p - 1)} disabled={page === 0}>
                                <ChevronLeft size={13} />
                            </button>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--sp-tx2)' }}>
                                {page + 1} / {totalPages}
                            </span>
                            <button className={sp.btnSecondary} onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>
                                <ChevronRight size={13} />
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
