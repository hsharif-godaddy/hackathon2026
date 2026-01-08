'use client';

import React, { useEffect, useState } from 'react';

interface AppMetadata {
    name?: string;
    status?: string;
    template?: string;
    version?: string;
    createdAt?: string;
    lastActivity?: string;
}

interface ErrorSummary {
    total: number;
    last24Hours: number;
    lastError?: {
        timestamp: string;
        message: string;
        event?: string;
    };
    commonErrors: Array<{
        message: string;
        count: number;
    }>;
}

interface ActivityStats {
    totalLogs: number;
    byLevel: Record<string, number>;
    byService: Record<string, number>;
    byEvent: Record<string, number>;
}

interface Conversation {
    conversationId: string;
    lastActivity: string;
    eventCount: number;
}

interface RecentActivity {
    id: string;
    timestamp: string;
    level: string;
    message: string;
    event?: string;
    service?: string;
    source?: string;
    raw: Record<string, unknown>;
}

interface APMTrace {
    timestamp: string;
    spanName?: string;
    duration?: number;
    raw: Record<string, unknown>;
}

interface AppContext {
    appId: string;
    metadata: AppMetadata;
    recentActivity: RecentActivity[];
    errorSummary: ErrorSummary;
    activityStats: ActivityStats;
    conversations: Conversation[];
    apmTraces: {
        total: number;
        traces: APMTrace[];
        pagination: {
            hasMore: boolean;
            total: number;
            page: number;
            pageSize: number;
        };
    };
}

interface AppContextPanelProps {
    appId: string;
    onClose?: () => void;
}

