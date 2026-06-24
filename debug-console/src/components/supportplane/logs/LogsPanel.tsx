'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Download, RefreshCw, ScrollText, Trash2 } from 'lucide-react';
import sp from '@/components/supportplane/sp.module.css';

// ── Types ──────────────────────────────────────────────────────────

interface SpLogEntry {
    id: number;
    ts: number;
    level: number;
    levelName: string;
    source: string;
    message: string;
    context?: Record<string, unknown>;
    exception?: string;
}

interface LogsApiResponse {
    entries: SpLogEntry[];
    total: number;
    facets: Record<string, number>;
    activeMask: number;
}

// ── Constants ──────────────────────────────────────────────────────

const LEVELS = [
    { name: 'FATAL',   bit: 1,  color: '#ef4444' },
    { name: 'ERROR',   bit: 2,  color: '#f87171' },
    { name: 'WARN',    bit: 4,  color: '#f59e0b' },
    { name: 'INFO',    bit: 8,  color: '#0891b2' },
    { name: 'DEBUG',   bit: 16, color: '#10b981' },
    { name: 'TRACE',   bit: 32, color: '#7c3aed' },
    { name: 'VERBOSE', bit: 64, color: '#94a3b8' },
] as const;

const DISPLAY_PRESETS = [
    { label: 'Errors', mask: 3   },
    { label: '+Warn',  mask: 7   },
    { label: '+Info',  mask: 15  },
    { label: 'Std',    mask: 31  },
    { label: 'Dev',    mask: 63  },
    { label: 'All',    mask: 127 },
];

const TIME_WINDOWS = [
    { label: '5m',  value: 5   },
    { label: '15m', value: 15  },
    { label: '30m', value: 30  },
    { label: '1h',  value: 60  },
    { label: '3h',  value: 180 },
    { label: 'All', value: 0   },
];

const REFRESH_OPTIONS = [
    { label: 'Off', value: 0  },
    { label: '5s',  value: 5  },
    { label: '15s', value: 15 },
    { label: '30s', value: 30 },
];

const SERVER_PRESETS = [
    { label: 'Errors (3)',  mask: 3   },
    { label: '+Warn (7)',   mask: 7   },
    { label: '+Info (15)', mask: 15  },
    { label: 'Std (31)',   mask: 31  },
    { label: 'Dev (63)',   mask: 63  },
    { label: 'All (127)', mask: 127 },
];

// ── Helpers ────────────────────────────────────────────────────────

