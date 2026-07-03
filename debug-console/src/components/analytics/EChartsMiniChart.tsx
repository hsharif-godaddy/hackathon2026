'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import ReactECharts from 'echarts-for-react/lib/core';
import type EChartsReactCore from 'echarts-for-react/lib/core';

import { HelpBadge, type HelpInfo } from './HelpBadge';

// Register only what we need — keeps the ECharts bundle ≈ 300 KB instead
// of the full ~700 KB. Adding a new chart type? Import + pass it here.
echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, DataZoomComponent, LegendComponent, MarkLineComponent, MarkAreaComponent, CanvasRenderer]);

// Show a zoom slider once the point count gets high enough that the
// compressed bars are unreadable. Tuned by eye: 30+ days is where it
// starts to hurt.
const DATA_ZOOM_MIN_POINTS = 30;

// Chart body height per size mode. Zoom adds ~20px for the slider
// regardless of mode so the plot area stays roughly proportional.
function chartHeightForSize(size: 'small' | 'large' | 'full', showZoom: boolean): number {
  const base = size === 'full' ? 340 : size === 'large' ? 220 : 110;
  return showZoom ? base + 20 : base;
}

/**
 * Optional line series drawn on a secondary y-axis, used for showing a
 * ratio/percentage (e.g. "% of the day's cohort that reached publish")
 * alongside the primary bar series. Line values are typically 0–100.
 */
export interface EChartsOverlay {
  name: string;
  values: Array<number | null>; // same length as `data`
  color: string;
  /** Suffix appended in tooltip, e.g. "%". Defaults to "". */
  unit?: string;
  /** Max for the secondary axis. Defaults to 100. */
  max?: number;
}

/**
 * Stacked-bar mode. When provided, replaces the single bar series that's
 * normally driven by `data[].value` with N stacked segments. Each
 * segment's values must align 1:1 with `data[].label` (x-axis order).
 */
export interface EChartsStackedSeries {
  name: string;
  color: string;
  values: number[];
}

export interface EChartsMiniChartProps {
  title: string;
  value: string;
  valueColor: string;
  data: Array<{ value: number; label: string; tooltip: string }>;
  barColor: string;
  barColorLight?: string;
  onClick?: (index: number) => void;
  backAction?: () => void;
  showBack?: boolean;
  chartNumber?: number;
  help?: HelpInfo;
  /**
   * Opt-in chart-to-chart sync. Charts passing the same `group` string
   * share an x-axis crosshair: hover a day in one chart, the same
   * day lights up on every other chart in the group.
   */
  group?: string;
  /** Optional ratio/percentage line on a secondary y-axis. */
  overlay?: EChartsOverlay;
  /**
   * Optional stacked-bar breakdown. When provided, the single bar series
   * driven by `data[].value` is replaced with N stacked segments, one per
   * entry. `data` is still used for x-axis labels and the bucket tooltip.
   */
  stackedSeries?: EChartsStackedSeries[];
  /** Label for the primary bar series in the tooltip (default: "Count"). */
  seriesName?: string;
  /** Draw a dashed horizontal line at the mean of the primary series. */
  markAverage?: boolean;
  /**
   * Indices (into `data`) of weekend days. When provided, each index gets
   * a faint vertical shaded band to visualize weekend rhythm at a glance.
   */
  weekendIndices?: number[];
  /**
   * Swap the primary bar series for a smooth filled area curve. Better
   * suited for latency-style trend metrics (e.g. p50 hours) than counts.
   * Stacked mode takes precedence if both are set.
   */
  areaMode?: boolean;
  /**
   * Size mode. `small` (default) ≈ 110px tall, matches the legacy
   * MiniChart. `large` doubles height, `full` triples it — used with a
   * wider grid column to give the chart breathing room.
   */
  size?: 'small' | 'large' | 'full';
  /**
   * Controlled zoom window in percent (0–100). When provided, the chart
   * uses these as the dataZoom start/end so multiple charts in the same
   * group can be driven by the same React state (keeps sync stable
   * across re-renders, which `echarts.connect` alone doesn't guarantee
   * when `notMerge` replaces the option each render).
   */
  zoomStart?: number;
  zoomEnd?: number;
  onZoomChange?: (start: number, end: number) => void;
}

