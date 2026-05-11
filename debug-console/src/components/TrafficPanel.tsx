'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ChartEmptyState, ChartLoadingState } from '@/components/analytics/ChartStates';
import { CloudflareChartsGrid, formatBandwidth } from '@/components/analytics/CloudflareChartsGrid';
import type { CloudflareAppTraffic, CloudflareBucketInterval } from '@/lib/analytics/cloudflare-db';
import { isDateRangeValid } from '@/lib/analytics/date-range';

// Matches the Apps tab preset semantics. getDateRange in page.tsx is
// module-local; replicate the subset we need here rather than export it.
function getPresetRange(preset: Exclude<TrafficPreset, 'custom'>): { start: Date; end: Date } {
  const now = Date.now();
  const spanMs = preset === '1h' ? 60 * 60 * 1000
    : preset === '1d' ? 24 * 60 * 60 * 1000
    : preset === '7d' ? 6 * 24 * 60 * 60 * 1000
    : preset === '14d' ? 13 * 24 * 60 * 60 * 1000
    : 29 * 24 * 60 * 60 * 1000;
  return { start: new Date(now - spanMs), end: new Date(now) };
}

// Supported presets for this panel — matches the /analytics Cloudflare tab.
type TrafficPreset = '1h' | '1d' | '7d' | '14d' | '30d' | 'custom';
const TRAFFIC_PRESETS = ['1h', '1d', '7d', '14d', '30d', 'custom'] as const;

interface TrafficPanelProps {
  appId: string;
  appDomains: string[];
  refreshKey: number;
  // kept symmetric with LogsPanel even if unused today — makes future
  // refresh-toolbar wiring trivial.
  onRefresh: () => void;
}

function resolveWindow(preset: TrafficPreset, customStart: string, customEnd: string): {
  startMs: number | null; endMs: number | null; bucketInterval: CloudflareBucketInterval;
} {
  if (preset === 'custom') {
    if (!customStart || !customEnd || !isDateRangeValid(customStart, customEnd)) {
      return { startMs: null, endMs: null, bucketInterval: '1h' };
    }
    const startMs = new Date(`${customStart}T00:00:00.000Z`).getTime();
    const endMs = new Date(`${customEnd}T23:59:59.999Z`).getTime();
    const spanDays = (endMs - startMs) / (24 * 60 * 60 * 1000);
    const bucketInterval: CloudflareBucketInterval = spanDays <= 2 ? '15m' : spanDays <= 14 ? '1h' : '1d';
    return { startMs, endMs, bucketInterval };
  }
  const { start, end } = getPresetRange(preset);
  const bucketInterval: CloudflareBucketInterval =
    preset === '1h' ? '5m'
    : preset === '1d' ? '15m'
    : preset === '7d' || preset === '14d' ? '1h'
    : '1d';
  return { startMs: start.getTime(), endMs: end.getTime(), bucketInterval };
}

