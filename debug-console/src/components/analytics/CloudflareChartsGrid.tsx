'use client';

import { useMemo } from 'react';

import type {
  CloudflareOverview,
  CloudflareTerm,
} from '@/lib/analytics/cloudflare-db';

import { EChartsMiniChart } from './EChartsMiniChart';
import { HelpBadge } from './HelpBadge';

export interface CloudflareChartsGridProps {
  data: CloudflareOverview;
  /** Set when rendering the per-app panel. Caller side controls which
   *  domains appear; the grid just draws a horizontal list. */
  perDomainBreakdown?: CloudflareTerm[];
  /** ECharts group — all charts render the shared crosshair. Use the
   *  same string across every chart in the enclosing view. */
  group: string;
  /** Controlled zoom state so every chart in `group` renders the same
   *  window through React re-renders (echarts.connect alone is flaky
   *  with `notMerge`, see EChartsMiniChart docstring). */
  zoomStart: number;
  zoomEnd: number;
  onZoomChange: (start: number, end: number) => void;
  /** Size toggle state from the enclosing view (S/L/Full). */
  chartSize: 'small' | 'large' | 'full';
  /** Hide charts that aren't meaningful for the per-app view. */
  showEdgeCharts?: boolean;
}

const PLAN_COLORS = {
  c2xx: '#22c55e',
  c3xx: '#3b82f6',
  c4xx: '#f59e0b',
  c5xx: '#dc2626',
  cOther: '#94a3b8',
};

function formatBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(2)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function formatShortBucket(d: string): string {
  // date-histogram keys come back as ISO strings. For short intervals
  // show HH:MM; for longer ones show MMM DD.
  const dt = new Date(d);
  const today = new Date();
  if (dt.toDateString() === today.toDateString()) {
    return dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function CloudflareChartsGrid({
  data, perDomainBreakdown, group, zoomStart, zoomEnd, onZoomChange, chartSize, showEdgeCharts = true,
}: CloudflareChartsGridProps) {
  const requestsChart = useMemo(
    () => data.requestsDaily.map(d => ({
      value: d.count,
      label: formatShortBucket(d.date),
      tooltip: `${formatShortBucket(d.date)}: ${d.count.toLocaleString()} reqs`,
    })),
    [data.requestsDaily],
  );

  const statusStacked = useMemo(() => {
    if (data.statusClassDaily.length === 0) return null;
    return [
      { name: '2xx', color: PLAN_COLORS.c2xx, values: data.statusClassDaily.map(d => d.c2xx) },
      { name: '3xx', color: PLAN_COLORS.c3xx, values: data.statusClassDaily.map(d => d.c3xx) },
      { name: '4xx', color: PLAN_COLORS.c4xx, values: data.statusClassDaily.map(d => d.c4xx) },
      { name: '5xx', color: PLAN_COLORS.c5xx, values: data.statusClassDaily.map(d => d.c5xx) },
      { name: 'other', color: PLAN_COLORS.cOther, values: data.statusClassDaily.map(d => d.cOther) },
    ];
  }, [data.statusClassDaily]);

  const latencyData = useMemo(
    () => data.latencyDaily.map(d => ({
      value: d.p50Ms ?? 0,
      label: formatShortBucket(d.date),
      tooltip: `${formatShortBucket(d.date)}: p50=${d.p50Ms?.toFixed(0) ?? '—'}ms, p95=${d.p95Ms?.toFixed(0) ?? '—'}ms`,
    })),
    [data.latencyDaily],
  );

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: chartSize === 'full' ? '1fr'
        : chartSize === 'large' ? 'repeat(auto-fit, minmax(560px, 1fr))'
        : 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: '1rem',
    }}>
      {/* #1 Requests */}
      <EChartsMiniChart
        group={group}
        size={chartSize}
        zoomStart={zoomStart}
        zoomEnd={zoomEnd}
        onZoomChange={onZoomChange}
        title="Requests"
        chartNumber={1}
        help={{
          what: 'Number of Cloudflare CDN requests per time bucket.',
          how: 'date_histogram on event_timestamp at the bucket interval the UI picks for the selected preset.',
          reading: 'Shape = when traffic arrives. Flat-line gaps would indicate an edge outage or an ingestion lag.',
        }}
        value={`Total: ${data.requestsDaily.reduce((s, d) => s + d.count, 0).toLocaleString()}`}
        valueColor="#1e40af"
        data={requestsChart}
        barColor="#1e40af"
        barColorLight="#93c5fd"
        markAverage
      />

      {/* #2 Status class stacked */}
      {statusStacked && (
        <EChartsMiniChart
          group={group}
          size={chartSize}
          zoomStart={zoomStart}
          zoomEnd={zoomEnd}
          onZoomChange={onZoomChange}
          title="Status class (stacked)"
          chartNumber={2}
          help={{
            what: 'Per-bucket count of responses by HTTP status class (2xx / 3xx / 4xx / 5xx).',
            how: 'Same date_histogram as #1, sub-aggregated by a painless script that maps status_code → its 100-bucket.',
            reading: '3xx dominance is normal for a redirector fleet. A visible red band (5xx) is worth investigating.',
          }}
          value={`5xx: ${data.statusClassDaily.reduce((s, d) => s + d.c5xx, 0).toLocaleString()}`}
          valueColor="#dc2626"
          data={requestsChart}
          barColor="#1e40af"
          stackedSeries={statusStacked}
          seriesName="Requests"
        />
      )}

      {/* #3 Latency (area) */}
      {data.latencyDaily.some(d => d.p50Ms != null) && (
        <EChartsMiniChart
          group={group}
          size={chartSize}
          zoomStart={zoomStart}
          zoomEnd={zoomEnd}
          onZoomChange={onZoomChange}
          title="Latency p50 (ms)"
          chartNumber={3}
          help={{
            what: 'Per-bucket median total_session_time — from Cloudflare seeing the request to the client closing the connection.',
            how: 'percentiles(50) on total_session_time inside each date_histogram bucket.',
            reading: `Overall: p50=${data.p50Ms?.toFixed(0) ?? '—'}ms, p95=${data.p95Ms?.toFixed(0) ?? '—'}ms. Spikes usually point at origin slowness (see origin_response_time in the raw log).`,
          }}
          value={`p50: ${data.p50Ms?.toFixed(0) ?? '—'}ms · p95: ${data.p95Ms?.toFixed(0) ?? '—'}ms`}
          valueColor="#0ea5e9"
          data={latencyData}
          barColor="#0ea5e9"
          barColorLight="#7dd3fc"
          areaMode
        />
      )}

      {/* Categorical pills rows — not time series, so plain lists */}
      <CategoryList title="Cache result" items={data.cacheResult} total={data.totalRequests} />
      <CategoryList title="HTTP methods" items={data.methods} total={data.totalRequests} />

      {/* Top domains */}
      <RankList title="Top domains" items={data.topDomains.slice(0, 10)} />

      {showEdgeCharts && (
        <>
          <RankList title="Top edge colos" items={data.topColos.slice(0, 10)} />
          {data.securityActions.length > 0 && (
            <CategoryList title="Security actions" items={data.securityActions} total={data.totalRequests} />
          )}
        </>
      )}

      {/* Per-app domain breakdown — only when caller supplies it. */}
      {perDomainBreakdown && perDomainBreakdown.length > 0 && (
        <RankList
          title="This app's domains"
          items={perDomainBreakdown}
          emptyHint="No traffic seen for this app's domains in the selected window."
          help={{
            what: "Per-domain traffic split for the app's fqdns (custom + preview/publish subdomains).",
            how: `terms(url.domain.keyword) with include=[${perDomainBreakdown.map(d => d.key).join(', ')}].`,
            reading: 'Zero on a published domain = nobody hit it. Zero on a preview subdomain is normal unless the editor is open.',
          }}
          sizeBytes={formatBytes(data.sumBytes)}
        />
      )}
    </div>
  );
}