export function EChartsMiniChart({
  title, value, valueColor, data, barColor, barColorLight,
  onClick, backAction, showBack, chartNumber, help, group, overlay, stackedSeries, seriesName = 'Count',
  markAverage, weekendIndices, areaMode, size = 'small',
  zoomStart, zoomEnd, onZoomChange,
}: EChartsMiniChartProps) {
  const chartRef = useRef<EChartsReactCore | null>(null);
  const showZoom = data.length > DATA_ZOOM_MIN_POINTS;

  const option = useMemo<echarts.EChartsCoreOption>(() => {
    // Label interval: with narrow charts and many buckets, showing every
    // label is unreadable. Match the heuristic the legacy MiniChart uses:
    // ≤7 points → every label, ≤14 → every other, else every 4th.
    const labelInterval = data.length <= 7 ? 0 : data.length <= 14 ? 1 : 3;
    // Default zoom: show the full selected range. The slider exists so
    // the user can narrow if they want; we don't second-guess the date
    // range they already picked in the header. When zoomStart/zoomEnd
    // props are provided (controlled mode), use those — caller-owned
    // state keeps multiple charts in the group rendering the same
    // window even through re-renders where `notMerge` would otherwise
    // wipe dataZoom state.
    const startPct = zoomStart ?? 0;
    const endPct = zoomEnd ?? 100;

    // markLine: dashed horizontal line at the mean of data[].value. In
    // stacked mode data[].value should already be the daily total (the
    // caller sums segments when building the row), so this stays correct.
    const avgValue = markAverage && data.length > 0
      ? data.reduce((s, d) => s + d.value, 0) / data.length
      : null;
    const markLineConfig = avgValue != null ? {
      silent: true,
      symbol: 'none' as const,
      lineStyle: { type: 'dashed' as const, color: '#64748b', width: 1 },
      label: {
        fontSize: 9,
        color: '#475569',
        position: 'insideEndTop' as const,
        formatter: `avg ${avgValue >= 10 ? Math.round(avgValue) : avgValue.toFixed(1)}`,
      },
      data: [{ yAxis: avgValue }],
    } : undefined;

    // markArea: faint vertical band on each weekend column. Same endpoint
    // on both sides of the pair collapses to a single-category band that
    // covers the full column slot in a category bar chart.
    const markAreaConfig = weekendIndices && weekendIndices.length > 0 ? {
      silent: true,
      itemStyle: { color: 'rgba(148, 163, 184, 0.12)' },
      data: weekendIndices
        .filter(i => i >= 0 && i < data.length)
        .map(i => ([
          { xAxis: data[i].label },
          { xAxis: data[i].label },
        ])),
    } : undefined;

    return {
      animation: false,
      grid: {
        top: 4,
        right: 4,
        bottom: showZoom ? 38 : 20,
        left: 4,
        containLabel: false,
      },
      xAxis: {
        type: 'category',
        data: data.map(d => d.label),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 9,
          color: '#94a3b8',
          interval: labelInterval,
          margin: 6,
        },
      },
      yAxis: overlay
        ? [
            { type: 'value', show: false, splitLine: { show: false } },
            {
              type: 'value',
              show: false,
              min: 0,
              max: overlay.max ?? 100,
              splitLine: { show: false },
            },
          ]
        : { type: 'value', show: false, splitLine: { show: false } },
      tooltip: {
        trigger: 'axis',
        confine: true,
        position: function tooltipPosition(
          point: [number, number],
          _params: unknown,
          _dom: unknown,
          _rect: unknown,
          size: { contentSize: [number, number]; viewSize: [number, number] },
        ) {
          const gap = 14;
          let x = point[0] - size.contentSize[0] - gap;
          if (x < 8) {
            x = point[0] + gap;
          }
          const y = Math.min(
            Math.max(8, point[1] - size.contentSize[1] / 2),
            size.viewSize[1] - size.contentSize[1] - 8,
          );
          return [x, y];
        },
        backgroundColor: 'rgba(255, 255, 255, 0.94)',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        padding: [10, 12],
        textStyle: { fontSize: 11, color: '#0f172a' },
        extraCssText:
          'border-radius:12px;box-shadow:0 10px 30px rgba(59,130,246,0.12),0 2px 8px rgba(15,23,42,0.06);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);',
        axisPointer: {
          type: 'shadow',
          z: 0,
          shadowStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(191, 219, 254, 0.42)' },
              { offset: 0.45, color: 'rgba(224, 242, 254, 0.2)' },
              { offset: 1, color: 'rgba(255, 255, 255, 0.03)' },
            ]),
          },
        },
        formatter: (params: unknown) => {
          const arr = Array.isArray(params) ? params : [params];
          const first = arr[0] as { dataIndex?: number } | undefined;
          const idx = first?.dataIndex;
          if (typeof idx !== 'number') return '';
          const baseLine = data[idx]?.tooltip ?? '';
          const parts: string[] = [baseLine];
          // Stacked breakdown: show one row per segment with a colored dot.
          if (stackedSeries && stackedSeries.length > 0) {
            const total = stackedSeries.reduce((s, ss) => s + (ss.values[idx] ?? 0), 0);
            for (const ss of stackedSeries) {
              const v = ss.values[idx] ?? 0;
              if (v === 0) continue;
              const swatch = `<span style="display:inline-block;margin-right:4px;border-radius:50%;width:7px;height:7px;background:${ss.color}"></span>`;
              parts.push(`${swatch}${ss.name}: <b>${v.toLocaleString()}</b>`);
            }
            if (stackedSeries.length > 1) parts.push(`<span style="color:#94a3b8">Total: <b>${total.toLocaleString()}</b></span>`);
          }
          if (overlay) {
            const overlayVal = overlay.values[idx];
            if (overlayVal != null) {
              const swatch = `<span style="display:inline-block;margin-right:4px;border-radius:50%;width:7px;height:7px;background:${overlay.color}"></span>`;
              parts.push(`${swatch}${overlay.name}: <b>${overlayVal}${overlay.unit ?? ''}</b>`);
            }
          }
          return parts.join('<br>');
        },
      },
      ...(showZoom ? {
        dataZoom: [
          { type: 'inside', start: startPct, end: endPct, zoomLock: false },
          {
            type: 'slider',
            start: startPct,
            end: endPct,
            height: 16,
            bottom: 4,
            borderColor: 'transparent',
            backgroundColor: '#f1f5f9',
            fillerColor: 'rgba(30,64,175,0.15)',
            handleStyle: { color: '#1e293b', borderColor: '#1e293b' },
            moveHandleSize: 4,
            showDetail: false,
            labelFormatter: '',
          },
        ],
      } : {}),
      series: [
        // Stacked mode: one bar series per breakdown segment, all
        // rendered on yAxisIndex=0 with the same stack ID so ECharts
        // stacks them. The last segment gets rounded corners on top to
        // match the single-series look.
        ...(stackedSeries && stackedSeries.length > 0
          ? stackedSeries.map((ss, i) => {
              const isTop = i === stackedSeries.length - 1;
              return {
                name: ss.name,
                type: 'bar' as const,
                stack: 'total',
                yAxisIndex: 0,
                data: ss.values,
                itemStyle: {
                  color: ss.color,
                  borderRadius: isTop ? ([2, 2, 0, 0] as [number, number, number, number]) : ([0, 0, 0, 0] as [number, number, number, number]),
                },
                emphasis: {
                  focus: 'series' as const,
                  itemStyle: {
                    shadowBlur: 14,
                    shadowColor: 'rgba(37, 99, 235, 0.28)',
                    shadowOffsetY: 2,
                  },
                },
                barMaxWidth: data.length <= 7 ? 40 : data.length <= 14 ? 28 : 14,
                cursor: onClick ? 'pointer' : 'default',
                // Large-mode rendering: uses a simplified path that
                // skips per-bar interaction polish (shadow, fine border
                // radius) in exchange for much cheaper draws. Only kicks
                // in above the threshold — 1yr daily (~365) stays below
                // it; denser future series (hourly, per-cell) benefit.
                large: true,
                largeThreshold: 200,
                // Attach annotations to the top segment so the avg line
                // sits over the stack and the weekend bands span its full
                // column. Non-top segments skip markLine/markArea.
                ...(isTop && markLineConfig ? { markLine: markLineConfig } : {}),
                ...(isTop && markAreaConfig ? { markArea: markAreaConfig } : {}),
              };
            })
          : areaMode
            ? [{
                // Smooth filled area — used for latency-style trend
                // metrics where the shape of the curve matters more than
                // the per-day bar magnitude.
                name: seriesName,
                type: 'line' as const,
                data: data.map(d => d.value),
                yAxisIndex: 0,
                smooth: true,
                showSymbol: false,
                sampling: 'lttb' as const,
                // Progressive render for very long series. A no-op below
                // the threshold; above it ECharts chunks the initial
                // paint so the UI thread doesn't freeze on load.
                progressive: 300,
                progressiveThreshold: 500,
                lineStyle: { color: barColor, width: 2 },
                itemStyle: { color: barColor },
                areaStyle: {
                  color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: barColor },
                    { offset: 1, color: barColorLight ?? barColor },
                  ]),
                  opacity: 0.35,
                },
                emphasis: {
                  focus: 'series' as const,
                  lineStyle: { width: 3, shadowBlur: 10, shadowColor: 'rgba(37, 99, 235, 0.22)' },
                },
                ...(markLineConfig ? { markLine: markLineConfig } : {}),
                ...(markAreaConfig ? { markArea: markAreaConfig } : {}),
              }]
            : [{
                name: seriesName,
                type: 'bar' as const,
                data: data.map(d => d.value),
                yAxisIndex: 0,
                itemStyle: {
                  color: onClick ? barColor : (barColorLight ?? barColor),
                  borderRadius: [2, 2, 0, 0] as [number, number, number, number],
                },
                emphasis: {
                  itemStyle: {
                    color: barColor,
                    opacity: 1,
                    shadowBlur: 16,
                    shadowColor: 'rgba(37, 99, 235, 0.32)',
                    shadowOffsetY: 3,
                  },
                },
                barMaxWidth: data.length <= 7 ? 40 : data.length <= 14 ? 28 : 14,
                cursor: onClick ? 'pointer' : 'default',
                large: true,
                largeThreshold: 200,
                ...(markLineConfig ? { markLine: markLineConfig } : {}),
                ...(markAreaConfig ? { markArea: markAreaConfig } : {}),
              }]),
        ...(overlay ? [{
          name: overlay.name,
          type: 'line' as const,
          yAxisIndex: 1,
          data: overlay.values,
          smooth: true,
          showSymbol: false,
          lineStyle: { color: overlay.color, width: 1.5 },
          itemStyle: { color: overlay.color },
          emphasis: { focus: 'series' as const },
          silent: false,
          z: 2,
        }] : []),
      ],
    };
  }, [data, barColor, barColorLight, onClick, showZoom, overlay, stackedSeries, seriesName, markAverage, weekendIndices, areaMode, zoomStart, zoomEnd]);

  const events = useMemo(() => {
    // Mixed handler shape: `click` gets `{dataIndex}`, `datazoom` gets
    // `{start, end}` (via batch[0] on mouse-drag). Typed loosely so we
    // can register both on the same onEvents map.
    const handlers: Record<string, (params: unknown) => void> = {};
    if (onClick) {
      handlers.click = (params) => {
        const p = params as { dataIndex: number };
        onClick(p.dataIndex);
      };
    }
    if (onZoomChange) {
      handlers.datazoom = (params) => {
        // Drag on the slider emits `{batch: [{start, end}]}`;
        // inside-zoom (wheel/pinch) emits `{start, end}` directly.
        const p = params as { start?: number; end?: number; batch?: Array<{ start?: number; end?: number }> };
        const start = p.start ?? p.batch?.[0]?.start;
        const end = p.end ?? p.batch?.[0]?.end;
        if (typeof start === 'number' && typeof end === 'number') {
          onZoomChange(start, end);
        }
      };
    }
    return handlers;
  }, [onClick, onZoomChange]);

  // Bind the instance to a group so ECharts syncs tooltip + axis pointer
  // across every chart sharing the same `group` string. Safe to call
  // `connect` on every mount — ECharts dedupes internally.
  useEffect(() => {
    if (!group) return;
    const instance = chartRef.current?.getEchartsInstance() as
      | (echarts.ECharts & { group: string })
      | undefined;
    if (!instance) return;
    instance.group = group;
    echarts.connect(group);
  }, [group]);

  return (
    <div style={{
      backgroundColor: 'rgba(255,255,255,0.97)',
      padding: '1rem 1.25rem',
      borderRadius: '10px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
          {typeof chartNumber === 'number' && (
            <span style={{ backgroundColor: '#1e293b', color: 'white', borderRadius: '4px', padding: '0 0.35rem', fontSize: '0.6rem', fontWeight: 700, letterSpacing: 0, flexShrink: 0 }}>
              #{chartNumber}
            </span>
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          {help && <HelpBadge info={help} color={valueColor} />}
          {showBack && backAction && (
            <span style={{ fontSize: '0.6rem', color: valueColor, cursor: 'pointer', fontWeight: 500 }} onClick={backAction}>← back</span>
          )}
        </div>
        <div style={{ fontSize: '1rem', fontWeight: 700, color: valueColor, flexShrink: 0, marginLeft: '0.5rem' }}>
          {value}
        </div>
      </div>
      <ReactECharts
        ref={chartRef}
        echarts={echarts}
        option={option}
        onEvents={events}
        opts={{ renderer: 'canvas' }}
        style={{ height: chartHeightForSize(size, showZoom), width: '100%' }}
        notMerge
        lazyUpdate
      />
    </div>
  );
}
