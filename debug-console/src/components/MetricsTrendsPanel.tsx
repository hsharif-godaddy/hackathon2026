'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

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

interface MetricsTrendsPanelProps {
    compact?: boolean;
    onExpand?: () => void;
    initialData?: ChartDataPoint[];
    initialMetricNames?: string[];
    initialFromTimestamp?: string;
    initialToTimestamp?: string;
}

export default function MetricsTrendsPanel({
    compact: _compact = false,
    onExpand: _onExpand,
    initialData,
    initialMetricNames,
    initialFromTimestamp,
    initialToTimestamp,
}: MetricsTrendsPanelProps = {}) {
    const [data, setData] = useState<ChartDataPoint[]>(initialData || []);
    const [loading, setLoading] = useState(!initialData);
    const [error, setError] = useState<string | null>(null);
    const [metricNames, setMetricNames] = useState<string[]>(initialMetricNames || []);
    const [fromTimestamp, setFromTimestamp] = useState(() => {
        if (initialFromTimestamp) return initialFromTimestamp;
        const date = new Date();
        date.setDate(date.getDate() - 1);
        return date.toISOString();
    });
    const [toTimestamp, setToTimestamp] = useState(() => initialToTimestamp || new Date().toISOString());
    const abortControllerRef = useRef<AbortController | null>(null);
    const isFetchingRef = useRef(false);
    const hasUsedInitialDataRef = useRef(false);

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
            } catch (fetchError) {
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
            } catch {
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
            setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
        } finally {
            setLoading(false);
            isFetchingRef.current = false;
            if (abortControllerRef.current === abortController) {
                abortControllerRef.current = null;
            }
        }
    }, [fromTimestamp, toTimestamp]);

    useEffect(() => {
        // Use initial data only on first mount if provided and timestamps match
        const hasInitialData = initialData && initialData.length > 0 && !hasUsedInitialDataRef.current;
        const timestampsMatch = fromTimestamp === initialFromTimestamp && toTimestamp === initialToTimestamp;

        if (hasInitialData && timestampsMatch) {
            hasUsedInitialDataRef.current = true;
            setLoading(false);
            return;
        }

        fetchMetrics();

        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
            isFetchingRef.current = false;
        };
    }, [fetchMetrics, fromTimestamp, toTimestamp]);

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

    return (
        <div style={{
            backgroundColor: 'rgba(255,255,255,0.97)',
            borderRadius: '12px',
            padding: '1.5rem',
            marginBottom: '1.25rem',
            boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        }}>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1.5rem',
            }}>
                <h2 style={{
                    margin: 0,
                    fontSize: '1.25rem',
                    fontWeight: 600,
                    color: '#1a1a1a',
                }}>
                    📊 Metrics Trends
                </h2>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: 500, color: '#6b7280' }}>
                            From
                        </label>
                        <input
                            type="datetime-local"
                            value={fromTimestamp.slice(0, 16)}
                            onChange={(e) => setFromTimestamp(new Date(e.target.value).toISOString())}
                            style={{
                                padding: '0.375rem 0.75rem',
                                borderRadius: '6px',
                                border: '1px solid #d1d5db',
                                fontSize: '0.875rem',
                            }}
                        />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: 500, color: '#6b7280' }}>
                            To
                        </label>
                        <input
                            type="datetime-local"
                            value={toTimestamp.slice(0, 16)}
                            onChange={(e) => setToTimestamp(new Date(e.target.value).toISOString())}
                            style={{
                                padding: '0.375rem 0.75rem',
                                borderRadius: '6px',
                                border: '1px solid #d1d5db',
                                fontSize: '0.875rem',
                            }}
                        />
                    </div>
                    <button
                        onClick={fetchMetrics}
                        disabled={loading}
                        style={{
                            padding: '0.5rem 1rem',
                            backgroundColor: '#3b82f6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: loading ? 'not-allowed' : 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            opacity: loading ? 0.6 : 1,
                            marginTop: '1.25rem',
                        }}
                    >
                        {loading ? 'Loading...' : 'Refresh'}
                    </button>
                </div>
            </div>

            {error && (
                <div style={{
                    padding: '1rem',
                    backgroundColor: '#fee2e2',
                    border: '1px solid #fecaca',
                    borderRadius: '6px',
                    color: '#991b1b',
                    marginBottom: '1rem',
                }}>
                    Error: {error}
                </div>
            )}

            {loading && data.length === 0 ? (
                <div style={{
                    padding: '3rem',
                    textAlign: 'center',
                    color: '#6b7280',
                }}>
                    Loading metrics...
                </div>
            ) : data.length === 0 ? (
                <div style={{
                    padding: '3rem',
                    textAlign: 'center',
                    color: '#6b7280',
                }}>
                    No metrics data available for the selected time range
                </div>
            ) : (
                <ResponsiveContainer width="100%" height={500}>
                    <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                            dataKey="time"
                            stroke="#6b7280"
                            style={{ fontSize: '0.75rem' }}
                        />
                        <YAxis
                            stroke="#6b7280"
                            style={{ fontSize: '0.75rem' }}
                            domain={[0, 1]}
                            tickFormatter={(value: number) => value.toFixed(2)}
                        />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: 'white',
                                border: '1px solid #e5e7eb',
                                borderRadius: '6px',
                                padding: '0.5rem',
                            }}
                            formatter={(value: number | string) => {
                                if (typeof value === 'number') {
                                    return value.toFixed(2);
                                }
                                return value;
                            }}
                        />
                        <Legend
                            wrapperStyle={{ paddingTop: '1rem' }}
                            iconType="line"
                        />
                        {metricNames.map((name, index) => (
                            <Line
                                key={name}
                                type="monotone"
                                dataKey={name}
                                stroke={colors[index % colors.length]}
                                strokeWidth={2}
                                dot={{ r: 3 }}
                                activeDot={{ r: 5 }}
                            />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            )}
        </div>
    );
}
