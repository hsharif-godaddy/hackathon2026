'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import sp from '@/components/supportplane/sp.module.css';

// ── Types ─────────────────────────────────────────────────────────────────────

interface C1EventRow {
  ts: string;
  event_type: string;
  eid: string;
  element_product: string;
  session_id: string;
  visitor_id: string;
  app_id: string;
}

interface C1EventsData {
  configMissing: boolean;
  events: C1EventRow[];
  total: number;
  productCounts: Record<string, number>;
}

interface Props {
  onSelectApp?: (appId: string) => void;
}

const PAGE_SIZE = 10;

// ── Fixed tab definitions ─────────────────────────────────────────────────────

const FIXED_TABS: Array<{ key: string; label: string }> = [
  { key: 'all',      label: 'All'      },
  { key: 'website',  label: 'Website'  },
  { key: 'feedback', label: 'Feedback' },
  { key: 'revenue',  label: 'Revenue'  },
  { key: 'logo',     label: 'Logo'     },
  { key: 'domain',   label: 'Domain'   },
  { key: 'seo',      label: 'SEO'      },
];

function groupCount(counts: Record<string, number>, key: string): number {
  if (key === 'all') return Object.values(counts).reduce((s, v) => s + v, 0);
  return counts[key] ?? 0;
}

// ── Colors ────────────────────────────────────────────────────────────────────

const TAB_COLOR: Record<string, string> = {
  all:      '#6b7280',
  website:  '#6366f1',
  logo:     '#ec4899',
  domain:   '#0d9488',
  revenue:  '#dc2626',
  feedback: '#7c3aed',
  seo:      '#059669',
};

const PRODUCT_COLOR: Record<string, string> = {
  homepage:    '#6366f1',
  develop:     '#6366f1',
  app:         '#6366f1',
  chat:        '#6366f1',
  auth:        '#6366f1',
  publish:     '#6366f1',
  settings:    '#6366f1',
  logo:        '#ec4899',
  domain:      '#0d9488',
  plan:        '#dc2626',
  usage_gauge: '#dc2626',
  feedback:    '#7c3aed',
  seo:         '#059669',
};

function tabColor(key: string): string {
  return TAB_COLOR[key] ?? '#6366f1';
}

