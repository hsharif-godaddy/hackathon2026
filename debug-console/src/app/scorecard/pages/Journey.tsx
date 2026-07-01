'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import sp from '@/components/supportplane/sp.module.css';

import type { ScorecardS3FeedbackData } from '../hooks/useS3Feedback';
import type {
  JourneyEventCategory,
  JourneyListData,
  JourneySession,
  JourneySessionMeta,
} from '../types';
import { CARD, SessionTimeline } from '../components';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  initialAppId?: string;
  s3Feedback?: ScorecardS3FeedbackData | null;
}

type LookbackOption = { days: number; label: string };
const LOOKBACK_OPTIONS: readonly LookbackOption[] = [
  { days: 14,  label: '14d'    },
  { days: 30,  label: '30d'    },
  { days: 90,  label: '90d'    },
  { days: 180, label: '180d'   },
  { days: 365, label: '1 year' },
];

type OutcomeFilter    = 'all' | 'published' | 'abandoned' | 'in_progress';
type CategoryFilter   = 'all' | JourneyEventCategory;

const OUTCOME_LABELS: Record<OutcomeFilter, string> = {
  all: 'All', published: 'Published', abandoned: 'Abandoned', in_progress: 'In Progress',
};

const CATEGORY_LABELS: Record<CategoryFilter, string> = {
  all:             'All',
  navigation:      'Navigation',
  interaction:     'Interaction',
  error:           'Errors',
  feedback:        'Feedback',
  instrumentation: 'Instrumentation',
};

const CATEGORY_COLORS: Record<JourneyEventCategory, string> = {
  navigation:      '#6366f1',
  interaction:     '#0891b2',
  error:           '#ef4444',
  feedback:        '#10b981',
  instrumentation: '#d97706',
};