export default function TrafficPanel({ appId, appDomains, refreshKey, onRefresh: _onRefresh }: TrafficPanelProps) {
  const [preset, setPreset] = useState<TrafficPreset>('1d');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');
  const [chartSize, setChartSize] = useState<'small' | 'large' | 'full'>('large');
  const [data, setData] = useState<CloudflareAppTraffic | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomStart, setZoomStart] = useState<number>(0);
  const [zoomEnd, setZoomEnd] = useState<number>(100);
  const onZoomChange = useCallback((s: number, e: number) => {
    setZoomStart(s); setZoomEnd(e);
  }, []);
  useEffect(() => { setZoomStart(0); setZoomEnd(100); }, [preset, customStart, customEnd]);

  // Sorted comma-joined fqdn list — stable identity for the effect deps
  // so parent rerenders that produce a new appDomains array reference
  // with identical content don't trigger a refetch. Doubles as the
  // `domains` query-string value (order doesn't matter to the API).
  const domainsKey = useMemo(() => [...appDomains].sort().join(','), [appDomains]);

  useEffect(() => {
    if (!appId) return;
    if (!domainsKey) {
      setData(null);
      setError(null);
      return;
    }
    const { startMs, endMs, bucketInterval } = resolveWindow(preset, customStart, customEnd);
    if (startMs == null || endMs == null) { setData(null); return; }
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const qs = new URLSearchParams({
      action: 'cloudflare-app-traffic',
      domains: domainsKey,
      startMs: String(startMs),
      endMs: String(endMs),
      bucketInterval,
    });
    fetch(`/api/analytics?${qs.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const json: CloudflareAppTraffic = await res.json();
        setData(json);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to fetch Cloudflare data');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [appId, domainsKey, preset, customStart, customEnd, refreshKey]);

  if (!appId) return <ChartEmptyState message="Load an app to see traffic" />;
  if (appDomains.length === 0) return <ChartEmptyState message="This app has no domains attached" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
        Source: <strong>PDNA cloudflare logs</strong> (<code>airo-app-cloudflare-cdn-logs-prod-*</code>), filtered to this app&apos;s {appDomains.length} domain{appDomains.length === 1 ? '' : 's'}.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', backgroundColor: 'rgba(255,255,255,0.97)', padding: '0.3rem 0.5rem', borderRadius: '10px', boxShadow: '0 2px 10px rgba(0,0,0,0.08)' }}>
          <span style={{ fontSize: '0.62rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Range</span>
          {TRAFFIC_PRESETS.map(p => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              style={{
                padding: '0.3rem 0.65rem',
                backgroundColor: preset === p ? '#1d4ed8' : '#f3f4f6',
                color: preset === p ? 'white' : '#374151',
                border: 'none', borderRadius: '6px', cursor: 'pointer',
                fontSize: '0.72rem', fontWeight: 500,
              }}
            >{p}</button>
          ))}
          {preset === 'custom' && (
            <>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={{ fontSize: '0.72rem', padding: '0.25rem 0.4rem', borderRadius: '4px', border: '1px solid #d1d5db' }} />
              <span style={{ color: '#64748b', fontSize: '0.7rem' }}>→</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={{ fontSize: '0.72rem', padding: '0.25rem 0.4rem', borderRadius: '4px', border: '1px solid #d1d5db' }} />
            </>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', backgroundColor: 'rgba(255,255,255,0.97)', padding: '0.3rem 0.5rem', borderRadius: '10px', boxShadow: '0 2px 10px rgba(0,0,0,0.08)' }}>
          <span style={{ fontSize: '0.62rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Size</span>
          {(['small', 'large', 'full'] as const).map(id => (
            <button
              key={id}
              onClick={() => setChartSize(id)}
              style={{
                padding: '0.3rem 0.65rem',
                backgroundColor: chartSize === id ? '#1d4ed8' : '#f3f4f6',
                color: chartSize === id ? 'white' : '#374151',
                border: 'none', borderRadius: '6px', cursor: 'pointer',
                fontSize: '0.72rem', fontWeight: 500,
              }}
            >{id === 'small' ? 'S' : id === 'large' ? 'L' : 'Full'}</button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <ChartLoadingState />
      ) : error ? (
        <div style={{ backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: '10px', padding: '1rem', borderLeft: '4px solid #ef4444' }}>
          <p style={{ margin: 0, color: '#dc2626', fontWeight: 600, fontSize: '0.8rem' }}>Traffic error: {error}</p>
        </div>
      ) : data ? (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: '0.6rem',
          }}>
            {[
              { label: 'Total Requests', value: data.totalRequests.toLocaleString(), color: '#1e40af' },
              { label: 'Unique Clients', value: data.uniqueClients.toLocaleString(), color: '#0ea5e9' },
              { label: 'Bandwidth', value: formatBandwidth(data.sumBytes), color: '#10b981' },
              { label: 'p50 Latency', value: data.p50Ms != null ? `${data.p50Ms.toFixed(0)} ms` : '—', color: '#0ea5e9' },
              { label: 'p95 Latency', value: data.p95Ms != null ? `${data.p95Ms.toFixed(0)} ms` : '—', color: '#0284c7' },
              (() => {
                const total = data.statusClassDaily.reduce((s, d) => s + d.c2xx + d.c3xx + d.c4xx + d.c5xx + d.cOther, 0);
                const c5xx = data.statusClassDaily.reduce((s, d) => s + d.c5xx, 0);
                const pct = total > 0 ? ((c5xx / total) * 100).toFixed(1) : '0.0';
                return { label: '5xx Rate', value: `${pct}% (${c5xx.toLocaleString()})`, color: '#dc2626' };
              })(),
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                backgroundColor: 'rgba(255,255,255,0.97)',
                padding: '0.6rem 0.8rem',
                borderRadius: '10px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
              }}>
                <div style={{ fontSize: '0.58rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color, fontFamily: 'monospace', marginTop: '0.15rem' }}>{value}</div>
              </div>
            ))}
          </div>

          <CloudflareChartsGrid
            data={data}
            perDomainBreakdown={data.perDomainBreakdown}
            group="traffic"
            zoomStart={zoomStart}
            zoomEnd={zoomEnd}
            onZoomChange={onZoomChange}
            chartSize={chartSize}
            // Per-app view: skip fleet-level edge-colo + security charts;
            // they're not actionable at the app scale.
            showEdgeCharts={false}
          />
        </>
      ) : (
        <ChartEmptyState message="No traffic data for this window" />
      )}
    </div>
  );
}
