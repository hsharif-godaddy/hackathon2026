'use client';

import { Cell, Pie, PieChart, Tooltip } from 'recharts';

import { CARD, IntervalChart, Section, StatCard } from '../../components';
import type { IntervalDataPoint, IntervalSeries } from '../../components';
import { SkeletonBlock, SkeletonCardGrid, SkeletonChart } from '../../components/Skeleton';
import { bmpVal } from '../../hooks/useBmpData';
import type { ScorecardBmpFeedbackData } from '../../hooks/useBmpData';
import type { ScorecardS3FeedbackData } from '../../hooks/useS3Feedback';
import type { ScorecardChartSize, ScorecardData, TrendView } from '../../types';
import { aggregateByView, viewLabel as trendViewLabel } from '../../trendAggregation';
import { buildStarTrendPoints, CAT_COLORS, Donut, fmtWeek, STAR_COLORS, starColor, Tip } from './shared';

interface Props {
  data:        ScorecardData;
  range:       string;
  chartSize:   ScorecardChartSize;
  trendView?:  TrendView;
  s3Feedback?: ScorecardS3FeedbackData | null;
  s3Loading?:  boolean;
  bmpData?:    ScorecardBmpFeedbackData | null;
}

export function FeedbackOverview({ data, range, chartSize, trendView = 'daily', s3Feedback, s3Loading, bmpData }: Props) {
  const fb:        typeof data.feedback = data.feedback;
  const donutSize: number               = chartSize === 'full' ? 90 : chartSize === 'large' ? 82 : 72;

  const s3AvgColor: string = s3Feedback && !s3Feedback.configMissing && s3Feedback.avgRating !== null
    ? (s3Feedback.avgRating >= 6 ? '#10b981' : s3Feedback.avgRating >= 4 ? '#f59e0b' : '#ef4444')
    : '#94a3b8';

  const bmpFbMetrics                = bmpData?.metrics ?? [];
  const bmpFbTotal:    number       = bmpFbMetrics.reduce((acc, m) => acc + bmpVal(m.aggregatedSummary, 'total_count'), 0);
  const bmpFbPositive: number       = bmpFbMetrics.reduce((acc, m) => acc + bmpVal(m.aggregatedSummary, 'positive_count'), 0);
  const thumbsUpPct:   number | null = bmpFbTotal > 0 ? Math.round((bmpFbPositive / bmpFbTotal) * 100) : null;
  const loveAvg:       number | null = s3Feedback && !s3Feedback.configMissing && s3Feedback.avgRating !== null ? s3Feedback.avgRating : null;
  const positiveRatePct: number | null = s3Feedback && !s3Feedback.configMissing && s3Feedback.total > 0
    ? Math.round((s3Feedback.positive / s3Feedback.total) * 100)
    : null;

  const ivMap = new Map<string, { pos: number; neg: number; tot: number }>();
  for (const m of bmpFbMetrics) {
    for (const iv of (m.intervals ?? [])) {
      const ex = ivMap.get(iv.startTime);
      if (ex) {
        ex.pos += bmpVal(iv.intervalSummary, 'positive_count');
        ex.neg += bmpVal(iv.intervalSummary, 'negative_count');
        ex.tot += bmpVal(iv.intervalSummary, 'total_count');
      } else {
        ivMap.set(iv.startTime, {
          pos: bmpVal(iv.intervalSummary, 'positive_count'),
          neg: bmpVal(iv.intervalSummary, 'negative_count'),
          tot: bmpVal(iv.intervalSummary, 'total_count'),
        });
      }
    }
  }
  const bmpIntervals = [...ivMap.entries()].sort(([a], [b]) => a.localeCompare(b));

  const thumbsRawPoints: IntervalDataPoint[] = (trendView === 'daily' ? bmpIntervals.slice(-14) : bmpIntervals).map(([startTime, v]) => ({
    label: fmtWeek(startTime),
    _date: startTime.slice(0, 10),
    up:    v.pos,
    down:  v.neg,
    total: v.tot,
  }));

  const thumbsAgg: IntervalDataPoint[]      = aggregateByView(thumbsRawPoints, ['up', 'down', 'total'], trendView);
  const thumbsChartData: IntervalDataPoint[] = thumbsAgg.map((pt): IntervalDataPoint => ({
    ...pt,
    rate: (pt.total as number) > 0 ? Math.round(((pt.up as number) / (pt.total as number)) * 1000) / 10 : 0,
  }));
  const thumbsChartSeries: IntervalSeries[] = [
    { key: 'rate',  label: 'Rate %', color: '#7c3aed', format: (v) => `${v.toFixed(1)}%` },
    { key: 'up',    label: 'Up',     color: '#10b981', format: (v) => v.toLocaleString() },
    { key: 'down',  label: 'Down',   color: '#ef4444', format: (v) => v.toLocaleString() },
    { key: 'total', label: 'Total',  color: 'var(--sp-tx2)', format: (v) => v.toLocaleString() },
  ];

  const vLabel:      string  = trendViewLabel(trendView);
  const s3Ready:     boolean = !!(s3Feedback && !s3Feedback.configMissing);
  const hasDailyDist: boolean = s3Ready && !!s3Feedback?.dailyDistribution && Object.keys(s3Feedback.dailyDistribution!).length > 0;

  if (s3Loading && !s3Feedback) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '0.9rem' }}>
          <SkeletonChart height="140px" />
          <SkeletonCardGrid count={4} columns="repeat(auto-fit, minmax(100px, 1fr))" />
        </div>
        <SkeletonChart height="148px" />
        <SkeletonBlock w="100%" h="80px" radius="10px" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>

      {/* Top row: Thumbs Up/Down (left) + Metrics (right) */}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '0.9rem', alignItems: 'stretch' }}>

        {/* Thumbs Up/Down */}
        <Section title="Thumbs Up / Down" sub="BMP · agent_feedback_count" style={{ height: '100%' }}>
          {bmpData == null ? (
            <div style={{ ...CARD, padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              <SkeletonBlock w="56%" h="14px" radius="3px" />
              <SkeletonBlock w="40%" h="14px" radius="3px" />
              <SkeletonBlock w="55%" h="14px" radius="3px" />
            </div>
          ) : bmpData.configMissing ? (
            <div style={{ ...CARD, color: 'var(--sp-tx2)', fontSize: '0.72rem', padding: '0.75rem', textAlign: 'center' }}>
              BMP not configured — set <code>BMP_API_TOKEN</code> in .env.local.
            </div>
          ) : bmpData.error ? (
            <div style={{ ...CARD, color: '#ef4444', fontSize: '0.72rem', padding: '0.75rem', textAlign: 'center' }}>
              BMP error: {bmpData.error}
            </div>
          ) : (() => {
            const fbMetrics = bmpData.metrics ?? [];
            if (fbMetrics.length === 0) return (
              <div style={{ ...CARD, color: 'var(--sp-tx2)', fontSize: '0.72rem', padding: '0.75rem', textAlign: 'center' }}>No feedback data in this range.</div>
            );
            const positiveCount: number = fbMetrics.reduce((acc, m) => acc + bmpVal(m.aggregatedSummary, 'positive_count'), 0);
            const negativeCount: number = fbMetrics.reduce((acc, m) => acc + bmpVal(m.aggregatedSummary, 'negative_count'), 0);
            const totalCount:    number = fbMetrics.reduce((acc, m) => acc + bmpVal(m.aggregatedSummary, 'total_count'), 0);
            if (totalCount === 0) return (
              <div style={{ ...CARD, color: 'var(--sp-tx2)', fontSize: '0.72rem', padding: '0.75rem', textAlign: 'center' }}>No feedback data in this range.</div>
            );
            const positivePct: number = (positiveCount / totalCount) * 100;
            return (
              <div style={{ ...CARD, padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem', flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                  <Donut rate={Math.round(positivePct)} label="" size={82} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.22rem' }}>
                    <Tip text="Users who gave a thumbs up to an AI message. Source: BMP agent_feedback_count · positive_count.">
                      <span style={{ fontSize: '0.68rem', color: '#10b981', fontWeight: 600 }}>👍 {positiveCount.toLocaleString()} positive</span>
                    </Tip>
                    <Tip text="Users who gave a thumbs down to an AI message. Source: BMP agent_feedback_count · negative_count.">
                      <span style={{ fontSize: '0.68rem', color: '#ef4444', fontWeight: 600 }}>👎 {negativeCount.toLocaleString()} negative</span>
                    </Tip>
                    <Tip text="Total thumbs feedback responses (up + down). Source: BMP agent_feedback_count · total_count.">
                      <span style={{ fontSize: '0.65rem', color: 'var(--sp-tx2)' }}>{totalCount.toLocaleString()} total</span>
                    </Tip>
                    <Tip text="positive_count ÷ total_count × 100. Calculated from raw counts.">
                      <span style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)' }}>rate: <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--sp-tx1)' }}>{positivePct.toFixed(1)}%</span></span>
                    </Tip>
                  </div>
                </div>
                {fb.appFeedbackTotal + fb.agentFeedbackTotal + fb.msgFeedbackTotal > 0 && (
                  <div style={{ borderTop: '1px solid var(--sp-border)', paddingTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.28rem' }}>
                    <span style={{ fontSize: '0.55rem', fontWeight: 700, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.05rem' }}>By Level</span>
                    {([
                      { label: 'App Gen', rate: fb.appPositiveRate,   total: fb.appFeedbackTotal   },
                      { label: 'Agent',   rate: fb.agentPositiveRate, total: fb.agentFeedbackTotal },
                      { label: 'Chat',    rate: fb.msgPositiveRate,   total: fb.msgFeedbackTotal   },
                    ] as const).filter((r) => r.total > 0).map((r) => {
                      const pct: number = r.rate ?? 0;
                      const col: string = pct >= 65 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';
                      return (
                        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ width: '50px', fontSize: '0.62rem', color: 'var(--sp-tx2)', flexShrink: 0 }}>{r.label}</span>
                          <div style={{ flex: 1, background: 'var(--sp-s3)', borderRadius: '3px', height: '11px' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: col, borderRadius: '3px', transition: 'width 0.4s' }} />
                          </div>
                          <span style={{ width: '36px', fontSize: '0.62rem', fontFamily: 'monospace', fontWeight: 700, color: col, flexShrink: 0, textAlign: 'right' }}>{r.rate !== null ? `${r.rate}%` : '—'}</span>
                          <span style={{ width: '32px', fontSize: '0.57rem', color: 'var(--sp-txm)', fontFamily: 'monospace', flexShrink: 0, textAlign: 'right' }}>{r.total}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}
        </Section>

        {/* Metrics */}
        <Section title="Feedback Metrics" sub={`BMP · S3 Parquet · last ${range}`} style={{ height: '100%' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
            <StatCard label="Love it or Leave it" value={loveAvg !== null ? loveAvg.toFixed(1) : null} description="avg / 7 · target ≥6 · S3" accent="premium"
              help={{ what: 'Average "Love it or Leave it" score on a 1–7 scale — the primary KR2 quality/satisfaction metric.', how: 'Mean score across all S3 Parquet feedback submissions in the range.', reading: 'Target ≥6.0. Below 4 is a red signal. Drives the KR2 goal.' }} />
            <StatCard label="Positive Rate" value={positiveRatePct !== null ? `${positiveRatePct}%` : null} description="ratings ≥6 ÷ total · S3" accent="info"
              help={{ what: '% of ratings that were 6 or 7 — a direct measure of user satisfaction.', how: 'positive (≥6) ÷ total × 100 · S3 Parquet feedback submissions.', reading: 'Higher is better. Pairs with the avg score to understand the distribution shape.' }} />
            <StatCard label="Agent Feedback" value={thumbsUpPct !== null ? `${thumbsUpPct}%` : null} description="thumbs-up rate · BMP"
              help={{ what: 'Share of AI responses rated thumbs-up by users in the selected range.', how: 'positive_count ÷ total_count × 100 · BMP agent_feedback_count.', reading: 'Target ≥65%. Drops here often correlate with poor generation quality.' }} />
            <StatCard label="Total Ratings" value={s3Ready ? s3Feedback!.total : null} description="rating submissions · S3"
              help={{ what: 'Total "Love it or Leave it" rating submissions in the selected range.', how: 'Count of S3 Parquet feedback rows with a valid 1–7 rating.', reading: 'Sample size indicator — low counts make the avg score less statistically reliable.' }} />
            {s3Ready && (
              <>
                <StatCard label="Positive (≥6)" value={s3Feedback!.positive.toLocaleString()} description="ratings 6–7 · S3" accent="info"
                  help={{ what: 'Count of ratings of 6 or 7 — users who had a positive experience.', how: 'S3 Parquet items with rating ≥ 6.', reading: 'Compare to Neutral and Negative counts to understand satisfaction distribution.' }} />
                <StatCard label="Neutral (4–5)" value={s3Feedback!.neutral.toLocaleString()} description="ratings 4–5 · S3"
                  help={{ what: 'Count of ratings of 4 or 5 — users who had a mixed/neutral experience.', how: 'S3 Parquet items with rating 4 or 5.', reading: 'Mid-range satisfaction. Opportunity to convert neutrals to promoters.' }} />
                <StatCard label="Negative (1–3)" value={s3Feedback!.negative.toLocaleString()} description="ratings 1–3 · S3"
                  help={{ what: 'Count of ratings of 1, 2 or 3 — users who had a negative experience.', how: 'S3 Parquet items with rating ≤ 3.', reading: 'Primary dissatisfaction signal. Check Deep Dive for comments.' }} />
              </>
            )}
          </div>
        </Section>

      </div>

      {/* Customer Rating + Feedback Categories — side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: chartSize === 'full' ? '1fr' : 'repeat(2, 1fr)', gap: '0.9rem', alignItems: 'stretch' }}>

        <Section title="Customer Rating" sub="S3 Parquet · 1–7 scale" style={{ height: '100%' }}>
          {s3Feedback == null ? (
            <div style={{ ...CARD, padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              {[7, 6, 5, 4, 3].map((i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{ width: '14px', height: '10px', background: 'var(--sp-s3)', borderRadius: '2px', flexShrink: 0, animation: 'pulse 1.5s ease-in-out infinite' }} />
                  <div style={{ flex: 1, height: '12px', background: 'var(--sp-s3)', borderRadius: '3px', width: `${30 + i * 8}%`, animation: 'pulse 1.5s ease-in-out infinite' }} />
                  <div style={{ width: '32px', height: '10px', background: 'var(--sp-s3)', borderRadius: '2px', flexShrink: 0, animation: 'pulse 1.5s ease-in-out infinite' }} />
                </div>
              ))}
            </div>
          ) : s3Feedback.configMissing ? (
            <div style={{ ...CARD, color: 'var(--sp-tx2)', fontSize: '0.72rem', padding: '0.75rem', textAlign: 'center' }}>
              S3 not configured — set <code>FEEDBACK_S3_BUCKET</code> in .env.local.
            </div>
          ) : s3Feedback.total === 0 ? (
            <div style={{ ...CARD, color: 'var(--sp-tx2)', fontSize: '0.72rem', padding: '0.75rem', textAlign: 'center' }}>
              No numeric ratings found in this range.
            </div>
          ) : (
            <div style={{ ...CARD, padding: '0.75rem 1rem', display: 'flex', gap: '1.25rem', alignItems: 'flex-start', flexWrap: 'wrap', flex: 1 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flexShrink: 0 }}>
                <Tip text="Average 'Love it or Leave it' score out of 7. Target ≥6.">
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ fontSize: chartSize === 'large' ? '3rem' : '2.4rem', fontWeight: 900, fontFamily: 'monospace', color: s3AvgColor, lineHeight: 1 }}>
                      {s3Feedback.avgRating?.toFixed(1) ?? '—'}
                    </span>
                    <span style={{ fontSize: '0.58rem', color: 'var(--sp-tx2)', marginTop: '2px' }}>avg / 7 · target ≥6</span>
                  </div>
                </Tip>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  <Tip text="Ratings of 6 or 7 — user had a positive experience.">
                    <span style={{ fontSize: '0.68rem', color: '#10b981', fontWeight: 600 }}>👍 {s3Feedback.positive.toLocaleString()} positive (≥6)</span>
                  </Tip>
                  <Tip text="Ratings of 4 or 5 — user had a mixed or neutral experience.">
                    <span style={{ fontSize: '0.68rem', color: '#f59e0b', fontWeight: 600 }}>😐 {s3Feedback.neutral.toLocaleString()} neutral (4–5)</span>
                  </Tip>
                  <Tip text="Ratings of 1, 2 or 3 — user had a negative experience.">
                    <span style={{ fontSize: '0.68rem', color: '#ef4444', fontWeight: 600 }}>👎 {s3Feedback.negative.toLocaleString()} negative (1–3)</span>
                  </Tip>
                  <Tip text="Total 'Love it or Leave it' rating submissions.">
                    <span style={{ fontSize: '0.65rem', color: 'var(--sp-tx2)' }}>{s3Feedback.total.toLocaleString()} total</span>
                  </Tip>
                </div>
                {(s3Feedback.partitionErrors ?? 0) > 0 && (
                  <span style={{ fontSize: '0.58rem', color: '#f59e0b' }}>
                    {s3Feedback.partitionErrors} partition{s3Feedback.partitionErrors === 1 ? '' : 's'} failed
                  </span>
                )}
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: chartSize === 'large' ? '0.48rem' : '0.28rem', minWidth: '160px' }}>
                {([7, 6, 5, 4, 3, 2, 1] as const).map((score) => {
                  const count: number = s3Feedback.distribution[String(score)] ?? 0;
                  const pct:   number = s3Feedback.total > 0 ? (count / s3Feedback.total) * 100 : 0;
                  const color: string = starColor(score);
                  return (
                    <div key={score} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ width: '14px', fontSize: '0.68rem', fontWeight: 700, color: 'var(--sp-tx2)', textAlign: 'right', flexShrink: 0 }}>{score}</span>
                      <div style={{ flex: 1, background: 'var(--sp-s3)', borderRadius: '3px', height: chartSize === 'large' ? '22px' : '16px' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width 0.4s' }} />
                      </div>
                      <span style={{ width: '42px', fontSize: '0.65rem', color: 'var(--sp-tx2)', fontFamily: 'monospace', flexShrink: 0, textAlign: 'right' }}>{count.toLocaleString()}</span>
                      <span style={{ width: '36px', fontSize: '0.6rem', color: 'var(--sp-txm)', fontFamily: 'monospace', flexShrink: 0, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Section>

        <Section title="Feedback Categories" sub="S3 Parquet · feedback_category breakdown" style={{ height: '100%' }}>
          {s3Feedback == null ? (
            <div style={{ ...CARD, padding: '0.75rem 1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <div style={{ width: 130, height: 130, borderRadius: '50%', background: 'var(--sp-s3)', flexShrink: 0, animation: 'pulse 1.5s ease-in-out infinite' }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {[70, 55, 40, 30, 20].map((w) => (
                  <div key={w} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: 'var(--sp-s3)', flexShrink: 0, animation: 'pulse 1.5s ease-in-out infinite' }} />
                    <div style={{ height: '10px', background: 'var(--sp-s3)', borderRadius: '3px', width: `${w}%`, animation: 'pulse 1.5s ease-in-out infinite' }} />
                  </div>
                ))}
              </div>
            </div>
          ) : s3Feedback.configMissing ? (
            <div style={{ ...CARD, color: 'var(--sp-tx2)', fontSize: '0.72rem', padding: '0.75rem', textAlign: 'center' }}>
              S3 not configured.
            </div>
          ) : !s3Feedback.categoryCounts || Object.keys(s3Feedback.categoryCounts).length === 0 ? (
            <div style={{ ...CARD, color: 'var(--sp-tx2)', fontSize: '0.72rem', padding: '0.75rem', textAlign: 'center' }}>
              No category data in this range.
            </div>
          ) : (() => {
            const sorted: Array<[string, number]> = Object.entries(s3Feedback.categoryCounts).sort((a, b) => b[1] - a[1]);
            const catTotal: number = sorted.reduce((s: number, [, n]: [string, number]) => s + n, 0);
            const pieData: Array<{ name: string; value: number; fill: string }> = sorted.map(
              ([cat, count]: [string, number], i: number) => ({
                name:  cat.replace(/_/g, ' '),
                value: count,
                fill:  CAT_COLORS[i % CAT_COLORS.length] as string,
              }),
            );
            return (
              <div style={{ ...CARD, padding: '0.75rem 1rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
                <div style={{ flexShrink: 0 }}>
                  <PieChart width={chartSize === 'large' ? 170 : 130} height={chartSize === 'large' ? 170 : 130}>
                    <Pie
                      data={pieData} dataKey="value" cx="50%" cy="50%"
                      innerRadius={chartSize === 'large' ? 50 : 38} outerRadius={chartSize === 'large' ? 76 : 60} paddingAngle={2}
                      stroke="var(--sp-bg)" strokeWidth={2}
                    >
                      {pieData.map((entry: { name: string; value: number; fill: string }) => (
                        <Cell key={entry.name} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number, name: string) => [v.toLocaleString(), name]}
                      contentStyle={{ fontSize: '11px', background: '#151b24', border: '1px solid #252f3e', borderRadius: '6px', padding: '5px 9px' }}
                      itemStyle={{ color: '#f1f5f9', fontWeight: 600 }}
                      labelStyle={{ color: '#a8b8cc', marginBottom: '2px' }}
                      cursor={false}
                    />
                  </PieChart>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: chartSize === 'large' ? '0.45rem' : '0.28rem', minWidth: '120px' }}>
                  {sorted.map(([cat, count]: [string, number], i: number) => {
                    const pct: number = catTotal > 0 ? (count / catTotal) * 100 : 0;
                    const col: string = CAT_COLORS[i % CAT_COLORS.length] as string;
                    return (
                      <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: col, flexShrink: 0 }} />
                        <span style={{ fontSize: '0.65rem', color: 'var(--sp-tx1)', textTransform: 'capitalize', flex: 1 }}>{cat.replace(/_/g, ' ')}</span>
                        <span style={{ fontSize: '0.65rem', fontFamily: 'monospace', fontWeight: 700, color: 'var(--sp-tx1)', flexShrink: 0 }}>{count.toLocaleString()}</span>
                        <span style={{ fontSize: '0.6rem', fontFamily: 'monospace', color: 'var(--sp-tx2)', width: '36px', textAlign: 'right', flexShrink: 0 }}>{pct.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </Section>

      </div>

      {/* Feedback by Level */}
      {fb.appFeedbackTotal + fb.agentFeedbackTotal + fb.msgFeedbackTotal > 0 && (
        <Section title="Feedback by Level" sub="BMP · thumbs-up rate per feedback prompt level">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {([
              { label: 'App Gen', rate: fb.appPositiveRate,   total: fb.appFeedbackTotal   },
              { label: 'Agent',   rate: fb.agentPositiveRate, total: fb.agentFeedbackTotal  },
              { label: 'Chat',    rate: fb.msgPositiveRate,   total: fb.msgFeedbackTotal    },
            ].filter((r) => r.total > 0)).map(({ label, rate, total }) => (
              <div
                key={label}
                style={{
                  ...CARD, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem',
                  padding: '0.75rem', flex: '1 1 80px', textAlign: 'center',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
                }}
              >
                <Donut rate={rate} label={label} size={donutSize} />
                <span style={{ fontSize: '0.6rem', color: 'var(--sp-tx2)' }}>{total} ratings</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: chartSize === 'full' ? '1fr' : '1fr 1fr', gap: '0.9rem', alignItems: 'stretch' }}>

        {/* Star Rating Trend */}
        <Section title="Star Rating Trend" sub={`S3 Parquet · daily count per star rating (1–7) · ${vLabel}`} style={{ height: '100%' }}>
          {s3Loading ? (
            <div style={{ ...CARD, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {[80, 60, 40].map((w) => (
                <div key={w} style={{ height: '14px', width: `${w}%`, background: 'var(--sp-s3)', borderRadius: '3px', animation: 'pulse 1.5s ease-in-out infinite' }} />
              ))}
              <div style={{ height: '140px', background: 'var(--sp-s3)', borderRadius: '6px', animation: 'pulse 1.5s ease-in-out infinite' }} />
            </div>
          ) : !s3Ready ? (
            <div style={{ ...CARD, color: 'var(--sp-tx2)', fontSize: '0.72rem', padding: '0.75rem', textAlign: 'center' }}>
              {s3Feedback?.configMissing ? 'S3 not configured — set FEEDBACK_S3_BUCKET in .env.local.' : 'No data in this range.'}
            </div>
          ) : !hasDailyDist ? (
            <div style={{ ...CARD, color: 'var(--sp-tx2)', fontSize: '0.72rem', padding: '0.75rem', textAlign: 'center' }}>
              No daily breakdown available for this range.
            </div>
          ) : (() => {
            const { points, series } = buildStarTrendPoints(s3Feedback!.dailyDistribution!, trendView);
            if (points.length === 0) return (
              <div style={{ ...CARD, color: 'var(--sp-tx2)', fontSize: '0.72rem', padding: '0.75rem', textAlign: 'center' }}>No data points for this range and trend view.</div>
            );
            return (
              <div style={{ ...CARD, padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                  {([7, 6, 5, 4, 3, 2, 1] as const).map((score) => {
                    const total: number = s3Feedback!.distribution[String(score)] ?? 0;
                    const color: string = STAR_COLORS[String(score)]!;
                    return (
                      <span key={score} style={{ display: 'flex', alignItems: 'center', gap: '0.22rem', fontSize: '0.6rem', color: 'var(--sp-tx2)' }}>
                        <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px', background: color, flexShrink: 0 }} />
                        ★{score} <span style={{ fontFamily: 'monospace', fontWeight: 700, color }}>{total.toLocaleString()}</span>
                      </span>
                    );
                  })}
                </div>
                <IntervalChart
                  data={points}
                  series={series}
                  size={chartSize}
                  defaultType="line"
                  defaultActive={['s7', 's6', 's5', 's4', 's3']}
                />
              </div>
            );
          })()}
        </Section>

        {/* Thumbs Trend */}
        {bmpIntervals.length > 0 ? (
          <Section title="Thumbs Trend" sub={`BMP · agent_feedback_count · thumbs up/down · ${vLabel}`} style={{ height: '100%' }}>
            <div style={{ ...CARD, padding: '0.75rem 1rem', flex: 1 }}>
              {thumbsChartData.length > 0 ? (
                <IntervalChart
                  data={thumbsChartData}
                  series={thumbsChartSeries}
                  size={chartSize}
                  defaultType="bar"
                  defaultActive={['rate', 'up', 'down']}
                />
              ) : (
                <div style={{ color: 'var(--sp-tx2)', fontSize: '0.72rem', textAlign: 'center' }}>No interval data in this range.</div>
              )}
            </div>
          </Section>
        ) : (!bmpData || bmpData.configMissing) ? (
          <div style={{ ...CARD, color: 'var(--sp-tx2)', fontSize: '0.72rem', padding: '0.75rem' }}>
            BMP not configured — thumbs trend unavailable.
          </div>
        ) : null}

      </div>

    </div>
  );
}
