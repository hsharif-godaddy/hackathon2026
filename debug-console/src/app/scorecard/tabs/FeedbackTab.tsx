'use client';

import React, { useEffect, useRef, useState } from 'react';

import { RANGE_DAYS } from '@/lib/analytics/date-range';

import type { ScorecardLokiData } from '@/lib/analytics/scorecard/loki';

import { CARD, IntervalChart, Section, StatCard, chartGrid } from '../components';
import type { IntervalDataPoint, IntervalSeries } from '../components';
import { bmpVal } from '../hooks/useBmpData';
import type { ScorecardBmpFeedbackData } from '../hooks/useBmpData';
import type { S3CommentRow, ScorecardS3FeedbackData } from '../hooks/useS3Feedback';
import type { ScorecardChartSize, ScorecardData, TrendView } from '../types';
import { aggregateByView } from '../trendAggregation';

function fmtWeek(iso: string): string {
  const d: Date = new Date(iso);
  const months: string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

type FeedbackLevel = '' | 'app_gen' | 'agent' | 'chat';

function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--sp-s2)', color: 'var(--sp-tx1)', borderRadius: '6px',
          padding: '0.35rem 0.6rem', fontSize: '0.65rem', lineHeight: 1.45,
          whiteSpace: 'normal', width: 'max-content', maxWidth: '240px',
          zIndex: 50, boxShadow: '0 4px 14px rgba(0,0,0,0.35)', pointerEvents: 'none',
        }}>
          {text}
        </span>
      )}
    </span>
  );
}

