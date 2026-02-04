'use client';

import React, { Component, ErrorInfo, ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import {
    CartesianGrid,
    Legend as _Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

import MetricsTrendsPanel from './MetricsTrendsPanel';

interface MetricDataPoint {
    name: string;
    time_dimension: string;
    avg_value: number;
}

interface MetricsResponse {
    data: MetricDataPoint[];
}

interface ChartDataPoint {
    time: string;
    [key: string]: string | number;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

class MetricsTrendsErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
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
                    borderRadius: '12px',
                    padding: '1rem 1.25rem',
                    marginBottom: '1.25rem',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
                    borderLeft: '4px solid #ef4444',
                }}>
                    <h3 style={{
                        margin: '0 0 0.5rem 0',
                        fontSize: '1rem',
                        fontWeight: 600,
                        color: '#dc2626',
                    }}>
                        ⚠️ Metrics Trends Unavailable
                    </h3>
                    <p style={{
                        margin: 0,
                        fontSize: '0.75rem',
                        color: '#6b7280',
                    }}>
                        Unable to load metrics trends. Please try refreshing the page.
                    </p>
                </div>
            );
        }

        return this.props.children;
    }
}

export default function MetricsTrendsCard() {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [data, setData] = useState<ChartDataPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [metricNames, setMetricNames] = useState<string[]>([]);
    const abortControllerRef = useRef<AbortController | null>(null);
    const isFetchingRef = useRef(false);

    const fromTimestamp = (() => {
        const date = new Date();
        date.setDate(date.getDate() - 1);
        return date.toISOString();
    })();
    const toTimestamp = new Date().toISOString();

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
                timeDimension: { granularity: 'auto' },
                fromTimestamp,
                toTimestamp,
                orderBy: null,
            };

            const queryString = JSON.stringify(query);
            const url = `/api/langfuse/metrics?query=${encodeURIComponent(queryString)}`;

            let response: Response | null = null;
            try {
                response = await fetch(url, {
                    signal: abortController.signal,
                });
            } catch (_fetchError) {
                if (abortController.signal.aborted) {
                    return;
                }
                if (fetchError instanceof TypeError && fetchError.message.includes('Failed to fetch')) {
                    throw new Error('Network error: Unable to reach the server. Please check your connection and try again.');
                }
                if (fetchError instanceof Error && fetchError.name === 'AbortError') {
                    return;
                }
                throw new Error(`Failed to fetch metrics: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
            }

            if (!response) {
                throw new Error('No response received from server. The request may have timed out or been cancelled.');
            }

            if (!response.ok) {
                let errorMessage = `HTTP ${response.status} ${response.statusText}`;
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || errorData.message || errorData.details || errorMessage;
                } catch (_parseError) {
                    try {
                        const errorText = await response.text();
                        errorMessage = errorText || errorMessage;
                    } catch (_textError) {
                    }
                }
                throw new Error(errorMessage);
            }

            let result: MetricsResponse;
            try {
                result = await response.json();
            } catch (_parseError) {
                throw new Error('Invalid response format: Expected JSON but received invalid data.');
            }

            if (!result) {
                throw new Error('Empty response received from server.');
            }

            if (!result.data || result.data.length === 0) {
                setData([]);
                setMetricNames([]);
                setLoading(false);
                return;
            }

            const uniqueMetricNames = Array.from(new Set(result.data.map((d) => d.name)));
            setMetricNames(uniqueMetricNames);

            const timeMap = new Map<string, Record<string, string | number>>();

            result.data.forEach((point) => {
                const timeKey = point.time_dimension;
                if (!timeMap.has(timeKey)) {
                    timeMap.set(timeKey, { timeTimestamp: timeKey });
                }
                timeMap.get(timeKey)![point.name] = point.avg_value;
            });

            const chartData: ChartDataPoint[] = Array.from(timeMap.entries())
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

            setData(chartData);
        } catch (err) {
            if (abortController.signal.aborted) {
                return;
            }
            const errorMessage = err instanceof Error ? err.message : 'Failed to fetch metrics';
            setError(errorMessage);
        } finally {
            setLoading(false);
            isFetchingRef.current = false;
            if (abortControllerRef.current === abortController) {
                abortControllerRef.current = null;
            }
        }
    }, []);

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

    const colors = [
        '#3b82f6',
        '#10b981',
        '#f59e0b',
        '#ef4444',
        '#8b5cf6',
        '#ec4899',
        '#06b6d4',
        '#84cc16',
    ];

    const handleCardClick = function handleClick() {
        setIsModalOpen(true);
    };

    const handleCloseModal = function handleClose() {
        setIsModalOpen(false);
    };

    const handleBackdropClick = function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
        if (e.target === e.currentTarget) {
            handleCloseModal();
        }
    };

    return (
        <MetricsTrendsErrorBoundary>
            {/* Compact Card with Mini Graph - Matches MiniChart style */}
            <div
                onClick={handleCardClick}
                style={{
                    backgroundColor: 'rgba(255,255,255,0.97)',
                    borderRadius: '10px',
                    padding: '1rem 1.25rem',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
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
                {/* Header - Matches MiniChart header style */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.75rem',
                }}>
                    <div style={{
                        fontSize: '0.7rem',
                        color: '#64748b',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        fontWeight: 600,
                    }}>
                        📊 Metrics Trends
                    </div>
                    <div style={{
                        fontSize: '0.75rem',
                        color: '#9ca3af',
                    }}>
                        →
                    </div>
                </div>

                {/* Mini Chart */}
                {loading && data.length === 0 ? (
                    <div style={{
                        height: '90px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#64748b',
                        fontSize: '0.65rem',
                    }}>
                        Loading...
                    </div>
                ) : error ? (
                    <div style={{
                        height: '90px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#ef4444',
                        fontSize: '0.65rem',
                        padding: '0.5rem',
                        textAlign: 'center',
                    }}>
                        {error.length > 50 ? error.substring(0, 50) + '...' : error}
                    </div>
                ) : data.length === 0 ? (
                    <div style={{
                        height: '90px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#94a3b8',
                        fontSize: '0.65rem',
                    }}>
                        No data
                    </div>
                ) : (
                    <div style={{ height: '90px', width: '100%', position: 'relative' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data} margin={{ top: 2, right: 5, left: -10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis
                                    dataKey="time"
                                    stroke="#94a3b8"
                                    style={{ fontSize: '0.55rem' }}
                                    tick={{ fill: '#94a3b8' }}
                                    interval="preserveStartEnd"
                                    tickLine={false}
                                />
                                <YAxis
                                    stroke="#94a3b8"
                                    style={{ fontSize: '0.55rem' }}
                                    tick={{ fill: '#94a3b8' }}
                                    domain={[0, 1]}
                                    width={25}
                                    tickLine={false}
                                    tickFormatter={(value: number) => value.toFixed(2)}
                                />
                                <Tooltip
                                    contentStyle={{
                                        backgroundColor: 'white',
                                        border: '1px solid #e5e7eb',
                                        borderRadius: '6px',
                                        padding: '0.4rem',
                                        fontSize: '0.7rem',
                                    }}
                                    formatter={(value: number | string) => {
                                        if (typeof value === 'number') {
                                            return value.toFixed(2);
                                        }
                                        return value;
                                    }}
                                />
                                {metricNames.slice(0, 3).map((name, index) => (
                                    <Line
                                        key={name}
                                        type="monotone"
                                        dataKey={name}
                                        stroke={colors[index % colors.length]}
                                        strokeWidth={1.5}
                                        dot={false}
                                        activeDot={{ r: 3 }}
                                    />
                                ))}
                            </LineChart>
                        </ResponsiveContainer>
                        {metricNames.length > 3 && (
                            <div style={{
                                position: 'absolute',
                                bottom: '2px',
                                right: '5px',
                                fontSize: '0.55rem',
                                color: '#94a3b8',
                                backgroundColor: 'rgba(255,255,255,0.8)',
                                padding: '0.1rem 0.3rem',
                                borderRadius: '3px',
                            }}>
                                +{metricNames.length - 3}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Modal/Popup */}
            {isModalOpen && (
                <>
                    {/* Backdrop */}
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
                        {/* Modal Content */}
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
                            {/* Close Button */}
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

                            {/* Full Panel */}
                            <div style={{ padding: '1.5rem' }}>
                                <MetricsTrendsPanel
                                    initialData={data}
                                    initialMetricNames={metricNames}
                                    initialFromTimestamp={fromTimestamp}
                                    initialToTimestamp={toTimestamp}
                                />
                            </div>
                        </div>
                    </div>
                </>
            )}
        </MetricsTrendsErrorBoundary>
    );
}