function CategoryList({ title, items, total }: { title: string; items: CloudflareTerm[]; total: number }) {
  return (
    <div style={cardStyle}>
      <div style={cardHeaderStyle}>{title}</div>
      {items.length === 0 ? <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>—</div> : items.map(it => {
        const pct = total > 0 ? (it.count / total) * 100 : 0;
        return (
          <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem', fontSize: '0.75rem', color: '#334155' }}>
            <span style={{ flexBasis: '8rem', flexShrink: 0 }}>{it.key}</span>
            <div style={{ flex: 1, height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.max(pct, 1)}%`, background: '#1e40af' }} />
            </div>
            <span style={{ flexBasis: '7rem', textAlign: 'right', fontFamily: 'monospace' }}>{it.count.toLocaleString()} ({pct.toFixed(1)}%)</span>
          </div>
        );
      })}
    </div>
  );
}

function RankList({
  title,
  items,
  emptyHint,
  help,
  sizeBytes,
}: {
  title: string;
  items: CloudflareTerm[];
  emptyHint?: string;
  help?: { what: string; how: string; reading: string };
  sizeBytes?: string;
}) {
  const maxCount = Math.max(1, ...items.map(i => i.count));
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <div style={{ ...cardHeaderStyle, marginBottom: 0, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          {title}
          {help && <HelpBadge info={help} color="#1e40af" />}
        </div>
        {sizeBytes && <span style={{ fontSize: '0.7rem', color: '#64748b', fontFamily: 'monospace' }}>{sizeBytes}</span>}
      </div>
      {items.length === 0 ? (
        <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{emptyHint ?? '—'}</div>
      ) : items.map(it => (
        <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem', fontSize: '0.75rem', color: '#334155' }}>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.key}>{it.key}</span>
          <div style={{ flexBasis: '6rem', height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
            <div style={{ height: '100%', width: `${(it.count / maxCount) * 100}%`, background: '#1e40af' }} />
          </div>
          <span style={{ flexBasis: '5rem', textAlign: 'right', fontFamily: 'monospace', flexShrink: 0 }}>{it.count.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.97)',
  padding: '1rem 1.25rem',
  borderRadius: '10px',
  boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
};

const cardHeaderStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontWeight: 600,
  marginBottom: '0.6rem',
};

export function formatBandwidth(n: number): string { return formatBytes(n); }
