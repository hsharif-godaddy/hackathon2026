'use client';

import React, { Component, ErrorInfo, ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import type { MetricDataPoint, MetricsResponse } from '@/lib/langfuse-types';
import MetricsTrendsPanel from './MetricsTrendsPanel';

interface ChartDataPoint {
    time: string;
    value: number;
    tooltip: string;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

class LangfuseMetricErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
    constructor(props: { children: ReactNode }) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    backgroundColor: 'rgba(255,255,255,0.97)',
                    borderRadius: '10px',
                    padding: '1rem 1.25rem',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
                    height: '100%',
                }}>
                    <div style={{ fontSize: '0.7rem', color: '#ef4444' }}>
                        ⚠️ Error loading metric
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

interface MetricCardProps {
    title: string;
    data: ChartDataPoint[];
    loading: boolean;
    error: string | null;
    avgValue: number;
    barColor: string;
    barColorLight: string;
    onClick: () => void;
}

function MetricCard({ title, data, loading, error, avgValue, barColor, barColorLight, onClick }: MetricCardProps) {
    const maxValue = Math.max(...data.map(d => d.value), 1);
    const barHeight = 70;

    return (
        <div
            onClick={onClick}
            style={{
                backgroundColor: 'rgba(255,255,255,0.97)',
                padding: '1rem 1.25rem',
                borderRadius: '10px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)';
                e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = '0 2px 10px rgba(0,0,0,0.08)';
                e.currentTarget.style.transform = 'translateY(0)';
            }}
        >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                    {title}
                </div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: barColor }}>
                    {loading ? '...' : error ? '—' : `Avg: ${avgValue.toFixed(2)}`}
                </div>
            </div>

            {/* Chart Area */}
            {loading ? (
                <div style={{ height: `${barHeight + 20}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '0.65rem' }}>
                    Loading...
                </div>
            ) : error ? (
                <div style={{ height: `${barHeight + 20}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444', fontSize: '0.65rem' }}>
                    {error.length > 30 ? error.substring(0, 30) + '...' : error}
                </div>
            ) : data.length === 0 ? (
                <div style={{ height: `${barHeight + 20}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '0.65rem' }}>
                    No data
                </div>
            ) : (
                <div style={{ position: 'relative', height: `${barHeight + 20}px` }}>
                    {/* Grid lines */}
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: barHeight, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', pointerEvents: 'none' }}>
                        {[0, 1, 2].map(i => (
                            <div key={i} style={{ borderBottom: '1px solid #f1f5f9', width: '100%' }} />
                        ))}
                    </div>

                    {/* Bars */}
                    <div style={{ display: 'flex', alignItems: 'flex-end', height: barHeight, gap: '2px', position: 'relative', zIndex: 1 }}>
                        {data.map((d, i) => (
                            <div
                                key={i}
                                style={{
                                    flex: 1,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                }}
                                title={d.tooltip}
                            >
                                <div
                                    style={{
                                        width: '100%',
                                        maxWidth: '28px',
                                        height: `${Math.max((d.value / maxValue) * barHeight, 2)}px`,
                                        backgroundColor: barColor,
                                        borderRadius: '3px 3px 0 0',
                                        transition: 'all 0.2s ease',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = barColorLight;
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = barColor;
                                    }}
                                />
                            </div>
                        ))}
                    </div>

                    {/* X-axis labels */}
                    <div style={{ display: 'flex', marginTop: '4px', gap: '2px' }}>
                        {data.map((d, i) => {
                            const showLabel = i === 0 || i === data.length - 1 || i === Math.floor(data.length / 2);
                            return (
                                <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: '0.55rem', color: '#94a3b8' }}>
                                    {showLabel ? d.time : ''}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

interface MetricData {
    name: string;
    data: ChartDataPoint[];
    avg: number;
}

const METRIC_CONFIG: Record<string, { title: string; color: string; colorLight: string }> = {
    'Conciseness': { title: 'Conciseness (LF)', color: '#3b82f6', colorLight: '#60a5fa' },
    'Goal Accuracy': { title: 'Goal Accuracy (LF)', color: '#10b981', colorLight: '#34d399' },
    'Helpfulness': { title: 'Helpfulness (LF)', color: '#f59e0b', colorLight: '#fbbf24' },
};

interface LangfuseMetricCardsProps {
    fromTimestamp: string;
    toTimestamp: string;
}

export default function LangfuseMetricCards({ fromTimestamp, toTimestamp }: LangfuseMetricCardsProps) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [metrics, setMetrics] = useState<MetricData[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [rawData, setRawData] = useState<Array<{ time: string; [key: string]: string | number }>>([]);
    const [metricNames, setMetricNames] = useState<string[]>([]);
    const abortControllerRef = useRef<AbortController | null>(null);
    const isFetchingRef = useRef(false);

    const fetchMetrics = useCallback(async function fetchData() {
        if (isFetchingRef.current) {
            return;
        }

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        const abortController = new AbortController();
        abortControllerRef.current = abortController;
        isFetchingRef.current = true;

        setLoading(true);
        setError(null);

        try {
            const query = {
                view: 'scores-numeric',
                dimensions: [{ field: 'name' }],
                metrics: [{ measure: 'value', aggregation: 'avg' }],
                filters: [],
                timeDimension: { granularity: 'day' },
                fromTimestamp,
                toTimestamp,
                orderBy: null,
            };

            const response = await fetch(`/api/langfuse/metrics?query=${encodeURIComponent(JSON.stringify(query))}`, {
                signal: abortController.signal,
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result: MetricsResponse = await response.json();

            if (!result.data || result.data.length === 0) {
                setMetrics([]);
                setLoading(false);
                return;
            }

            const uniqueMetricNames = Array.from(new Set(result.data.map((d) => d.name)));
            setMetricNames(uniqueMetricNames);

            // Build raw data for modal
            const timeMap = new Map<string, Record<string, string | number>>();
            result.data.forEach((point) => {
                const timeKey = point.time_dimension;
                if (!timeMap.has(timeKey)) {
                    timeMap.set(timeKey, { timeTimestamp: timeKey });
                }
                timeMap.get(timeKey)![point.name] = point.avg_value;
            });

            const chartData = Array.from(timeMap.entries())
                .map(([timestamp, point]) => ({
                    ...point,
                    time: new Date(timestamp).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                    }),
                    _sortKey: timestamp,
                }))
                .sort((a, b) => new Date(a._sortKey as string).getTime() - new Date(b._sortKey as string).getTime())
                .map(({ _sortKey, ...rest }) => rest);

            setRawData(chartData);

            // Process data per metric
            const metricsMap = new Map<string, { points: MetricDataPoint[]; sum: number; count: number }>();

            result.data.forEach((point) => {
                if (!metricsMap.has(point.name)) {
                    metricsMap.set(point.name, { points: [], sum: 0, count: 0 });
                }
                const metric = metricsMap.get(point.name)!;
                metric.points.push(point);
                metric.sum += point.avg_value;
                metric.count += 1;
            });

            const processedMetrics: MetricData[] = [];

            for (const [name, { points, sum, count }] of metricsMap) {
                const sortedPoints = points.sort((a, b) =>
                    new Date(a.time_dimension).getTime() - new Date(b.time_dimension).getTime()
                );

                processedMetrics.push({
                    name,
                    data: sortedPoints.map(p => ({
                        time: new Date(p.time_dimension).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
                        value: p.avg_value,
                        tooltip: `${new Date(p.time_dimension).toLocaleDateString()}: ${p.avg_value.toFixed(2)}`,
                    })),
                    avg: sum / count,
                });
            }

            setMetrics(processedMetrics);
        } catch (err) {
            if (abortController.signal.aborted) {
                return;
            }
            setError(err instanceof Error ? err.message : 'Failed to fetch');
        } finally {
            setLoading(false);
            isFetchingRef.current = false;
            if (abortControllerRef.current === abortController) {
                abortControllerRef.current = null;
            }
        }
    }, [fromTimestamp, toTimestamp]);

    useEffect(() => {
        fetchMetrics();

        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
            isFetchingRef.current = false;
        };
    }, [fetchMetrics]);

    const handleCloseModal = function handleClose() {
        setIsModalOpen(false);
    };

    const handleBackdropClick = function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
        if (e.target === e.currentTarget) {
            handleCloseModal();
        }
    };

    // Get the 3 main metrics in order
    const targetMetrics = ['Conciseness', 'Goal Accuracy', 'Helpfulness'];
    const displayMetrics = targetMetrics.map(name => {
        const found = metrics.find(m => m.name === name);
        return found || { name, data: [], avg: 0 };
    });

    return (
        <LangfuseMetricErrorBoundary>
            {displayMetrics.map((metric) => {
                const config = METRIC_CONFIG[metric.name] || { title: metric.name, color: '#6b7280', colorLight: '#9ca3af' };
                return (
                    <MetricCard
                        key={metric.name}
                        title={config.title}
                        data={metric.data}
                        loading={loading}
                        error={error}
                        avgValue={metric.avg}
                        barColor={config.color}
                        barColorLight={config.colorLight}
                        onClick={() => setIsModalOpen(true)}
                    />
                );
            })}

            {/* Modal/Popup */}
            {isModalOpen && (
                <div
                    onClick={handleBackdropClick}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                        zIndex: 9999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '1rem',
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            backgroundColor: 'white',
                            borderRadius: '12px',
                            width: '100%',
                            maxWidth: '1200px',
                            maxHeight: '90vh',
                            overflow: 'auto',
                            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                            position: 'relative',
                        }}
                    >
                        <button
                            onClick={handleCloseModal}
                            style={{
                                position: 'absolute',
                                top: '1rem',
                                right: '1rem',
                                background: 'none',
                                border: 'none',
                                fontSize: '1.5rem',
                                cursor: 'pointer',
                                color: '#6b7280',
                                padding: '0.25rem 0.5rem',
                                lineHeight: 1,
                                zIndex: 10000,
                                borderRadius: '4px',
                                transition: 'all 0.2s',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = '#f3f4f6';
                                e.currentTarget.style.color = '#1f2937';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                                e.currentTarget.style.color = '#6b7280';
                            }}
                        >
                            ×
                        </button>

                        <div style={{ padding: '1.5rem' }}>
                            <MetricsTrendsPanel
                                initialData={rawData}
                                initialMetricNames={metricNames}
                                initialFromTimestamp={fromTimestamp}
                                initialToTimestamp={toTimestamp}
                            />
                        </div>
                    </div>
                </div>
            )}
        </LangfuseMetricErrorBoundary>
    );
}
