'use client';

import React, { useCallback, useEffect, useState } from 'react';

import sp from '@/components/supportplane/sp.module.css';

import type { ScorecardS3FeedbackData } from '../hooks/useS3Feedback';
import type { AppJourneyData } from '../types';

import { CARD, SessionTimeline } from '../components';

interface Props {
  initialAppId?: string;
  s3Feedback?: ScorecardS3FeedbackData | null;
}

export function JourneyTab({ initialAppId = '', s3Feedback }: Props) {
  const [appId,    setAppId]    = useState(initialAppId);
  const [loading,  setLoading]  = useState(false);
  const [journey,  setJourney]  = useState<AppJourneyData | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const lookup = useCallback(async (id: string) => {
    if (!id.trim()) return;
    setLoading(true);
    setError(null);
    setNotFound(false);
    setJourney(null);
    try {
      const params = `action=journey&appId=${encodeURIComponent(id.trim())}`;
      const res = await fetch(`/api/analytics/scorecard?${params}`);
      if (res.status === 404) { setNotFound(true); return; }
      if (!res.ok) {
        const b = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      setJourney(await res.json());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialAppId) { setAppId(initialAppId); void lookup(initialAppId); }
  }, [initialAppId, lookup]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Info banner */}
      <div style={{ ...CARD, display: 'flex', alignItems: 'center', gap: '0.5rem', borderLeft: '4px solid #7c3aed' }}>
        <span style={{ color: '#7c3aed', fontSize: '0.85rem' }}>ⓘ</span>
        <div>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--sp-tx1)' }}>
            Per-app event timeline · FullStory sessions
          </div>
          <div style={{ fontSize: '0.63rem', color: 'var(--sp-tx2)' }}>
            Shows FullStory sessions for users who visited <code style={{ fontFamily: 'monospace', fontSize: '0.62rem' }}>/develop/&#123;appId&#125;</code> in the last 7 days. Up to 5 most recent sessions, up to 500 events each. Requires <code style={{ fontFamily: 'monospace', fontSize: '0.62rem' }}>FULLSTORY_API_KEY</code> to be configured.
          </div>
        </div>
      </div>

      {/* Lookup input */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          type="text"
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void lookup(appId)}
          placeholder="Enter App ID (e.g. Abc123xyz)…"
          className={sp.searchInput}
          style={{ flex: 1, fontSize: '0.8rem', fontFamily: 'monospace', maxWidth: '420px' }}
        />
        {appId && (
          <button type="button" onClick={() => { setAppId(''); setJourney(null); setNotFound(false); setError(null); }} style={{ padding: '0.5rem', background: 'var(--sp-s3)', border: '1px solid var(--sp-border)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.72rem', color: 'var(--sp-tx2)' }}>✕</button>
        )}
        <button
          type="button"
          onClick={() => void lookup(appId)}
          disabled={loading || !appId.trim()}
          className={sp.btnPrimary}
          style={{ padding: '0.5rem 1rem', fontSize: '0.78rem', fontWeight: 600, opacity: loading || !appId.trim() ? 0.5 : 1 }}
        >{loading ? 'Loading…' : 'Look up journey →'}</button>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[1, 2].map((i) => (
            <div key={i} style={{ border: '1px solid var(--sp-border)', borderRadius: '10px', overflow: 'hidden' }}>
              <div style={{ padding: '0.6rem 0.85rem', background: 'var(--sp-s2)', borderBottom: '1px solid var(--sp-border)', display: 'flex', gap: '1rem' }}>
                <div style={{ height: '18px', width: '180px', background: 'var(--sp-s3)', borderRadius: '3px', animation: 'pulse 1.5s ease-in-out infinite' }} />
                <div style={{ height: '18px', width: '120px', background: 'var(--sp-s3)', borderRadius: '3px', animation: 'pulse 1.5s ease-in-out infinite' }} />
              </div>
              {[1, 2, 3, 4].map((j) => (
                <div key={j} style={{ padding: '0.4rem 0.85rem', borderBottom: '1px solid var(--sp-border)', display: 'flex', gap: '0.75rem' }}>
                  <div style={{ height: '12px', width: '12px', background: 'var(--sp-s3)', borderRadius: '50%', animation: 'pulse 1.5s ease-in-out infinite' }} />
                  <div style={{ height: '12px', width: '60px', background: 'var(--sp-s3)', borderRadius: '3px', animation: 'pulse 1.5s ease-in-out infinite' }} />
                  <div style={{ height: '12px', width: '200px', background: 'var(--sp-s3)', borderRadius: '3px', animation: 'pulse 1.5s ease-in-out infinite' }} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Not found */}
      {notFound && (
        <div style={{ ...CARD, textAlign: 'center', padding: '2rem' }}>
          <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 600, color: 'var(--sp-tx1)' }}>
            No events found for <code style={{ background: 'var(--sp-s3)', padding: '1px 5px', borderRadius: '3px', fontFamily: 'monospace', fontSize: '0.75rem' }}>{appId}</code>
          </p>
          <p style={{ margin: '0.4rem 0 0', fontSize: '0.65rem', color: 'var(--sp-tx2)' }}>Check the App ID and environment, or verify that events are being collected.</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ ...CARD, borderLeft: '4px solid #ef4444' }}>
          <p style={{ margin: 0, color: '#dc2626', fontSize: '0.78rem', fontWeight: 600 }}>Failed to load journey: {error}</p>
        </div>
      )}

      {/* Journey result */}
      {journey && !loading && (
        <div>
          {/* Summary header */}
          <div style={{ ...CARD, marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '0.58rem', color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>App ID</div>
                <code style={{ fontSize: '0.75rem', fontFamily: 'monospace', fontWeight: 600 }}>{journey.appId}</code>
              </div>
              {journey.businessName && (
                <div>
                  <div style={{ fontSize: '0.58rem', color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Business</div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#6366f1' }}>&ldquo;{journey.businessName}&rdquo;</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: '0.58rem', color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sessions</div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--sp-accent)', fontFamily: 'monospace' }}>{journey.totalSessions}</div>
              </div>
              {(() => {
                const appRating = s3Feedback?.perAppRatings?.find((r) => r.appId === journey.appId);
                if (!appRating) return null;
                const rColor = appRating.avg >= 6 ? '#10b981' : appRating.avg >= 4 ? '#f59e0b' : '#ef4444';
                return (
                  <div style={{ borderLeft: '2px solid var(--sp-border)', paddingLeft: '1.5rem' }}>
                    <div style={{ fontSize: '0.58rem', color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg Rating</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
                      <span style={{ fontSize: '1rem', fontWeight: 800, fontFamily: 'monospace', color: rColor }}>{appRating.avg.toFixed(1)}</span>
                      <span style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)' }}>/ 7</span>
                      <span style={{ fontSize: '0.6rem', color: 'var(--sp-tx2)' }}>({appRating.count} rating{appRating.count !== 1 ? 's' : ''})</span>
                    </div>
                    <div style={{ fontSize: '0.55rem', color: 'var(--sp-tx2)', marginTop: '0.1rem' }}>S3 · {s3Feedback?.itemsInWindow?.toLocaleString()} window</div>
                  </div>
                );
              })()}
              <div>
                <div style={{ fontSize: '0.58rem', color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>First Seen</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--sp-tx2)' }}>{new Date(journey.firstSeen).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.58rem', color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Last Seen</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--sp-tx2)' }}>{new Date(journey.lastSeen).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
              </div>
            </div>
          </div>

          {/* Session timelines — newest first */}
          {[...journey.sessions]
            .sort((a, b) => b.startTime.localeCompare(a.startTime))
            .map((session, i) => (
              <SessionTimeline key={session.sessionId} session={session} index={i} total={journey.sessions.length} appId={journey.appId} />
            ))}
        </div>
      )}
    </div>
  );
}
