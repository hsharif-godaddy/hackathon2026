'use client';

import { useEffect, useRef, useState } from 'react';

import { RANGE_DAYS } from '@/lib/analytics/date-range';

import { CARD, Section } from '../../components';
import type { S3AppRatingRow, S3CommentRow, ScorecardS3FeedbackData } from '../../hooks/useS3Feedback';
import type { ScorecardChartSize, ScorecardData } from '../../types';
import { CAT_COLORS, starColor, Tip } from './shared';

interface Props {
  data:         ScorecardData;
  feedRange:    string;
  customFrom?:  string;
  customTo?:    string;
  chartSize:    ScorecardChartSize;
  onSelectApp:  (id: string) => void;
  s3Feedback?:  ScorecardS3FeedbackData | null;
  s3Loading?:   boolean;
}

type CommentsApiResponse = { comments: S3CommentRow[]; total: number; page: number; pageSize: number };
type CacheEntry          = { comments: S3CommentRow[]; total: number; pageSize: number };

export function FeedbackDeepDive({ data, feedRange, customFrom = '', customTo = '', chartSize, onSelectApp, s3Feedback, s3Loading }: Props) {
  const [selectedRating,      setSelectedRating]      = useState<number | null>(null);
  const [commentsPage,        setCommentsPage]        = useState(0);
  const [commentsLoading,     setCommentsLoading]     = useState(false);
  const [commentsError,       setCommentsError]       = useState<string | null>(null);
  const [ratingComments,      setRatingComments]      = useState<S3CommentRow[] | null>(null);
  const [ratingCommentsTotal, setRatingCommentsTotal] = useState(0);
  const [commentsPageSize,    setCommentsPageSize]    = useState(15);
  const [commentSearch,       setCommentSearch]       = useState('');

  const cacheRef     = useRef<Record<string, CacheEntry>>({});
  const inflightRef  = useRef<Set<string>>(new Set());
  const activeKeyRef = useRef<string | null>(null);
  const mountedRef   = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const fb = data.feedback;

  const selectRating = (score: number): void => {
    setSelectedRating(score);
    setCommentsPage(0);
    setRatingComments(null);
    setCommentsError(null);
    setCommentSearch('');
  };

  useEffect(() => {
    if (!s3Feedback || s3Feedback.configMissing || s3Feedback.total === 0) return;
    setSelectedRating((prev: number | null): number | null => {
      if (prev !== null) return prev;
      const dist: Record<string, number> = s3Feedback.distribution;
      const scores: readonly number[] = [1, 2, 3, 4, 5, 6, 7];
      return scores.find((s: number) => (dist[String(s)] ?? 0) > 0) ?? 1;
    });
  }, [s3Feedback]);

  useEffect(() => {
    if (selectedRating === null) {
      activeKeyRef.current = null;
      setRatingComments(null);
      setRatingCommentsTotal(0);
      setCommentsError(null);
      return;
    }
    const rangeKey: string = feedRange === 'custom' && customFrom && customTo
      ? `custom_${customFrom}_${customTo}`
      : feedRange;
    const key: string = `${rangeKey}_${selectedRating}_${commentsPage}`;
    activeKeyRef.current = key;

    const cached: CacheEntry | undefined = cacheRef.current[key];
    if (cached) {
      setRatingComments(cached.comments);
      setRatingCommentsTotal(cached.total);
      setCommentsPageSize(cached.pageSize);
      setCommentsLoading(false);
      setCommentsError(null);
      return;
    }

    setCommentsLoading(true);
    setCommentsError(null);
    if (inflightRef.current.has(key)) return;

    inflightRef.current.add(key);
    const params = new URLSearchParams({
      action: 'feedback-comments',
      rating: String(selectedRating),
      page:   String(commentsPage),
    });
    if (feedRange === 'custom' && customFrom && customTo) {
      params.set('start', customFrom);
      params.set('end', customTo);
    } else {
      params.set('days', String(RANGE_DAYS[feedRange] ?? 7));
    }
    (async () => {
      try {
        const res = await fetch(`/api/analytics/scorecard?${params.toString()}`);
        if (!mountedRef.current) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          inflightRef.current.delete(key);
          if (mountedRef.current && activeKeyRef.current === key) {
            setCommentsError(body.error ?? `HTTP ${res.status}`);
            setCommentsLoading(false);
          }
          return;
        }
        const json = await res.json() as CommentsApiResponse;
        inflightRef.current.delete(key);
        cacheRef.current[key] = { comments: json.comments ?? [], total: json.total ?? 0, pageSize: json.pageSize ?? 15 };
        if (mountedRef.current && activeKeyRef.current === key) {
          setRatingComments(json.comments ?? []);
          setRatingCommentsTotal(json.total ?? 0);
          setCommentsPageSize(json.pageSize ?? 15);
          setCommentsLoading(false);
        }
      } catch (err) {
        inflightRef.current.delete(key);
        if (mountedRef.current && activeKeyRef.current === key) {
          setCommentsError((err as Error)?.message ?? 'Failed to load comments');
          setCommentsLoading(false);
        }
      }
    })();
  }, [selectedRating, commentsPage, feedRange, customFrom, customTo]);

  const funnelBar = (label: string, count: number, max: number, color = '#6366f1') => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.18rem' }}>
      <span style={{ width: '140px', fontSize: '0.6rem', color: 'var(--sp-tx2)', textAlign: 'right', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, background: 'var(--sp-s3)', borderRadius: '3px', height: '16px' }}>
        <div style={{ width: `${max > 0 ? (count / max) * 100 : 0}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width 0.4s' }} />
      </div>
      <span style={{ width: '52px', fontSize: '0.68rem', fontWeight: 700, fontFamily: 'monospace', flexShrink: 0 }}>{count.toLocaleString()}</span>
    </div>
  );

  const s3AvgColor: string = s3Feedback && !s3Feedback.configMissing && s3Feedback.avgRating !== null
    ? (s3Feedback.avgRating >= 6 ? '#10b981' : s3Feedback.avgRating >= 4 ? '#f59e0b' : '#ef4444')
    : '#94a3b8';

  const s3Ready: boolean = !!(s3Feedback && !s3Feedback.configMissing);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>

      {/* Summary strip */}
      {s3Ready && s3Feedback!.total > 0 && (() => {
        const n:      number = s3Feedback!.total;
        const posPct: number = Math.round((s3Feedback!.positive / n) * 100);
        const neuPct: number = Math.round((s3Feedback!.neutral  / n) * 100);
        const negPct: number = Math.round((s3Feedback!.negative / n) * 100);
        return (
          <div style={{ display: 'flex', gap: '0.55rem' }}>
            {([
              { label: 'Avg Rating',    value: s3Feedback!.avgRating?.toFixed(2) ?? '—', sub: '/ 7 · target ≥6',   color: s3AvgColor,      tip: "Average 'Love it or Leave it' score · 1–7 scale · target ≥6" },
              { label: 'Total Ratings', value: n.toLocaleString(),                        sub: 'submissions',        color: 'var(--sp-tx1)', tip: 'Total numeric rating submissions in selected range' },
              { label: '👍 Positive',   value: s3Feedback!.positive.toLocaleString(),     sub: `${posPct}% · ≥6`,    color: '#10b981',       tip: 'Ratings of 6 or 7 — positive experience' },
              { label: '😐 Neutral',    value: s3Feedback!.neutral.toLocaleString(),      sub: `${neuPct}% · 4–5`,   color: '#f59e0b',       tip: 'Ratings of 4 or 5 — mixed experience' },
              { label: '👎 Negative',   value: s3Feedback!.negative.toLocaleString(),     sub: `${negPct}% · ≤3`,    color: '#ef4444',       tip: 'Ratings of 1, 2 or 3 — negative experience' },
            ] as const).map(({ label, value, sub, color, tip }) => (
              <Tip key={label} text={tip} style={{ flex: 1 }}>
                <div style={{ ...CARD, padding: '0.5rem 0.85rem', display: 'flex', flexDirection: 'column', gap: '0.08rem', cursor: 'default', width: '100%' }}>
                  <span style={{ fontSize: '0.57rem', fontWeight: 700, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
                  <span style={{ fontSize: '1.25rem', fontWeight: 900, fontFamily: 'monospace', color, lineHeight: 1 }}>{value}</span>
                  <span style={{ fontSize: '0.55rem', color: 'var(--sp-txm)' }}>{sub}</span>
                </div>
              </Tip>
            ))}
            {(s3Feedback!.partitionErrors ?? 0) > 0 && (
              <div style={{ ...CARD, padding: '0.45rem 0.85rem', display: 'flex', flexDirection: 'column', gap: '0.08rem', borderColor: '#f59e0b' }}>
                <span style={{ fontSize: '0.57rem', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>⚠ Errors</span>
                <span style={{ fontSize: '1.25rem', fontWeight: 900, fontFamily: 'monospace', color: '#f59e0b', lineHeight: 1 }}>{s3Feedback!.partitionErrors}</span>
                <span style={{ fontSize: '0.55rem', color: 'var(--sp-txm)' }}>partitions failed</span>
              </div>
            )}
            {s3Feedback!.mergedTruncated && (
              <div style={{ ...CARD, padding: '0.45rem 0.85rem', display: 'flex', flexDirection: 'column', gap: '0.08rem', borderColor: '#f59e0b' }}>
                <span style={{ fontSize: '0.57rem', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>⚠ Truncated</span>
                <span style={{ fontSize: '0.72rem', color: '#f59e0b', lineHeight: 1.3 }}>Most recent 2,000</span>
              </div>
            )}
          </div>
        );
      })()}

      {/* Main row: Distribution + Categories (left) + Comments (right) */}
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '0.9rem', alignItems: 'stretch' }}>

        {/* LEFT PANEL */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>

          {/* Rating Distribution */}
          <Section title="Rating Distribution" sub="S3 Parquet · click to filter comments">
            {s3Feedback == null ? (
              <div style={{ ...CARD, padding: '0.55rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.22rem' }}>
                {[7, 6, 5, 4, 3, 2, 1].map((i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <div style={{ width: '12px', height: '10px', background: 'var(--sp-s3)', borderRadius: '2px', flexShrink: 0, animation: 'pulse 1.5s ease-in-out infinite' }} />
                    <div style={{ flex: 1, height: '12px', background: 'var(--sp-s3)', borderRadius: '3px', animation: 'pulse 1.5s ease-in-out infinite' }} />
                    <div style={{ width: '30px', height: '10px', background: 'var(--sp-s3)', borderRadius: '2px', flexShrink: 0, animation: 'pulse 1.5s ease-in-out infinite' }} />
                  </div>
                ))}
              </div>
            ) : s3Feedback.configMissing ? (
              <div style={{ ...CARD, color: 'var(--sp-tx2)', fontSize: '0.72rem', padding: '0.75rem', textAlign: 'center' }}>
                S3 not configured — set <code>FEEDBACK_S3_BUCKET</code> in .env.local.
              </div>
            ) : s3Feedback.total === 0 ? (
              <div style={{ ...CARD, color: 'var(--sp-tx2)', fontSize: '0.72rem', padding: '0.75rem', textAlign: 'center' }}>No ratings in this range.</div>
            ) : (
              <div style={{ ...CARD, padding: '0.55rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.22rem' }}>
                {([7, 6, 5, 4, 3, 2, 1] as const).map((score) => {
                  const count:      number  = s3Feedback.distribution[String(score)] ?? 0;
                  const pct:        number  = s3Feedback.total > 0 ? (count / s3Feedback.total) * 100 : 0;
                  const color:      string  = starColor(score);
                  const isSelected: boolean = selectedRating === score;
                  return (
                    <button
                      key={score}
                      type="button"
                      onClick={() => selectRating(score)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.45rem',
                        borderRadius: '4px', padding: '0.12rem 0.25rem', margin: '0 -0.25rem',
                        background: isSelected ? `${color}18` : 'transparent',
                        border: isSelected ? `1px solid ${color}40` : '1px solid transparent',
                        cursor: 'pointer', width: 'calc(100% + 0.5rem)', transition: 'background 0.12s',
                      }}
                    >
                      <span style={{ width: '12px', fontSize: '0.68rem', fontWeight: 700, color: isSelected ? color : 'var(--sp-tx2)', textAlign: 'right', flexShrink: 0 }}>{score}</span>
                      <div style={{ flex: 1, background: 'var(--sp-s3)', borderRadius: '3px', height: '11px' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width 0.4s', opacity: selectedRating === null || isSelected ? 1 : 0.35 }} />
                      </div>
                      <span style={{ width: '36px', fontSize: '0.6rem', color: isSelected ? color : 'var(--sp-tx2)', fontFamily: 'monospace', flexShrink: 0, textAlign: 'right', fontWeight: isSelected ? 700 : 400 }}>{count.toLocaleString()}</span>
                      <span style={{ width: '34px', fontSize: '0.55rem', color: 'var(--sp-txm)', fontFamily: 'monospace', flexShrink: 0, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Section>

          {/* Feedback Categories */}
          {(s3Loading || s3Ready) && (
            <Section title="Feedback Categories" sub="S3 Parquet · feedback_category field">
              {s3Loading || !s3Feedback ? (
                <div style={{ ...CARD, padding: '0.55rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.28rem' }}>
                  {[80, 60, 45, 35, 25].map((w) => (
                    <div key={w} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: 'var(--sp-s3)', flexShrink: 0, animation: 'pulse 1.5s ease-in-out infinite' }} />
                      <div style={{ flex: 1, height: '10px', background: 'var(--sp-s3)', borderRadius: '3px', animation: 'pulse 1.5s ease-in-out infinite' }} />
                      <div style={{ width: '30px', height: '10px', background: 'var(--sp-s3)', borderRadius: '2px', flexShrink: 0, animation: 'pulse 1.5s ease-in-out infinite' }} />
                    </div>
                  ))}
                </div>
              ) : !s3Feedback.categoryCounts || Object.keys(s3Feedback.categoryCounts).length === 0 ? (
                <div style={{ ...CARD, color: 'var(--sp-tx2)', fontSize: '0.72rem', padding: '0.75rem', textAlign: 'center' }}>No category data.</div>
              ) : (() => {
                const sorted: Array<[string, number]> = Object.entries(s3Feedback.categoryCounts).sort((a, b) => b[1] - a[1]);
                const catTotal: number = sorted.reduce((s: number, [, n]: [string, number]) => s + n, 0);
                return (
                  <div style={{ ...CARD, padding: '0.55rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.28rem' }}>
                    {sorted.map(([cat, count]: [string, number], i: number) => {
                      const pct: number = catTotal > 0 ? (count / catTotal) * 100 : 0;
                      const col: string = CAT_COLORS[i % CAT_COLORS.length] as string;
                      return (
                        <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: col, flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: '0.62rem', color: 'var(--sp-tx1)', textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.replace(/_/g, ' ')}</span>
                          <span style={{ fontSize: '0.62rem', fontWeight: 700, fontFamily: 'monospace', color: 'var(--sp-tx1)', flexShrink: 0 }}>{count.toLocaleString()}</span>
                          <span style={{ fontSize: '0.58rem', fontFamily: 'monospace', color: 'var(--sp-tx2)', width: '32px', textAlign: 'right', flexShrink: 0 }}>{pct.toFixed(0)}%</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </Section>
          )}

          {/* Per-App Ratings */}
          {s3Ready && (s3Feedback!.perAppRatings?.length ?? 0) > 0 && (() => {
            const rows: S3AppRatingRow[] = s3Feedback!.perAppRatings!;
            return (
              <Section title="Per-App Ratings" sub="S3 Parquet · top apps · click to open Journey">
                <div style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 44px 36px', padding: '0.28rem 0.7rem', background: 'var(--sp-s2)', borderBottom: '1px solid var(--sp-border)' }}>
                    {(['App', 'Ct', 'Avg'] as const).map((h) => (
                      <span key={h} style={{ fontSize: '0.54rem', fontWeight: 700, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: h === 'App' ? 'left' : 'right' }}>{h}</span>
                    ))}
                  </div>
                  {rows.map((row) => {
                    const color: string = row.avg >= 6 ? '#10b981' : row.avg >= 4 ? '#f59e0b' : '#ef4444';
                    return (
                      <div key={row.appId} style={{ display: 'grid', gridTemplateColumns: '1fr 44px 36px', padding: '0.3rem 0.7rem', borderBottom: '1px solid var(--sp-border)', alignItems: 'center' }}>
                        <button
                          type="button"
                          onClick={() => onSelectApp(row.appId)}
                          style={{ fontFamily: 'monospace', fontSize: '0.58rem', color: 'var(--sp-accent)', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {row.appId}
                        </button>
                        <span style={{ fontSize: '0.62rem', fontWeight: 700, fontFamily: 'monospace', color: 'var(--sp-tx2)', textAlign: 'right' }}>{row.count.toLocaleString()}</span>
                        <span style={{ fontSize: '0.65rem', fontWeight: 700, fontFamily: 'monospace', color, textAlign: 'right' }}>{row.avg.toFixed(1)}</span>
                      </div>
                    );
                  })}
                </div>
              </Section>
            );
          })()}

        </div>

        {/* RIGHT: Comments Explorer */}
        <Section title="Customer Comments" sub="S3 Parquet · select a rating to filter" style={{ height: '100%' }}>
          {!s3Ready || s3Feedback!.total === 0 ? (
            <div style={{ ...CARD, color: 'var(--sp-tx2)', fontSize: '0.72rem', padding: '1.5rem', textAlign: 'center' }}>
              {s3Feedback == null ? 'Loading…' : s3Feedback.configMissing ? 'S3 not configured.' : 'No ratings in this range.'}
            </div>
          ) : (
            <div style={{ ...CARD, padding: 0, overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', borderTop: `3px solid ${selectedRating !== null ? starColor(selectedRating) : 'var(--sp-accent)'}` }}>
              {/* Rating filter tabs */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 10px', background: 'var(--sp-s2)', borderBottom: '1px solid var(--sp-border)', overflowX: 'auto', flexWrap: 'nowrap' }}>
                {([7, 6, 5, 4, 3, 2, 1] as const).map((score) => {
                  const count:    number  = s3Feedback!.distribution[String(score)] ?? 0;
                  const isActive: boolean = selectedRating === score;
                  const color:    string  = starColor(score);
                  return (
                    <button
                      key={score}
                      type="button"
                      onClick={() => selectRating(score)}
                      style={{
                        padding: '3px 10px', borderRadius: '6px', cursor: 'pointer',
                        border: `1px solid ${isActive ? color : 'transparent'}`,
                        background: isActive ? color : 'var(--sp-s3)',
                        color: isActive ? '#fff' : 'var(--sp-tx2)',
                        fontSize: '11.5px', fontWeight: isActive ? 600 : 500,
                        whiteSpace: 'nowrap', transition: 'background 0.12s, color 0.12s',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px',
                      }}
                    >
                      <span>★{score}</span>
                      <span style={{ fontSize: '9px', fontFamily: 'monospace', opacity: isActive ? 0.85 : 0.65 }}>{count.toLocaleString()}</span>
                    </button>
                  );
                })}
                <div style={{ flex: 1 }} />
                {selectedRating !== null && (
                  <input
                    type="text"
                    placeholder="Search comments…"
                    value={commentSearch}
                    onChange={(e) => setCommentSearch(e.target.value)}
                    style={{
                      padding: '3px 8px', borderRadius: '6px', fontSize: '11px',
                      background: 'var(--sp-s1)', border: '1px solid var(--sp-border)',
                      color: 'var(--sp-tx1)', outline: 'none', width: '160px',
                    }}
                  />
                )}
                {selectedRating !== null && ratingCommentsTotal > 0 && (
                  <span style={{ fontSize: '11px', color: 'var(--sp-tx2)', whiteSpace: 'nowrap', paddingLeft: '4px' }}>
                    {ratingCommentsTotal.toLocaleString()} total
                  </span>
                )}
              </div>

              {/* Body */}
              <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                {selectedRating === null ? (
                  <div style={{ padding: '3rem', textAlign: 'center', fontSize: '0.72rem', color: 'var(--sp-tx2)' }}>
                    Select a rating above to view comments.
                  </div>
                ) : commentsLoading ? (
                  <div style={{ padding: '0 1rem' }}>
                    {[90, 75, 85, 60, 80, 65, 70, 55, 88, 50, 78, 62, 92, 45, 72].map((w: number) => (
                      <div key={w} style={{ display: 'grid', gridTemplateColumns: '80px 130px 1fr', gap: '0.75rem', padding: '0.55rem 0', borderBottom: '1px solid var(--sp-border)', alignItems: 'center' }}>
                        <div style={{ height: '10px', background: 'var(--sp-s3)', borderRadius: '3px', animation: 'pulse 1.5s ease-in-out infinite' }} />
                        <div style={{ height: '10px', background: 'var(--sp-s3)', borderRadius: '3px', animation: 'pulse 1.5s ease-in-out infinite' }} />
                        <div style={{ height: '10px', background: 'var(--sp-s3)', borderRadius: '3px', width: `${w}%`, animation: 'pulse 1.5s ease-in-out infinite' }} />
                      </div>
                    ))}
                  </div>
                ) : commentsError ? (
                  <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: '0.72rem', color: '#ef4444' }}>Failed to load comments: {commentsError}</div>
                ) : !ratingComments || ratingComments.length === 0 ? (
                  <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: '0.72rem', color: 'var(--sp-tx2)' }}>No text comments for ★{selectedRating} in this range.</div>
                ) : (() => {
                  const needle:   string        = commentSearch.trim().toLowerCase();
                  const filtered: S3CommentRow[] = needle
                    ? ratingComments.filter((c) => c.text.toLowerCase().includes(needle))
                    : ratingComments;
                  return (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '80px 130px 1fr', padding: '0.28rem 1rem', background: 'var(--sp-s2)', borderBottom: '1px solid var(--sp-border)' }}>
                        {(['Date', 'App ID', 'Comment'] as const).map((h) => (
                          <span key={h} style={{ fontSize: '0.54rem', fontWeight: 700, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</span>
                        ))}
                      </div>
                      {filtered.length === 0 ? (
                        <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: '0.72rem', color: 'var(--sp-tx2)' }}>No matches for "{commentSearch}".</div>
                      ) : filtered.map((c, i) => (
                        <div
                          key={i}
                          style={{ display: 'grid', gridTemplateColumns: '80px 130px 1fr', gap: '0.5rem', padding: '0.55rem 1rem', borderBottom: '1px solid var(--sp-border)', alignItems: 'start' }}
                        >
                          <span style={{ fontSize: '0.58rem', color: 'var(--sp-tx2)', fontFamily: 'monospace', paddingTop: '0.05rem', lineHeight: 1.4 }}>
                            {c.ts ? new Date(c.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                          </span>
                          {c.appId ? (
                            <button
                              type="button"
                              onClick={() => onSelectApp(c.appId as string)}
                              style={{ fontFamily: 'monospace', fontSize: '0.58rem', color: 'var(--sp-accent)', background: 'var(--sp-accent-dim)', border: '1px solid var(--sp-accent-ring)', borderRadius: '4px', padding: '0.1rem 0.4rem', cursor: 'pointer', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px', width: 'fit-content' }}
                            >
                              {c.appId}
                            </button>
                          ) : (
                            <span style={{ fontSize: '0.58rem', color: 'var(--sp-txm)' }}>—</span>
                          )}
                          <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--sp-tx1)', lineHeight: 1.55 }}>{c.text}</p>
                        </div>
                      ))}
                      {ratingCommentsTotal > commentsPageSize && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.45rem 1rem', background: 'var(--sp-s2)', borderTop: '1px solid var(--sp-border)' }}>
                          <button
                            type="button"
                            onClick={() => setCommentsPage((p) => Math.max(0, p - 1))}
                            disabled={commentsPage === 0}
                            style={{ padding: '0.22rem 0.7rem', borderRadius: '5px', fontSize: '0.63rem', fontWeight: 600, cursor: commentsPage === 0 ? 'not-allowed' : 'pointer', color: commentsPage === 0 ? 'var(--sp-txm)' : 'var(--sp-accent)', background: commentsPage === 0 ? 'var(--sp-s2)' : 'var(--sp-accent-dim)', border: `1px solid ${commentsPage === 0 ? 'var(--sp-border)' : 'var(--sp-accent-ring)'}` }}
                          >← Prev</button>
                          <span style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)', fontFamily: 'monospace' }}>
                            {commentsPage * commentsPageSize + 1}–{Math.min((commentsPage + 1) * commentsPageSize, ratingCommentsTotal)} of {ratingCommentsTotal.toLocaleString()}
                          </span>
                          <button
                            type="button"
                            onClick={() => setCommentsPage((p) => p + 1)}
                            disabled={(commentsPage + 1) * commentsPageSize >= ratingCommentsTotal}
                            style={{ padding: '0.22rem 0.7rem', borderRadius: '5px', fontSize: '0.63rem', fontWeight: 600, cursor: (commentsPage + 1) * commentsPageSize >= ratingCommentsTotal ? 'not-allowed' : 'pointer', color: (commentsPage + 1) * commentsPageSize >= ratingCommentsTotal ? 'var(--sp-txm)' : 'var(--sp-accent)', background: (commentsPage + 1) * commentsPageSize >= ratingCommentsTotal ? 'var(--sp-s2)' : 'var(--sp-accent-dim)', border: `1px solid ${(commentsPage + 1) * commentsPageSize >= ratingCommentsTotal ? 'var(--sp-border)' : 'var(--sp-accent-ring)'}` }}
                          >Next →</button>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </Section>

      </div>

      {/* Engagement + Funnel */}
      {(fb.feedbackModalOpened + fb.feedbackModalUserOpened + fb.appGenView + fb.agentWorkView + fb.chatFeedbackView) > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: chartSize === 'full' ? '1fr' : '1fr 1fr', gap: '0.9rem', alignItems: 'start' }}>

          {/* Banner Engagement */}
          {(fb.appGenView + fb.agentWorkView + fb.chatFeedbackView + fb.feedbackModalOpened + fb.feedbackModalUserOpened) > 0 && (
            <Section title="Banner Engagement" sub="BMP · view and dismiss counts for feedback prompts">
              <div style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 60px 70px', padding: '0.28rem 0.85rem', background: 'var(--sp-s2)', borderBottom: '1px solid var(--sp-border)' }}>
                  {(['Banner', 'Views', 'Closes', 'Dismiss %'] as const).map((h) => (
                    <span key={h} style={{ fontSize: '0.54rem', fontWeight: 700, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: h === 'Banner' ? 'left' : 'right' }}>{h}</span>
                  ))}
                </div>
                {([
                  { label: 'App Gen Feedback',     views: fb.appGenView,                                      closes: fb.appGenClose        },
                  { label: 'Agent Work Feedback',  views: fb.agentWorkView,                                    closes: fb.agentWorkClose     },
                  { label: 'Chat Feedback Banner', views: fb.chatFeedbackView,                                  closes: fb.chatFeedbackClose  },
                  { label: 'Feedback Modal',       views: fb.feedbackModalOpened + fb.feedbackModalUserOpened, closes: fb.feedbackModalClosed },
                ] as const).filter((r) => r.views > 0).map((row) => {
                  const dismissRate: number | null = row.views > 0 ? Math.round((row.closes / row.views) * 100) : null;
                  const rateColor:   string        = dismissRate == null ? '#94a3b8' : dismissRate >= 70 ? '#ef4444' : dismissRate >= 40 ? '#f59e0b' : '#10b981';
                  return (
                    <div key={row.label} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 60px 70px', padding: '0.38rem 0.85rem', borderBottom: '1px solid var(--sp-border)', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.65rem', color: 'var(--sp-tx1)' }}>{row.label}</span>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, fontFamily: 'monospace', color: 'var(--sp-tx1)', textAlign: 'right' }}>{row.views.toLocaleString()}</span>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, fontFamily: 'monospace', color: row.closes > 0 ? '#f59e0b' : '#94a3b8', textAlign: 'right' }}>{row.closes.toLocaleString()}</span>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, fontFamily: 'monospace', color: rateColor, textAlign: 'right' }}>{dismissRate != null ? `${dismissRate}%` : '—'}</span>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Feedback Modal Funnel */}
          {fb.feedbackModalOpened + fb.feedbackModalUserOpened > 0 && (
            <Section title="Feedback Modal Funnel" sub="BMP · modal open → category → submit → success">
              <div style={{ ...CARD, padding: '0.75rem 1rem' }}>
                {(() => {
                  const opened:    number = fb.feedbackModalOpened + fb.feedbackModalUserOpened;
                  const catView:   number = fb.feedbackCategoryView;
                  const submitted: number = fb.issueReports + fb.supportRequests + fb.feedbackShareSubmit;
                  const succeeded: number = fb.feedbackIssueSuccess + fb.feedbackSupportSuccess + fb.feedbackShareSuccess;
                  const maxVal:    number = Math.max(opened, 1);
                  return (
                    <>
                      {funnelBar('Modal Opened',    opened,    maxVal, '#6366f1')}
                      {funnelBar('Category Viewed', catView,   maxVal, '#8b5cf6')}
                      {funnelBar('Submitted',       submitted, maxVal, '#0891b2')}
                      {funnelBar('Submit Success',  succeeded, maxVal, '#10b981')}
                      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.65rem', flexWrap: 'wrap' }}>
                        {([
                          { label: '🐛 Issue',   view: fb.feedbackIssueView,   sel: fb.feedbackCategoryIssue,   sub: fb.issueReports,       ok: fb.feedbackIssueSuccess,   color: '#ef4444' },
                          { label: '🛟 Support', view: fb.feedbackSupportView, sel: fb.feedbackCategorySupport, sub: fb.supportRequests,     ok: fb.feedbackSupportSuccess, color: '#f59e0b' },
                          { label: '📣 Share',   view: fb.feedbackShareView,   sel: fb.feedbackCategoryShare,   sub: fb.feedbackShareSubmit, ok: fb.feedbackShareSuccess,   color: '#10b981' },
                        ] as const).map(({ label, view, sel, sub, ok, color }) => (
                          <div key={label} style={{ background: 'var(--sp-s2)', borderRadius: '8px', padding: '0.4rem 0.7rem', minWidth: '90px', flex: 1 }}>
                            <div style={{ fontSize: '0.6rem', fontWeight: 600, color: 'var(--sp-tx2)', marginBottom: '0.2rem' }}>{label}</div>
                            {view > 0 && <div style={{ fontSize: '0.6rem', color: '#0284c7', fontFamily: 'monospace' }}>{view.toLocaleString()} views</div>}
                            <div style={{ fontSize: '0.7rem', fontWeight: 700, color, fontFamily: 'monospace' }}>{sel.toLocaleString()} selected</div>
                            <div style={{ fontSize: '0.6rem', color: 'var(--sp-tx2)', fontFamily: 'monospace' }}>{sub} submitted · {ok} ✓</div>
                          </div>
                        ))}
                      </div>
                    </>
                  );
                })()}
              </div>
            </Section>
          )}

        </div>
      )}

    </div>
  );
}