function fmtTs(ts: number): string {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${d.toLocaleDateString()} ${hh}:${mm}:${ss}.${ms}`;
}

function levelColor(name: string): string {
    return LEVELS.find(l => l.name === name)?.color ?? '#94a3b8';
}

// ── Sub-components ─────────────────────────────────────────────────

function ToolbarBtn({ active, onClick, children }: {
    active?: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            style={{
                padding: '3px 9px',
                fontSize: 11,
                borderRadius: 4,
                border: `1px solid ${active ? 'var(--sp-accent)' : 'var(--sp-border)'}`,
                background: active ? 'var(--sp-accent-dim)' : 'transparent',
                color: active ? 'var(--sp-accent)' : 'var(--sp-tx2)',
                cursor: 'pointer',
                whiteSpace: 'nowrap' as const,
                lineHeight: 1.5,
            }}
        >
            {children}
        </button>
    );
}

function Divider() {
    return <div style={{ width: 1, height: 16, background: 'var(--sp-border)', flexShrink: 0 }} />;
}

// ── Main component ─────────────────────────────────────────────────

export default function LogsPanel() {
    const [allEntries, setAllEntries]   = useState<SpLogEntry[]>([]);
    const [facets, setFacets]           = useState<Record<string, number>>({});
    const [serverMask, setServerMask]   = useState(31);
    const [displayMask, setDisplayMask] = useState(127);
    const [sinceMin, setSinceMin]       = useState(0);
    const [search, setSearch]           = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [refreshSec, setRefreshSec]   = useState(0);
    const [loading, setLoading]         = useState(false);
    const [expandedId, setExpandedId]   = useState<number | null>(null);

    const searchTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
    const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    // Debounce search input → search state
    useEffect(() => {
        if (searchTimer.current) clearTimeout(searchTimer.current);
        searchTimer.current = setTimeout(() => setSearch(searchInput), 300);
        return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
    }, [searchInput]);

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                mask: '127',    // always fetch all levels; filter client-side for instant UX
                limit: '500',
                since: String(sinceMin),
            });
            const res = await fetch(`/api/supportplane/logs?${params}`);
            if (!res.ok) return;
            const data = await res.json() as LogsApiResponse;
            setAllEntries(data.entries);
            setFacets(data.facets);
            setServerMask(data.activeMask);
        } finally {
            setLoading(false);
        }
    }, [sinceMin]);

    useEffect(() => { void fetchLogs(); }, [fetchLogs]);

    // Auto-refresh
    useEffect(() => {
        if (refreshTimer.current) clearInterval(refreshTimer.current);
        if (refreshSec > 0) {
            refreshTimer.current = setInterval(() => void fetchLogs(), refreshSec * 1_000);
        }
        return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
    }, [refreshSec, fetchLogs]);

    // Client-side filter: level mask + search
    const entries = useMemo(() => {
        const q = search.toLowerCase();
        return allEntries.filter(e => {
            if (!(e.level & displayMask)) return false;
            if (q && !e.message.toLowerCase().includes(q) && !e.source.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [allEntries, displayMask, search]);

    const toggleLevel = (bit: number): void => setDisplayMask(m => m ^ bit);

    const patchServerMask = async (mask: number): Promise<void> => {
        await fetch('/api/supportplane/logs', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mask }),
        });
        setServerMask(mask);
        void fetchLogs();
    };

    const clearLogs = async (): Promise<void> => {
        await fetch('/api/supportplane/logs', { method: 'DELETE' });
        void fetchLogs();
    };

    const downloadLogs = (): void => {
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const payload = entries.map(e => ({
            ts: new Date(e.ts).toISOString(),
            level: e.levelName,
            source: e.source,
            message: e.message,
            ...(e.context ? { context: e.context } : {}),
            ...(e.exception ? { exception: e.exception } : {}),
        }));
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sp-logs-${ts}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className={sp.panelRoot}>

            {/* ── Header ─────────────────────────────────────────── */}
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>
                        <ScrollText size={17} style={{ color: 'var(--sp-accent)', flexShrink: 0 }} />
                        App Logs
                    </div>
                    <div className={sp.panelSub}>
                        In-process ring buffer · 3,000 entries · cleared on server restart
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--sp-txm)' }}>Auto-refresh:</span>
                    {REFRESH_OPTIONS.map(r => (
                        <ToolbarBtn key={r.value} active={refreshSec === r.value} onClick={() => setRefreshSec(r.value)}>
                            {r.label}
                        </ToolbarBtn>
                    ))}
                    <button
                        onClick={() => void fetchLogs()}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '4px 10px', fontSize: 11, borderRadius: 4,
                            border: '1px solid var(--sp-border)', background: 'transparent',
                            color: 'var(--sp-tx2)', cursor: 'pointer',
                        }}
                    >
                        <RefreshCw
                            size={12}
                            style={{ animation: loading ? 'sp-spin 0.8s linear infinite' : 'none' }}
                        />
                        Refresh
                    </button>
                </div>
            </div>

            {/* ── Toolbar ────────────────────────────────────────── */}
            <div className={sp.card} style={{ padding: '12px 14px', marginBottom: 14 }}>

                {/* Row 1 — level checkboxes */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
                    <span style={{ fontSize: 11, color: 'var(--sp-txm)', fontWeight: 600, marginRight: 2 }}>DISPLAY</span>
                    {LEVELS.map(lv => {
                        const on = !!(displayMask & lv.bit);
                        const count = facets[lv.name];
                        return (
                            <label
                                key={lv.name}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 5,
                                    padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                                    border: `1px solid ${on ? `${lv.color}50` : 'var(--sp-border)'}`,
                                    background: on ? `${lv.color}14` : 'transparent',
                                    fontSize: 11, fontWeight: 700,
                                    color: on ? lv.color : 'var(--sp-txm)',
                                    userSelect: 'none',
                                    transition: 'all 0.1s',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={on}
                                    onChange={() => toggleLevel(lv.bit)}
                                    style={{ width: 11, height: 11, accentColor: lv.color, margin: 0 }}
                                />
                                {lv.name}
                                {count != null && count > 0 && (
                                    <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.7 }}>
                                        {count}
                                    </span>
                                )}
                            </label>
                        );
                    })}
                    <span style={{ fontSize: 10, color: 'var(--sp-txm)', marginLeft: 4 }}>
                        mask&nbsp;=&nbsp;{displayMask}
                    </span>
                </div>

                {/* Row 2 — presets + time + search + server controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: 'var(--sp-txm)', fontWeight: 600 }}>Preset:</span>
                    {DISPLAY_PRESETS.map(p => (
                        <ToolbarBtn key={p.mask} active={displayMask === p.mask} onClick={() => setDisplayMask(p.mask)}>
                            {p.label}
                        </ToolbarBtn>
                    ))}

                    <Divider />

                    <span style={{ fontSize: 11, color: 'var(--sp-txm)', fontWeight: 600 }}>Last:</span>
                    {TIME_WINDOWS.map(tw => (
                        <ToolbarBtn key={tw.value} active={sinceMin === tw.value} onClick={() => setSinceMin(tw.value)}>
                            {tw.label}
                        </ToolbarBtn>
                    ))}

                    <Divider />

                    <input
                        type="text"
                        placeholder="Search message / source…"
                        value={searchInput}
                        onChange={e => setSearchInput(e.target.value)}
                        style={{ width: 200 }}
                    />

                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, color: 'var(--sp-txm)', fontWeight: 600 }}>Server records:</span>
                        <select
                            value={serverMask}
                            onChange={e => void patchServerMask(Number(e.target.value))}
                            style={{ padding: '3px 6px', fontSize: 11, cursor: 'pointer' }}
                        >
                            {SERVER_PRESETS.map(p => (
                                <option key={p.mask} value={p.mask}>{p.label}</option>
                            ))}
                        </select>
                        <button
                            onClick={downloadLogs}
                            title={`Download ${entries.length} entries as JSON`}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 4,
                                padding: '4px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                                border: '1px solid var(--sp-border)', background: 'transparent',
                                color: 'var(--sp-tx2)',
                            }}
                        >
                            <Download size={11} />
                            Download
                        </button>
                        <button
                            onClick={() => void clearLogs()}
                            title="Clear ring buffer"
                            style={{
                                display: 'flex', alignItems: 'center', gap: 4,
                                padding: '4px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                                border: '1px solid var(--sp-danger)', background: 'transparent',
                                color: 'var(--sp-danger)',
                            }}
                        >
                            <Trash2 size={11} />
                            Clear
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Log table ──────────────────────────────────────── */}
            <div className={sp.card} style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
                {entries.length === 0 ? (
                    <div style={{
                        padding: '48px 24px', textAlign: 'center',
                        color: 'var(--sp-txm)', fontSize: 13,
                    }}>
                        {loading ? 'Loading…' : 'No log entries match the current filters.'}
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            fontSize: 11.5,
                        }}>
                            <thead>
                                <tr style={{ background: 'var(--sp-s2)', borderBottom: '1px solid var(--sp-border)' }}>
                                    <th style={{ width: 18, padding: '7px 6px' }} />
                                    <th style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--sp-tx2)', whiteSpace: 'nowrap' }}>Timestamp</th>
                                    <th style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--sp-tx2)', width: 76 }}>Level</th>
                                    <th style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--sp-tx2)', width: 150 }}>Source</th>
                                    <th style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--sp-tx2)' }}>Message</th>
                                </tr>
                            </thead>
                            <tbody>
                                {entries.map(entry => {
                                    const isExpanded = expandedId === entry.id;
                                    const hasDetail = !!(entry.context || entry.exception);
                                    const clr = levelColor(entry.levelName);
                                    return (
                                        <React.Fragment key={entry.id}>
                                            <tr
                                                onClick={() => hasDetail && setExpandedId(isExpanded ? null : entry.id)}
                                                style={{
                                                    borderBottom: '1px solid var(--sp-border)',
                                                    cursor: hasDetail ? 'pointer' : 'default',
                                                    background: isExpanded ? 'var(--sp-s2)' : undefined,
                                                    transition: 'background 0.1s',
                                                }}
                                                onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--sp-s2)'; }}
                                                onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = isExpanded ? 'var(--sp-s2)' : ''; }}
                                            >
                                                <td style={{ padding: '5px 4px 5px 10px', color: 'var(--sp-txm)', verticalAlign: 'top' }}>
                                                    {hasDetail && (
                                                        isExpanded
                                                            ? <ChevronDown size={12} />
                                                            : <ChevronRight size={12} />
                                                    )}
                                                </td>
                                                <td style={{
                                                    padding: '5px 12px',
                                                    fontFamily: 'var(--mono)',
                                                    fontSize: 11,
                                                    color: 'var(--sp-txm)',
                                                    whiteSpace: 'nowrap',
                                                    verticalAlign: 'top',
                                                }}>
                                                    {fmtTs(entry.ts)}
                                                </td>
                                                <td style={{ padding: '5px 12px', verticalAlign: 'top' }}>
                                                    <span style={{
                                                        display: 'inline-block',
                                                        padding: '2px 6px',
                                                        borderRadius: 4,
                                                        fontSize: 10,
                                                        fontWeight: 700,
                                                        letterSpacing: '0.04em',
                                                        background: `${clr}18`,
                                                        color: clr,
                                                        border: `1px solid ${clr}35`,
                                                    }}>
                                                        {entry.levelName}
                                                    </span>
                                                </td>
                                                <td style={{
                                                    padding: '5px 12px',
                                                    fontFamily: 'var(--mono)',
                                                    fontSize: 11,
                                                    color: 'var(--sp-accent)',
                                                    verticalAlign: 'top',
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    maxWidth: 150,
                                                }}>
                                                    {entry.source}
                                                </td>
                                                <td style={{
                                                    padding: '5px 12px',
                                                    fontFamily: 'var(--mono)',
                                                    fontSize: 11,
                                                    color: 'var(--sp-tx1)',
                                                    verticalAlign: 'top',
                                                    wordBreak: 'break-word',
                                                    maxWidth: 680,
                                                }}>
                                                    {entry.message}
                                                </td>
                                            </tr>
                                            {isExpanded && (
                                                <tr style={{
                                                    background: 'var(--sp-s2)',
                                                    borderBottom: '1px solid var(--sp-border)',
                                                }}>
                                                    <td colSpan={5} style={{ padding: '8px 16px 14px 40px' }}>
                                                        {entry.context && (
                                                            <div style={{ marginBottom: entry.exception ? 10 : 0 }}>
                                                                <div style={{
                                                                    fontSize: 10, fontWeight: 700,
                                                                    color: 'var(--sp-txm)',
                                                                    marginBottom: 5,
                                                                    letterSpacing: '0.06em',
                                                                }}>
                                                                    CONTEXT
                                                                </div>
                                                                <pre style={{
                                                                    margin: 0,
                                                                    padding: '8px 12px',
                                                                    borderRadius: 6,
                                                                    background: 'var(--sp-s3)',
                                                                    color: 'var(--sp-tx2)',
                                                                    fontFamily: 'var(--mono)',
                                                                    fontSize: 11,
                                                                    overflow: 'auto',
                                                                    maxHeight: 200,
                                                                    border: '1px solid var(--sp-border)',
                                                                }}>
                                                                    {JSON.stringify(entry.context, null, 2)}
                                                                </pre>
                                                            </div>
                                                        )}
                                                        {entry.exception && (
                                                            <div>
                                                                <div style={{
                                                                    fontSize: 10, fontWeight: 700,
                                                                    color: '#ef4444',
                                                                    marginBottom: 5,
                                                                    letterSpacing: '0.06em',
                                                                }}>
                                                                    EXCEPTION
                                                                </div>
                                                                <pre style={{
                                                                    margin: 0,
                                                                    padding: '8px 12px',
                                                                    borderRadius: 6,
                                                                    background: '#ef444412',
                                                                    color: '#ef4444',
                                                                    fontFamily: 'var(--mono)',
                                                                    fontSize: 11,
                                                                    overflow: 'auto',
                                                                    maxHeight: 200,
                                                                    border: '1px solid #ef444430',
                                                                }}>
                                                                    {entry.exception}
                                                                </pre>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ── Footer ─────────────────────────────────────────── */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                fontSize: 11,
                color: 'var(--sp-txm)',
                padding: '0 4px',
                flexWrap: 'wrap',
            }}>
                <span>
                    Showing {entries.length.toLocaleString()} of {allEntries.length.toLocaleString()}
                    {allEntries.length === 500 && ' (limit 500 — narrow the time window to see more)'}
                </span>
                {LEVELS.some(lv => facets[lv.name]) && (
                    <>
                        <Divider />
                        {LEVELS.map(lv => {
                            const count = facets[lv.name];
                            if (!count) return null;
                            return (
                                <span key={lv.name} style={{ color: lv.color, fontWeight: 600 }}>
                                    {lv.name} {count}
                                </span>
                            );
                        })}
                    </>
                )}
            </div>
        </div>
    );
}