function Donut({ rate, label, size = 72 }: { rate: number | null; label: string; size?: number }) {
  const pct   = rate ?? 0;
  const color = pct >= 65 ? '#10b981' : pct >= 50 ? '#f59e0b' : pct > 0 ? '#ef4444' : 'var(--sp-s3)';
  const inner = size * 0.72;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
      <div style={{ width: size, height: size, borderRadius: '50%', background: `conic-gradient(${color} ${pct}%, var(--sp-s3) ${pct}%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: inner, height: inner, borderRadius: '50%', background: 'var(--sp-s1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: size > 60 ? '0.76rem' : '0.58rem', fontWeight: 800, color, fontFamily: 'monospace' }}>
            {rate !== null ? `${rate}%` : '—'}
          </span>
        </div>
      </div>
      <span style={{ fontSize: '0.58rem', color: 'var(--sp-tx2)', fontWeight: 500 }}>{label}</span>
    </div>
  );
}

interface Props {
  data:          ScorecardData;
  range:         string;
  feedRange:     string;
  customFrom?:   string;
  customTo?:     string;
  chartSize:     ScorecardChartSize;
  trendView?:    TrendView;
  onSelectApp:   (id: string) => void;
  s3Feedback?:   ScorecardS3FeedbackData | null;
  s3Loading?:    boolean;
  bmpData?:      ScorecardBmpFeedbackData | null;
  lokiData?:     ScorecardLokiData | null;
}

type CommentsApiResponse = { comments: S3CommentRow[]; total: number; page: number; pageSize: number };
type CacheEntry = { comments: S3CommentRow[]; total: number };

export function FeedbackTab({ data, range, feedRange, customFrom = '', customTo = '', chartSize, trendView = 'daily', onSelectApp, s3Feedback, s3Loading, bmpData, lokiData }: Props) {
  const [selectedLevel,         setSelectedLevel]         = useState<FeedbackLevel>('');
  const [selectedReason,        setSelectedReason]        = useState('');
  const [selectedRating,        setSelectedRating]        = useState<number | null>(null);
  const [commentsPage,          setCommentsPage]          = useState(0);
  const [commentsLoading,       setCommentsLoading]       = useState(false);
  const [commentsError,         setCommentsError]         = useState<string | null>(null);
  const [ratingComments,        setRatingComments]        = useState<S3CommentRow[] | null>(null);
  const [ratingCommentsTotal,   setRatingCommentsTotal]   = useState(0);

  const cacheRef     = useRef<Record<string, CacheEntry>>({});
  const inflightRef  = useRef<Set<string>>(new Set());
  const activeKeyRef = useRef<string | null>(null);
  const mountedRef   = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const fb        = data.feedback;
  const donutSize = chartSize === 'full' ? 90 : chartSize === 'large' ? 82 : 72;

  const handleBarClick = (score: number): void => {
    if (selectedRating === score) {
      setSelectedRating(null);
      setCommentsPage(0);
      setCommentsError(null);
    } else {
      setSelectedRating(score);
      setCommentsPage(0);
      setRatingComments(null);
      setCommentsError(null);
    }
  };

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
      page: String(commentsPage),
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
        cacheRef.current[key] = { comments: json.comments ?? [], total: json.total ?? 0 };
        if (mountedRef.current && activeKeyRef.current === key) {
          setRatingComments(json.comments ?? []);
          setRatingCommentsTotal(json.total ?? 0);
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

  const handleLevelChange = (level: FeedbackLevel) => {
    setSelectedLevel((prev) => (prev === level ? '' : level));
    setSelectedReason('');
  };

  const handleReasonChange = (reason: string) => {
    setSelectedReason((prev) => (prev === reason ? '' : reason));
  };

  const funnelBar = (label: string, count: number, max: number, color = '#6366f1') => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.18rem' }}>
      <span style={{ width: '140px', fontSize: '0.6rem', color: 'var(--sp-tx2)', textAlign: 'right', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, background: 'var(--sp-s3)', borderRadius: '3px', height: '16px' }}>
        <div style={{ width: `${max > 0 ? (count / max) * 100 : 0}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width 0.4s' }} />
      </div>
      <span style={{ width: '52px', fontSize: '0.68rem', fontWeight: 700, fontFamily: 'monospace', flexShrink: 0 }}>{count.toLocaleString()}</span>
    </div>
  );

  const s3AvgColor = s3Feedback && !s3Feedback.configMissing && s3Feedback.avgRating !== null
    ? (s3Feedback.avgRating >= 6 ? '#10b981' : s3Feedback.avgRating >= 4 ? '#f59e0b' : '#ef4444')
    : '#94a3b8';

  const bmpFbMetrics = bmpData?.metrics ?? [];
  const bmpFbTotal: number = bmpFbMetrics.reduce((acc, m) => acc + bmpVal(m.aggregatedSummary, 'total_count'), 0);
  const bmpFbPositive: number = bmpFbMetrics.reduce((acc, m) => acc + bmpVal(m.aggregatedSummary, 'positive_count'), 0);
  const thumbsUpPct: number | null = bmpFbTotal > 0 ? Math.round((bmpFbPositive / bmpFbTotal) * 100) : null;
  const loveAvg: number | null = s3Feedback && !s3Feedback.configMissing && s3Feedback.avgRating !== null ? s3Feedback.avgRating : null;
  const positiveRatePct: number | null = s3Feedback && !s3Feedback.configMissing && s3Feedback.total > 0
    ? Math.round((s3Feedback.positive / s3Feedback.total) * 100)
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>

      {/* Feedback headline metrics */}
      <Section title="Feedback Metrics" sub={`BMP · S3 Parquet · Customer rating + agent feedback · last ${range}`}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem' }}>
          <StatCard label="Love it or Leave it" value={loveAvg !== null ? loveAvg.toFixed(1) : null} description="avg / 7 · target ≥6 · S3" accent="premium" help={{ what: 'Average "Love it or Leave it" score on a 1–7 scale — the primary KR2 quality/satisfaction metric.', how: 'Mean score across all S3 Parquet feedback submissions in the range.', reading: 'Target ≥6.0. Below 4 is a red signal. Drives the KR2 "Love it or Leave it ≥6.0" goal.' }} />
          <StatCard label="Positive Rate" value={positiveRatePct !== null ? `${positiveRatePct}%` : null} description="ratings ≥6 ÷ total · S3" accent="info" help={{ what: '% of ratings that were 6 or 7 — a direct measure of user satisfaction.', how: 'positive (≥6) ÷ total × 100 · S3 Parquet feedback submissions.', reading: 'Higher is better. Pairs with the avg score to understand the distribution shape.' }} />
          <StatCard label="Agent Feedback" value={thumbsUpPct !== null ? `${thumbsUpPct}%` : null} description="thumbs-up rate · BMP" help={{ what: 'Share of AI responses rated thumbs-up by users in the selected range.', how: 'positive_count ÷ total_count × 100 · BMP agent_feedback_count (agent-observability).', reading: 'Target ≥65%. Drops here often correlate with poor generation quality.' }} />
          <StatCard label="Total Ratings" value={s3Feedback && !s3Feedback.configMissing ? s3Feedback.total : null} description="rating submissions · S3" help={{ what: 'Total number of "Love it or Leave it" rating submissions in the selected range.', how: 'Count of S3 Parquet feedback rows with a valid 1–7 rating.', reading: 'Sample size indicator — low counts make the avg score less statistically reliable.' }} />
        </div>
      </Section>

      <div style={{ display: 'flex', flexDirection: 'row', gap: '0.9rem', flexWrap: 'wrap', alignItems: 'stretch' }}>
      <div style={{ flex: 1, minWidth: '260px', display: 'flex', flexDirection: 'column' }}>
      {/* BMP Thumbs Feedback — agent_feedback_count */}
      <Section title="Thumbs Up / Down" sub="BMP · agent_feedback_count" style={{ flex: 1 }}>
        {bmpData == null ? (
          <div style={{ ...CARD, padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.45rem', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'var(--sp-s3)', flexShrink: 0, animation: 'pulse 1.5s ease-in-out infinite' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flex: 1 }}>
                <div style={{ height: '14px', width: '40%', background: 'var(--sp-s3)', borderRadius: '3px', animation: 'pulse 1.5s ease-in-out infinite' }} />
                <div style={{ height: '12px', width: '55%', background: 'var(--sp-s3)', borderRadius: '3px', animation: 'pulse 1.5s ease-in-out infinite' }} />
              </div>
            </div>
          </div>
        ) : bmpData.configMissing ? (
          <div style={{ ...CARD, color: 'var(--sp-tx2)', fontSize: '0.72rem', padding: '0.75rem', textAlign: 'center', flex: 1 }}>
            BMP not configured — set <code>BMP_API_TOKEN</code> in .env.local to enable thumbs feedback metrics.
          </div>
        ) : bmpData.error ? (
          <div style={{ ...CARD, color: '#ef4444', fontSize: '0.72rem', padding: '0.75rem', textAlign: 'center', flex: 1 }}>
            BMP error: {bmpData.error}
          </div>
        ) : (() => {
          const fbMetrics = bmpData.metrics ?? [];
          if (fbMetrics.length === 0) return (
            <div style={{ ...CARD, color: 'var(--sp-tx2)', fontSize: '0.72rem', padding: '0.75rem', textAlign: 'center', flex: 1 }}>
              No feedback data in this range.
            </div>
          );
          const positiveCount: number = fbMetrics.reduce((acc, m) => acc + bmpVal(m.aggregatedSummary, 'positive_count'), 0);
          const negativeCount: number = fbMetrics.reduce((acc, m) => acc + bmpVal(m.aggregatedSummary, 'negative_count'), 0);
          const totalCount: number    = fbMetrics.reduce((acc, m) => acc + bmpVal(m.aggregatedSummary, 'total_count'), 0);
          if (totalCount === 0) return (
            <div style={{ ...CARD, color: 'var(--sp-tx2)', fontSize: '0.72rem', padding: '0.75rem', textAlign: 'center', flex: 1 }}>
              No feedback data in this range.
            </div>
          );
          // Compute rate from counts — BMP's positive_pct with SUM is not a 0-100 percentage.
          const positivePct: number = (positiveCount / totalCount) * 100;
          // Merge intervals across all dimension combinations, keyed by startTime
          const ivMap = new Map<string, { pos: number; neg: number; tot: number; endTime: string }>();
          for (const m of fbMetrics) {
            for (const iv of (m.intervals ?? [])) {
              const ex = ivMap.get(iv.startTime);
              if (ex) {
                ex.pos += bmpVal(iv.intervalSummary, 'positive_count');
                ex.neg += bmpVal(iv.intervalSummary, 'negative_count');
                ex.tot += bmpVal(iv.intervalSummary, 'total_count');
              } else {
                ivMap.set(iv.startTime, { pos: bmpVal(iv.intervalSummary, 'positive_count'), neg: bmpVal(iv.intervalSummary, 'negative_count'), tot: bmpVal(iv.intervalSummary, 'total_count'), endTime: iv.endTime });
              }
            }
          }
          const intervals = [...ivMap.entries()].sort(([a], [b]) => a.localeCompare(b));
          return (
            <div style={{ ...CARD, padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
                <Donut rate={Math.round(positivePct)} label="" size={donutSize + 10} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <Tip text="Users who gave a thumbs up to an AI message. Source: BMP agent_feedback_count · positive_count.">
                      <span style={{ fontSize: '0.68rem', color: '#10b981', fontWeight: 600 }}>👍 {positiveCount.toLocaleString()} positive</span>
                    </Tip>
                    <Tip text="Users who gave a thumbs down to an AI message. Source: BMP agent_feedback_count · negative_count.">
                      <span style={{ fontSize: '0.68rem', color: '#ef4444', fontWeight: 600 }}>👎 {negativeCount.toLocaleString()} negative</span>
                    </Tip>
                    <Tip text="Total thumbs feedback responses (up + down). Source: BMP agent_feedback_count · total_count.">
                      <span style={{ fontSize: '0.65rem', color: 'var(--sp-tx2)' }}>{totalCount.toLocaleString()} total</span>
                    </Tip>
                  </div>
                  <div style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)' }}>
                    <Tip text="positive_count ÷ total_count × 100. Calculated from raw counts — BMP's positive_pct field (SUM) is not a percentage and is not used here.">
                      <span>positive rate: <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--sp-tx1)' }}>{positivePct.toFixed(1)}%</span></span>
                    </Tip>
                  </div>
                </div>
              </div>
              {intervals.length > 0 && (() => {
                const rawData: IntervalDataPoint[] = (trendView === 'daily' ? intervals.slice(-14) : intervals).map(([startTime, v]) => ({
                  label: fmtWeek(startTime),
                  _date: startTime.slice(0, 10),
                  up:    v.pos,
                  down:  v.neg,
                  total: v.tot,
                }));
                const agg = aggregateByView(rawData, ['up', 'down', 'total'], trendView);
                const chartData: IntervalDataPoint[] = agg.map((pt): IntervalDataPoint => ({
                  ...pt,
                  rate: (pt.total as number) > 0 ? Math.round(((pt.up as number) / (pt.total as number)) * 1000) / 10 : 0,
                }));
                const chartSeries: IntervalSeries[] = [
                  { key: 'rate',  label: 'Rate %', color: '#7c3aed', format: (v) => `${v.toFixed(1)}%` },
                  { key: 'up',    label: 'Up',     color: '#10b981', format: (v) => v.toLocaleString() },
                  { key: 'down',  label: 'Down',   color: '#ef4444', format: (v) => v.toLocaleString() },
                  { key: 'total', label: 'Total',  color: 'var(--sp-tx2)', format: (v) => v.toLocaleString() },
                ];
                return (
                  <IntervalChart
                    data={chartData}
                    series={chartSeries}
                    size={chartSize}
                    defaultType="bar"
                    defaultActive={['rate', 'up', 'down']}
                  />
                );
              })()}
            </div>
          );
        })()}
      </Section>
      </div>
      <div style={{ flex: 1, minWidth: '260px', display: 'flex', flexDirection: 'column' }}>
      {/* Numeric Love Score from S3 Parquet */}
      <Section title="Customer Rating" sub="S3 Parquet · Avg 1–7 rating from user submissions" style={{ flex: 1 }}>
        {s3Feedback == null ? (
          <div style={{ ...CARD, padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.45rem', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <div style={{ width: '56px', height: '44px', background: 'var(--sp-s3)', borderRadius: '6px', flexShrink: 0, animation: 'pulse 1.5s ease-in-out infinite' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flex: 1 }}>
                <div style={{ height: '12px', width: '40%', background: 'var(--sp-s3)', borderRadius: '3px', animation: 'pulse 1.5s ease-in-out infinite' }} />
                <div style={{ height: '10px', width: '65%', background: 'var(--sp-s3)', borderRadius: '3px', animation: 'pulse 1.5s ease-in-out infinite' }} />
              </div>
            </div>
            {[7, 6, 5, 4, 3].map((i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: '14px', height: '10px', background: 'var(--sp-s3)', borderRadius: '2px', flexShrink: 0, animation: 'pulse 1.5s ease-in-out infinite' }} />
                <div style={{ flex: 1, height: '12px', background: 'var(--sp-s3)', borderRadius: '3px', width: `${30 + i * 8}%`, animation: 'pulse 1.5s ease-in-out infinite' }} />
                <div style={{ width: '32px', height: '10px', background: 'var(--sp-s3)', borderRadius: '2px', flexShrink: 0, animation: 'pulse 1.5s ease-in-out infinite' }} />
              </div>
            ))}
          </div>
        ) : s3Feedback.configMissing ? (
          <div style={{ ...CARD, color: 'var(--sp-tx2)', fontSize: '0.72rem', padding: '0.75rem', textAlign: 'center', flex: 1 }}>
            S3 not configured — set <code>FEEDBACK_S3_BUCKET</code> in .env.local to enable numeric love score.
          </div>
        ) : s3Feedback.total === 0 ? (
          <div style={{ ...CARD, color: 'var(--sp-tx2)', fontSize: '0.72rem', padding: '0.75rem', textAlign: 'center', flex: 1 }}>
            No numeric ratings found in this range.
          </div>
        ) : (
          <div style={{ ...CARD, padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
              <Tip text="Average 'Love it or Leave it' score out of 7. Target ≥6. Users answer 'How would you rate your experience?' on a 1–7 scale. Source: S3 Parquet.">
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '72px' }}>
                  <span style={{ fontSize: '2.4rem', fontWeight: 900, fontFamily: 'monospace', color: s3AvgColor, lineHeight: 1 }}>
                    {s3Feedback.avgRating?.toFixed(1) ?? '—'}
                  </span>
                  <span style={{ fontSize: '0.58rem', color: 'var(--sp-tx2)', marginTop: '2px' }}>avg / 7 &nbsp;target ≥6</span>
                </div>
              </Tip>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <Tip text="Ratings of 6 or 7 — user had a positive experience. From S3 Parquet, items with a valid 1–7 rating only.">
                  <span style={{ fontSize: '0.68rem', color: '#10b981', fontWeight: 600 }}>👍 {s3Feedback.positive.toLocaleString()} positive (≥6)</span>
                </Tip>
                <Tip text="Ratings of 4 or 5 — user had a mixed or neutral experience.">
                  <span style={{ fontSize: '0.68rem', color: '#f59e0b', fontWeight: 600 }}>😐 {s3Feedback.neutral.toLocaleString()} neutral (4–5)</span>
                </Tip>
                <Tip text="Ratings of 1, 2 or 3 — user had a negative experience.">
                  <span style={{ fontSize: '0.68rem', color: '#ef4444', fontWeight: 600 }}>👎 {s3Feedback.negative.toLocaleString()} negative (1–3)</span>
                </Tip>
                <Tip text="Total 'Love it or Leave it' rating submissions in this date range. Excludes rows without a valid 1–7 rating.">
                  <span style={{ fontSize: '0.65rem', color: 'var(--sp-tx2)' }}>{s3Feedback.total.toLocaleString()} total</span>
                </Tip>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {([7, 6, 5, 4, 3, 2, 1] as const).map((score) => {
                const count = s3Feedback.distribution[String(score)] ?? 0;
                const pct = s3Feedback.total > 0 ? (count / s3Feedback.total) * 100 : 0;
                const barColor = score >= 6 ? '#10b981' : score >= 4 ? '#f59e0b' : '#ef4444';
                const isSelected = selectedRating === score;
                return (
                  <div
                    key={score}
                    role="button" tabIndex={0}
                    onClick={() => handleBarClick(score)}
                    onKeyDown={(e) => e.key === 'Enter' && handleBarClick(score)}
                    title={`Click to view ★${score} comments`}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', borderRadius: '4px', padding: '0.05rem 0.15rem', margin: '0 -0.15rem', background: isSelected ? `${barColor}15` : 'transparent', transition: 'background 0.12s' }}
                  >
                    <span style={{ width: '14px', fontSize: '0.68rem', fontWeight: 700, color: isSelected ? barColor : 'var(--sp-tx2)', textAlign: 'right', flexShrink: 0 }}>{score}</span>
                    <div style={{ flex: 1, background: 'var(--sp-s3)', borderRadius: '3px', height: '14px' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: '3px', transition: 'width 0.4s', opacity: selectedRating === null || isSelected ? 1 : 0.4 }} />
                    </div>
                    <span style={{ width: '50px', fontSize: '0.65rem', color: isSelected ? barColor : 'var(--sp-tx2)', fontFamily: 'monospace', flexShrink: 0, fontWeight: isSelected ? 700 : 400 }}>
                      {count.toLocaleString()}{isSelected ? ' ▼' : ''}
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: '0.56rem', color: 'var(--sp-tx2)', textAlign: 'right', marginTop: '0.1rem' }}>
              click a bar to view recent comments
            </div>
            {s3Feedback.mergedTruncated && (
              <div style={{ fontSize: '0.58rem', color: '#f59e0b', textAlign: 'right' }}>
                Results truncated — showing most recent 2,000 submissions
              </div>
            )}
            {(s3Feedback.partitionErrors ?? 0) > 0 && (
              <div style={{ fontSize: '0.58rem', color: '#f59e0b', textAlign: 'right' }}>
                {s3Feedback.partitionErrors} partition{s3Feedback.partitionErrors === 1 ? '' : 's'} failed — score may be incomplete
              </div>
            )}
          </div>
        )}
      </Section>
      </div>
      </div>

      {/* On-demand comments for selected star rating */}
      {selectedRating !== null && (() => {
        const accentColor = selectedRating >= 6 ? '#10b981' : selectedRating >= 4 ? '#f59e0b' : '#ef4444';
        const totalPages = Math.ceil(ratingCommentsTotal / 10);
        return (
          <div style={{ ...CARD, padding: 0, overflow: 'hidden', borderTop: `3px solid ${accentColor}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.85rem', background: 'var(--sp-s2)', borderBottom: '1px solid var(--sp-border)' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--sp-tx1)' }}>
                ★{selectedRating} Recent Comments
              </span>
              {ratingCommentsTotal > 0 && (
                <span style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)', fontWeight: 400 }}>
                  ({ratingCommentsTotal.toLocaleString()} total · page {commentsPage + 1} of {totalPages})
                </span>
              )}
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => { setSelectedRating(null); setCommentsPage(0); }}
                style={{ fontSize: '0.65rem', color: 'var(--sp-tx2)', background: 'var(--sp-s3)', border: 'none', borderRadius: '4px', padding: '0.15rem 0.45rem', cursor: 'pointer' }}
              >
                ✕ Close
              </button>
            </div>
            {commentsLoading ? (
              <div style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {[90, 75, 85, 60, 80, 65, 70, 55, 88, 50].map((w: number) => (
                  <div key={w} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                    <div style={{ width: '22px', height: '14px', background: 'var(--sp-s3)', borderRadius: '3px', flexShrink: 0, animation: 'pulse 1.5s ease-in-out infinite' }} />
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <div style={{ height: '10px', background: 'var(--sp-s3)', borderRadius: '3px', width: `${w}%`, animation: 'pulse 1.5s ease-in-out infinite' }} />
                      <div style={{ height: '8px', background: 'var(--sp-s3)', borderRadius: '3px', width: '35%', animation: 'pulse 1.5s ease-in-out infinite' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : commentsError ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: '0.72rem', color: '#ef4444' }}>
                Failed to load comments: {commentsError}
              </div>
            ) : !ratingComments || ratingComments.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: '0.72rem', color: 'var(--sp-tx2)' }}>
                No text comments for ★{selectedRating} in this range.
              </div>
            ) : (
              <>
                {ratingComments.map((c, i) => (
                  <div key={i} style={{ padding: '0.45rem 0.85rem', borderBottom: '1px solid var(--sp-border)', display: 'grid', gridTemplateColumns: '82px 120px 1fr', gap: '0.6rem', alignItems: 'start' }}>
                    <span style={{ fontSize: '0.6rem', color: 'var(--sp-tx2)', fontFamily: 'monospace', paddingTop: '0.1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.ts ? new Date(c.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </span>
                    {c.appId ? (
                      <button
                        type="button"
                        onClick={() => onSelectApp(c.appId as string)}
                        style={{ fontFamily: 'monospace', fontSize: '0.6rem', color: 'var(--sp-accent)', background: 'var(--sp-accent-dim)', border: '1px solid var(--sp-accent-ring)', borderRadius: '3px', padding: '0.05rem 0.3rem', cursor: 'pointer', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {c.appId}
                      </button>
                    ) : (
                      <span style={{ fontSize: '0.6rem', color: 'var(--sp-tx2)' }}>—</span>
                    )}
                    <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--sp-tx1)', lineHeight: 1.45 }}>{c.text}</p>
                  </div>
                ))}
                {ratingCommentsTotal > 10 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.45rem 0.85rem', background: 'var(--sp-s2)', borderTop: '1px solid var(--sp-border)' }}>
                    <button
                      type="button"
                      onClick={() => setCommentsPage((p) => Math.max(0, p - 1))}
                      disabled={commentsPage === 0}
                      style={{ padding: '0.2rem 0.6rem', borderRadius: '5px', fontSize: '0.65rem', fontWeight: 600, cursor: commentsPage === 0 ? 'not-allowed' : 'pointer', color: commentsPage === 0 ? 'var(--sp-txm)' : 'var(--sp-accent)', background: commentsPage === 0 ? 'var(--sp-s2)' : 'var(--sp-accent-dim)', border: `1px solid ${commentsPage === 0 ? 'var(--sp-border)' : 'var(--sp-accent-ring)'}` }}
                    >
                      ← Prev
                    </button>
                    <span style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)', fontFamily: 'monospace' }}>
                      {commentsPage * 10 + 1}–{Math.min((commentsPage + 1) * 10, ratingCommentsTotal)} of {ratingCommentsTotal.toLocaleString()}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCommentsPage((p) => p + 1)}
                      disabled={(commentsPage + 1) * 10 >= ratingCommentsTotal}
                      style={{ padding: '0.2rem 0.6rem', borderRadius: '5px', fontSize: '0.65rem', fontWeight: 600, cursor: (commentsPage + 1) * 10 >= ratingCommentsTotal ? 'not-allowed' : 'pointer', color: (commentsPage + 1) * 10 >= ratingCommentsTotal ? 'var(--sp-txm)' : 'var(--sp-accent)', background: (commentsPage + 1) * 10 >= ratingCommentsTotal ? 'var(--sp-s2)' : 'var(--sp-accent-dim)', border: `1px solid ${(commentsPage + 1) * 10 >= ratingCommentsTotal ? 'var(--sp-border)' : 'var(--sp-accent-ring)'}` }}
                    >
                      Next →
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* Banner engagement — view/dismiss counts for each feedback prompt */}
      {(fb.appGenView + fb.agentWorkView + fb.chatFeedbackView + fb.feedbackModalOpened + fb.feedbackModalUserOpened) > 0 && (
        <Section title="Banner Engagement" sub="BMP · View and dismiss counts for feedback prompts">
          <div style={{ border: '1px solid var(--sp-border)', borderRadius: '10px', overflow: 'hidden', background: 'var(--sp-s1)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 70px 80px', padding: '0.35rem 1rem', background: 'var(--sp-s2)', borderBottom: '1px solid var(--sp-border)' }}>
              {(['Banner', 'Views', 'Closes', 'Dismiss %'] as const).map((h) => (
                <span key={h} style={{ fontSize: '0.6rem', fontWeight: 600, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</span>
              ))}
            </div>
            {([
              { label: 'App Gen Feedback',    views: fb.appGenView,                                      closes: fb.appGenClose      },
              { label: 'Agent Work Feedback', views: fb.agentWorkView,                                    closes: fb.agentWorkClose   },
              { label: 'Chat Feedback Banner', views: fb.chatFeedbackView,                                closes: fb.chatFeedbackClose },
              { label: 'Feedback Modal',      views: fb.feedbackModalOpened + fb.feedbackModalUserOpened, closes: fb.feedbackModalClosed },
            ] as const).filter((r) => r.views > 0).map((row) => {
              const dismissRate = row.views > 0 ? Math.round((row.closes / row.views) * 100) : null;
              const rateColor   = dismissRate == null ? '#94a3b8' : dismissRate >= 70 ? '#ef4444' : dismissRate >= 40 ? '#f59e0b' : '#10b981';
              return (
                <div key={row.label} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 70px 80px', padding: '0.4rem 1rem', borderBottom: '1px solid var(--sp-border)', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.68rem', color: 'var(--sp-tx1)' }}>{row.label}</span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, fontFamily: 'monospace', color: 'var(--sp-tx1)' }}>{row.views.toLocaleString()}</span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, fontFamily: 'monospace', color: row.closes > 0 ? '#f59e0b' : '#94a3b8' }}>{row.closes.toLocaleString()}</span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, fontFamily: 'monospace', color: rateColor }}>{dismissRate != null ? `${dismissRate}%` : '—'}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Feedback modal funnel + category breakdown */}
      {fb.feedbackModalOpened + fb.feedbackModalUserOpened > 0 && (
        <Section title="Feedback Modal Funnel" sub="BMP · Modal open → category → submit → success">
          <div style={{ ...CARD, padding: '0.75rem 1rem' }}>
            {(() => {
              const opened = fb.feedbackModalOpened + fb.feedbackModalUserOpened;
              const catView = fb.feedbackCategoryView;
              const submitted = fb.issueReports + fb.supportRequests + fb.feedbackShareSubmit;
              const succeeded = fb.feedbackIssueSuccess + fb.feedbackSupportSuccess + fb.feedbackShareSuccess;
              const maxVal = Math.max(opened, 1);
              return (
                <>
                  {funnelBar('Modal Opened', opened, maxVal, '#6366f1')}
                  {funnelBar('Category Viewed', catView, maxVal, '#8b5cf6')}
                  {funnelBar('Submitted', submitted, maxVal, '#0891b2')}
                  {funnelBar('Submit Success', succeeded, maxVal, '#10b981')}
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                    {[
                      { label: '🐛 Issue',   view: fb.feedbackIssueView,   sel: fb.feedbackCategoryIssue,   sub: fb.issueReports,        ok: fb.feedbackIssueSuccess,   color: '#ef4444' },
                      { label: '🛟 Support', view: fb.feedbackSupportView, sel: fb.feedbackCategorySupport, sub: fb.supportRequests,     ok: fb.feedbackSupportSuccess, color: '#f59e0b' },
                      { label: '📣 Share',   view: fb.feedbackShareView,   sel: fb.feedbackCategoryShare,   sub: fb.feedbackShareSubmit, ok: fb.feedbackShareSuccess,   color: '#10b981' },
                    ].map(({ label, view, sel, sub, ok, color }) => (
                      <div key={label} style={{ background: 'var(--sp-s2)', borderRadius: '8px', padding: '0.4rem 0.65rem', minWidth: '90px' }}>
                        <div style={{ fontSize: '0.6rem', fontWeight: 600, color: 'var(--sp-tx2)' }}>{label}</div>
                        {view > 0 && <div style={{ fontSize: '0.6rem', color: '#0284c7', fontFamily: 'monospace' }}>{view.toLocaleString()} view</div>}
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color, fontFamily: 'monospace' }}>{sel.toLocaleString()} sel</div>
                        <div style={{ fontSize: '0.6rem', color: 'var(--sp-tx2)' }}>{sub} sub · {ok} ✓</div>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        </Section>
      )}

      {/* Feedback by Level + Failure Drivers + Daily Feedback Trend — responsive grid */}
      <div style={{ display: 'grid', gridTemplateColumns: chartGrid(chartSize), gap: '0.9rem', alignItems: 'start' }}>

        {/* Feedback by Level (donut cards kept for at-a-glance rate) */}
        {fb.appFeedbackTotal + fb.agentFeedbackTotal + fb.msgFeedbackTotal > 0 && (
          <Section title="Feedback by Level" sub="BMP · Click a level to filter the event feed below">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {(([
                { key: 'app_gen' as FeedbackLevel, label: 'App Gen', rate: fb.appPositiveRate,   total: fb.appFeedbackTotal   },
                { key: 'agent'   as FeedbackLevel, label: 'Agent',   rate: fb.agentPositiveRate, total: fb.agentFeedbackTotal  },
                { key: 'chat'    as FeedbackLevel, label: 'Chat',    rate: fb.msgPositiveRate,   total: fb.msgFeedbackTotal    },
              ]).filter((r) => r.total > 0)).map(({ key, label, rate, total }) => {
                const isActive = selectedLevel === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleLevelChange(key)}
                    style={{
                      ...CARD,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem',
                      padding: '0.75rem', flex: '1 1 80px',
                      cursor: 'pointer', border: 'none', textAlign: 'center',
                      boxShadow: isActive
                        ? '0 0 0 2px var(--sp-accent), 0 2px 10px rgba(0,0,0,0.08)'
                        : '0 2px 10px rgba(0,0,0,0.08)',
                      transition: 'box-shadow 0.15s',
                    }}
                  >
                    <Donut rate={rate} label={label} size={donutSize} />
                    <span style={{ fontSize: '0.6rem', color: 'var(--sp-tx2)' }}>{total} ratings</span>
                    {isActive && <span style={{ fontSize: '0.52rem', color: 'var(--sp-accent)', fontWeight: 600, marginTop: '0.1rem' }}>✓ filtering</span>}
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        {/* Failure Drivers */}
        <Section title="Failure/Error Drivers" sub="Loki · BMP · Publish pipeline failures + user feedback drivers">
          {(() => {
            const loki = lokiData?.publish;
            const hasLoki = !!loki && (loki.failures > 0 || loki.buildFailed > 0 || loki.archiveFailed > 0);
            const hasEsData = fb.topFailureReasons.length > 0 || fb.publishFailuresByStage.length > 0 || data.funnel.blockedReasons.length > 0 || fb.topFailureCategories.length > 0;
            if (!hasLoki && !hasEsData && !lokiData?.error) {
              return (
                <div style={{ ...CARD, color: 'var(--sp-tx2)', fontSize: '0.72rem', textAlign: 'center', padding: '1.5rem' }}>
                  No failure data in this range.
                </div>
              );
            }
            return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {lokiData?.error && (
                <div style={{ ...CARD, padding: '0.4rem 0.75rem', color: '#ef4444', fontSize: '0.72rem' }}>
                  Loki query error: {lokiData.error}
                </div>
              )}
              {/* Server-side failures from Loki */}
              {hasLoki && loki && (
                <div style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '0.5rem 0.75rem', background: 'var(--sp-s2)', borderBottom: '1px solid var(--sp-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Server-side pipeline failures</span>
                    <span style={{ fontSize: '0.57rem', fontWeight: 700, background: 'var(--sp-s3)', color: 'var(--sp-tx2)', border: '1px solid var(--sp-border)', borderRadius: '4px', padding: '0.05rem 0.35rem' }}>Loki</span>
                  </div>
                  {[
                    { label: 'Total Publish Failures', count: loki.failures,      color: '#ef4444' },
                    { label: 'Build Step Failed',       count: loki.buildFailed,   color: '#f97316' },
                    { label: 'Archive Step Failed',     count: loki.archiveFailed, color: '#f97316' },
                  ].filter((r) => r.count > 0).map((r) => (
                    <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.75rem', borderBottom: '1px solid var(--sp-border)' }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--sp-tx1)', flex: 1 }}>{r.label}</span>
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, color: r.color, fontFamily: 'monospace' }}>{r.count.toLocaleString()}</span>
                    </div>
                  ))}
                  {loki.successRate !== null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.75rem', background: 'var(--sp-s2)' }}>
                      <span style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)', flex: 1 }}>Publish success rate</span>
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, fontFamily: 'monospace', color: loki.successRate >= 90 ? '#10b981' : loki.successRate >= 75 ? '#f59e0b' : '#ef4444' }}>
                        {loki.successRate}%
                      </span>
                    </div>
                  )}
                </div>
              )}
              {fb.topFailureCategories.length > 0 && (
                <div style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '0.5rem 0.75rem', background: 'var(--sp-s2)', borderBottom: '1px solid var(--sp-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Feedback categories</span>
                    <span style={{ fontSize: '0.57rem', color: 'var(--sp-tx2)' }}>click to filter feed ↓</span>
                  </div>
                  {fb.topFailureCategories.map((r, i) => {
                    const isActive = selectedReason === r.category;
                    return (
                      <div
                        key={r.category}
                        role="button" tabIndex={0}
                        onClick={() => handleReasonChange(r.category)}
                        onKeyDown={(e) => e.key === 'Enter' && handleReasonChange(r.category)}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.75rem', borderBottom: '1px solid var(--sp-border)', cursor: 'pointer', background: isActive ? 'rgba(245,158,11,0.06)' : 'transparent', transition: 'background 0.12s' }}
                      >
                        <span style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)', width: '16px', textAlign: 'right', flexShrink: 0 }}>{i + 1}.</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--sp-tx1)', flex: 1, textTransform: 'capitalize' }}>{r.category.replace(/_/g, ' ')}</span>
                        {isActive && <span style={{ fontSize: '0.56rem', color: 'var(--sp-accent)', fontWeight: 600, flexShrink: 0 }}>✓</span>}
                        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#f59e0b', fontFamily: 'monospace' }}>{r.count.toLocaleString()}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {fb.topFailureReasons.length > 0 && (
                <div style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '0.5rem 0.75rem', background: 'var(--sp-s2)', borderBottom: '1px solid var(--sp-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Negative feedback reasons</span>
                    <span style={{ fontSize: '0.57rem', color: 'var(--sp-tx2)' }}>click to filter feed ↓</span>
                  </div>
                  {fb.topFailureReasons.map((r, i) => {
                    const isActive = selectedReason === r.reason;
                    return (
                      <div
                        key={r.reason}
                        role="button" tabIndex={0}
                        onClick={() => handleReasonChange(r.reason)}
                        onKeyDown={(e) => e.key === 'Enter' && handleReasonChange(r.reason)}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.75rem', borderBottom: '1px solid var(--sp-border)', cursor: 'pointer', background: isActive ? 'rgba(239,68,68,0.06)' : 'transparent', transition: 'background 0.12s' }}
                      >
                        <span style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)', width: '16px', textAlign: 'right', flexShrink: 0 }}>{i + 1}.</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--sp-tx1)', flex: 1, textTransform: 'capitalize' }}>{r.reason.replace(/_/g, ' ')}</span>
                        {isActive && <span style={{ fontSize: '0.56rem', color: 'var(--sp-accent)', fontWeight: 600, flexShrink: 0 }}>✓</span>}
                        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#ef4444', fontFamily: 'monospace' }}>{r.count.toLocaleString()}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {data.funnel.blockedReasons.length > 0 && (
                <div style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '0.5rem 0.75rem', background: 'var(--sp-s2)', borderBottom: '1px solid var(--sp-border)', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Blocked publish reasons</span>
                    <span style={{ fontSize: '0.62rem', color: '#f59e0b', fontFamily: 'monospace' }}>{data.funnel.blockedPublish.numerator.toLocaleString()} blocked</span>
                  </div>
                  {data.funnel.blockedReasons.map((r, i) => (
                    <div key={r.reason} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.75rem', borderBottom: '1px solid var(--sp-border)' }}>
                      <span style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)', width: '16px', textAlign: 'right', flexShrink: 0 }}>{i + 1}.</span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--sp-tx1)', flex: 1, textTransform: 'capitalize' }}>{r.reason.replace(/_/g, ' ')}</span>
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#f59e0b', fontFamily: 'monospace' }}>{r.count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
              {fb.publishFailuresByStage.length > 0 && (
                <div style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '0.5rem 0.75rem', background: 'var(--sp-s2)', borderBottom: '1px solid var(--sp-border)', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Publish failure stages</span>
                    <span style={{ fontSize: '0.62rem', color: '#ef4444', fontFamily: 'monospace' }}>{fb.publishFailureTotal.toLocaleString()} total</span>
                  </div>
                  {fb.publishFailuresByStage.map((s, i) => (
                    <div key={s.stage} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.75rem', borderBottom: '1px solid var(--sp-border)' }}>
                      <span style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)', width: '16px', textAlign: 'right', flexShrink: 0 }}>{i + 1}.</span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--sp-tx1)', flex: 1, textTransform: 'capitalize' }}>{s.stage.replace(/_/g, ' ')}</span>
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#ef4444', fontFamily: 'monospace' }}>{s.count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            );
          })()}
        </Section>

      </div>

      {/* S3 deep-dive: Category Breakdown */}
      {(s3Loading || (s3Feedback && !s3Feedback.configMissing)) && (
        <Section title="S3 Feedback Categories" sub="S3 Parquet · feedback_category field breakdown">
          {s3Loading || !s3Feedback ? (
            <div style={{ ...CARD, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {[80, 60, 45, 35, 25].map((w) => (
                <div key={w} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{ width: '110px', height: '10px', background: 'var(--sp-s3)', borderRadius: '3px', flexShrink: 0, animation: 'pulse 1.5s ease-in-out infinite' }} />
                  <div style={{ flex: 1, height: '12px', background: 'var(--sp-s3)', borderRadius: '3px', width: `${w}%`, animation: 'pulse 1.5s ease-in-out infinite' }} />
                  <div style={{ width: '38px', height: '10px', background: 'var(--sp-s3)', borderRadius: '2px', flexShrink: 0, animation: 'pulse 1.5s ease-in-out infinite' }} />
                </div>
              ))}
            </div>
          ) : !s3Feedback.categoryCounts || Object.keys(s3Feedback.categoryCounts).length === 0 ? (
            <div style={{ ...CARD, color: 'var(--sp-tx2)', fontSize: '0.72rem', padding: '0.75rem', textAlign: 'center' }}>No category data in this range.</div>
          ) : (
            <div style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
              {Object.entries(s3Feedback.categoryCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, count]: [string, number], _i: number, sorted: Array<[string, number]>) => {
                  const total: number = sorted.reduce((s: number, [, n]: [string, number]) => s + n, 0);
                  const pct: number = total > 0 ? (count / total) * 100 : 0;
                  return (
                    <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.38rem 0.75rem', borderBottom: '1px solid var(--sp-border)' }}>
                      <span style={{ width: '110px', fontSize: '0.68rem', color: 'var(--sp-tx1)', textTransform: 'capitalize', flexShrink: 0 }}>{cat.replace(/_/g, ' ')}</span>
                      <div style={{ flex: 1, background: 'var(--sp-s3)', borderRadius: '3px', height: '12px' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: '#0891b2', borderRadius: '3px', transition: 'width 0.4s' }} />
                      </div>
                      <span style={{ width: '40px', fontSize: '0.68rem', fontWeight: 700, fontFamily: 'monospace', color: 'var(--sp-tx1)', flexShrink: 0 }}>{count.toLocaleString()}</span>
                      <span style={{ width: '38px', fontSize: '0.62rem', color: 'var(--sp-tx2)', fontFamily: 'monospace', flexShrink: 0 }}>{pct.toFixed(1)}%</span>
                    </div>
                  );
                })}
            </div>
          )}
        </Section>
      )}


    </div>
  );
}
