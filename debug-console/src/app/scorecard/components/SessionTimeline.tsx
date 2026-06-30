'use client';

import React, { useCallback, useState } from 'react';

import { buildFsSearchUrl } from '@/lib/analytics/scorecard/fs-utils';

import type { JourneySession } from '../types';

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
const EVENTS_PER_PAGE = 15;

function formatDuration(ms: number): string {
  return ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60000)}m`;
}
function formatTs(iso: string): string {
  try { return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return iso; }
}
function formatDateFull(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return iso; }
}

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

interface Props {
  session: JourneySession;
  index:   number;
  total:   number;
  appId:   string;
}

export function SessionTimeline({ session, index, total, appId }: Props) {
  const [page,    setPage]    = useState(0);
  const [showAll, setShowAll] = useState(true);

  const allEventsDesc  = [...session.events].reverse();
  const keyEventsDesc  = allEventsDesc.filter((e) => e.isKeyEvent);
  const sourceEvents   = showAll ? allEventsDesc : keyEventsDesc;
  const totalPages     = Math.ceil(sourceEvents.length / EVENTS_PER_PAGE);
  const pageStart      = page * EVENTS_PER_PAGE;
  const displayEvents  = sourceEvents.slice(pageStart, pageStart + EVENTS_PER_PAGE);

  const handleToggle = useCallback(() => { setShowAll((v) => !v); setPage(0); }, []);

  const outcome   = session.outcome as keyof typeof OUTCOME_COLORS;
  const outColors = OUTCOME_COLORS[outcome] ?? OUTCOME_COLORS.in_progress;

  return (
    <div style={{ border: '1px solid var(--sp-border)', borderRadius: '10px', overflow: 'hidden', marginBottom: '0.5rem', background: 'var(--sp-s1)', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
      {/* Session header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.85rem', background: 'var(--sp-s2)', borderBottom: '1px solid var(--sp-border)', flexWrap: 'wrap', gap: '0.5rem' }}>
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
            {total > 1 && session.sessionId && (
              <div style={{ fontSize: '0.58rem', fontFamily: 'monospace', color: 'var(--sp-txm)', marginTop: '1px' }} title={`Session ID: ${session.sessionId}`}>{session.sessionId}</div>
            )}
          </div>
        </div>
        {session.fullstorySessionUrl
          ? <a href={session.fullstorySessionUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '0.25rem 0.6rem', border: '1px solid var(--sp-border)', borderRadius: '6px', fontSize: '0.65rem', color: '#6366f1', textDecoration: 'none', flexShrink: 0 }}>▶ FullStory ↗</a>
          : <FsSearchLink appId={appId} />
        }
      </div>

      {/* Event rows */}
      <div>
        {displayEvents.map((event, i) => {
          const keyFields = ['business_name', 'entry_point', 'plan_type', 'task_type', 'creation_source', 'failure_stage', 'feedback', 'reason', 'blockedReason'];
          const pairs = keyFields
            .filter((k) => event.data[k] != null && event.data[k] !== '')
            .map((k) => `${k}: ${String(event.data[k])}`);
          const statusColor = STATUS_COLOR[event.status] ?? '#94a3b8';
          const statusDot   = STATUS_DOT[event.status]   ?? '○';
          return (
            <div
              key={`${event.timestamp}-${i}`}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                padding: '0.35rem 0.85rem',
                borderBottom: '1px solid var(--sp-border)',
                background: event.isKeyEvent ? 'var(--sp-s1)' : 'transparent',
                opacity: event.isKeyEvent ? 1 : 0.65,
              }}
            >
              <span style={{ color: statusColor, fontSize: '0.8rem', width: '12px', textAlign: 'center', flexShrink: 0, marginTop: '1px' }}>{statusDot}</span>
              <span style={{ fontSize: '0.62rem', fontFamily: 'monospace', color: 'var(--sp-tx2)', flexShrink: 0, width: '68px', paddingTop: '2px' }}>{formatTs(event.timestamp)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '0.7rem', fontWeight: event.isKeyEvent ? 600 : 400, color: event.status === 'error' ? '#ef4444' : event.status === 'success' ? '#10b981' : event.isKeyEvent ? 'var(--sp-tx1)' : 'var(--sp-tx2)' }}>
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
        })}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.35rem 0.85rem', background: 'var(--sp-s2)', borderTop: '1px solid var(--sp-border)', flexWrap: 'wrap', gap: '0.3rem' }}>
        <button type="button" onClick={handleToggle} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.63rem', color: '#6366f1' }}>
          {showAll ? `Key events only (${keyEventsDesc.length})` : `All events (${allEventsDesc.length})`}
        </button>
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.6rem', color: 'var(--sp-tx2)' }}>{pageStart + 1}–{Math.min(pageStart + EVENTS_PER_PAGE, sourceEvents.length)} of {sourceEvents.length}</span>
            <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={{ padding: '1px 6px', border: '1px solid var(--sp-border)', borderRadius: '4px', fontSize: '0.65rem', cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.4 : 1, background: 'var(--sp-s1)' }}>←</button>
            <button type="button" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={{ padding: '1px 6px', border: '1px solid var(--sp-border)', borderRadius: '4px', fontSize: '0.65rem', cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', opacity: page >= totalPages - 1 ? 0.4 : 1, background: 'var(--sp-s1)' }}>→</button>
          </div>
        )}
      </div>
    </div>
  );
}