const OUTCOME_COLORS = {
  published:   { bg: 'rgba(16,185,129,0.12)',  text: '#10b981' },
  abandoned:   { bg: 'rgba(239,68,68,0.12)',   text: '#ef4444' },
  in_progress: { bg: 'rgba(245,158,11,0.12)',  text: '#f59e0b' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}
function fmtTime(iso: string): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}
function fmtDuration(ms: number): string {
  if (ms <= 0) return '—';
  return ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`;
}

// ── Session row (collapsed by default, events loaded on demand) ───────────────

interface SessionRowProps {
  meta:        JourneySessionMeta;
  index:       number;
  total:       number;
  loaded:      JourneySession | null;
  loading:     boolean;
  loadFailed:  boolean;
  expanded:    boolean;
  categoryFilter: CategoryFilter;
  appId:       string;
  onExpand:    () => void;
}

function SessionRow({ meta, index, total, loaded, loading, loadFailed, expanded, categoryFilter, appId, onExpand }: SessionRowProps) {
  const outcome    = loaded?.outcome ?? 'in_progress';
  const outColors  = OUTCOME_COLORS[outcome] ?? OUTCOME_COLORS.in_progress;

  const categoryCounts: Partial<Record<JourneyEventCategory, number>> = {};
  if (loaded) {
    for (const ev of loaded.events) {
      categoryCounts[ev.category] = (categoryCounts[ev.category] ?? 0) + 1;
    }
  }

  return (
    <div style={{ border: '1px solid var(--sp-border)', borderRadius: '10px', overflow: 'hidden', marginBottom: '0.5rem', background: 'var(--sp-s1)' }}>
      {/* Session header row */}
      <button
        type="button"
        onClick={onExpand}
        style={{
          width: '100%', textAlign: 'left', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.55rem 0.85rem', background: 'var(--sp-s2)',
          borderBottom: expanded ? '1px solid var(--sp-border)' : 'none',
          border: 'none', gap: '0.75rem', flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span style={{
            width: '22px', height: '22px', borderRadius: '50%', background: '#6366f1',
            color: 'white', fontSize: '0.6rem', fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            {total - index}
          </span>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--sp-tx1)' }}>
                {loaded ? `${fmtDate(loaded.startTime)} · ${fmtTime(loaded.startTime)}` : meta.startTime ? fmtDate(meta.startTime) : `Session ${total - index}`}
              </span>
              {loaded && (
                <span style={{ padding: '1px 8px', borderRadius: '12px', fontSize: '0.6rem', fontWeight: 600, background: outColors.bg, color: outColors.text }}>
                  {OUTCOME_LABELS[outcome] ?? outcome}
                </span>
              )}
              {loading && <span style={{ fontSize: '0.6rem', color: 'var(--sp-txm)', fontStyle: 'italic' }}>Loading events…</span>}
              {loadFailed && <span style={{ fontSize: '0.6rem', color: '#ef4444' }}>Failed to load</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '3px', flexWrap: 'wrap' }}>
              <code style={{
                fontSize: '0.58rem', fontFamily: 'monospace', fontWeight: 600,
                padding: '1px 7px', borderRadius: '5px',
                background: 'rgba(99,102,241,0.1)', color: '#818cf8',
                border: '1px solid rgba(99,102,241,0.25)',
                letterSpacing: '0.01em', userSelect: 'all',
              }}>
                {meta.sessionId}
              </code>
              {loaded && (
                <span style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)' }}>
                  {fmtDuration(loaded.durationMs)} · {loaded.events.length} events
                </span>
              )}
            </div>
            {/* Category breakdown chips */}
            {loaded && (
              <div style={{ display: 'flex', gap: '4px', marginTop: '3px', flexWrap: 'wrap' }}>
                {(Object.entries(categoryCounts) as Array<[JourneyEventCategory, number]>)
                  .sort(([, a], [, b]) => b - a)
                  .map(([cat, cnt]) => (
                    <span key={cat} style={{
                      padding: '1px 6px', borderRadius: '9px', fontSize: '0.55rem', fontWeight: 600,
                      background: `${CATEGORY_COLORS[cat]}20`, color: CATEGORY_COLORS[cat],
                      border: `1px solid ${CATEGORY_COLORS[cat]}40`,
                    }}>
                      {CATEGORY_LABELS[cat]} {cnt}
                    </span>
                  ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          {meta.fullstorySessionUrl && (
            <a
              href={meta.fullstorySessionUrl} target="_blank" rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ padding: '0.25rem 0.6rem', border: '1px solid var(--sp-border)', borderRadius: '6px', fontSize: '0.65rem', color: '#6366f1', textDecoration: 'none' }}
            >
              ▶ FullStory ↗
            </a>
          )}
          <span style={{ fontSize: '0.7rem', color: 'var(--sp-tx2)' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Expanded: show SessionTimeline — pass total=1 so it suppresses its own header (SessionRow owns it) */}
      {expanded && loaded && (
        <SessionTimeline
          session={loaded}
          index={0}
          total={1}
          appId={appId}
          categoryFilter={categoryFilter}
        />
      )}
      {expanded && !loaded && !loadFailed && (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--sp-tx2)', fontSize: '0.75rem' }}>
          {loading ? 'Loading session events…' : 'Click to load events'}
        </div>
      )}
      {expanded && loadFailed && (
        <div style={{ padding: '1rem', borderTop: '1px solid var(--sp-border)' }}>
          <p style={{ margin: 0, color: '#ef4444', fontSize: '0.75rem' }}>Failed to load events for this session. FullStory API may be rate-limiting.</p>
        </div>
      )}
    </div>
  );
}

// ── Summary stats bar ─────────────────────────────────────────────────────────

function StatPill({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ ...CARD, padding: '0.5rem 0.85rem', minWidth: '80px' }}>
      <div style={{ fontSize: '0.58rem', color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '1rem', fontWeight: 800, fontFamily: 'monospace', color: color ?? 'var(--sp-accent)', marginTop: '1px' }}>{value}</div>
    </div>
  );
}

// ── Main Journey ─────────────────────────────────────────────────────────────

export function Journey({ initialAppId = '', s3Feedback }: Props) {
  const [appIdInput,  setAppIdInput]  = useState(initialAppId);
  const [lookback,    setLookback]    = useState<number>(30);
  const [listData,        setListData]        = useState<JourneyListData | null>(null);
  const [listLoading,     setListLoading]     = useState(false);
  const [loadMoreLoading, setLoadMoreLoading] = useState(false);
  const [listError,       setListError]       = useState<string | null>(null);
  const [notFound,        setNotFound]        = useState(false);

  // Lazy event loading: keyed by sessionId
  const [loadedSessions, setLoadedSessions] = useState<Map<string, JourneySession>>(new Map());
  const [loadingIds,     setLoadingIds]     = useState<Set<string>>(new Set());
  const [failedIds,      setFailedIds]      = useState<Set<string>>(new Set());
  const [expandedIds,    setExpandedIds]    = useState<Set<string>>(new Set());

  // Filters
  const [outcomeFilter,  setOutcomeFilter]  = useState<OutcomeFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [searchText,     setSearchText]     = useState('');

  // ── Fetch session list ────────────────────────────────────────────────────

  // Stable ref so fetchSessions can call the latest loadSessionEvents without
  // being in its dependency array (avoids stale-closure / dep-loop issues).
  const loadSessionEventsRef = useRef<((meta: JourneySessionMeta) => Promise<void>) | undefined>(undefined);

  const fetchSessions = useCallback(async (id: string, days: number) => {
    const trimId = id.trim();
    if (!trimId) return;
    setListLoading(true);
    setListError(null);
    setNotFound(false);
    setListData(null);
    setLoadedSessions(new Map());
    setLoadingIds(new Set());
    setFailedIds(new Set());
    setExpandedIds(new Set());
    try {
      const params = new URLSearchParams({ action: 'journey-list', appId: trimId, lookbackDays: String(days) });
      const res = await fetch(`/api/analytics/scorecard?${params.toString()}`);
      if (res.status === 404) { setNotFound(true); return; }
      if (!res.ok) {
        const b = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as JourneyListData;
      setListData(data);
      // Auto-expand and eagerly load the 3 most recent sessions
      const firstThree = data.sessions.slice(0, 3);
      setExpandedIds(new Set(firstThree.map((s) => s.sessionId)));
      await Promise.allSettled(firstThree.map((s) => loadSessionEventsRef.current?.(s) ?? Promise.resolve()));
    } catch (err: unknown) {
      setListError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setListLoading(false);
    }
  }, []);

  // ── Load next page of sessions (pagination) ──────────────────────────────

  const loadMoreSessions = useCallback(async () => {
    if (!listData?.nextPageToken || !listData.segmentId) return;
    setLoadMoreLoading(true);
    try {
      const params = new URLSearchParams({
        action:      'journey-list',
        appId:       listData.appId,
        lookbackDays: String(listData.lookbackDays),
        pageToken:   listData.nextPageToken,
        segmentId:   listData.segmentId,
      });
      const res = await fetch(`/api/analytics/scorecard?${params.toString()}`);
      if (!res.ok) {
        const b = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      const page = await res.json() as JourneyListData;
      // Merge new sessions into existing listData, keeping pagination state current.
      setListData((prev) => prev ? {
        ...page,
        sessions: [...prev.sessions, ...page.sessions],
      } : page);
      // Auto-expand first 3 of the new batch and load their events.
      const firstThree = page.sessions.slice(0, 3);
      setExpandedIds((prev) => {
        const next = new Set(prev);
        firstThree.forEach((s) => next.add(s.sessionId));
        return next;
      });
      await Promise.allSettled(firstThree.map((s) => loadSessionEventsRef.current?.(s) ?? Promise.resolve()));
    } catch (err: unknown) {
      setListError(err instanceof Error ? err.message : 'Failed to load more sessions');
    } finally {
      setLoadMoreLoading(false);
    }
  }, [listData]);

  // ── Load events for a single session ─────────────────────────────────────

  const loadSessionEvents = useCallback(async (meta: JourneySessionMeta) => {
    if (loadedSessions.has(meta.sessionId) || loadingIds.has(meta.sessionId)) return;
    setLoadingIds((prev) => new Set(prev).add(meta.sessionId));
    try {
      const params = new URLSearchParams({
        action:    'journey-session',
        deviceId:  meta.deviceId,
        sessionId: meta.sessionId,
        ...(meta.fullstorySessionUrl ? { sessionUrl: meta.fullstorySessionUrl } : {}),
      });
      const res = await fetch(`/api/analytics/scorecard?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const session = await res.json() as JourneySession;
      setLoadedSessions((prev) => new Map(prev).set(meta.sessionId, session));
    } catch {
      setFailedIds((prev) => new Set(prev).add(meta.sessionId));
    } finally {
      setLoadingIds((prev) => { const n = new Set(prev); n.delete(meta.sessionId); return n; });
    }
  }, [loadedSessions, loadingIds]);

  useEffect(() => { loadSessionEventsRef.current = loadSessionEvents; }, [loadSessionEvents]);

  // ── Toggle session expansion ──────────────────────────────────────────────

  const toggleSession = useCallback((meta: JourneySessionMeta) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(meta.sessionId)) {
        next.delete(meta.sessionId);
      } else {
        next.add(meta.sessionId);
        void loadSessionEventsRef.current?.(meta);
      }
      return next;
    });
  }, []);

  // ── Seed from initialAppId prop ───────────────────────────────────────────

  useEffect(() => {
    if (initialAppId) {
      setAppIdInput(initialAppId);
      void fetchSessions(initialAppId, lookback);
    }
  }, [initialAppId]); // fetchSessions and lookback intentionally omitted: only fire when prop changes


  // ── Derived: filter session list ──────────────────────────────────────────

  const filteredSessions: JourneySessionMeta[] = (listData?.sessions ?? []).filter((meta) => {
    const loaded = loadedSessions.get(meta.sessionId);
    // Outcome filter only applies once the session is loaded
    if (outcomeFilter !== 'all' && loaded && loaded.outcome !== outcomeFilter) return false;
    // Text search on sessionId
    if (searchText && !meta.sessionId.toLowerCase().includes(searchText.toLowerCase())) return false;
    return true;
  });

  // ── Summary stats across all loaded sessions ──────────────────────────────

  const allLoadedSessions: JourneySession[] = Array.from(loadedSessions.values());
  const publishedCount = allLoadedSessions.filter((s) => s.outcome === 'published').length;
  const totalEvents    = allLoadedSessions.reduce((n, s) => n + s.events.length, 0);
  const instrEvents    = allLoadedSessions.reduce((n, s) => n + s.events.filter((e) => e.category === 'instrumentation').length, 0);
  const errorEvents    = allLoadedSessions.reduce((n, s) => n + s.events.filter((e) => e.category === 'error').length, 0);

  // ── S3 rating for this app ────────────────────────────────────────────────

  const appRating = listData
    ? s3Feedback?.perAppRatings?.find((r) => r.appId === listData.appId)
    : null;

  // ── Pill button style helper ──────────────────────────────────────────────

  const pillStyle = (active: boolean): React.CSSProperties => ({
    padding: '3px 10px', borderRadius: '6px', border: '1px solid transparent', cursor: 'pointer',
    fontSize: '11px', fontWeight: active ? 700 : 500,
    background: active ? 'var(--sp-accent)' : 'var(--sp-s3)',
    color: active ? '#fff' : 'var(--sp-tx2)',
    transition: 'background 0.12s, color 0.12s',
  });

  const ctrlLabel: React.CSSProperties = {
    fontSize: '9px', fontWeight: 700, color: 'var(--sp-txm)',
    textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap',
  };

  const ctrlGroup: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '4px',
    background: 'var(--sp-s1)', border: '1px solid var(--sp-border)',
    borderRadius: '8px', padding: '4px 8px',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* ── Info banner ──────────────────────────────────────────────────── */}
      <div style={{ ...CARD, display: 'flex', alignItems: 'flex-start', gap: '0.6rem', borderLeft: '4px solid #7c3aed' }}>
        <span style={{ color: '#7c3aed', fontSize: '0.85rem', marginTop: '1px' }}>ⓘ</span>
        <div>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--sp-tx1)' }}>
            Per-app FullStory explorer · All-time session history
          </div>
          <div style={{ fontSize: '0.63rem', color: 'var(--sp-tx2)', marginTop: '2px', lineHeight: 1.5 }}>
            Enter an App ID to fetch <strong>all</strong> FullStory sessions for users who visited{' '}
            <code style={{ fontFamily: 'monospace', fontSize: '0.62rem' }}>/develop/&#123;appId&#125;</code>.
            Sessions load lazily — expand a row to stream its events on demand.
            Events are split into <strong style={{ color: CATEGORY_COLORS.instrumentation }}>Instrumentation</strong> (custom Airo-tracked events),{' '}
            <strong style={{ color: CATEGORY_COLORS.navigation }}>Navigation</strong>, <strong style={{ color: CATEGORY_COLORS.interaction }}>Interaction</strong>,{' '}
            and <strong style={{ color: CATEGORY_COLORS.error }}>Errors</strong>.{' '}
            Requires <code style={{ fontFamily: 'monospace', fontSize: '0.62rem' }}>FULLSTORY_API_KEY</code>.
            FullStory typically retains up to 1 year of data.
          </div>
        </div>
      </div>

      {/* ── Search + lookback controls ────────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: '360px', minWidth: '180px' }}>
          <input
            type="text"
            value={appIdInput}
            onChange={(e) => setAppIdInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void fetchSessions(appIdInput, lookback)}
            placeholder="Enter App ID and press Enter…"
            className={sp.searchInput}
            style={{ width: '100%', fontSize: '0.8rem', fontFamily: 'monospace', paddingRight: appIdInput ? '1.8rem' : undefined }}
          />
          {appIdInput && (
            <button
              type="button"
              onClick={() => setAppIdInput('')}
              style={{
                position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
                color: 'var(--sp-tx2)', fontSize: '0.8rem', lineHeight: 1,
              }}
              title="Clear"
            >
              ✕
            </button>
          )}
        </div>

        {/* Lookback selector */}
        <div style={ctrlGroup}>
          <span style={ctrlLabel}>Lookback</span>
          {LOOKBACK_OPTIONS.map((opt) => (
            <button key={opt.days} type="button" onClick={() => setLookback(opt.days)} style={pillStyle(lookback === opt.days)}>
              {opt.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void fetchSessions(appIdInput, lookback)}
          disabled={listLoading || !appIdInput.trim()}
          className={sp.btnPrimary}
          style={{ padding: '0.45rem 1rem', fontSize: '0.78rem', fontWeight: 600, opacity: listLoading || !appIdInput.trim() ? 0.5 : 1 }}
        >
          {listLoading ? 'Loading…' : 'Search →'}
        </button>
      </div>

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {listError && (
        <div style={{ ...CARD, borderLeft: '4px solid #ef4444' }}>
          <p style={{ margin: 0, color: '#dc2626', fontSize: '0.78rem', fontWeight: 600 }}>Failed to load sessions: {listError}</p>
        </div>
      )}

      {/* ── Not found ────────────────────────────────────────────────────── */}
      {notFound && (
        <div style={{ ...CARD, textAlign: 'center', padding: '2rem' }}>
          <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 600, color: 'var(--sp-tx1)' }}>
            No sessions found for{' '}
            <code style={{ background: 'var(--sp-s3)', padding: '1px 5px', borderRadius: '3px', fontFamily: 'monospace', fontSize: '0.75rem' }}>{appIdInput}</code>{' '}
            in the last {LOOKBACK_OPTIONS.find((o) => o.days === lookback)?.label ?? `${lookback} days`}.
          </p>
          <p style={{ margin: '0.4rem 0 0', fontSize: '0.65rem', color: 'var(--sp-tx2)' }}>
            No FullStory sessions found. Check the App ID, or try a longer lookback window.
          </p>
        </div>
      )}

      {/* ── Results ──────────────────────────────────────────────────────── */}
      {listData && !listLoading && (
        <div>
          {/* Summary stats */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem', alignItems: 'flex-start' }}>
            <StatPill label="App ID"    value={listData.appId} />
            <StatPill label="Sessions"  value={listData.sessions.length} />
            <StatPill label="Loaded"    value={allLoadedSessions.length} color="#6366f1" />
            {allLoadedSessions.length > 0 && (
              <>
                <StatPill label="Published"      value={publishedCount} color="#10b981" />
                <StatPill label="Total Events"   value={totalEvents.toLocaleString()} />
                <StatPill label="Instrumented"   value={instrEvents.toLocaleString()} color="#d97706" />
                <StatPill label="Errors"         value={errorEvents} color={errorEvents > 0 ? '#ef4444' : undefined} />
              </>
            )}
            {appRating && (() => {
              const rColor = appRating.avg >= 6 ? '#10b981' : appRating.avg >= 4 ? '#f59e0b' : '#ef4444';
              return (
                <div style={{ ...CARD, padding: '0.5rem 0.85rem' }}>
                  <div style={{ fontSize: '0.58rem', color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg Rating</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem', marginTop: '1px' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 800, fontFamily: 'monospace', color: rColor }}>{appRating.avg.toFixed(1)}</span>
                    <span style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)' }}>/ 7 ({appRating.count})</span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Filters */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center',
            padding: '8px 12px', background: 'var(--sp-s1)', border: '1px solid var(--sp-border)',
            borderRadius: '10px', marginBottom: '0.75rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, minWidth: '180px' }}>
              <span style={{ ...ctrlLabel, marginRight: '2px' }}>Search sessions</span>
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Session ID filter…"
                className={sp.searchInput}
                style={{ flex: 1, fontSize: '0.72rem', fontFamily: 'monospace', padding: '2px 8px' }}
              />
            </div>

            <div style={ctrlGroup}>
              <span style={ctrlLabel}>Outcome</span>
              {(Object.keys(OUTCOME_LABELS) as OutcomeFilter[]).map((v) => (
                <button key={v} type="button" onClick={() => setOutcomeFilter(v)} style={pillStyle(outcomeFilter === v)}>
                  {OUTCOME_LABELS[v]}
                </button>
              ))}
            </div>

            <div style={ctrlGroup}>
              <span style={ctrlLabel}>Event type</span>
              {(Object.keys(CATEGORY_LABELS) as CategoryFilter[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setCategoryFilter(v)}
                  style={{
                    ...pillStyle(categoryFilter === v),
                    ...(categoryFilter === v && v !== 'all'
                      ? { background: CATEGORY_COLORS[v as JourneyEventCategory], color: '#fff', borderColor: CATEGORY_COLORS[v as JourneyEventCategory] }
                      : {}),
                  }}
                >
                  {CATEGORY_LABELS[v]}
                </button>
              ))}
            </div>

            {(outcomeFilter !== 'all' || categoryFilter !== 'all' || searchText) && (
              <button
                type="button"
                onClick={() => { setOutcomeFilter('all'); setCategoryFilter('all'); setSearchText(''); }}
                style={{ padding: '3px 8px', background: 'none', border: '1px solid var(--sp-border)', borderRadius: '6px', fontSize: '0.65rem', color: 'var(--sp-tx2)', cursor: 'pointer' }}
              >
                ✕ Reset filters
              </button>
            )}
          </div>

          {/* Session count / filtered indicator */}
          <div style={{ fontSize: '0.65rem', color: 'var(--sp-tx2)', marginBottom: '0.5rem' }}>
            Showing {filteredSessions.length} of {listData.sessions.length} sessions
            {listData.nextPageToken && <span style={{ color: '#6366f1' }}> · more available</span>}
            {' '} · lookback {LOOKBACK_OPTIONS.find((o) => o.days === lookback)?.label ?? `${lookback} days`}
          </div>

          {/* Session list */}
          {filteredSessions.length === 0 ? (
            <div style={{ ...CARD, textAlign: 'center', padding: '1.5rem' }}>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--sp-tx2)' }}>
                No sessions match the current filters.
              </p>
            </div>
          ) : (() => {
            // Pre-build index map so each SessionRow renders in O(1) instead of O(n).
            const sessionIndexMap = new Map(listData.sessions.map((s, i) => [s.sessionId, i]));
            return filteredSessions.map((meta) => (
              <SessionRow
                key={meta.sessionId}
                meta={meta}
                index={sessionIndexMap.get(meta.sessionId) ?? 0}
                total={listData.sessions.length}
                loaded={loadedSessions.get(meta.sessionId) ?? null}
                loading={loadingIds.has(meta.sessionId)}
                loadFailed={failedIds.has(meta.sessionId)}
                expanded={expandedIds.has(meta.sessionId)}
                categoryFilter={categoryFilter}
                appId={listData.appId}
                onExpand={() => toggleSession(meta)}
              />
            ));
          })()}

          {/* ── Load more (pagination) ──────────────────────────────────── */}
          {listData.nextPageToken && (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '0.5rem' }}>
              <button
                type="button"
                onClick={() => void loadMoreSessions()}
                disabled={loadMoreLoading}
                style={{
                  padding: '0.5rem 1.5rem', borderRadius: '8px', cursor: loadMoreLoading ? 'not-allowed' : 'pointer',
                  background: 'var(--sp-s2)', border: '1px solid var(--sp-border)',
                  fontSize: '0.75rem', fontWeight: 600, color: '#6366f1',
                  opacity: loadMoreLoading ? 0.6 : 1, transition: 'opacity 0.12s',
                }}
              >
                {loadMoreLoading ? 'Loading next page…' : 'Load next 50 sessions →'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Loading skeleton ─────────────────────────────────────────────── */}
      {listLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ border: '1px solid var(--sp-border)', borderRadius: '10px', overflow: 'hidden' }}>
              <div style={{ padding: '0.6rem 0.85rem', background: 'var(--sp-s2)', display: 'flex', gap: '1rem' }}>
                <div style={{ height: '18px', width: '200px', background: 'var(--sp-s3)', borderRadius: '3px', animation: 'pulse 1.5s ease-in-out infinite' }} />
                <div style={{ height: '18px', width: '80px', background: 'var(--sp-s3)', borderRadius: '3px', animation: 'pulse 1.5s ease-in-out infinite' }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
