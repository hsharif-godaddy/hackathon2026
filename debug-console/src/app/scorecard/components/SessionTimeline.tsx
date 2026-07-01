'use client';

import { useCallback, useEffect, useState } from 'react';

import { buildFsSearchUrl } from '@/lib/analytics/scorecard/fs-utils';

import type { JourneyEventCategory, JourneySession } from '../types';

// ── Constants ─────────────────────────────────────────────────────────────────

const OUTCOME_COLORS = {
  published:   { bg: 'rgba(16,185,129,0.12)',  text: '#10b981' },
  abandoned:   { bg: 'rgba(239,68,68,0.12)',   text: '#ef4444' },
  in_progress: { bg: 'rgba(245,158,11,0.12)',  text: '#f59e0b' },
};
const OUTCOME_LABELS: Record<string, string> = {
  published: 'Published', abandoned: 'Abandoned', in_progress: 'In Progress',
};
const STATUS_DOT:   Record<string, string> = { success: '●', warning: '◐', error: '✗', info: '○' };
const STATUS_COLOR: Record<string, string> = { success: '#10b981', warning: '#f59e0b', error: '#ef4444', info: '#94a3b8' };

const CATEGORY_COLORS: Record<JourneyEventCategory, string> = {
  navigation:      '#6366f1',
  interaction:     '#0891b2',
  error:           '#ef4444',
  feedback:        '#10b981',
  instrumentation: '#d97706',
};
const CATEGORY_LABELS: Record<JourneyEventCategory, string> = {
  navigation:      'Nav',
  interaction:     'UI',
  error:           'Err',
  feedback:        'FB',
  instrumentation: 'Instr',
};

const EVENTS_PER_PAGE = 20;

