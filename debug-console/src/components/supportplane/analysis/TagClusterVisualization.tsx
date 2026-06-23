'use client';

import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import sp from '@/components/supportplane/sp.module.css';

interface TagClusterData {
  tag: string;
  count: number;
  cluster: number;
  x: number;
  y: number;
  z: number;
  avgSentiment: number;
  unresolvedRate: number;
}

interface TagClusterVisualizationProps {
  onTagClick?: (tag: string) => void;
  daysBack?: number;
}

const CLUSTER_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6'];

export default function TagClusterVisualization({ onTagClick, daysBack: initialDaysBack = 30 }: TagClusterVisualizationProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);
  const [daysBack, setDaysBack] = useState<number>(initialDaysBack);
  const [clusters, setClusters] = useState<TagClusterData[]>([]);
  const [clusterLabels, setClusterLabels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchClusters = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/supportplane/transcripts/tag-clusters?days_back=${daysBack}&min_count=3`,
      );
      const data = await response.json() as { clusters?: TagClusterData[]; clusterLabels?: string[]; error?: string };
      if (!response.ok) {
        setError(data.error ?? 'Failed to load tag clusters');
      } else {
        setClusters(data.clusters ?? []);
        setClusterLabels(data.clusterLabels ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clusters');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchClusters(); }, [daysBack]);

  // Build/update chart when data or container is ready
  useEffect(() => {
    if (!chartRef.current || loading || error || clusters.length === 0) return;

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current, undefined, { renderer: 'svg' });
    }

    const series: echarts.ScatterSeriesOption[] = clusterLabels.map((label, clusterIdx) => {
      const clusterData = clusters.filter(c => c.cluster === clusterIdx);
      return {
        name: label,
        type: 'scatter',
        symbolSize: (val: number[]) => Math.min(40, 8 + Math.log(val[2] + 1) * 6),
        data: clusterData.map(c => ({
          value: [c.x, c.y, c.count, c.avgSentiment, c.unresolvedRate],
          name: c.tag,
        })),
        itemStyle: { color: CLUSTER_COLORS[clusterIdx % CLUSTER_COLORS.length], opacity: 0.82 },
        emphasis: { itemStyle: { opacity: 1, shadowBlur: 8, shadowColor: CLUSTER_COLORS[clusterIdx % CLUSTER_COLORS.length] } },
      };
    });

    chartInstance.current.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        formatter: (params: echarts.TooltipComponentFormatterCallbackParams) => {
          const p = params as { name: string; value: number[]; seriesName: string };
          return [
            `<b>${p.name}</b>`,
            `Cluster: ${p.seriesName}`,
            `Count: ${p.value[2]}`,
            `Avg Sentiment: ${p.value[3].toFixed(2)}`,
            `Unresolved: ${p.value[4].toFixed(1)}%`,
          ].join('<br/>');
        },
      },
      legend: {
        data: clusterLabels,
        right: 10,
        top: 10,
        textStyle: { color: 'var(--sp-tx2, #64748b)', fontSize: 11 },
      },
      xAxis: {
        name: 'Co-occurrence Dim 1',
        nameLocation: 'middle',
        nameGap: 28,
        splitLine: { lineStyle: { color: 'var(--sp-border, #e2e8f0)' } },
        axisLine: { lineStyle: { color: 'var(--sp-border, #e2e8f0)' } },
        axisLabel: { color: 'var(--sp-txm, #94a3b8)', fontSize: 10 },
        nameTextStyle: { color: 'var(--sp-txm, #94a3b8)', fontSize: 10 },
      },
      yAxis: {
        name: 'Co-occurrence Dim 2',
        nameLocation: 'middle',
        nameGap: 36,
        splitLine: { lineStyle: { color: 'var(--sp-border, #e2e8f0)' } },
        axisLine: { lineStyle: { color: 'var(--sp-border, #e2e8f0)' } },
        axisLabel: { color: 'var(--sp-txm, #94a3b8)', fontSize: 10 },
        nameTextStyle: { color: 'var(--sp-txm, #94a3b8)', fontSize: 10 },
      },
      grid: { left: 56, right: 140, top: 48, bottom: 48 },
      series,
    });

    if (onTagClick) {
      chartInstance.current.off('click');
      chartInstance.current.on('click', (params: echarts.ECElementEvent) => {
        const name = (params as { name?: string }).name;
        if (name) onTagClick(name);
      });
    }

    const observer = new ResizeObserver(() => chartInstance.current?.resize());
    observer.observe(chartRef.current);
    return () => { observer.disconnect(); };
  }, [clusters, clusterLabels, loading, error, onTagClick]);

  // Clean up on unmount
  useEffect(() => () => { chartInstance.current?.dispose(); }, []);

  if (loading) {
    return (
      <div className={sp.card} style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ width: 24, height: 24, border: '3px solid #0891b2', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
        <div style={{ fontSize: 13, color: 'var(--sp-txm)' }}>Analyzing tag clusters...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={sp.card} style={{ padding: 16 }}>
        <div className={sp.alertError}>
          {error}
        </div>
      </div>
    );
  }

  if (clusters.length === 0) {
    return (
      <div className={sp.card} style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--sp-txm)' }}>
          No tag data available. Generate tags for transcripts to see clusters.
        </div>
      </div>
    );
  }

  return (
    <div className={sp.card}>
      <div style={{ padding: 16, borderBottom: '1px solid var(--sp-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Tag Clusters — 2D Visualization</div>
          <div style={{ fontSize: 12, color: 'var(--sp-txm)', marginBottom: 6 }}>
            {clusters.length} tags grouped into {clusterLabels.length} clusters · bubble size = count
          </div>
          <div style={{ fontSize: 11, color: 'var(--sp-txm)' }}>
            <strong>Clusters:</strong>{' '}
            Publishing &amp; Infrastructure · UI/UX &amp; Design · AI &amp; Content · Account &amp; Access
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--sp-txm)' }}>Period:</label>
          <select
            value={daysBack}
            onChange={e => setDaysBack(parseInt(e.target.value, 10))}
            style={{ padding: '4px 8px', fontSize: 12, border: '1px solid var(--sp-border)', borderRadius: 4, background: 'var(--sp-bg)', color: 'var(--sp-tx)' }}
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>
      <div ref={chartRef} style={{ height: 480, width: '100%' }} />
    </div>
  );
}