function productColor(product: string): string {
  return PRODUCT_COLOR[(product ?? '').toLowerCase()] ?? '#6366f1';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function shortEid(eid: string): string {
  const parts = eid.split('.');
  if (parts[0] === 'appbuilder' && parts.length > 2) return parts.slice(2).join('.');
  return eid;
}

function formatTime(iso: string): { time: string; date: string } {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { time: iso, date: '' };
  return {
    time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
    date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  };
}

function eidParts(eid: string): { product: string; section: string; widget: string; action: string } {
  const parts = eid.split('.');
  return {
    product: parts[1] ?? '',
    section: parts[2] ?? '',
    widget:  parts[3] ?? '',
    action:  parts[4] ?? (parts.length === 4 ? parts[3] : ''),
  };
}

function exportCsv(events: C1EventRow[]): void {
  const header = 'timestamp,eid,element_product,section,widget,event_type,app_id,session_id,visitor_id';
  const rows = events.map((e) => {
    const p = eidParts(e.eid);
    return [e.ts, e.eid, e.element_product, p.section, p.widget, e.event_type, e.app_id, e.session_id, e.visitor_id]
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
      .join(',');
  });
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'c1-live-events.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ── Expanded detail panel ─────────────────────────────────────────────────────

function EventDetail({ ev }: { ev: C1EventRow }) {
  const p = eidParts(ev.eid);
  const fields: Array<[string, string, boolean?]> = [
    ['Full EID',   ev.eid,                                    true],
    ['Product',    p.product  || ev.element_product || '—',  false],
    ['Section',    p.section  || '—',                         false],
    ['Widget',     p.widget   || '—',                         false],
    ['Event Type', ev.event_type || '—',                      false],
    ['App ID',     ev.app_id  || '—',                         true],
    ['Session ID', ev.session_id || '—',                      true],
    ['Visitor ID', ev.visitor_id || '—',                      true],
    ['Timestamp',  ev.ts,                                      true],
  ];
  return (
    <div style={{
      padding: '0.65rem 1rem 0.65rem 2rem',
      background: 'var(--sp-accent-dim)',
      borderBottom: '1px solid var(--sp-border)',
      display: 'flex', flexWrap: 'wrap', gap: '0.75rem 1.5rem',
    }}>
      {fields.map(([label, value, mono]) => (
        <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '0.58rem', color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{label}</span>
          <span style={{ fontSize: '0.7rem', color: 'var(--sp-tx1)', fontWeight: 500, wordBreak: 'break-all', maxWidth: '260px', fontFamily: mono ? 'monospace' : undefined }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function C1LiveFeed({ onSelectApp }: Props) {
  const [data,        setData]        = useState<C1EventsData | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [activeTab,   setActiveTab]   = useState<string>('all');
  const [page,        setPage]        = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search,      setSearch]      = useState('');
  const [refreshKey,  setRefreshKey]  = useState(0);
  const [expanded,    setExpanded]    = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => { setSearch(searchInput); setPage(0); }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback((): (() => void) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const params = new URLSearchParams({ action: 'c1-events' });
    params.set('product', activeTab);
    if (search) params.set('search', search);
    params.set('page', String(page));
    if (refreshKey > 0) params.set('bust', '1');

    setLoading(true);
    setError(null);
    setExpanded(null);

    const timerId = setTimeout(() => {
      fetch(`/api/analytics/scorecard?${params}`, { signal: ctrl.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          setData(await res.json() as C1EventsData);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if ((err as { name?: string }).name === 'AbortError') { setLoading(false); return; }
          setError(err instanceof Error ? err.message : 'Failed to load');
          setLoading(false);
        });
    }, 0);

    return () => { clearTimeout(timerId); ctrl.abort(); };
  }, [activeTab, page, search, refreshKey]);

  useEffect(() => load(), [load]);

  const tabs: Array<{ key: string; label: string; count: number }> = useMemo(() => {
    const counts = data?.productCounts ?? {};
    return FIXED_TABS.map((tab) => ({ ...tab, count: groupCount(counts, tab.key) }));
  }, [data]);

  const total: number        = data?.total ?? 0;
  const totalPages: number   = Math.ceil(total / PAGE_SIZE);
  const events: C1EventRow[] = data?.events ?? [];

  const handleTabChange = (key: string): void => { setActiveTab(key); setPage(0); };
  const handleRefresh   = (): void => { setPage(0); setRefreshKey((k) => k + 1); };

  const colTemplate = '110px 1fr 100px 100px 24px';

  const headerCell: React.CSSProperties = {
    fontSize: '0.6rem', fontWeight: 700, color: 'var(--sp-tx2)',
    textTransform: 'uppercase', letterSpacing: '0.05em',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>

      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.1rem' }}>
        <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Live Event Feed
        </span>
        <span style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)' }}>
          C1 ClickHouse · Most recent analytics events · last 24h
        </span>
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {tabs.map((tab) => {
          const isActive: boolean = activeTab === tab.key;
          const color: string     = tabColor(tab.key);
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleTabChange(tab.key)}
              style={{
                padding: '0.2rem 0.6rem',
                backgroundColor: isActive ? color : 'var(--sp-s2)',
                color: isActive ? '#fff' : color,
                border: `1px solid ${isActive ? color : `${color}55`}`,
                borderRadius: '5px', cursor: 'pointer',
                fontSize: '0.65rem', fontWeight: isActive ? 600 : 500,
                display: 'flex', alignItems: 'center', gap: '0.3rem',
                transition: 'all 0.12s',
              }}
            >
              {tab.label}
              <span style={{
                fontSize: '0.58rem', fontWeight: 700,
                background: isActive ? 'rgba(255,255,255,0.25)' : `${color}20`,
                color: isActive ? '#fff' : color,
                borderRadius: '8px', padding: '0.02rem 0.3rem',
              }}>
                {tab.count.toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>

      {/* Config missing */}
      {data?.configMissing && (
        <div className={sp.alertInfo}>
          ClickHouse not configured — set <code style={{ fontFamily: 'monospace' }}>CLICKHOUSE_HOST</code> and <code style={{ fontFamily: 'monospace' }}>CLICKHOUSE_USER</code>.
        </div>
      )}

      {/* Error */}
      {error && (
        <div className={sp.alertError}>
          Failed to load: {error}
        </div>
      )}

      {/* Table card */}
      {!data?.configMissing && (
        <div style={{ background: 'var(--sp-s1)', borderRadius: '10px', border: '1px solid var(--sp-border)', overflow: 'hidden' }}>

          {/* Search + count + buttons */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--sp-border)' }}>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search EID, app ID, session ID, visitor ID…"
              className={sp.searchInput}
              style={{ flex: 1, fontSize: '0.7rem' }}
            />
            {!loading && total > 0 && (
              <span style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
              </span>
            )}
            {events.length > 0 && (
              <button
                type="button"
                onClick={() => exportCsv(events)}
                className={sp.btnSecondary}
                style={{ padding: '0.28rem 0.55rem', fontSize: '0.62rem', whiteSpace: 'nowrap', flexShrink: 0 }}
              >↓ CSV</button>
            )}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className={sp.btnPrimary}
              style={{ padding: '0.28rem 0.55rem', fontSize: '0.62rem', whiteSpace: 'nowrap', flexShrink: 0, opacity: loading ? 0.5 : 1 }}
            >{loading ? '…' : '↺'}</button>
          </div>

          {/* Column header */}
          <div style={{ display: 'grid', gridTemplateColumns: colTemplate, padding: '0.38rem 0.75rem', background: 'var(--sp-s2)', borderBottom: '1px solid var(--sp-border)', gap: '0.5rem', alignItems: 'center' }}>
            <span style={headerCell}>Time</span>
            <span style={headerCell}>Event Name</span>
            <span style={headerCell}>App ID</span>
            <span style={headerCell}>Session</span>
            <span />
          </div>

          {/* Loading skeleton */}
          {loading && Array.from({ length: PAGE_SIZE }).map((_, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: colTemplate, gap: '0.5rem', padding: '0.45rem 0.75rem', borderBottom: '1px solid var(--sp-border)', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <div style={{ height: '10px', width: '72px', background: 'var(--sp-s3)', borderRadius: '3px', animation: 'pulse 1.5s ease-in-out infinite' }} />
                <div style={{ height: '9px', width: '44px', background: 'var(--sp-s3)', borderRadius: '3px', opacity: 0.7 }} />
              </div>
              <div style={{ height: '20px', width: '140px', background: 'var(--sp-s3)', borderRadius: '4px', animation: 'pulse 1.5s ease-in-out infinite' }} />
              <div style={{ height: '10px', width: '70px', background: 'var(--sp-s3)', borderRadius: '3px' }} />
              <div style={{ height: '10px', width: '60px', background: 'var(--sp-s3)', borderRadius: '3px' }} />
              <span />
            </div>
          ))}

          {/* Empty */}
          {!loading && events.length === 0 && (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--sp-tx2)', fontSize: '0.78rem' }}>
              {search ? `No events matching "${search}"` : 'No events in the last 24 hours.'}
            </div>
          )}

          {/* Rows */}
          {!loading && events.map((ev, idx) => {
            const rowKey: string     = `${ev.ts}_${ev.eid}_${ev.session_id}_${idx}`;
            const color: string      = productColor(ev.element_product?.toLowerCase() ?? '');
            const isExpanded: boolean = expanded === rowKey;
            const { time, date }    = formatTime(ev.ts);
            return (
              <React.Fragment key={rowKey}>
                <div
                  onClick={() => setExpanded(isExpanded ? null : rowKey)}
                  style={{
                    display: 'grid', gridTemplateColumns: colTemplate,
                    gap: '0.5rem', padding: '0.42rem 0.75rem',
                    borderBottom: isExpanded ? 'none' : '1px solid var(--sp-border)',
                    background: isExpanded ? 'var(--sp-accent-dim)' : 'var(--sp-s1)',
                    cursor: 'pointer', alignItems: 'center',
                    transition: 'background 0.1s',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                    <span style={{ fontSize: '0.68rem', fontFamily: 'monospace', color: 'var(--sp-tx1)', fontWeight: 500 }}>{time}</span>
                    <span style={{ fontSize: '0.6rem', color: 'var(--sp-tx2)' }}>{date}</span>
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 7px', borderRadius: '4px',
                      fontSize: '0.62rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em',
                      background: `${color}18`, color, border: `1px solid ${color}35`,
                      maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }} title={ev.eid}>
                      {shortEid(ev.eid)}
                    </span>
                  </div>

                  <div style={{ minWidth: 0 }} onClick={(e) => e.stopPropagation()}>
                    {ev.app_id ? (
                      <button
                        type="button"
                        onClick={() => onSelectApp?.(ev.app_id)}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--sp-accent)', fontSize: '0.68rem', fontFamily: 'monospace', textDecoration: 'underline', textDecorationColor: 'var(--sp-accent-ring)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '2px' }}
                        title={ev.app_id}
                      >
                        <span>{ev.app_id.slice(0, 10)}…</span>
                        <span style={{ fontSize: '0.55rem', opacity: 0.6 }}>↗</span>
                      </button>
                    ) : (
                      <span style={{ fontSize: '0.65rem', color: 'var(--sp-txm)' }}>—</span>
                    )}
                  </div>

                  <span style={{ fontFamily: 'monospace', fontSize: '0.65rem', color: 'var(--sp-tx2)' }} title={ev.session_id}>
                    {shortId(ev.session_id)}
                  </span>

                  <span style={{ fontSize: '0.6rem', color: 'var(--sp-txm)', textAlign: 'right' }}>
                    {isExpanded ? '▲' : '▼'}
                  </span>
                </div>

                {isExpanded && <EventDetail ev={ev} />}
              </React.Fragment>
            );
          })}

          {/* Pagination */}
          {!loading && totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 0.75rem', borderTop: '1px solid var(--sp-border)', background: 'var(--sp-s2)' }}>
              <span style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)' }}>
                Page {page + 1} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className={sp.btnSecondary}
                style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', opacity: page === 0 ? 0.4 : 1 }}
              >←</button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className={sp.btnSecondary}
                style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', opacity: page >= totalPages - 1 ? 0.4 : 1 }}
              >→</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