function formatTimestamp(timestamp: string): string {
    try {
        return new Date(timestamp).toLocaleString('en-US', {
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    } catch {
        return timestamp;
    }
}

function mapOperationName(operationName: string | undefined | null): string {
    if (!operationName || typeof operationName !== 'string') {
        return '-';
    }

    const normalized = operationName.trim().toLowerCase();

    const operationMap: Record<string, string> = {
        'ai.toolCall agent-AI Developer': 'Develop Agent',
    };

    if (operationMap[normalized]) {
        return operationMap[normalized];
    }

    if (normalized.startsWith('ai.')) {
        const operation = normalized.substring(3).replace(/_/g, ' ');
        return operation
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    return operationName;
}

interface ParsedTool {
    name?: string;
    description?: string;
    type?: string;
    inputSchema?: {
        type?: string;
        properties?: Record<string, unknown>;
        required?: string[];
    };
}

function parseAIPromptTools(aiPromptTools: unknown): ParsedTool[] | null {
    if (!aiPromptTools) {
        return null;
    }

    if (!Array.isArray(aiPromptTools)) {
        return null;
    }

    const parsed: ParsedTool[] = [];

    for (const tool of aiPromptTools) {
        if (typeof tool !== 'string') {
            continue;
        }

        try {
            const parsedTool = JSON.parse(tool) as ParsedTool;
            parsed.push(parsedTool);
        } catch {
            continue;
        }
    }

    return parsed.length > 0 ? parsed : null;
}

function getLogLevelBadgeStyle(level: string): React.CSSProperties {
    const base: React.CSSProperties = {
        padding: '0.125rem 0.5rem',
        borderRadius: '4px',
        fontSize: '0.75rem',
        fontFamily: 'monospace',
        fontWeight: 600,
        border: '1px solid',
        display: 'inline-block'
    };

    switch (level.toUpperCase()) {
        case 'ERROR':
            return {
                ...base,
                backgroundColor: '#fee2e2',
                color: '#991b1b',
                borderColor: '#fca5a5'
            };
        case 'WARN':
            return {
                ...base,
                backgroundColor: '#fef3c7',
                color: '#92400e',
                borderColor: '#fcd34d'
            };
        case 'INFO':
            return {
                ...base,
                backgroundColor: '#dbeafe',
                color: '#1e40af',
                borderColor: '#93c5fd'
            };
        case 'DEBUG':
            return {
                ...base,
                backgroundColor: '#f3f4f6',
                color: '#374151',
                borderColor: '#6b7280'
            };
        default:
            return {
                ...base,
                backgroundColor: '#f3f4f6',
                color: '#4b5563',
                borderColor: '#6b7280'
            };
    }
}

export default function AppContextPanel({
    appId,
    onClose
}: AppContextPanelProps) {
    const [context, setContext] = useState<AppContext | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [timeRange, setTimeRange] = useState('24h');
    const [useCustomTime, setUseCustomTime] = useState<boolean>(false);
    const [customStartTime, setCustomStartTime] = useState<string>('');
    const [customEndTime, setCustomEndTime] = useState<string>('');
    const [activeTab, setActiveTab] = useState<
        'overview' | 'activity' | 'errors' | 'conversation-logs'
    >('overview');
    const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
    const [apmPage, setApmPage] = useState(0);
    const [loadingMore, setLoadingMore] = useState(false);

    useEffect(() => {
        async function fetchContext() {
            setLoading(true);
            setError(null);
            setApmPage(0);

            try {
                let url = `/api/app-context?appId=${encodeURIComponent(appId)}`;
                if (useCustomTime && customStartTime && customEndTime) {
                    url += `&startTime=${encodeURIComponent(new Date(customStartTime).toISOString())}`;
                    url += `&endTime=${encodeURIComponent(new Date(customEndTime).toISOString())}`;
                } else {
                    url += `&timeRange=${timeRange}`;
                }
                const response = await fetch(url);

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to fetch app context');
                }

                const data = await response.json();
                setContext(data);
            } catch (err) {
                setError(
                    err instanceof Error ? err.message : 'Failed to fetch app context'
                );
            } finally {
                setLoading(false);
            }
        }

        if (appId) {
            fetchContext();
        }
    }, [appId, timeRange, useCustomTime, customStartTime, customEndTime]);

    useEffect(() => {
        if (appId && activeTab === 'conversation-logs') {
            setApmPage(0);
        }
    }, [appId, activeTab]);

    const handleRefresh = () => {
        if (appId) {
            setLoading(true);
            setApmPage(0);
            let url = `/api/app-context?appId=${encodeURIComponent(appId)}`;
            if (useCustomTime && customStartTime && customEndTime) {
                url += `&startTime=${encodeURIComponent(new Date(customStartTime).toISOString())}`;
                url += `&endTime=${encodeURIComponent(new Date(customEndTime).toISOString())}`;
            } else {
                url += `&timeRange=${timeRange}`;
            }
            fetch(url)
                .then((res) => res.json())
                .then((data) => {
                    setContext(data);
                    setLoading(false);
                })
                .catch((err) => {
                    setError(err.message);
                    setLoading(false);
                });
        }
    };

    const handleLoadMoreApm = async () => {
        if (!appId || loadingMore || !context) return;

        setLoadingMore(true);
        const nextPage = apmPage + 1;

        try {
            let url = `/api/app-context?appId=${encodeURIComponent(appId)}&spansPage=${nextPage}`;
            if (useCustomTime && customStartTime && customEndTime) {
                url += `&startTime=${encodeURIComponent(new Date(customStartTime).toISOString())}`;
                url += `&endTime=${encodeURIComponent(new Date(customEndTime).toISOString())}`;
            } else {
                url += `&timeRange=${timeRange}`;
            }
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error('Failed to load more APM traces');
            }

            const data = await response.json();

            if (data.apmTraces && data.apmTraces.traces) {
                setContext({
                    ...context,
                    apmTraces: {
                        ...data.apmTraces,
                        traces: [...context.apmTraces.traces, ...data.apmTraces.traces]
                    }
                });
                setApmPage(nextPage);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load more APM traces');
        } finally {
            setLoadingMore(false);
        }
    };

    if (loading && !context) {
        return (
            <div
                style={{
                    backgroundColor: 'white',
                    padding: '2rem',
                    borderRadius: '8px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    textAlign: 'center'
                }}
            >
                <p>Loading app context...</p>
            </div>
        );
    }

    if (error && !context) {
        return (
            <div
                style={{
                    backgroundColor: 'white',
                    padding: '2rem',
                    borderRadius: '8px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    border: '1px solid #ef4444'
                }}
            >
                <p style={{ color: '#ef4444', margin: 0 }}>Error: {error}</p>
                <button
                    onClick={handleRefresh}
                    style={{
                        marginTop: '1rem',
                        padding: '0.5rem 1rem',
                        backgroundColor: '#3b82f6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer'
                    }}
                >
                    Retry
                </button>
            </div>
        );
    }

    if (!context) {
        return null;
    }

    return (
        <div
            style={{
                backgroundColor: 'white',
                borderRadius: '8px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                overflow: 'hidden'
            }}
        >
            <div
                style={{
                    padding: '1.5rem',
                    borderBottom: '1px solid #6b7280',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}
            >
                <div>
                    <h2
                        style={{
                            margin: '0 0 0.25rem 0',
                            fontSize: '1.25rem',
                            fontWeight: 600,
                            color: '#1a1a1a'
                        }}
                    >
                        App Context: {context.appId}
                    </h2>
                    {context.metadata.lastActivity && (
                        <p
                            style={{
                                margin: 0,
                                fontSize: '0.875rem',
                                color: '#666'
                            }}
                        >
                            Last activity:{' '}
                            {formatTimestamp(context.metadata.lastActivity)}
                        </p>
                    )}
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '200px' }}>
                        <label style={{
                            fontSize: '0.75rem',
                            fontWeight: 500,
                            color: '#374151',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap'
                        }}>
                            <input
                                type="checkbox"
                                checked={useCustomTime}
                                onChange={(e) => {
                                    setUseCustomTime(e.target.checked);
                                    if (!e.target.checked) {
                                        setCustomStartTime('');
                                        setCustomEndTime('');
                                    } else {
                                        const now = new Date();
                                        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
                                        const formatForInput = (date: Date) => {
                                            const year = date.getFullYear();
                                            const month = String(date.getMonth() + 1).padStart(2, '0');
                                            const day = String(date.getDate()).padStart(2, '0');
                                            const hours = String(date.getHours()).padStart(2, '0');
                                            const minutes = String(date.getMinutes()).padStart(2, '0');
                                            return `${year}-${month}-${day}T${hours}:${minutes}`;
                                        };
                                        setCustomStartTime(formatForInput(oneHourAgo));
                                        setCustomEndTime(formatForInput(now));
                                    }
                                }}
                                style={{ cursor: 'pointer', flexShrink: 0 }}
                            />
                            <span>Use Custom Time Range</span>
                        </label>
                        {useCustomTime ? (
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.75rem',
                                padding: '0.75rem',
                                backgroundColor: '#f9fafb',
                                borderRadius: '6px',
                                border: '1px solid #6b7280',
                                width: '100%',
                                minWidth: '280px'
                            }}>
                                <div>
                                    <label htmlFor="custom-start-time" style={{
                                        fontSize: '0.75rem',
                                        fontWeight: 500,
                                        color: '#374151',
                                        display: 'block',
                                        marginBottom: '0.375rem'
                                    }}>
                                        Start Time
                                    </label>
                                    <input
                                        id="custom-start-time"
                                        type="datetime-local"
                                        value={customStartTime}
                                        onChange={(e) => setCustomStartTime(e.target.value)}
                                        style={{
                                            width: '100%',
                                            padding: '0.5rem',
                                            border: '1px solid #6b7280',
                                            borderRadius: '6px',
                                            fontSize: '0.875rem',
                                            backgroundColor: 'white',
                                            cursor: 'text'
                                        }}
                                    />
                                </div>
                                <div>
                                    <label htmlFor="custom-end-time" style={{
                                        fontSize: '0.75rem',
                                        fontWeight: 500,
                                        color: '#374151',
                                        display: 'block',
                                        marginBottom: '0.375rem'
                                    }}>
                                        End Time
                                    </label>
                                    <input
                                        id="custom-end-time"
                                        type="datetime-local"
                                        value={customEndTime}
                                        onChange={(e) => setCustomEndTime(e.target.value)}
                                        style={{
                                            width: '100%',
                                            padding: '0.5rem',
                                            border: '1px solid #6b7280',
                                            borderRadius: '6px',
                                            fontSize: '0.875rem',
                                            backgroundColor: 'white',
                                            cursor: 'text'
                                        }}
                                    />
                                </div>
                            </div>
                        ) : (
                            <div>
                                <label htmlFor="time-range" style={{
                                    fontSize: '0.75rem',
                                    fontWeight: 500,
                                    color: '#374151',
                                    display: 'block',
                                    marginBottom: '0.25rem'
                                }}>
                                    Time Range
                                </label>
                                <select
                                    id="time-range"
                                    value={timeRange}
                                    onChange={(e) => setTimeRange(e.target.value)}
                                    style={{
                                        width: '100%',
                                        padding: '0.4rem 0.75rem',
                                        border: '1px solid #6b7280',
                                        borderRadius: '6px',
                                        fontSize: '0.875rem',
                                        cursor: 'pointer',
                                        backgroundColor: 'white'
                                    }}
                                >
                                    <option value="15m">Last 15 minutes</option>
                                    <option value="1h">Last 1 hour</option>
                                    <option value="6h">Last 6 hours</option>
                                    <option value="24h">Last 24 hours</option>
                                    <option value="7d">Last 7 days</option>
                                </select>
                            </div>
                        )}
                    </div>
                    <button
                        onClick={handleRefresh}
                        disabled={loading}
                        style={{
                            padding: '0.4rem 0.75rem',
                            backgroundColor: '#f3f4f6',
                            border: '1px solid #6b7280',
                            borderRadius: '6px',
                            cursor: loading ? 'not-allowed' : 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: 500
                        }}
                    >
                        {loading ? 'Loading...' : 'Refresh'}
                    </button>
                    {onClose && (
                        <button
                            onClick={onClose}
                            style={{
                                padding: '0.4rem 0.75rem',
                                backgroundColor: '#fee2e2',
                                color: '#991b1b',
                                border: '1px solid #fca5a5',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontSize: '0.875rem',
                                fontWeight: 500
                            }}
                        >
                            Close
                        </button>
                    )}
                </div>
            </div>

            <div
                style={{
                    display: 'flex',
                    borderBottom: '1px solid #6b7280',
                    backgroundColor: '#f9fafb'
                }}
            >
                {(['overview', 'activity', 'errors', 'conversation-logs'] as const).map(
                    (tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            style={{
                                padding: '0.75rem 1.5rem',
                                backgroundColor: activeTab === tab ? 'white' : 'transparent',
                                border: 'none',
                                borderBottom:
                                    activeTab === tab ? '2px solid #3b82f6' : '2px solid transparent',
                                cursor: 'pointer',
                                fontSize: '0.875rem',
                                fontWeight: activeTab === tab ? 600 : 500,
                                color: activeTab === tab ? '#3b82f6' : '#6b7280',
                                textTransform: 'capitalize'
                            }}
                        >
                            {tab === 'conversation-logs' ? 'Conversation Logs' : tab}
                        </button>
                    )
                )}
            </div>

            <div style={{ padding: '1.5rem' }}>
                {activeTab === 'overview' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                                gap: '1rem'
                            }}
                        >
                            <div
                                style={{
                                    padding: '1rem',
                                    backgroundColor: '#f9fafb',
                                    borderRadius: '6px',
                                    border: '1px solid #6b7280'
                                }}
                            >
                                <div
                                    style={{
                                        fontSize: '0.75rem',
                                        color: '#6b7280',
                                        marginBottom: '0.25rem'
                                    }}
                                >
                                    Total Logs
                                </div>
                                <div
                                    style={{
                                        fontSize: '1.5rem',
                                        fontWeight: 600,
                                        color: '#1a1a1a'
                                    }}
                                >
                                    {context.activityStats.totalLogs.toLocaleString()}
                                </div>
                            </div>

                            <div
                                style={{
                                    padding: '1rem',
                                    backgroundColor: '#fef2f2',
                                    borderRadius: '6px',
                                    border: '1px solid #fecaca'
                                }}
                            >
                                <div
                                    style={{
                                        fontSize: '0.75rem',
                                        color: '#991b1b',
                                        marginBottom: '0.25rem'
                                    }}
                                >
                                    Total Errors
                                </div>
                                <div
                                    style={{
                                        fontSize: '1.5rem',
                                        fontWeight: 600,
                                        color: '#dc2626'
                                    }}
                                >
                                    {context.errorSummary.total}
                                </div>
                            </div>

                            <div
                                style={{
                                    padding: '1rem',
                                    backgroundColor: '#fef2f2',
                                    borderRadius: '6px',
                                    border: '1px solid #fecaca'
                                }}
                            >
                                <div
                                    style={{
                                        fontSize: '0.75rem',
                                        color: '#991b1b',
                                        marginBottom: '0.25rem'
                                    }}
                                >
                                    Errors (24h)
                                </div>
                                <div
                                    style={{
                                        fontSize: '1.5rem',
                                        fontWeight: 600,
                                        color: '#dc2626'
                                    }}
                                >
                                    {context.errorSummary.last24Hours}
                                </div>
                            </div>

                            <div
                                style={{
                                    padding: '1rem',
                                    backgroundColor: '#f0f9ff',
                                    borderRadius: '6px',
                                    border: '1px solid #bae6fd'
                                }}
                            >
                                <div
                                    style={{
                                        fontSize: '0.75rem',
                                        color: '#1e40af',
                                        marginBottom: '0.25rem'
                                    }}
                                >
                                    Conversations
                                </div>
                                <div
                                    style={{
                                        fontSize: '1.5rem',
                                        fontWeight: 600,
                                        color: '#2563eb'
                                    }}
                                >
                                    {context.conversations.length}
                                </div>
                            </div>
                        </div>

                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                                gap: '1rem'
                            }}
                        >
                            <div
                                style={{
                                    padding: '1rem',
                                    backgroundColor: '#f9fafb',
                                    borderRadius: '6px',
                                    border: '1px solid #6b7280'
                                }}
                            >
                                <h3
                                    style={{
                                        margin: '0 0 0.75rem 0',
                                        fontSize: '0.875rem',
                                        fontWeight: 600,
                                        color: '#374151'
                                    }}
                                >
                                    Logs by Level
                                </h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {Object.entries(context.activityStats.byLevel)
                                        .sort(([, a], [, b]) => b - a)
                                        .map(([level, count]) => (
                                            <div
                                                key={level}
                                                style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center'
                                                }}
                                            >
                                                <span style={getLogLevelBadgeStyle(level)}>
                                                    {level}
                                                </span>
                                                <span
                                                    style={{
                                                        fontSize: '0.875rem',
                                                        fontWeight: 500,
                                                        color: '#6b7280'
                                                    }}
                                                >
                                                    {count.toLocaleString()}
                                                </span>
                                            </div>
                                        ))}
                                </div>
                            </div>

                            <div
                                style={{
                                    padding: '1rem',
                                    backgroundColor: '#f9fafb',
                                    borderRadius: '6px',
                                    border: '1px solid #6b7280'
                                }}
                            >
                                <h3
                                    style={{
                                        margin: '0 0 0.75rem 0',
                                        fontSize: '0.875rem',
                                        fontWeight: 600,
                                        color: '#374151'
                                    }}
                                >
                                    Top Services
                                </h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {Object.entries(context.activityStats.byService)
                                        .sort(([, a], [, b]) => b - a)
                                        .slice(0, 5)
                                        .map(([service, count]) => (
                                            <div
                                                key={service}
                                                style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center'
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        fontSize: '0.875rem',
                                                        fontFamily: 'monospace',
                                                        color: '#374151'
                                                    }}
                                                >
                                                    {service}
                                                </span>
                                                <span
                                                    style={{
                                                        fontSize: '0.875rem',
                                                        fontWeight: 500,
                                                        color: '#6b7280'
                                                    }}
                                                >
                                                    {count.toLocaleString()}
                                                </span>
                                            </div>
                                        ))}
                                </div>
                            </div>
                        </div>

                    </div>
                )}

                {activeTab === 'activity' && (
                    <div
                        style={{
                            maxHeight: '600px',
                            overflowY: 'auto',
                            border: '1px solid #6b7280',
                            borderRadius: '6px'
                        }}
                    >
                        <table
                            style={{
                                width: '100%',
                                fontSize: '0.875rem',
                                borderCollapse: 'collapse'
                            }}
                        >
                            <thead
                                style={{
                                    backgroundColor: '#f9fafb',
                                    borderBottom: '1px solid #6b7280',
                                    position: 'sticky',
                                    top: 0,
                                    zIndex: 5
                                }}
                            >
                                <tr>
                                    <th
                                        style={{
                                            textAlign: 'left',
                                            padding: '0.75rem 1rem',
                                            fontWeight: 600,
                                            width: '160px',
                                            color: '#374151'
                                        }}
                                    >
                                        Timestamp
                                    </th>
                                    <th
                                        style={{
                                            textAlign: 'left',
                                            padding: '0.75rem 1rem',
                                            fontWeight: 600,
                                            width: '80px',
                                            color: '#374151'
                                        }}
                                    >
                                        Level
                                    </th>
                                    <th
                                        style={{
                                            textAlign: 'left',
                                            padding: '0.75rem 1rem',
                                            fontWeight: 600,
                                            width: '120px',
                                            color: '#374151'
                                        }}
                                    >
                                        Source
                                    </th>
                                    <th
                                        style={{
                                            textAlign: 'left',
                                            padding: '0.75rem 1rem',
                                            fontWeight: 600,
                                            width: '200px',
                                            color: '#374151'
                                        }}
                                    >
                                        Event
                                    </th>
                                    <th
                                        style={{
                                            textAlign: 'left',
                                            padding: '0.75rem 1rem',
                                            fontWeight: 600,
                                            color: '#374151'
                                        }}
                                    >
                                        Message
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {context.recentActivity.map((activity) => (
                                    <React.Fragment key={activity.id}>
                                        <tr
                                            onClick={() =>
                                                setExpandedLogId(
                                                    expandedLogId === activity.id ? null : activity.id
                                                )
                                            }
                                            style={{
                                                borderBottom: '1px solid #9ca3af',
                                                cursor: 'pointer',
                                                transition: 'background-color 0.2s'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = '#f9fafb';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = 'transparent';
                                            }}
                                        >
                                            <td
                                                style={{
                                                    padding: '0.75rem 1rem',
                                                    fontFamily: 'monospace',
                                                    whiteSpace: 'nowrap',
                                                    fontSize: '0.75rem',
                                                    color: '#6b7280'
                                                }}
                                            >
                                                {formatTimestamp(activity.timestamp)}
                                            </td>
                                            <td style={{ padding: '0.75rem 1rem' }}>
                                                <span style={getLogLevelBadgeStyle(activity.level)}>
                                                    {activity.level.toLowerCase()}
                                                </span>
                                            </td>
                                            <td
                                                style={{
                                                    padding: '0.75rem 1rem',
                                                    fontSize: '0.75rem',
                                                    color: '#6b7280',
                                                    fontFamily: 'monospace'
                                                }}
                                            >
                                                {activity.source || '-'}
                                            </td>
                                            <td
                                                style={{
                                                    padding: '0.75rem 1rem',
                                                    fontFamily: 'monospace',
                                                    fontSize: '0.75rem',
                                                    color: '#6b7280',
                                                    maxWidth: '200px',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap'
                                                }}
                                                title={activity.event || '-'}
                                            >
                                                {activity.event || '-'}
                                            </td>
                                            <td
                                                style={{
                                                    padding: '0.75rem 1rem',
                                                    fontSize: '0.875rem',
                                                    maxWidth: '400px',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap'
                                                }}
                                            >
                                                {activity.message}
                                            </td>
                                        </tr>
                                        {expandedLogId === activity.id && (
                                            <tr>
                                                <td
                                                    colSpan={5}
                                                    style={{
                                                        padding: '1rem',
                                                        backgroundColor: '#f9fafb',
                                                        borderBottom: '1px solid #6b7280'
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            gap: '0.75rem'
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                display: 'flex',
                                                                justifyContent: 'space-between',
                                                                alignItems: 'center'
                                                            }}
                                                        >
                                                            <div
                                                                style={{
                                                                    fontSize: '0.7rem',
                                                                    fontWeight: 600,
                                                                    textTransform: 'uppercase',
                                                                    color: '#6b7280'
                                                                }}
                                                            >
                                                                Complete JSON Log
                                                            </div>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    navigator.clipboard.writeText(
                                                                        JSON.stringify(activity.raw, null, 2)
                                                                    );
                                                                }}
                                                                style={{
                                                                    fontSize: '0.65rem',
                                                                    padding: '0.25rem 0.5rem',
                                                                    backgroundColor: '#f3f4f6',
                                                                    border: '1px solid #6b7280',
                                                                    borderRadius: '4px',
                                                                    cursor: 'pointer',
                                                                    color: '#374151'
                                                                }}
                                                            >
                                                                Copy JSON
                                                            </button>
                                                        </div>
                                                        <pre
                                                            style={{
                                                                fontSize: '0.75rem',
                                                                padding: '0.75rem',
                                                                borderRadius: '6px',
                                                                border: '1px solid #6b7280',
                                                                backgroundColor: 'white',
                                                                overflowX: 'auto',
                                                                maxHeight: '400px',
                                                                overflowY: 'auto',
                                                                margin: 0,
                                                                fontFamily: 'monospace',
                                                                whiteSpace: 'pre-wrap',
                                                                wordBreak: 'break-word'
                                                            }}
                                                        >
                                                            {JSON.stringify(activity.raw, null, 2)}
                                                        </pre>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {activeTab === 'errors' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        {context.errorSummary.lastError && (
                            <div
                                style={{
                                    padding: '1rem',
                                    backgroundColor: '#fef2f2',
                                    borderRadius: '6px',
                                    border: '1px solid #fecaca'
                                }}
                            >
                                <h3
                                    style={{
                                        margin: '0 0 0.75rem 0',
                                        fontSize: '0.875rem',
                                        fontWeight: 600,
                                        color: '#991b1b'
                                    }}
                                >
                                    Last Error
                                </h3>
                                <div
                                    style={{
                                        fontSize: '0.875rem',
                                        color: '#dc2626',
                                        marginBottom: '0.5rem'
                                    }}
                                >
                                    {context.errorSummary.lastError.message}
                                </div>
                                <div
                                    style={{
                                        fontSize: '0.75rem',
                                        color: '#991b1b',
                                        fontFamily: 'monospace'
                                    }}
                                >
                                    {formatTimestamp(context.errorSummary.lastError.timestamp)}
                                    {context.errorSummary.lastError.event && (
                                        <> • {context.errorSummary.lastError.event}</>
                                    )}
                                </div>
                            </div>
                        )}

                        {context.errorSummary.commonErrors.length > 0 && (
                            <div
                                style={{
                                    padding: '1rem',
                                    backgroundColor: '#f9fafb',
                                    borderRadius: '6px',
                                    border: '1px solid #6b7280'
                                }}
                            >
                                <h3
                                    style={{
                                        margin: '0 0 0.75rem 0',
                                        fontSize: '0.875rem',
                                        fontWeight: 600,
                                        color: '#374151'
                                    }}
                                >
                                    Common Errors
                                </h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    {context.errorSummary.commonErrors.map((error, index) => (
                                        <div
                                            key={index}
                                            style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'start',
                                                padding: '0.75rem',
                                                backgroundColor: 'white',
                                                borderRadius: '4px',
                                                border: '1px solid #6b7280'
                                            }}
                                        >
                                            <div style={{ flex: 1 }}>
                                                <div
                                                    style={{
                                                        fontSize: '0.875rem',
                                                        color: '#374151',
                                                        marginBottom: '0.25rem'
                                                    }}
                                                >
                                                    {error.message}
                                                </div>
                                            </div>
                                            <div
                                                style={{
                                                    fontSize: '0.875rem',
                                                    fontWeight: 600,
                                                    color: '#dc2626',
                                                    marginLeft: '1rem'
                                                }}
                                            >
                                                {error.count}x
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {context.errorSummary.total === 0 && (
                            <div
                                style={{
                                    padding: '2rem',
                                    textAlign: 'center',
                                    color: '#6b7280'
                                }}
                            >
                                No errors found in the selected time range
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'conversation-logs' && (
                    <div>
                        {context.apmTraces.total > 0 && (
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    marginBottom: '0.75rem',
                                    padding: '0.5rem',
                                    backgroundColor: '#f9fafb',
                                    borderRadius: '6px',
                                    border: '1px solid #6b7280'
                                }}
                            >
                                <div
                                    style={{
                                        fontSize: '0.875rem',
                                        color: '#374151',
                                        fontWeight: 500
                                    }}
                                >
                                    {context.apmTraces.total} APM Trace{context.apmTraces.total !== 1 ? 's' : ''} found
                                </div>
                                <button
                                    onClick={() => {
                                        const allTracesJson = JSON.stringify(
                                            context.apmTraces.traces.map((trace) => trace.raw),
                                            null,
                                            2
                                        );
                                        navigator.clipboard.writeText(allTracesJson);
                                    }}
                                    style={{
                                        fontSize: '0.75rem',
                                        padding: '0.375rem 0.75rem',
                                        backgroundColor: '#3b82f6',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontWeight: 500
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = '#2563eb';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = '#3b82f6';
                                    }}
                                >
                                    Copy All APM Traces JSON
                                </button>
                            </div>
                        )}
                        <div
                            style={{
                                maxHeight: '600px',
                                overflowY: 'auto',
                                border: '1px solid #6b7280',
                                borderRadius: '6px'
                            }}
                        >
                            {context.apmTraces.total > 0 ? (
                                <table
                                    style={{
                                        width: '100%',
                                        fontSize: '0.875rem',
                                        borderCollapse: 'collapse'
                                    }}
                                >
                                    <thead
                                        style={{
                                            backgroundColor: '#f9fafb',
                                            borderBottom: '1px solid #6b7280',
                                            position: 'sticky',
                                            top: 0,
                                            zIndex: 5
                                        }}
                                    >
                                        <tr>
                                            <th
                                                style={{
                                                    textAlign: 'left',
                                                    padding: '0.75rem 1rem',
                                                    fontWeight: 600,
                                                    width: '160px',
                                                    color: '#374151'
                                                }}
                                            >
                                                Timestamp
                                            </th>
                                            <th
                                                style={{
                                                    textAlign: 'left',
                                                    padding: '0.75rem 1rem',
                                                    fontWeight: 600,
                                                    width: '200px',
                                                    color: '#374151'
                                                }}
                                            >
                                                Operation Name
                                            </th>
                                            <th
                                                style={{
                                                    textAlign: 'left',
                                                    padding: '0.75rem 1rem',
                                                    fontWeight: 600,
                                                    width: '120px',
                                                    color: '#374151'
                                                }}
                                            >
                                                Duration (ms)
                                            </th>
                                            <th
                                                style={{
                                                    textAlign: 'left',
                                                    padding: '0.75rem 1rem',
                                                    fontWeight: 600,
                                                    width: '300px',
                                                    color: '#374151'
                                                }}
                                            >
                                                AI Prompt
                                            </th>
                                            <th
                                                style={{
                                                    textAlign: 'left',
                                                    padding: '0.75rem 1rem',
                                                    fontWeight: 600,
                                                    width: '300px',
                                                    color: '#374151'
                                                }}
                                            >
                                                AI Response
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {context.apmTraces.traces.map((trace, index) => (
                                            <React.Fragment key={index}>
                                                <tr
                                                    onClick={() =>
                                                        setExpandedLogId(
                                                            expandedLogId === `apm-${index}` ? null : `apm-${index}`
                                                        )
                                                    }
                                                    style={{
                                                        borderBottom: '1px solid #9ca3af',
                                                        cursor: 'pointer',
                                                        transition: 'background-color 0.2s'
                                                    }}
                                                    onMouseEnter={(e) => {
                                                        e.currentTarget.style.backgroundColor = '#f9fafb';
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        e.currentTarget.style.backgroundColor = 'transparent';
                                                    }}
                                                >
                                                    <td
                                                        style={{
                                                            padding: '0.75rem 1rem',
                                                            fontFamily: 'monospace',
                                                            whiteSpace: 'nowrap',
                                                            fontSize: '0.75rem',
                                                            color: '#6b7280'
                                                        }}
                                                    >
                                                        {formatTimestamp(trace.timestamp)}
                                                    </td>
                                                    <td
                                                        style={{
                                                            padding: '0.75rem 1rem',
                                                            fontSize: '0.75rem',
                                                            color: '#374151'
                                                        }}
                                                    >
                                                        {mapOperationName((trace.raw?.labels as any)?.operation_name || trace.spanName)}
                                                    </td>
                                                    <td
                                                        style={{
                                                            padding: '0.75rem 1rem',
                                                            fontSize: '0.875rem',
                                                            color: '#6b7280'
                                                        }}
                                                    >
                                                        {trace.duration
                                                            ? `${trace.duration.toFixed(2)} ms`
                                                            : '-'}
                                                    </td>
                                                    <td
                                                        style={{
                                                            padding: '0.75rem 1rem',
                                                            fontSize: '0.75rem',
                                                            color: '#374151',
                                                            maxWidth: '300px',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                            whiteSpace: 'nowrap'
                                                        }}
                                                        title={(trace.raw?.labels as any)?.ai_prompt || '-'}
                                                    >
                                                        {(trace.raw?.labels as any)?.ai_prompt || '-'}
                                                    </td>
                                                    <td
                                                        style={{
                                                            padding: '0.75rem 1rem',
                                                            fontSize: '0.75rem',
                                                            color: '#374151',
                                                            maxWidth: '300px',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                            whiteSpace: 'nowrap'
                                                        }}
                                                        title={(trace.raw?.labels as any)?.ai_response_text || '-'}
                                                    >
                                                        {(trace.raw?.labels as any)?.ai_response_text || '-'}
                                                    </td>
                                                </tr>
                                                {expandedLogId === `apm-${index}` && (
                                                    <tr>
                                                        <td
                                                            colSpan={5}
                                                            style={{
                                                                padding: '1.5rem',
                                                                backgroundColor: '#f9fafb',
                                                                borderTop: '2px solid #3b82f6',
                                                                borderBottom: '2px solid #6b7280',
                                                                borderLeft: '1px solid #6b7280',
                                                                borderRight: '1px solid #6b7280',
                                                                boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                                                            }}
                                                        >
                                                            <div
                                                                style={{
                                                                    display: 'flex',
                                                                    flexDirection: 'column',
                                                                    gap: '1rem',
                                                                    borderLeft: '3px solid #3b82f6',
                                                                    paddingLeft: '1rem',
                                                                    marginLeft: '0.5rem'
                                                                }}
                                                            >
                                                                {(() => {
                                                                    const labels = (trace.raw?.labels as any) || {};
                                                                    const aiPromptTools = parseAIPromptTools(labels.ai_prompt_tools);
                                                                    return aiPromptTools ? (
                                                                        <div>
                                                                            <div
                                                                                style={{
                                                                                    fontSize: '0.7rem',
                                                                                    fontWeight: 600,
                                                                                    textTransform: 'uppercase',
                                                                                    marginBottom: '0.5rem',
                                                                                    color: '#6b7280'
                                                                                }}
                                                                            >
                                                                                AI Prompt Tools ({aiPromptTools.length})
                                                                            </div>
                                                                            <div
                                                                                style={{
                                                                                    display: 'flex',
                                                                                    flexDirection: 'column',
                                                                                    gap: '0.75rem',
                                                                                    maxHeight: '300px',
                                                                                    overflowY: 'auto',
                                                                                    padding: '0.5rem',
                                                                                    backgroundColor: 'white',
                                                                                    border: '1px solid #6b7280',
                                                                                    borderRadius: '6px'
                                                                                }}
                                                                            >
                                                                                {aiPromptTools.map((tool, toolIndex) => (
                                                                                    <div
                                                                                        key={toolIndex}
                                                                                        style={{
                                                                                            padding: '0.75rem',
                                                                                            backgroundColor: '#f9fafb',
                                                                                            border: '1px solid #6b7280',
                                                                                            borderRadius: '6px'
                                                                                        }}
                                                                                    >
                                                                                        <div
                                                                                            style={{
                                                                                                display: 'flex',
                                                                                                alignItems: 'center',
                                                                                                gap: '0.5rem',
                                                                                                marginBottom: '0.5rem'
                                                                                            }}
                                                                                        >
                                                                                            <span
                                                                                                style={{
                                                                                                    fontSize: '0.875rem',
                                                                                                    fontWeight: 600,
                                                                                                    color: '#1a1a1a',
                                                                                                    fontFamily: 'monospace'
                                                                                                }}
                                                                                            >
                                                                                                {tool.name || 'Unknown Tool'}
                                                                                            </span>
                                                                                            {tool.type && (
                                                                                                <span
                                                                                                    style={{
                                                                                                        fontSize: '0.65rem',
                                                                                                        padding: '0.125rem 0.375rem',
                                                                                                        backgroundColor: '#e5e7eb',
                                                                                                        borderRadius: '4px',
                                                                                                        color: '#6b7280'
                                                                                                    }}
                                                                                                >
                                                                                                    {tool.type}
                                                                                                </span>
                                                                                            )}
                                                                                        </div>
                                                                                        {tool.description && (
                                                                                            <div
                                                                                                style={{
                                                                                                    fontSize: '0.75rem',
                                                                                                    color: '#374151',
                                                                                                    marginBottom: '0.5rem',
                                                                                                    lineHeight: '1.5'
                                                                                                }}
                                                                                            >
                                                                                                {tool.description}
                                                                                            </div>
                                                                                        )}
                                                                                        {tool.inputSchema?.properties && (
                                                                                            <div
                                                                                                style={{
                                                                                                    fontSize: '0.7rem',
                                                                                                    color: '#6b7280'
                                                                                                }}
                                                                                            >
                                                                                                <div
                                                                                                    style={{
                                                                                                        fontWeight: 600,
                                                                                                        marginBottom: '0.25rem'
                                                                                                    }}
                                                                                                >
                                                                                                    Parameters:
                                                                                                </div>
                                                                                                <div
                                                                                                    style={{
                                                                                                        display: 'flex',
                                                                                                        flexWrap: 'wrap',
                                                                                                        gap: '0.25rem'
                                                                                                    }}
                                                                                                >
                                                                                                    {Object.keys(tool.inputSchema.properties).map((paramName) => {
                                                                                                        const param = tool.inputSchema!.properties![paramName] as any;
                                                                                                        const isRequired = tool.inputSchema?.required?.includes(paramName);
                                                                                                        return (
                                                                                                            <span
                                                                                                                key={paramName}
                                                                                                                style={{
                                                                                                                    fontSize: '0.65rem',
                                                                                                                    padding: '0.125rem 0.375rem',
                                                                                                                    backgroundColor: isRequired ? '#fee2e2' : '#f3f4f6',
                                                                                                                    border: `1px solid ${isRequired ? '#fca5a5' : '#6b7280'}`,
                                                                                                                    borderRadius: '4px',
                                                                                                                    color: '#374151',
                                                                                                                    fontFamily: 'monospace'
                                                                                                                }}
                                                                                                            >
                                                                                                                {paramName}
                                                                                                                {param.type && `: ${param.type}`}
                                                                                                            </span>
                                                                                                        );
                                                                                                    })}
                                                                                                </div>
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    ) : null;
                                                                })()}
                                                                {(() => {
                                                                    const numericLabels = (trace.raw?.numeric_labels as any) || {};
                                                                    const hasMetrics = Object.keys(numericLabels).length > 0;
                                                                    return hasMetrics ? (
                                                                        <div>
                                                                            <div
                                                                                style={{
                                                                                    fontSize: '0.7rem',
                                                                                    fontWeight: 600,
                                                                                    textTransform: 'uppercase',
                                                                                    marginBottom: '0.5rem',
                                                                                    color: '#6b7280'
                                                                                }}
                                                                            >
                                                                                AI Metrics & Performance
                                                                            </div>
                                                                            <div
                                                                                style={{
                                                                                    display: 'grid',
                                                                                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                                                                                    gap: '0.75rem',
                                                                                    padding: '0.75rem',
                                                                                    backgroundColor: 'white',
                                                                                    border: '1px solid #6b7280',
                                                                                    borderRadius: '6px'
                                                                                }}
                                                                            >
                                                                                {(numericLabels.ai_usage_inputTokens !== undefined ||
                                                                                    numericLabels.gen_ai_usage_input_tokens !== undefined) && (
                                                                                        <div>
                                                                                            <div
                                                                                                style={{
                                                                                                    fontSize: '0.65rem',
                                                                                                    color: '#6b7280',
                                                                                                    marginBottom: '0.25rem'
                                                                                                }}
                                                                                            >
                                                                                                Input Tokens
                                                                                            </div>
                                                                                            <div
                                                                                                style={{
                                                                                                    fontSize: '0.875rem',
                                                                                                    fontWeight: 600,
                                                                                                    color: '#1a1a1a',
                                                                                                    fontFamily: 'monospace'
                                                                                                }}
                                                                                            >
                                                                                                {(numericLabels.ai_usage_inputTokens ||
                                                                                                    numericLabels.gen_ai_usage_input_tokens || 0).toLocaleString()}
                                                                                            </div>
                                                                                        </div>
                                                                                    )}
                                                                                {(numericLabels.ai_usage_outputTokens !== undefined ||
                                                                                    numericLabels.gen_ai_usage_output_tokens !== undefined) && (
                                                                                        <div>
                                                                                            <div
                                                                                                style={{
                                                                                                    fontSize: '0.65rem',
                                                                                                    color: '#6b7280',
                                                                                                    marginBottom: '0.25rem'
                                                                                                }}
                                                                                            >
                                                                                                Output Tokens
                                                                                            </div>
                                                                                            <div
                                                                                                style={{
                                                                                                    fontSize: '0.875rem',
                                                                                                    fontWeight: 600,
                                                                                                    color: '#1a1a1a',
                                                                                                    fontFamily: 'monospace'
                                                                                                }}
                                                                                            >
                                                                                                {(numericLabels.ai_usage_outputTokens ||
                                                                                                    numericLabels.gen_ai_usage_output_tokens || 0).toLocaleString()}
                                                                                            </div>
                                                                                        </div>
                                                                                    )}
                                                                                {numericLabels.ai_usage_totalTokens !== undefined && (
                                                                                    <div>
                                                                                        <div
                                                                                            style={{
                                                                                                fontSize: '0.65rem',
                                                                                                color: '#6b7280',
                                                                                                marginBottom: '0.25rem'
                                                                                            }}
                                                                                        >
                                                                                            Total Tokens
                                                                                        </div>
                                                                                        <div
                                                                                            style={{
                                                                                                fontSize: '0.875rem',
                                                                                                fontWeight: 600,
                                                                                                color: '#1a1a1a',
                                                                                                fontFamily: 'monospace'
                                                                                            }}
                                                                                        >
                                                                                            {numericLabels.ai_usage_totalTokens.toLocaleString()}
                                                                                        </div>
                                                                                    </div>
                                                                                )}
                                                                                {numericLabels.ai_usage_cachedInputTokens !== undefined &&
                                                                                    numericLabels.ai_usage_cachedInputTokens > 0 && (
                                                                                        <div>
                                                                                            <div
                                                                                                style={{
                                                                                                    fontSize: '0.65rem',
                                                                                                    color: '#6b7280',
                                                                                                    marginBottom: '0.25rem'
                                                                                                }}
                                                                                            >
                                                                                                Cached Tokens
                                                                                            </div>
                                                                                            <div
                                                                                                style={{
                                                                                                    fontSize: '0.875rem',
                                                                                                    fontWeight: 600,
                                                                                                    color: '#10b981',
                                                                                                    fontFamily: 'monospace'
                                                                                                }}
                                                                                            >
                                                                                                {numericLabels.ai_usage_cachedInputTokens.toLocaleString()}
                                                                                            </div>
                                                                                        </div>
                                                                                    )}
                                                                                {numericLabels.ai_response_msToFinish !== undefined && (
                                                                                    <div>
                                                                                        <div
                                                                                            style={{
                                                                                                fontSize: '0.65rem',
                                                                                                color: '#6b7280',
                                                                                                marginBottom: '0.25rem'
                                                                                            }}
                                                                                        >
                                                                                            Total Time
                                                                                        </div>
                                                                                        <div
                                                                                            style={{
                                                                                                fontSize: '0.875rem',
                                                                                                fontWeight: 600,
                                                                                                color: '#1a1a1a',
                                                                                                fontFamily: 'monospace'
                                                                                            }}
                                                                                        >
                                                                                            {numericLabels.ai_response_msToFinish.toFixed(0)} ms
                                                                                        </div>
                                                                                    </div>
                                                                                )}
                                                                                {numericLabels.ai_response_msToFirstChunk !== undefined && (
                                                                                    <div>
                                                                                        <div
                                                                                            style={{
                                                                                                fontSize: '0.65rem',
                                                                                                color: '#6b7280',
                                                                                                marginBottom: '0.25rem'
                                                                                            }}
                                                                                        >
                                                                                            Time to First Chunk
                                                                                        </div>
                                                                                        <div
                                                                                            style={{
                                                                                                fontSize: '0.875rem',
                                                                                                fontWeight: 600,
                                                                                                color: '#1a1a1a',
                                                                                                fontFamily: 'monospace'
                                                                                            }}
                                                                                        >
                                                                                            {numericLabels.ai_response_msToFirstChunk.toFixed(0)} ms
                                                                                        </div>
                                                                                    </div>
                                                                                )}
                                                                                {numericLabels.ai_response_avgOutputTokensPerSecond !== undefined && (
                                                                                    <div>
                                                                                        <div
                                                                                            style={{
                                                                                                fontSize: '0.65rem',
                                                                                                color: '#6b7280',
                                                                                                marginBottom: '0.25rem'
                                                                                            }}
                                                                                        >
                                                                                            Output Speed
                                                                                        </div>
                                                                                        <div
                                                                                            style={{
                                                                                                fontSize: '0.875rem',
                                                                                                fontWeight: 600,
                                                                                                color: '#1a1a1a',
                                                                                                fontFamily: 'monospace'
                                                                                            }}
                                                                                        >
                                                                                            {numericLabels.ai_response_avgOutputTokensPerSecond.toFixed(1)} tokens/s
                                                                                        </div>
                                                                                    </div>
                                                                                )}
                                                                                {numericLabels.ai_settings_temperature !== undefined && (
                                                                                    <div>
                                                                                        <div
                                                                                            style={{
                                                                                                fontSize: '0.65rem',
                                                                                                color: '#6b7280',
                                                                                                marginBottom: '0.25rem'
                                                                                            }}
                                                                                        >
                                                                                            Temperature
                                                                                        </div>
                                                                                        <div
                                                                                            style={{
                                                                                                fontSize: '0.875rem',
                                                                                                fontWeight: 600,
                                                                                                color: '#1a1a1a',
                                                                                                fontFamily: 'monospace'
                                                                                            }}
                                                                                        >
                                                                                            {numericLabels.ai_settings_temperature}
                                                                                        </div>
                                                                                    </div>
                                                                                )}
                                                                                {(numericLabels.ai_settings_maxOutputTokens !== undefined ||
                                                                                    numericLabels.gen_ai_request_max_tokens !== undefined) && (
                                                                                        <div>
                                                                                            <div
                                                                                                style={{
                                                                                                    fontSize: '0.65rem',
                                                                                                    color: '#6b7280',
                                                                                                    marginBottom: '0.25rem'
                                                                                                }}
                                                                                            >
                                                                                                Max Output Tokens
                                                                                            </div>
                                                                                            <div
                                                                                                style={{
                                                                                                    fontSize: '0.875rem',
                                                                                                    fontWeight: 600,
                                                                                                    color: '#1a1a1a',
                                                                                                    fontFamily: 'monospace'
                                                                                                }}
                                                                                            >
                                                                                                {(numericLabels.ai_settings_maxOutputTokens ||
                                                                                                    numericLabels.gen_ai_request_max_tokens || 0).toLocaleString()}
                                                                                            </div>
                                                                                        </div>
                                                                                    )}
                                                                                {numericLabels.ai_settings_maxRetries !== undefined && (
                                                                                    <div>
                                                                                        <div
                                                                                            style={{
                                                                                                fontSize: '0.65rem',
                                                                                                color: '#6b7280',
                                                                                                marginBottom: '0.25rem'
                                                                                            }}
                                                                                        >
                                                                                            Max Retries
                                                                                        </div>
                                                                                        <div
                                                                                            style={{
                                                                                                fontSize: '0.875rem',
                                                                                                fontWeight: 600,
                                                                                                color: '#1a1a1a',
                                                                                                fontFamily: 'monospace'
                                                                                            }}
                                                                                        >
                                                                                            {numericLabels.ai_settings_maxRetries}
                                                                                        </div>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    ) : null;
                                                                })()}
                                                                <div
                                                                    style={{
                                                                        display: 'flex',
                                                                        justifyContent: 'space-between',
                                                                        alignItems: 'center'
                                                                    }}
                                                                >
                                                                    <div
                                                                        style={{
                                                                            fontSize: '0.7rem',
                                                                            fontWeight: 600,
                                                                            textTransform: 'uppercase',
                                                                            color: '#6b7280'
                                                                        }}
                                                                    >
                                                                        Complete APM Trace JSON
                                                                    </div>
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            navigator.clipboard.writeText(
                                                                                JSON.stringify(trace.raw, null, 2)
                                                                            );
                                                                        }}
                                                                        style={{
                                                                            fontSize: '0.65rem',
                                                                            padding: '0.25rem 0.5rem',
                                                                            backgroundColor: '#f3f4f6',
                                                                            border: '1px solid #6b7280',
                                                                            borderRadius: '4px',
                                                                            cursor: 'pointer',
                                                                            color: '#374151'
                                                                        }}
                                                                    >
                                                                        Copy JSON
                                                                    </button>
                                                                </div>
                                                                <pre
                                                                    style={{
                                                                        fontSize: '0.75rem',
                                                                        padding: '0.75rem',
                                                                        borderRadius: '6px',
                                                                        border: '1px solid #6b7280',
                                                                        backgroundColor: 'white',
                                                                        overflowX: 'auto',
                                                                        maxHeight: '400px',
                                                                        overflowY: 'auto',
                                                                        margin: 0,
                                                                        fontFamily: 'monospace',
                                                                        whiteSpace: 'pre-wrap',
                                                                        wordBreak: 'break-word'
                                                                    }}
                                                                >
                                                                    {JSON.stringify(trace.raw, null, 2)}
                                                                </pre>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <div
                                    style={{
                                        padding: '2rem',
                                        textAlign: 'center',
                                        color: '#6b7280'
                                    }}
                                >
                                    No APM traces found for ai.streamText operations in the selected time range
                                </div>
                            )}
                            {context.apmTraces.pagination.hasMore && (
                                <div
                                    style={{
                                        padding: '1rem',
                                        textAlign: 'center',
                                        borderTop: '1px solid #6b7280'
                                    }}
                                >
                                    <button
                                        onClick={handleLoadMoreApm}
                                        disabled={loadingMore}
                                        style={{
                                            padding: '0.5rem 1rem',
                                            fontSize: '0.875rem',
                                            backgroundColor: loadingMore ? '#d1d5db' : '#3b82f6',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '6px',
                                            cursor: loadingMore ? 'not-allowed' : 'pointer',
                                            fontWeight: 500
                                        }}
                                    >
                                        {loadingMore ? 'Loading...' : 'Load More'}
                                    </button>
                                    {context.apmTraces.pagination.total > 0 && (
                                        <div
                                            style={{
                                                marginTop: '0.5rem',
                                                fontSize: '0.75rem',
                                                color: '#6b7280'
                                            }}
                                        >
                                            Showing {context.apmTraces.traces.length} of {context.apmTraces.pagination.total} traces
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