// ── Helper formatters ─────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  return ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`;
}
function formatTs(iso: string): string {
  try { return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return iso; }
}
function formatDateFull(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return iso; }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FsSearchLink({ appId }: { appId: string }) {
  return (
    <a
      href={buildFsSearchUrl(appId)}
      target="_blank"
      rel="noopener noreferrer"
      style={{ padding: '0.25rem 0.6rem', border: '1px solid var(--sp-border)', borderRadius: '6px', fontSize: '0.65rem', color: 'var(--sp-tx2)', textDecoration: 'none', flexShrink: 0 }}
      title="Search for sessions by App ID in FullStory"
    >
      🔍 FullStory ↗
    </a>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  session:        JourneySession;
  index:          number;
  total:          number;
  appId:          string;
  /** When set, only events with this category are shown (or 'all'). */
  categoryFilter?: JourneyEventCategory | 'all';
}

// ── Event category tab bar ────────────────────────────────────────────────────

type LocalEventFilter = 'all' | 'key' | JourneyEventCategory;

const LOCAL_FILTER_LABELS: Array<{ id: LocalEventFilter; label: string }> = [
  { id: 'all',             label: 'All'             },
  { id: 'key',             label: 'Key only'        },
  { id: 'instrumentation', label: 'Instrumentation' },
  { id: 'navigation',      label: 'Navigation'      },
  { id: 'interaction',     label: 'Interaction'     },
  { id: 'error',           label: 'Errors'          },
];

// ── Main component ────────────────────────────────────────────────────────────

export function SessionTimeline({ session, index, total, appId, categoryFilter }: Props) {
  const [page,        setPage]        = useState(0);
  const [localFilter, setLocalFilter] = useState<LocalEventFilter>(() => {
    if (categoryFilter && categoryFilter !== 'all') return categoryFilter;
    return 'all';
  });

  // When the external category filter changes, sync the local filter and reset page.
  useEffect(() => {
    setLocalFilter(categoryFilter && categoryFilter !== 'all' ? categoryFilter : 'all');
    setPage(0);
  }, [categoryFilter]);

  const allEventsDesc = [...session.events].reverse();

  const baseEvents = (() => {
    // External categoryFilter from parent narrows the set. Local filter refines further.
    const afterExternal = categoryFilter && categoryFilter !== 'all'
      ? allEventsDesc.filter((e) => e.category === categoryFilter)
      : allEventsDesc;

    if (localFilter === 'all') return afterExternal;
    if (localFilter === 'key') return afterExternal.filter((e) => e.isKeyEvent);
    return afterExternal.filter((e) => e.category === localFilter);
  })();

  const totalPages    = Math.ceil(baseEvents.length / EVENTS_PER_PAGE);
  const pageStart     = page * EVENTS_PER_PAGE;
  const displayEvents = baseEvents.slice(pageStart, pageStart + EVENTS_PER_PAGE);

  const handleFilterChange = useCallback((f: LocalEventFilter) => {
    setLocalFilter(f);
    setPage(0);
  }, []);

  // Count events by category for the tab bar labels
  const catCounts: Partial<Record<JourneyEventCategory, number>> = {};
  for (const ev of allEventsDesc) {
    catCounts[ev.category] = (catCounts[ev.category] ?? 0) + 1;
  }

  return (
    <div style={{ marginBottom: '0' }}>
      {/* Session header — only shown when rendered standalone (total > 1 or explicitly) */}
      {total > 1 && (() => {
        const outcome   = session.outcome as keyof typeof OUTCOME_COLORS;
        const outColors = OUTCOME_COLORS[outcome] ?? OUTCOME_COLORS.in_progress;
        return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.55rem 0.85rem', background: 'var(--sp-s2)', borderBottom: '1px solid var(--sp-border)', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: '#6366f1', color: 'white', fontSize: '0.6rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {total - index}
            </span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--sp-tx1)' }}>{formatDateFull(session.startTime)}</span>
                <span style={{ padding: '1px 8px', borderRadius: '12px', fontSize: '0.6rem', fontWeight: 600, background: outColors.bg, color: outColors.text }}>
                  {OUTCOME_LABELS[outcome] ?? outcome}
                </span>
              </div>
              <div style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)', marginTop: '1px' }}>
                {formatTs(session.startTime)} – {formatTs(session.endTime)} · {formatDuration(session.durationMs)} · {session.events.length} events
              </div>
              {session.sessionId && (
                <div style={{ fontSize: '0.58rem', fontFamily: 'monospace', color: 'var(--sp-txm)', marginTop: '1px' }}>{session.sessionId}</div>
              )}
            </div>
          </div>
          {session.fullstorySessionUrl
            ? <a href={session.fullstorySessionUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '0.25rem 0.6rem', border: '1px solid var(--sp-border)', borderRadius: '6px', fontSize: '0.65rem', color: '#6366f1', textDecoration: 'none', flexShrink: 0 }}>▶ FullStory ↗</a>
            : <FsSearchLink appId={appId} />
          }
        </div>
        );
      })()}

      {/* ── Event filter pills ─────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap',
        padding: '6px 10px', background: 'var(--sp-s1)', borderBottom: '1px solid var(--sp-border)',
      }}>
        <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--sp-txm)', textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>
          Event type
        </span>
        <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', background: 'var(--sp-s2)', border: '1px solid var(--sp-border)', borderRadius: '8px', padding: '3px 5px' }}>
          {LOCAL_FILTER_LABELS.map(({ id, label }) => {
            const count = id === 'all' ? allEventsDesc.length
                        : id === 'key' ? allEventsDesc.filter((e) => e.isKeyEvent).length
                        : (catCounts[id as JourneyEventCategory] ?? 0);
            if (count === 0 && id !== 'all') return null;
            const isActive = localFilter === id;
            const color = id !== 'all' && id !== 'key' ? CATEGORY_COLORS[id as JourneyEventCategory] : undefined;
            return (
              <button
                key={id}
                type="button"
                onClick={() => handleFilterChange(id)}
                style={{
                  padding: '2px 9px', borderRadius: '6px', fontSize: '10.5px',
                  fontWeight: isActive ? 700 : 500, cursor: 'pointer',
                  background: isActive ? (color ?? 'var(--sp-accent)') : 'transparent',
                  color: isActive ? '#fff' : (color ?? 'var(--sp-tx2)'),
                  border: 'none', transition: 'background 0.12s, color 0.12s',
                }}
              >
                {label} <span style={{ opacity: 0.75, fontWeight: 400 }}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Event rows ────────────────────────────────────────────────── */}
      <div>
        {displayEvents.length === 0 ? (
          <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.72rem', color: 'var(--sp-tx2)' }}>
            No events match this filter.
          </div>
        ) : (
          displayEvents.map((event, i) => {
            const keyFields = ['business_name', 'entry_point', 'plan_type', 'task_type', 'creation_source', 'failure_stage', 'feedback', 'reason', 'blockedReason'];
            const pairs = keyFields
              .filter((k) => event.data[k] != null && event.data[k] !== '')
              .map((k) => `${k}: ${String(event.data[k])}`);
            const statusColor = STATUS_COLOR[event.status] ?? '#94a3b8';
            const statusDot   = STATUS_DOT[event.status]   ?? '○';
            const catColor    = CATEGORY_COLORS[event.category];
            const catLabel    = CATEGORY_LABELS[event.category];

            return (
              <div
                key={`${event.timestamp}-${i}`}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                  padding: '0.3rem 0.85rem',
                  borderBottom: '1px solid var(--sp-border)',
                  background: event.isKeyEvent ? 'var(--sp-s1)' : 'transparent',
                  opacity: event.isKeyEvent ? 1 : 0.7,
                }}
              >
                <span style={{ color: statusColor, fontSize: '0.8rem', width: '12px', textAlign: 'center', flexShrink: 0, marginTop: '2px' }}>{statusDot}</span>
                <span style={{ fontSize: '0.62rem', fontFamily: 'monospace', color: 'var(--sp-tx2)', flexShrink: 0, width: '68px', paddingTop: '2px' }}>{formatTs(event.timestamp)}</span>

                {/* Category badge */}
                <span style={{
                  flexShrink: 0, fontSize: '0.52rem', fontWeight: 700, padding: '1px 5px',
                  borderRadius: '8px', background: `${catColor}20`, color: catColor,
                  border: `1px solid ${catColor}35`, alignSelf: 'center', marginTop: '1px',
                  minWidth: '32px', textAlign: 'center',
                }}>
                  {catLabel}
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    fontSize: '0.7rem',
                    fontWeight: event.isKeyEvent ? 600 : 400,
                    color: event.status === 'error' ? '#ef4444'
                          : event.status === 'success' ? '#10b981'
                          : event.category === 'instrumentation' ? '#d97706'
                          : event.isKeyEvent ? 'var(--sp-tx1)'
                          : 'var(--sp-tx2)',
                  }}>
                    {event.label}
                  </span>
                  {pairs.length > 0 && (
                    <span style={{ marginLeft: '6px', fontSize: '0.6rem', color: 'var(--sp-tx2)' }}>{pairs.join(' · ')}</span>
                  )}
                </div>

                {event.fullstoryUrl ? (
                  <a href={event.fullstoryUrl} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0, padding: '1px 5px', border: '1px solid var(--sp-border)', borderRadius: '4px', fontSize: '0.6rem', color: '#6366f1', textDecoration: 'none' }}>▶</a>
                ) : <span style={{ width: '22px', flexShrink: 0 }} />}
              </div>
            );
          })
        )}
      </div>

      {/* ── Footer: pagination ────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.35rem 0.85rem', background: 'var(--sp-s2)', borderTop: '1px solid var(--sp-border)', flexWrap: 'wrap', gap: '0.3rem' }}>
        <span style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)' }}>
          {baseEvents.length} event{baseEvents.length !== 1 ? 's' : ''} shown
        </span>
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.6rem', color: 'var(--sp-tx2)' }}>
              {pageStart + 1}–{Math.min(pageStart + EVENTS_PER_PAGE, baseEvents.length)} of {baseEvents.length}
            </span>
            <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={{ padding: '1px 6px', border: '1px solid var(--sp-border)', borderRadius: '4px', fontSize: '0.65rem', cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.4 : 1, background: 'var(--sp-s1)' }}>←</button>
            <span style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)' }}>p{page + 1}/{totalPages}</span>
            <button type="button" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={{ padding: '1px 6px', border: '1px solid var(--sp-border)', borderRadius: '4px', fontSize: '0.65rem', cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', opacity: page >= totalPages - 1 ? 0.4 : 1, background: 'var(--sp-s1)' }}>→</button>
          </div>
        )}
      </div>
    </div>
  );
}
