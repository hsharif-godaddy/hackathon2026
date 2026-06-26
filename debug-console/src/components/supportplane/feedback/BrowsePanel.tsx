'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, CheckCircle, ChevronDown,
    ChevronLeft, ChevronRight, ChevronUp, CloudDownload, Columns, Database,
    ExternalLink, FileText, RefreshCw, Upload, Volume2, XCircle,
} from 'lucide-react';
import sp from '@/components/supportplane/sp.module.css';
import { WaveDots } from '@/components/supportplane/WaveDots';

// ── Types ──────────────────────────────────────────────────────────

type ActiveTab = 's3' | 'athena' | 'browse' | 'compare';

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
    rawS3Total: number;
    rawAthenaTotal: number;
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

// Athena exports timestamps as "2026-04-01 12:34:56.000" (space, no T).
// Normalize to ISO before parsing so new Date() doesn't return Invalid Date.
function normTs(raw: string): Date {
    return new Date(raw.trim().replace(' ', 'T'));
}

function fmtDate(iso: string | null): string {
    if (!iso) return '—';
    try {
        const d = normTs(iso);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    } catch { return '—'; }
}

function fmtTs(ts: string | null): string {
    if (!ts) return '—';
    try {
        const d = normTs(ts);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch { return '—'; }
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

function KpiTile({ value, label, sub, color, loading }: { value: string; label: string; sub: string; color: string; loading?: boolean }) {
    return (
        <div className={sp.kpiCard}>
            {loading
                ? <div style={{ marginBottom: 4 }}><WaveDots size={8} gap={5} /></div>
                : <div className={sp.kpiValue} style={{ color }}>{value}</div>
            }
            <div className={sp.kpiLabel}>{label}</div>
            <div className={sp.kpiSub}>{loading ? '…' : sub}</div>
        </div>
    );
}

function parseDateParts(iso: string | null): { day: string; month: string; year: string } | null {
    if (!iso) return null;
    try {
        const d = normTs(iso);
        if (isNaN(d.getTime())) return null;
        return {
            day: String(d.getUTCDate()).padStart(2, '0'),
            month: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
            year: String(d.getUTCFullYear()),
        };
    } catch { return null; }
}

function DateKpiTile({ iso, label, sub, loading }: { iso: string | null; label: string; sub: string; loading?: boolean }) {
    const parts = parseDateParts(iso);
    return (
        <div className={sp.kpiCard}>
            {loading
                ? <div style={{ marginBottom: 4 }}><WaveDots size={8} gap={5} /></div>
                : parts
                    ? (
                        <div className={sp.kpiDateRow}>
                            <span className={sp.kpiDay}>{parts.day}</span>
                            <div className={sp.kpiSep} />
                            <div className={sp.kpiMonthYear}>
                                <span className={sp.kpiMonth}>{parts.month}</span>
                                <span className={sp.kpiYear}>{parts.year}</span>
                            </div>
                        </div>
                    )
                    : <div className={sp.kpiValue} style={{ color: 'var(--sp-txm)' }}>—</div>
            }
            <div className={sp.kpiLabel}>{label}</div>
            <div className={sp.kpiSub}>{loading ? '…' : sub}</div>
        </div>
    );
}

function DateBlock({ parts }: { parts: ReturnType<typeof parseDateParts> }) {
    if (!parts) return <div className={sp.kpiValue} style={{ color: 'var(--sp-txm)' }}>—</div>;
    return (
        <div className={sp.kpiDateRow}>
            <span className={sp.kpiDay}>{parts.day}</span>
            <div className={sp.kpiSep} />
            <div className={sp.kpiMonthYear}>
                <span className={sp.kpiMonth}>{parts.month}</span>
                <span className={sp.kpiYear}>{parts.year}</span>
            </div>
        </div>
    );
}

function DateRangeTile({ from, to, loading }: { from: string | null; to: string | null; loading?: boolean }) {
    const f = parseDateParts(from);
    const t = parseDateParts(to);
    return (
        <div className={sp.kpiCard} style={{ gridColumn: 'span 2' }}>
            {loading
                ? <div style={{ marginBottom: 4 }}><WaveDots size={8} gap={5} /></div>
                : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <DateBlock parts={f} />
                        <span style={{ fontSize: 20, color: 'var(--sp-txm)', flexShrink: 0, lineHeight: 1 }}>→</span>
                        <DateBlock parts={t} />
                    </div>
                )
            }
            <div className={sp.kpiLabel}>Data Range</div>
            <div className={sp.kpiSub}>{loading ? '…' : 'earliest → latest feedback'}</div>
        </div>
    );
}

// ── Main component ─────────────────────────────────────────────────

export default function FeedbackBrowsePanel({ syncTrigger = 0 }: { syncTrigger?: number }) {
    // ── Tab state ──
    const [activeTab, setActiveTab] = useState<ActiveTab>('s3');

    // ── Data source state ──
    const [status,   setStatus]   = useState<IngestionStatus | null>(null);
    const [coverage, setCoverage] = useState<DataCoverage | null>(null);
    const [log,      setLog]      = useState<LogEntry[]>([]);
    const [statusLoading, setStatusLoading] = useState(true);
    const [statusError,   setStatusError]   = useState<string | null>(null);

    // ── Sync state ──
    const [syncing,         setSyncing]         = useState(false);
    const [syncSource,      setSyncSource]      = useState<'s3' | 'athena' | 'both'>('both');
    const [syncProgress,    setSyncProgress]    = useState<SyncProgress | null>(null);
    const [syncDone,        setSyncDone]        = useState<string | null>(null);
    const [syncError,       setSyncError]       = useState<string | null>(null);
    const [syncCollapsed,   setSyncCollapsed]   = useState(false);
    const [streamDropped,   setStreamDropped]   = useState(false);
    const readerRef      = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
    const pollRef        = useRef<ReturnType<typeof setInterval> | null>(null);
    const syncingRef     = useRef(false);
    const forceResyncRef = useRef(false);
    // Timestamp of last manual log clear (or sync start). Poll/loadStatus filter
    // out entries older than this so clearing sticks until the next sync.
    const logClearedAtRef = useRef<number>(0);

    // ── Athena CSV upload state ──
    const [uploadFile,     setUploadFile]     = useState<File | null>(null);
    const [uploading,      setUploading]      = useState(false);
    const [uploadProgress, setUploadProgress] = useState<{ phase: string; processed: number; total: number; newRows: number; skipped: number; errors: number } | null>(null);
    const [uploadResult,   setUploadResult]   = useState<{ message: string; warnings?: string[]; errors?: number } | null>(null);
    const [uploadError,    setUploadError]    = useState<string | null>(null);
    const [dragging,       setDragging]       = useState(false);
    const uploadInputRef = useRef<HTMLInputElement>(null);

    // ── Legacy migration state ──
    const [migrating,      setMigrating]      = useState(false);
    const [migrateResult,  setMigrateResult]  = useState<{ legacyTotal: number; s3Written: number; athenaWritten: number; enrichedTotal: number; alreadyPopulated: boolean } | null>(null);
    const [migrateError,   setMigrateError]   = useState<string | null>(null);

    // ── Log panel ──
    const [logOpen, setLogOpen] = useState(false);
    const [logTab, setLogTab] = useState<'all' | 'errors'>('all');

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
    const [filterDays,   setFilterDays]   = useState('');

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
            const cutoff = logClearedAtRef.current;
            const entries = (d.log ?? []) as LogEntry[];
            setLog(cutoff > 0 ? entries.filter((e: LogEntry) => new Date(e.ingested_at).getTime() >= cutoff - 5000) : entries);
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
            setActiveTab('s3');
            void startSync(false, 's3');
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
        let pollInFlight = false;
        pollRef.current = setInterval(async () => {
            if (!syncingRef.current) { stopPoll(); return; }
            if (pollInFlight) return;
            pollInFlight = true;
            try {
                const res = await fetch('/api/supportplane/feedback/sync');
                if (!res.ok) return;
                const d = await res.json() as { status: IngestionStatus; coverage: DataCoverage; log: LogEntry[] };
                setStatus(d.status);
                setCoverage(d.coverage);
                if (!forceResyncRef.current) {
                    const cutoff = logClearedAtRef.current;
                    const entries = (d.log ?? []) as LogEntry[];
                    setLog(cutoff > 0 ? entries.filter((e: LogEntry) => new Date(e.ingested_at).getTime() >= cutoff - 5000) : entries);
                }
            } catch { /* ignore poll errors */ } finally {
                pollInFlight = false;
            }
        }, 15000);
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
                        // Once clear is confirmed via SSE, re-enable poll so log count updates live
                        if (forceResyncRef.current && p.message?.includes('data cleared')) {
                            forceResyncRef.current = false;
                        }
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

    const startSync = useCallback(async (force = false, source: 's3' | 'athena' | 'both' = 'both') => {
        if (syncing) return;
        setSyncing(true);
        setSyncSource(source);
        syncingRef.current = true;
        setSyncProgress(null);
        setSyncDone(null);
        setSyncError(null);
        setSyncCollapsed(false);
        setStreamDropped(false);
        setLog([]);
        logClearedAtRef.current = Date.now();
        if (force) { forceResyncRef.current = true; }

        const params: string[] = [`sources=${source}`];
        if (force) params.push('force=true');
        const baseUrl = `/api/supportplane/feedback/sync/stream?${params.join('&')}`;

        // Start poll immediately so log count updates every 5s even while stream is active
        startPoll();

        try {
            let attempt = 0;
            while (syncingRef.current) {
                const result = await runStream(baseUrl);
                if (result === 'done' || result === 'error') break;

                attempt++;
                setStreamDropped(true);

                // Exponential backoff: 5s, 10s, 20s, cap at 30s — gives server time to recover
                const backoffMs = Math.min(5000 * Math.pow(2, attempt - 1), 30000);
                await new Promise<void>(r => setTimeout(r, backoffMs));
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

    const migrateLegacy = useCallback(async () => {
        if (migrating) return;
        setMigrating(true);
        setMigrateResult(null);
        setMigrateError(null);
        try {
            const res = await fetch('/api/supportplane/feedback/sync/migrate-legacy', { method: 'POST' });
            const body = await res.json() as { success: boolean; error?: string; legacyTotal?: number; s3Written?: number; athenaWritten?: number; enrichedTotal?: number; alreadyPopulated?: boolean };
            if (!body.success) {
                setMigrateError(body.error ?? 'Migration failed');
            } else {
                setMigrateResult({
                    legacyTotal: body.legacyTotal ?? 0,
                    s3Written: body.s3Written ?? 0,
                    athenaWritten: body.athenaWritten ?? 0,
                    enrichedTotal: body.enrichedTotal ?? 0,
                    alreadyPopulated: body.alreadyPopulated ?? false,
                });
                void loadStatus();
                void loadBrowse(0);
            }
        } catch (err) {
            setMigrateError(err instanceof Error ? err.message : 'Network error');
        } finally {
            setMigrating(false);
        }
    }, [migrating, loadStatus, loadBrowse]);

    const uploadAthenaCSV = useCallback(async () => {
        if (!uploadFile || uploading) return;
        setUploading(true);
        setUploadResult(null);
        setUploadError(null);
        setUploadProgress(null);
        logClearedAtRef.current = Date.now();
        const form = new FormData();
        form.append('file', uploadFile);
        try {
            const res = await fetch('/api/supportplane/feedback/sync/athena-upload', { method: 'POST', body: form });
            if (!res.ok || !res.body) {
                const body = await res.json() as { error?: string };
                setUploadError(body.error ?? `Upload failed (${res.status})`);
                return;
            }
            const reader = res.body.getReader();
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
                        const p = JSON.parse(line.slice(6)) as {
                            phase: string; processed?: number; total?: number;
                            newRows?: number; skipped?: number; errors?: number;
                            message?: string; warnings?: string[];
                        };
                        if (p.phase === 'processing' || p.phase === 'aggregating') {
                            setUploadProgress({ phase: p.phase, processed: p.processed ?? 0, total: p.total ?? 0, newRows: p.newRows ?? 0, skipped: p.skipped ?? 0, errors: p.errors ?? 0 });
                        } else if (p.phase === 'done' || p.phase === 'done_with_errors' || p.phase === 'error') {
                            setUploadProgress({ phase: p.phase, processed: p.total ?? 0, total: p.total ?? 0, newRows: p.newRows ?? 0, skipped: p.skipped ?? 0, errors: p.errors ?? 0 });
                            if (p.phase === 'error') {
                                setUploadError(p.message ?? 'Upload failed');
                            } else {
                                setUploadResult({ message: p.message ?? 'Upload complete', warnings: p.warnings, errors: p.errors ?? 0 });
                            }
                            setUploadFile(null);
                            if (uploadInputRef.current) uploadInputRef.current.value = '';
                            void loadStatus();
                            void loadBrowse(0);
                        }
                    } catch { /* malformed SSE line */ }
                }
            }
        } catch (err) {
            setUploadError((err as Error).message);
        } finally {
            setUploading(false);
        }
    }, [uploadFile, uploading, loadStatus, loadBrowse]);

    // ── Computed ───────────────────────────────────────────────────

    const s3Log: LogEntry[]     = log.filter((e: LogEntry) => e.source !== 'athena');
    const athenaLog: LogEntry[] = log.filter((e: LogEntry) => e.source === 'athena');

    const s3LogErrors: LogEntry[]     = s3Log.filter((e: LogEntry) => e.status !== 'success');
    const athenaLogErrors: LogEntry[] = athenaLog.filter((e: LogEntry) => e.status !== 'success');

    const s3LogVisible: LogEntry[]     = logTab === 'errors' ? s3LogErrors     : s3Log;
    const athenaLogVisible: LogEntry[] = logTab === 'errors' ? athenaLogErrors : athenaLog;

    const totalPages = Math.ceil(total / pageSize);
    const progressPct = syncProgress && syncProgress.totalFiles > 0
        ? Math.min(100, Math.round(((syncProgress.processed + syncProgress.skipped) / syncProgress.totalFiles) * 100))
        : (syncProgress?.phase === 'aggregating' ? 95 : syncProgress?.phase === 'done' ? 100 : 0);

    const hasData = (coverage?.totalRows ?? 0) > 0;

    // Per-source sync panel visibility — progress shows in the tab that triggered it
    const showS3SyncPanel     = (syncing && syncSource === 's3')
        || (!syncCollapsed && syncSource === 's3'     && (syncProgress !== null || syncError !== null));
    const showAthenaSyncPanel = (syncing && syncSource === 'athena')
        || (!syncCollapsed && syncSource === 'athena' && (syncProgress !== null || syncError !== null));

    // ── Sync progress card (reused in both source tabs) ───────────────
    const SyncProgressCard = (): React.ReactElement => (
        <div className={sp.card} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span className={sp.cardLabel} style={{ margin: 0 }}>
                    <RefreshCw size={12} className={syncing ? sp.spin : ''} />
                    {streamDropped
                        ? 'Reconnecting to sync stream…'
                        : `${syncSource === 's3' ? 'S3' : 'Athena'} sync in progress`}
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
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {syncing && (
                        <button className={sp.btnSecondary} onClick={abortSync} style={{ fontSize: 11 }}>
                            <XCircle size={11} /> Abort
                        </button>
                    )}
                    {!syncing && (
                        <button className={sp.btnSecondary} onClick={() => setSyncCollapsed(true)} style={{ fontSize: 11, padding: '2px 8px' }}>
                            <ChevronUp size={11} />
                        </button>
                    )}
                </div>
            </div>

            {/* Progress bar */}
            <div style={{ height: 4, borderRadius: 2, background: 'var(--sp-s3)', overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ height: '100%', width: `${progressPct}%`, background: 'var(--sp-accent)', borderRadius: 2, transition: 'width 0.4s ease' }} />
            </div>

            {/* Phase label */}
            {syncProgress && (
                <div style={{ fontSize: 11, color: 'var(--sp-txm)', fontFamily: 'var(--mono)' }}>
                    {phaseLabel(syncProgress)}
                    {syncProgress.currentFile && (
                        <span style={{ marginLeft: 8, opacity: 0.7 }}>{shortUrl(syncProgress.currentFile)}</span>
                    )}
                </div>
            )}

            {/* Done */}
            {syncDone && !syncing && (
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--green)', fontSize: 12 }}>
                    <CheckCircle size={12} /> {syncDone}
                </div>
            )}

            {/* Error */}
            {syncError && (
                <div className={sp.alertError} style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
                    <AlertCircle size={11} /> {syncError}
                </div>
            )}
        </div>
    );

    // ── Ingestion log card (reused in both source tabs) ───────────────
    const IngestionLogCard = ({ entries, errorEntries, visibleEntries }: {
        entries: LogEntry[];
        errorEntries: LogEntry[];
        visibleEntries: LogEntry[];
    }): React.ReactElement | null => {
        if (entries.length === 0) return null;
        return (
            <div className={sp.card} style={{ padding: 0, overflow: 'hidden' }}>
                <button
                    onClick={() => setLogOpen(o => !o)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sp-tx1)' }}
                >
                    <span className={sp.cardLabel} style={{ margin: 0 }}>
                        <Database size={12} /> Ingestion Log
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 10, color: 'var(--sp-txm)', fontFamily: 'var(--mono)' }}>{entries.length} entries</span>
                        {errorEntries.length > 0 && (
                            <span style={{ fontSize: 10, color: 'var(--red)', fontFamily: 'var(--mono)', fontWeight: 600 }}>· {errorEntries.length} errors</span>
                        )}
                        <span
                            role="button"
                            onClick={(e) => { e.stopPropagation(); logClearedAtRef.current = Date.now(); setLog([]); }}
                            style={{ fontSize: 10, color: 'var(--sp-txm)', cursor: 'pointer', padding: '1px 6px', borderRadius: 4, border: '1px solid var(--sp-border)' }}
                        >
                            Clear
                        </span>
                        {logOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </span>
                </button>
                {logOpen && (
                    <>
                        <div style={{ display: 'flex', gap: 0, borderTop: '1px solid var(--sp-border)', borderBottom: '1px solid var(--sp-border)', background: 'var(--sp-s2)' }}>
                            {(['all', 'errors'] as const).map(tab => (
                                <button key={tab} onClick={() => setLogTab(tab)} style={{
                                    padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                                    background: logTab === tab ? 'var(--sp-s1)' : 'transparent',
                                    color: tab === 'errors' && errorEntries.length > 0
                                        ? (logTab === tab ? 'var(--red)' : '#ef444490')
                                        : (logTab === tab ? 'var(--sp-tx1)' : 'var(--sp-txm)'),
                                    borderBottom: logTab === tab ? '2px solid var(--sp-accent)' : '2px solid transparent',
                                }}>
                                    {tab === 'all' ? `All (${entries.length})` : `Errors (${errorEntries.length})`}
                                </button>
                            ))}
                        </div>
                        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: 'var(--sp-s2)', position: 'sticky', top: 0 }}>
                                        <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--sp-txm)', fontWeight: 600 }}>Source / Key</th>
                                        <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--sp-txm)', fontWeight: 600 }}>Status</th>
                                        <th style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--sp-txm)', fontWeight: 600 }}>Rows</th>
                                        <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--sp-txm)', fontWeight: 600 }}>Ingested At</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visibleEntries.map((entry: LogEntry) => (
                                        <tr key={entry.id} style={{ borderTop: '1px solid var(--sp-s3)' }}>
                                            <td style={{ padding: '6px 10px', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                <span style={{
                                                    display: 'inline-block', marginRight: 6, padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                                                    background: entry.source === 'athena' ? '#7c3aed18' : '#0891b218',
                                                    color: entry.source === 'athena' ? '#7c3aed' : '#0891b2',
                                                    border: `1px solid ${entry.source === 'athena' ? '#7c3aed40' : '#0891b240'}`,
                                                }}>
                                                    {entry.source}
                                                </span>
                                                {shortUrl(entry.s3_url)}
                                            </td>
                                            <td style={{ padding: '6px 10px', color: entry.status === 'success' ? 'var(--green)' : 'var(--red)', fontWeight: 500 }}>{entry.status}</td>
                                            <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--sp-tx2)' }}>{entry.rows_written}</td>
                                            <td style={{ padding: '6px 10px', color: 'var(--sp-txm)', whiteSpace: 'nowrap' }}>{fmtTs(entry.ingested_at)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>
        );
    };

    return (
        <div className={sp.panelRoot}>

            {/* ── Header ── */}
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>Feedback Analytics</div>
                    <div className={sp.panelSub}>
                        S3 + Athena → DynamoDB ·
                        {hasData
                            ? ` ${coverage!.totalRows.toLocaleString()} rows · ${fmtDate(coverage!.earliest)} – ${fmtDate(coverage!.latest)}`
                            : ' No data loaded yet'}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button className={sp.btnSecondary} onClick={loadStatus} disabled={statusLoading} title="Refresh status">
                        <RefreshCw size={13} className={statusLoading ? sp.spin : ''} />
                    </button>
                    {syncing && (
                        <button className={sp.btnSecondary} onClick={abortSync} title="Stop the current sync">
                            <XCircle size={13} /> Abort {syncSource.toUpperCase()}
                        </button>
                    )}
                </div>
            </div>

            {statusError && (
                <div className={sp.alertError} style={{ marginBottom: 12 }}>
                    <AlertCircle size={13} /> {statusError}
                </div>
            )}

            {/* ── KPI tiles ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 8, marginBottom: 14 }}>
                <KpiTile
                    loading={statusLoading}
                    value={coverage?.rawS3Total.toLocaleString() ?? '—'}
                    label="Rows — S3"
                    sub={coverage ? `${coverage.s3OnlyRows.toLocaleString()} rows w/o Athena match` : '…'}
                    color="var(--sp-row)"
                />
                <KpiTile
                    loading={statusLoading}
                    value={coverage?.rawAthenaTotal.toLocaleString() ?? '—'}
                    label="Rows — Athena"
                    sub={coverage ? `${coverage.athenaRows.toLocaleString()} rows w/o S3 match` : '…'}
                    color="var(--sp-row)"
                />
                <KpiTile loading={statusLoading} value={coverage?.totalRows.toLocaleString() ?? '—'} label="Enriched Records" sub="S3 ∪ Athena · no duplicates" color="var(--sp-enriched)" />
                <DateKpiTile loading={statusLoading} iso={coverage?.earliest ?? null} label="From" sub="earliest feedback" />
                <DateKpiTile loading={statusLoading} iso={coverage?.latest ?? null} label="To" sub="latest feedback" />
            </div>

            {/* ── Sync done bar ── */}
            {!syncing && syncCollapsed && syncDone && (
                <div className={sp.syncCollapsedBar} onClick={() => setSyncCollapsed(false)}>
                    <CheckCircle size={13} style={{ color: 'var(--green)', flexShrink: 0 }} />
                    <span style={{ flex: 1, color: 'var(--sp-tx1)' }}>{syncDone}</span>
                    <Volume2 size={12} style={{ color: 'var(--sp-txm)' }} />
                    <ChevronDown size={13} style={{ color: 'var(--sp-txm)' }} />
                </div>
            )}

            {/* ── Migrate from Legacy — shown when enriched table is empty ── */}
            {!statusLoading && !hasData && !migrating && !migrateResult && (
                <div className={sp.card} style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>Populate from Legacy Table</div>
                        <div style={{ fontSize: 12, color: 'var(--sp-txm)' }}>
                            Copy S3 + Athena rows from the existing <code style={{ fontSize: 11 }}>feedback</code> table into the new raw tables and rebuild the enriched view. One-time operation — safe to re-run.
                        </div>
                    </div>
                    <button
                        className={sp.btnPrimary}
                        onClick={() => void migrateLegacy()}
                        style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                        <Database size={12} /> Migrate from Legacy
                    </button>
                </div>
            )}

            {migrating && (
                <div className={sp.card} style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--sp-txm)', fontSize: 13 }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}>
                        <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="20 14" />
                    </svg>
                    Copying rows from legacy table and rebuilding enriched view…
                </div>
            )}

            {migrateResult && (
                <div className={sp.alertSuccess} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, marginBottom: 4 }}>
                        <CheckCircle size={13} /> Migration complete{migrateResult.alreadyPopulated ? ' (topped up)' : ''}
                    </div>
                    <div style={{ fontSize: 12 }}>
                        Legacy: {migrateResult.legacyTotal.toLocaleString()} rows →
                        S3: {migrateResult.s3Written.toLocaleString()} · Athena: {migrateResult.athenaWritten.toLocaleString()} · Enriched: {migrateResult.enrichedTotal.toLocaleString()} unique records
                    </div>
                </div>
            )}

            {migrateError && (
                <div className={sp.alertError} style={{ marginBottom: 12 }}>
                    <AlertCircle size={12} /> Migration failed: {migrateError}
                </div>
            )}

            {/* ── Tab bar ── */}
            <div className={sp.tabBar}>
                <button className={`${sp.tab} ${activeTab === 's3' ? sp.tabActive : ''}`} onClick={() => setActiveTab('s3')}>
                    <CloudDownload size={11} /> S3{s3Log.length > 0 && <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.6 }}>({s3Log.length})</span>}
                </button>
                <button className={`${sp.tab} ${activeTab === 'athena' ? sp.tabActive : ''}`} onClick={() => setActiveTab('athena')}>
                    <Database size={11} /> Athena{athenaLog.length > 0 && <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.6 }}>({athenaLog.length})</span>}
                </button>
                <button className={`${sp.tab} ${activeTab === 'browse' ? sp.tabActive : ''}`} onClick={() => setActiveTab('browse')}>
                    Browse Data {hasData && <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>({coverage!.totalRows.toLocaleString()})</span>}
                </button>
                <button className={`${sp.tab} ${activeTab === 'compare' ? sp.tabActive : ''}`} onClick={() => setActiveTab('compare')}>
                    S3 ↔ Athena
                </button>
            </div>

            {/* ════════════════════════════════════════════════════
                TAB: S3
            ════════════════════════════════════════════════════ */}
            {activeTab === 's3' && (
                <>
                    {/* Sync progress (S3) */}
                    {showS3SyncPanel && <SyncProgressCard />}

                    {/* S3 action card */}
                    <div className={sp.card} style={{ marginBottom: 14 }}>
                        <div className={sp.cardLabel}><CloudDownload size={12} /> S3 Parquet Sync</div>
                        <div style={{ fontSize: 12, color: 'var(--sp-txm)', marginBottom: 12, lineHeight: 1.6 }}>
                            Incrementally reads new parquet files from S3 (<code style={{ fontSize: 11 }}>{process.env.NEXT_PUBLIC_S3_FEEDBACK_BUCKET ?? 'airo-builder-feedback-prod'}</code>).
                            Already-ingested files are skipped; use <strong>Force Resync</strong> to re-read everything.
                        </div>
                        {!syncing && (
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <button className={sp.btnPrimary} onClick={() => void startSync(false, 's3')}>
                                    <CloudDownload size={13} /> S3 Sync
                                </button>
                                <button
                                    className={sp.btnSecondary}
                                    style={{ fontSize: 11 }}
                                    onClick={() => { if (confirm('Drop all S3 ingest history and re-read every parquet file from scratch? This may take several minutes.')) void startSync(true, 's3'); }}
                                    title="Wipes the ingest log and re-processes all S3 files"
                                >
                                    <RefreshCw size={11} /> Force Resync
                                </button>
                            </div>
                        )}
                        {syncing && syncSource === 's3' && (
                            <div style={{ fontSize: 12, color: 'var(--sp-txm)', fontStyle: 'italic' }}>S3 sync running — see progress above</div>
                        )}
                    </div>

                    {/* Non-syncing idle error when collapsed */}
                    {!syncing && syncCollapsed && syncError && syncSource === 's3' && (
                        <div className={sp.alertError} style={{ marginBottom: 12, whiteSpace: 'pre-wrap' }}>
                            <AlertCircle size={11} /> {syncError}
                        </div>
                    )}

                    {/* S3 ingestion log */}
                    <IngestionLogCard entries={s3Log} errorEntries={s3LogErrors} visibleEntries={s3LogVisible} />
                </>
            )}

            {/* ════════════════════════════════════════════════════
                TAB: ATHENA
            ════════════════════════════════════════════════════ */}
            {activeTab === 'athena' && (
                <>
                    {/* Tab subheader */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
                        <div>
                            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--sp-tx1)' }}>Upload Athena CSV</div>
                            <div className={sp.panelSubtitle}>Export from Athena console · upload here · merged into DynamoDB without overwriting S3 fields</div>
                        </div>
                        {syncing && syncSource === 'athena' ? (
                            <button className={sp.btnSecondary} onClick={abortSync} style={{ flexShrink: 0 }}>
                                <XCircle size={12} /> Abort
                            </button>
                        ) : (
                            <button
                                className={sp.btnSecondary}
                                onClick={() => void startSync(false, 'athena')}
                                disabled={syncing}
                                style={{ flexShrink: 0 }}
                                title="Run a live SQL query against Athena and write results to DynamoDB"
                            >
                                <Database size={12} /> Athena Sync
                            </button>
                        )}
                    </div>

                    {/* Sync progress (Athena) */}
                    {showAthenaSyncPanel && <SyncProgressCard />}

                    {/* Drop zone — hidden once file selected or uploading */}
                    {!uploadFile && !uploading && !uploadResult && (
                        <div
                            className={`${sp.uploadZone} ${dragging ? sp.uploadZoneActive : ''}`}
                            onDragOver={(e: React.DragEvent) => { e.preventDefault(); setDragging(true); }}
                            onDragLeave={() => setDragging(false)}
                            onDrop={(e: React.DragEvent) => {
                                e.preventDefault();
                                setDragging(false);
                                const f: File | undefined = e.dataTransfer.files[0];
                                if (f) { setUploadFile(f); setUploadResult(null); setUploadError(null); }
                            }}
                            onClick={() => uploadInputRef.current?.click()}
                        >
                            <div className={sp.uploadIcon}><Upload size={32} /></div>
                            <div className={sp.uploadTitle}>Drop file here or click to browse</div>
                            <div className={sp.uploadSub}>Supports .csv</div>
                            <input
                                ref={uploadInputRef}
                                type="file"
                                accept=".csv,text/csv"
                                style={{ display: 'none' }}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                    const f: File | undefined = e.target.files?.[0];
                                    if (f) { setUploadFile(f); setUploadResult(null); setUploadError(null); }
                                }}
                            />
                        </div>
                    )}

                    {/* Selected file row — shown before upload starts */}
                    {uploadFile && !uploading && !uploadResult && (
                        <div className={sp.fileList}>
                            <div className={sp.fileRow}>
                                <FileText size={15} style={{ color: 'var(--sp-txm)', flexShrink: 0 }} />
                                <span className={sp.fileName}>{uploadFile.name}</span>
                                <span className={sp.fileSize}>{(uploadFile.size / 1024).toFixed(1)} KB</span>
                                <button
                                    className={`${sp.btn} ${sp.btnPrimary}`}
                                    onClick={() => void uploadAthenaCSV()}
                                >
                                    Upload
                                </button>
                                <button
                                    className={sp.btnSecondary}
                                    onClick={() => { setUploadFile(null); if (uploadInputRef.current) uploadInputRef.current.value = ''; }}
                                    style={{ marginLeft: 4 }}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Upload in-progress with live progress bar */}
                    {uploading && (
                        <div className={sp.card} style={{ marginTop: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                <span className={sp.cardLabel} style={{ margin: 0 }}>
                                    <RefreshCw size={12} className={sp.spin} />
                                    {uploadProgress?.phase === 'aggregating' ? 'Rebuilding stats…' : 'Uploading rows…'}
                                    {uploadProgress && (
                                        <span style={{ marginLeft: 8, fontFamily: 'var(--mono)', fontWeight: 400, color: 'var(--sp-txm)' }}>
                                            {uploadProgress.newRows} new · {uploadProgress.skipped} skipped
                                            {uploadProgress.errors > 0 && <span style={{ color: 'var(--red)' }}> · {uploadProgress.errors} errors</span>}
                                        </span>
                                    )}
                                </span>
                                {uploadProgress && (
                                    <span style={{ fontSize: 11, color: 'var(--sp-txm)', fontFamily: 'var(--mono)' }}>
                                        {uploadProgress.processed.toLocaleString()} / {uploadProgress.total.toLocaleString()}
                                    </span>
                                )}
                            </div>
                            <div style={{ height: 4, background: 'var(--sp-s3)', borderRadius: 2, overflow: 'hidden' }}>
                                <div style={{
                                    height: '100%',
                                    width: uploadProgress && uploadProgress.total > 0
                                        ? `${Math.round((uploadProgress.processed / uploadProgress.total) * 100)}%`
                                        : '5%',
                                    background: 'var(--sp-accent)',
                                    borderRadius: 2,
                                    transition: 'width 0.4s ease',
                                }} />
                            </div>
                        </div>
                    )}

                    {/* Upload result */}
                    {uploadResult && (
                        <div
                            className={uploadResult.errors && uploadResult.errors > 0 ? sp.alertError : sp.alertSuccess}
                            style={{ marginTop: 12 }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, marginBottom: 4 }}>
                                {uploadResult.errors && uploadResult.errors > 0
                                    ? <AlertCircle size={13} />
                                    : <CheckCircle size={13} />}
                                {uploadResult.errors && uploadResult.errors > 0 ? 'Upload completed with errors' : 'Upload complete'}
                            </div>
                            <div style={{ fontSize: 12 }}>{uploadResult.message}</div>
                            {uploadResult.warnings && uploadResult.warnings.length > 0 && (
                                <div style={{ marginTop: 6 }}>
                                    {uploadResult.warnings.map((w: string, i: number) => (
                                        <div key={i} style={{ fontSize: 11, color: 'var(--sp-txm)', fontFamily: 'var(--mono)', marginTop: 2 }}>⚠ {w}</div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Upload error */}
                    {uploadError && (
                        <div className={sp.alertError} style={{ marginTop: 12 }}>
                            <AlertCircle size={12} /> {uploadError}
                        </div>
                    )}

                    {/* Non-syncing idle error when collapsed */}
                    {!syncing && syncCollapsed && syncError && syncSource === 'athena' && (
                        <div className={sp.alertError} style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>
                            <AlertCircle size={11} /> {syncError}
                        </div>
                    )}

                    {/* Instructions — hidden while file is selected, uploading, or result shown */}
                    {!uploadFile && !uploading && !uploadResult && (
                        <div className={sp.card} style={{ marginTop: 20 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>📋 Instructions</div>
                            <ul style={{ fontSize: 12, color: 'var(--sp-tx2)', paddingLeft: 20, lineHeight: 1.6, margin: 0 }}>
                                <li>In the Athena console, run: <code style={{ fontSize: 11 }}>SELECT * FROM airo_builder_cln.airo_builder_feedback_cln</code></li>
                                <li>Download the result as CSV and upload it here</li>
                                <li>Supports the standard 17-column Athena export format</li>
                                <li>Rows are merged — existing S3 fields are never overwritten</li>
                                <li>Duplicate uploads are safe — rows are upserted by <code style={{ fontSize: 11 }}>feedback_id</code></li>
                                <li>Use <strong>Athena Sync</strong> (top-right) for a live query if Lake Formation access is available</li>
                            </ul>
                        </div>
                    )}

                    {/* Athena ingestion log */}
                    {athenaLog.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--sp-txm)', fontSize: 12 }}>
                            No Athena ingest history yet — upload a CSV or run Athena Sync.
                        </div>
                    )}
                    <IngestionLogCard entries={athenaLog} errorEntries={athenaLogErrors} visibleEntries={athenaLogVisible} />
                </>
            )}

            {/* ════════════════════════════════════════════════════
                TAB: BROWSE DATA
            ════════════════════════════════════════════════════ */}
            {activeTab === 'browse' && (
                <>
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
                                            <tr><td colSpan={colCount} style={{ textAlign: 'center', padding: 32 }}><WaveDots size={9} gap={6} /></td></tr>
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

            {/* ════════════════════════════════════════════════════
                TAB: S3 ↔ ATHENA COMPARE
            ════════════════════════════════════════════════════ */}
            {activeTab === 'compare' && coverage && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                    {/* Match summary */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                        {[
                            { label: 'Matched (Both)', value: coverage.bothRows, sub: 'S3 row found its Athena counterpart', color: 'var(--sp-enriched)' },
                            { label: 'S3 Only', value: coverage.s3OnlyRows, sub: 'in S3 raw table, no Athena row', color: 'var(--sp-row)' },
                            { label: 'Athena Only', value: coverage.athenaRows, sub: 'in Athena raw table, no S3 row', color: 'var(--sp-row)' },
                        ].map(({ label, value, sub, color }) => (
                            <div key={label} className={sp.card} style={{ padding: '12px 16px' }}>
                                <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                                    {value.toLocaleString()}
                                </div>
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sp-tx2)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                                <div style={{ fontSize: 11, color: 'var(--sp-txm)', marginTop: 2 }}>{sub}</div>
                            </div>
                        ))}
                    </div>

                    {/* Field schema diff */}
                    <div className={sp.card}>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Schema Comparison — fields per source</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            {/* S3 fields */}
                            <div>
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sp-row)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                                    S3 — 29 fields (superset)
                                </div>
                                {[
                                    { field: 'feedback_id', both: true },
                                    { field: 'env', both: true },
                                    { field: 'app_id', both: true },
                                    { field: 'customer_id', both: true },
                                    { field: 'feedback_utc_ts', both: true },
                                    { field: 'rating', both: true },
                                    { field: 'feedback_text', both: true },
                                    { field: 'consent_flag', both: true },
                                    { field: 'plan_type_name', both: true },
                                    { field: 'subscription_id', both: true },
                                    { field: 'subscription_status', both: true },
                                    { field: 'total_credit_cnt', both: true },
                                    { field: 'available_credit_cnt', both: true },
                                    { field: 'feedback_topic_list', both: true },
                                    { field: 'feedback_origin_name', both: true },
                                    { field: 'feedback_category', both: false },
                                    { field: 'app_publish_flag', both: true },
                                    { field: 'full_story_url', both: false },
                                    { field: 'shopper_id', both: false },
                                    { field: 'experiments_line', both: false },
                                    { field: 'publish_url', both: true },
                                    { field: 'cln_create_utc_ts', both: true },
                                    { field: 's3_url', both: false },
                                    { field: 'device_type', both: false },
                                    { field: 'browser_type', both: false },
                                    { field: 'page_url', both: false },
                                    { field: 'session_id', both: false },
                                    { field: 'app_name', both: false },
                                    { field: 'app_version', both: false },
                                ].map(({ field, both }) => (
                                    <div key={field} style={{
                                        display: 'flex', alignItems: 'center', gap: 6,
                                        padding: '2px 0', fontSize: 11,
                                        color: both ? 'var(--sp-tx1)' : 'var(--sp-enriched)',
                                        fontFamily: 'var(--mono)',
                                    }}>
                                        <span style={{ opacity: 0.4, fontSize: 10 }}>{both ? '●' : '★'}</span>
                                        {field}
                                        {!both && <span style={{ fontSize: 9, fontFamily: 'system-ui', color: 'var(--sp-enriched)', opacity: 0.8 }}>S3 only</span>}
                                    </div>
                                ))}
                            </div>
                            {/* Athena fields */}
                            <div>
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sp-row)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                                    Athena — 18 fields (subset)
                                </div>
                                {[
                                    'feedback_id', 'env', 'app_id', 'customer_id', 'feedback_utc_ts',
                                    'rating', 'feedback_text', 'consent_flag', 'plan_type_name',
                                    'subscription_id', 'subscription_status', 'total_credit_cnt',
                                    'available_credit_cnt', 'feedback_topic_list', 'feedback_origin_name',
                                    'app_publish_flag', 'publish_url', 'cln_create_utc_ts',
                                ].map((field) => (
                                    <div key={field} style={{
                                        display: 'flex', alignItems: 'center', gap: 6,
                                        padding: '2px 0', fontSize: 11,
                                        color: 'var(--sp-tx1)',
                                        fontFamily: 'var(--mono)',
                                    }}>
                                        <span style={{ opacity: 0.4, fontSize: 10 }}>●</span>
                                        {field}
                                    </div>
                                ))}
                                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--sp-txm)', fontStyle: 'italic' }}>
                                    11 fields absent: feedback_category, full_story_url, shopper_id, experiments_line, s3_url, device_type, browser_type, page_url, session_id, app_name, app_version
                                </div>
                            </div>
                        </div>
                        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--sp-txm)', borderTop: '1px solid var(--sp-border)', paddingTop: 8 }}>
                            <strong style={{ color: 'var(--sp-tx2)' }}>Merge rule:</strong> S3 is authoritative — Athena is used as base, then all non-null S3 fields overwrite it. S3 has 29 fields (superset) vs Athena 18; S3 wins on every shared field. Athena fills rows absent from S3.
                        </div>
                    </div>

                    {/* Raw vs enriched counts */}
                    <div className={sp.card}>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Row counts across tables</div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--sp-border)' }}>
                                    {['Table', 'Total rows', 'Matched', 'Unmatched', 'Note'].map(h => (
                                        <th key={h} style={{ textAlign: 'left', padding: '4px 8px', fontSize: 10, fontWeight: 600, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                <tr style={{ borderBottom: '1px solid var(--sp-border)' }}>
                                    <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)', fontSize: 11 }}>raw-s3</td>
                                    <td style={{ padding: '6px 8px', fontWeight: 600 }}>{coverage.rawS3Total.toLocaleString()}</td>
                                    <td style={{ padding: '6px 8px', color: 'var(--sp-enriched)' }}>{coverage.bothRows.toLocaleString()}</td>
                                    <td style={{ padding: '6px 8px', color: coverage.s3OnlyRows > 0 ? 'var(--sp-warning)' : 'var(--sp-txm)' }}>{coverage.s3OnlyRows.toLocaleString()}</td>
                                    <td style={{ padding: '6px 8px', fontSize: 11, color: 'var(--sp-txm)' }}>deduplicated by enrich_key</td>
                                </tr>
                                <tr style={{ borderBottom: '1px solid var(--sp-border)' }}>
                                    <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)', fontSize: 11 }}>raw-athena</td>
                                    <td style={{ padding: '6px 8px', fontWeight: 600 }}>{coverage.rawAthenaTotal.toLocaleString()}</td>
                                    <td style={{ padding: '6px 8px', color: 'var(--sp-enriched)' }}>{coverage.bothRows.toLocaleString()}</td>
                                    <td style={{ padding: '6px 8px', color: coverage.athenaRows > 0 ? 'var(--sp-warning)' : 'var(--sp-txm)' }}>{coverage.athenaRows.toLocaleString()}</td>
                                    <td style={{ padding: '6px 8px', fontSize: 11, color: 'var(--sp-txm)' }}>18 fields, older legacy rows</td>
                                </tr>
                                <tr>
                                    <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)', fontSize: 11 }}>enriched</td>
                                    <td style={{ padding: '6px 8px', fontWeight: 600, color: 'var(--sp-enriched)' }}>{coverage.totalRows.toLocaleString()}</td>
                                    <td style={{ padding: '6px 8px', color: 'var(--sp-txm)' }}>—</td>
                                    <td style={{ padding: '6px 8px', color: 'var(--sp-txm)' }}>—</td>
                                    <td style={{ padding: '6px 8px', fontSize: 11, color: 'var(--sp-txm)' }}>FEEDBACK_START_DATE onward · S3 wins on overlap</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
