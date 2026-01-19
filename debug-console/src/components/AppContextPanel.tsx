'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import ConversationLogDetailPanel from './ConversationLogDetailPanel';

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
    errorGroups: Array<{
        message: string;
        count: number;
        lastSeen?: string;
    }>;
}

interface ErrorDetail {
    timestamp: string;
    message: string;
    event?: string;
    service?: string;
    raw: Record<string, unknown>;
}

interface ActivityStats {
    totalLogs: number;
    byLevel: Record<string, number>;
    byService: Record<string, number>;
    byEvent: Record<string, number>;
}

interface LifetimeActivityStats {
    totalLogs: number;
    byLevel: Record<string, number>;
    byService: Record<string, number>;
    byEvent: Record<string, number>;
    firstActivity?: string;
    lastActivity?: string;
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
    lifetimeStats?: LifetimeActivityStats;
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
    showAllLogs?: boolean;
    onShowAllLogsChange?: (showAll: boolean) => void;
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

export default function AppContextPanel({
    appId,
    onClose: _onClose,
    showAllLogs = false,
    onShowAllLogsChange
}: AppContextPanelProps) {
    const [context, setContext] = useState<AppContext | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [timeRange, setTimeRange] = useState('24h');
    const [activeTab, setActiveTab] = useState<
        'summary' | 'conversation-logs'
    >('summary');
    const [apmPage, setApmPage] = useState(0);
    const [loadingMore, setLoadingMore] = useState(false);

    // Activity logs pagination state
    const [activityLogs, setActivityLogs] = useState<RecentActivity[]>([]);
    const [activityPage, setActivityPage] = useState(0);
    const [activityHasMore, setActivityHasMore] = useState(false);
    const [activityLoadingMore, setActivityLoadingMore] = useState(false);
    const ACTIVITY_PAGE_SIZE = 50;

    // Activity detail panel state
    const [selectedActivityIndex, setSelectedActivityIndex] = useState<number | null>(null);

    // Conversation log detail panel state
    const [selectedConversationIndex, setSelectedConversationIndex] = useState<number | null>(null);
    const conversationPanelRef = useRef<HTMLDivElement>(null);

    // Error detail drawer state
    const [selectedErrorGroup, setSelectedErrorGroup] = useState<{ message: string; count: number } | null>(null);
    const [errorDetails, setErrorDetails] = useState<ErrorDetail[]>([]);
    const [errorDetailsLoading, setErrorDetailsLoading] = useState(false);

    useEffect(() => {
        async function fetchContext() {
            setLoading(true);
            setError(null);
            setApmPage(0);

            try {
                const url = `/api/app-context?appId=${encodeURIComponent(appId)}&timeRange=${timeRange}`;
                const response = await fetch(url);

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to fetch app details');
                }

                const data = await response.json();
                setContext(data);
            } catch (err) {
                setError(
                    err instanceof Error ? err.message : 'Failed to fetch app details'
                );
            } finally {
                setLoading(false);
            }
        }

        if (appId) {
            fetchContext();
        }
    }, [appId, timeRange]);

    useEffect(() => {
        if (appId && activeTab === 'conversation-logs') {
            setApmPage(0);
        }
    }, [appId, activeTab]);

    const handleRefresh = () => {
        if (appId) {
            setLoading(true);
            setApmPage(0);
            fetch(`/api/app-context?appId=${encodeURIComponent(appId)}&timeRange=${timeRange}`)
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

    // Conversation log detail panel handlers
    const handleConversationSelect = useCallback((index: number) => {
        setSelectedConversationIndex(index);
    }, []);

    const closeConversationDetailPanel = useCallback(() => {
        setSelectedConversationIndex(null);
    }, []);

    const selectPreviousConversation = useCallback(() => {
        if (selectedConversationIndex !== null && selectedConversationIndex > 0) {
            setSelectedConversationIndex(selectedConversationIndex - 1);
        }
    }, [selectedConversationIndex]);

    const selectNextConversation = useCallback(() => {
        if (selectedConversationIndex !== null && context && selectedConversationIndex < context.apmTraces.traces.length - 1) {
            setSelectedConversationIndex(selectedConversationIndex + 1);
        }
    }, [selectedConversationIndex, context]);

    // Error detail drawer handlers
    const handleErrorGroupClick = useCallback(async (group: { message: string; count: number }) => {
        setSelectedErrorGroup(group);
        setErrorDetailsLoading(true);
        setErrorDetails([]);

        try {
            const url = `/api/error-details?appId=${encodeURIComponent(appId)}&message=${encodeURIComponent(group.message)}&timeRange=${timeRange}`;
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                setErrorDetails(data.errors || []);
            }
        } catch (err) {
            console.error('Error fetching error details:', err);
        } finally {
            setErrorDetailsLoading(false);
        }
    }, [appId, timeRange]);

    const closeErrorDrawer = useCallback(() => {
        setSelectedErrorGroup(null);
        setErrorDetails([]);
    }, []);

    // Keyboard navigation for conversation panel
    useEffect(() => {
        if (activeTab !== 'conversation-logs' || selectedConversationIndex === null) return;

        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeConversationDetailPanel();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectPreviousConversation();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectNextConversation();
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeTab, selectedConversationIndex, closeConversationDetailPanel, selectPreviousConversation, selectNextConversation]);

    const handleLoadMoreApm = async () => {
        if (!appId || loadingMore || !context) return;

        setLoadingMore(true);
        const nextPage = apmPage + 1;

        try {
            const url = `/api/app-context?appId=${encodeURIComponent(appId)}&spansPage=${nextPage}&timeRange=${timeRange}`;
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
                <p>Loading app details...</p>
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
                        App Details: {context.appId}
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
                    <div style={{ minWidth: '200px' }}>
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
                    {onShowAllLogsChange && (
                        <div style={{ display: 'flex', alignItems: 'center', paddingTop: '1.25rem' }}>
                            <label style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                cursor: 'pointer',
                                fontSize: '0.875rem',
                                color: '#374151',
                                userSelect: 'none'
                            }}>
                                <input
                                    type="checkbox"
                                    checked={showAllLogs}
                                    onChange={(e) => onShowAllLogsChange(e.target.checked)}
                                    style={{
                                        width: '1rem',
                                        height: '1rem',
                                        cursor: 'pointer',
                                        accentColor: '#3b82f6'
                                    }}
                                />
                                Show All Logs
                            </label>
                        </div>
                    )}
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
                </div>
            </div>

            <div
                style={{
                    display: 'flex',
                    borderBottom: '1px solid #6b7280',
                    backgroundColor: '#f9fafb'
                }}
            >
                {(['summary', 'conversation-logs'] as const).map(
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
                {activeTab === 'summary' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {/* Summary Header */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '1rem',
                            backgroundColor: context.errorSummary.total > 0 ? '#fef2f2' : '#f0fdf4',
                            borderRadius: '6px',
                            border: context.errorSummary.total > 0 ? '1px solid #fecaca' : '1px solid #bbf7d0'
                        }}>
                            <h3 style={{
                                margin: 0,
                                fontSize: '1rem',
                                fontWeight: 600,
                                color: context.errorSummary.total > 0 ? '#991b1b' : '#166534'
                            }}>
                                Error Summary
                            </h3>
                            <div style={{
                                display: 'flex',
                                gap: '1.5rem',
                                fontSize: '0.875rem',
                                fontWeight: 500
                            }}>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{
                                        fontSize: '1.5rem',
                                        fontWeight: 700,
                                        color: context.errorSummary.total > 0 ? '#dc2626' : '#16a34a'
                                    }}>
                                        {context.errorSummary.total}
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Total Errors</div>
                                </div>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{
                                        fontSize: '1.5rem',
                                        fontWeight: 700,
                                        color: context.errorSummary.last24Hours > 0 ? '#dc2626' : '#16a34a'
                                    }}>
                                        {context.errorSummary.last24Hours}
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Last 24h</div>
                                </div>
                            </div>
                        </div>

                        {/* Error Groups */}
                        {context.errorSummary.errorGroups.length > 0 ? (
                            <div style={{
                                padding: '1rem',
                                backgroundColor: '#f9fafb',
                                borderRadius: '6px',
                                border: '1px solid #e5e7eb'
                            }}>
                                <h4 style={{
                                    margin: '0 0 0.75rem 0',
                                    fontSize: '0.875rem',
                                    fontWeight: 600,
                                    color: '#374151'
                                }}>
                                    Errors by Message
                                </h4>
                                <div style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.5rem',
                                    maxHeight: '400px',
                                    overflowY: 'auto'
                                }}>
                                    {context.errorSummary.errorGroups.map((group, index) => (
                                        <div
                                            key={index}
                                            onClick={() => handleErrorGroupClick(group)}
                                            style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                                padding: '0.75rem 1rem',
                                                backgroundColor: selectedErrorGroup?.message === group.message ? '#fef2f2' : 'white',
                                                borderRadius: '4px',
                                                border: selectedErrorGroup?.message === group.message ? '1px solid #fca5a5' : '1px solid #e5e7eb',
                                                cursor: 'pointer',
                                                transition: 'all 0.15s ease'
                                            }}
                                            onMouseEnter={(e) => {
                                                if (selectedErrorGroup?.message !== group.message) {
                                                    e.currentTarget.style.backgroundColor = '#f9fafb';
                                                    e.currentTarget.style.borderColor = '#d1d5db';
                                                }
                                            }}
                                            onMouseLeave={(e) => {
                                                if (selectedErrorGroup?.message !== group.message) {
                                                    e.currentTarget.style.backgroundColor = 'white';
                                                    e.currentTarget.style.borderColor = '#e5e7eb';
                                                }
                                            }}
                                        >
                                            <div style={{
                                                flex: 1,
                                                fontSize: '0.875rem',
                                                color: '#374151',
                                                wordBreak: 'break-word',
                                                marginRight: '1rem'
                                            }}>
                                                <div>{group.message}</div>
                                                {group.lastSeen && (
                                                    <div style={{
                                                        fontSize: '0.7rem',
                                                        color: '#6b7280',
                                                        marginTop: '0.25rem',
                                                        fontFamily: 'monospace'
                                                    }}>
                                                        Last seen: {formatTimestamp(group.lastSeen)}
                                                    </div>
                                                )}
                                            </div>
                                            <div style={{
                                                fontSize: '0.875rem',
                                                fontWeight: 600,
                                                color: '#dc2626',
                                                backgroundColor: '#fef2f2',
                                                padding: '0.25rem 0.75rem',
                                                borderRadius: '9999px',
                                                whiteSpace: 'nowrap',
                                                alignSelf: 'flex-start'
                                            }}>
                                                {group.count}×
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : context.errorSummary.total === 0 ? (
                            <div style={{
                                padding: '2rem',
                                textAlign: 'center',
                                color: '#166534',
                                backgroundColor: '#f0fdf4',
                                borderRadius: '6px',
                                border: '1px solid #bbf7d0'
                            }}>
                                ✓ No errors found in the selected time range
                            </div>
                        ) : null}
                    </div>
                )}

                {activeTab === 'conversation-logs' && (
                    <div ref={conversationPanelRef} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', height: '100%' }}>
                        {/* Conversation Logs Header */}
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '0.5rem 1rem',
                                backgroundColor: '#f0fdf4',
                                borderRadius: '6px',
                                border: '1px solid #86efac'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                <span style={{ fontSize: '0.875rem', color: '#166534', fontWeight: 600 }}>
                                    🤖 Conversation Logs
                                </span>
                                <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                                    {context.apmTraces.total} trace{context.apmTraces.total !== 1 ? 's' : ''} found
                                </span>
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
                                    fontSize: '0.7rem',
                                    padding: '0.35rem 0.75rem',
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
                                Copy All JSON
                            </button>
                        </div>

                        {/* Conversation Logs Table */}
                        <div style={{
                            maxHeight: '550px',
                            overflowY: 'auto',
                            border: '1px solid #6b7280',
                            borderRadius: '6px'
                        }}>
                            {context.apmTraces.total > 0 ? (
                                <table style={{ width: '100%', fontSize: '0.875rem', borderCollapse: 'collapse' }}>
                                    <thead style={{
                                        backgroundColor: '#f9fafb',
                                        borderBottom: '1px solid #6b7280',
                                        position: 'sticky',
                                        top: 0,
                                        zIndex: 5
                                    }}>
                                        <tr>
                                            <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, width: '160px', color: '#374151' }}>Timestamp</th>
                                            <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, width: '200px', color: '#374151' }}>Operation</th>
                                            <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, width: '120px', color: '#374151' }}>Duration</th>
                                            <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, width: '300px', color: '#374151' }}>AI Prompt</th>
                                            <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, width: '300px', color: '#374151' }}>AI Response</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {context.apmTraces.traces.map((trace, index) => (
                                            <tr
                                                key={index}
                                                onClick={() => handleConversationSelect(index)}
                                                style={{
                                                    borderBottom: '1px solid #9ca3af',
                                                    cursor: 'pointer',
                                                    transition: 'background-color 0.2s',
                                                    backgroundColor: selectedConversationIndex === index ? '#dbeafe' : 'transparent'
                                                }}
                                                onMouseEnter={(e) => {
                                                    if (selectedConversationIndex !== index) {
                                                        e.currentTarget.style.backgroundColor = '#f9fafb';
                                                    }
                                                }}
                                                onMouseLeave={(e) => {
                                                    if (selectedConversationIndex !== index) {
                                                        e.currentTarget.style.backgroundColor = 'transparent';
                                                    }
                                                }}
                                            >
                                                <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', whiteSpace: 'nowrap', fontSize: '0.75rem', color: '#6b7280' }}>
                                                    {formatTimestamp(trace.timestamp)}
                                                </td>
                                                <td style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', color: '#374151' }}>
                                                    {mapOperationName((trace.raw?.labels as Record<string, unknown>)?.operation_name as string || trace.spanName)}
                                                </td>
                                                <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: '#6b7280' }}>
                                                    {trace.duration ? `${trace.duration.toFixed(2)} ms` : '-'}
                                                </td>
                                                <td style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', color: '#374151', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={((trace.raw?.labels as Record<string, unknown>)?.ai_prompt as string) || '-'}>
                                                    {((trace.raw?.labels as Record<string, unknown>)?.ai_prompt as string) || '-'}
                                                </td>
                                                <td style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', color: '#374151', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={((trace.raw?.labels as Record<string, unknown>)?.ai_response_text as string) || '-'}>
                                                    {((trace.raw?.labels as Record<string, unknown>)?.ai_response_text as string) || '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                                    No conversation logs found for the app
                                </div>
                            )}
                        </div>

                        {/* Drawer Detail Panel */}
                        {selectedConversationIndex !== null && context.apmTraces.total > 0 && (
                            <div style={{
                                position: 'fixed',
                                top: '60px',
                                right: 0,
                                bottom: 0,
                                width: '650px',
                                maxWidth: '90vw',
                                backgroundColor: 'white',
                                boxShadow: '-4px 0 20px rgba(0,0,0,0.15)',
                                zIndex: 1000,
                                borderTopLeftRadius: '8px'
                            }}>
                                <ConversationLogDetailPanel
                                    trace={context.apmTraces.traces[selectedConversationIndex]}
                                    onClose={closeConversationDetailPanel}
                                    onPrevious={selectPreviousConversation}
                                    onNext={selectNextConversation}
                                    hasPrevious={selectedConversationIndex > 0}
                                    hasNext={selectedConversationIndex < context.apmTraces.traces.length - 1}
                                />
                            </div>
                        )}

                        {/* Load More Button */}
                        {context.apmTraces.pagination.hasMore && (
                            <div
                                style={{
                                    padding: '1rem',
                                    textAlign: 'center',
                                    borderTop: '1px solid #6b7280',
                                    borderRadius: '0 0 6px 6px',
                                    backgroundColor: '#fafafa'
                                }}
                            >
                                <button
                                    onClick={handleLoadMoreApm}
                                    disabled={loadingMore}
                                    style={{
                                        padding: '0.5rem 1.5rem',
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
                )}
            </div>

            {/* Error Detail Drawer */}
            {selectedErrorGroup && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        right: 0,
                        width: '500px',
                        height: '100vh',
                        backgroundColor: 'white',
                        boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.15)',
                        zIndex: 1000,
                        display: 'flex',
                        flexDirection: 'column',
                        animation: 'slideIn 0.2s ease-out'
                    }}
                >
                    {/* Drawer Header */}
                    <div style={{
                        padding: '1rem 1.5rem',
                        borderBottom: '1px solid #e5e7eb',
                        backgroundColor: '#fef2f2',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start'
                    }}>
                        <div style={{ flex: 1 }}>
                            <h3 style={{
                                margin: '0 0 0.5rem 0',
                                fontSize: '1rem',
                                fontWeight: 600,
                                color: '#991b1b'
                            }}>
                                Error Details
                            </h3>
                            <div style={{
                                fontSize: '0.875rem',
                                color: '#dc2626',
                                wordBreak: 'break-word'
                            }}>
                                {selectedErrorGroup.message}
                            </div>
                            <div style={{
                                marginTop: '0.5rem',
                                fontSize: '0.75rem',
                                color: '#991b1b'
                            }}>
                                {selectedErrorGroup.count} occurrence{selectedErrorGroup.count !== 1 ? 's' : ''}
                            </div>
                        </div>
                        <button
                            onClick={closeErrorDrawer}
                            style={{
                                padding: '0.5rem',
                                backgroundColor: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: '1.25rem',
                                color: '#991b1b',
                                lineHeight: 1
                            }}
                        >
                            ×
                        </button>
                    </div>

                    {/* Drawer Content */}
                    <div style={{
                        flex: 1,
                        overflowY: 'auto',
                        padding: '1rem'
                    }}>
                        {errorDetailsLoading ? (
                            <div style={{
                                padding: '2rem',
                                textAlign: 'center',
                                color: '#6b7280'
                            }}>
                                Loading error details...
                            </div>
                        ) : errorDetails.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {errorDetails.map((detail, index) => (
                                    <div
                                        key={index}
                                        style={{
                                            padding: '1rem',
                                            backgroundColor: '#f9fafb',
                                            borderRadius: '6px',
                                            border: '1px solid #e5e7eb'
                                        }}
                                    >
                                        <div style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            marginBottom: '0.5rem'
                                        }}>
                                            <span style={{
                                                fontSize: '0.75rem',
                                                color: '#6b7280',
                                                fontFamily: 'monospace'
                                            }}>
                                                {formatTimestamp(detail.timestamp)}
                                            </span>
                                            {detail.service && (
                                                <span style={{
                                                    fontSize: '0.75rem',
                                                    color: '#374151',
                                                    backgroundColor: '#e5e7eb',
                                                    padding: '0.125rem 0.5rem',
                                                    borderRadius: '4px'
                                                }}>
                                                    {detail.service}
                                                </span>
                                            )}
                                        </div>
                                        {detail.event && (
                                            <div style={{
                                                fontSize: '0.75rem',
                                                color: '#6b7280',
                                                marginBottom: '0.5rem'
                                            }}>
                                                Event: {detail.event}
                                            </div>
                                        )}

                                        {/* Error field */}
                                        {(() => {
                                            const errorValue = detail.raw?.error;
                                            if (!errorValue) return null;
                                            const errorText = typeof errorValue === 'string' ? errorValue : JSON.stringify(errorValue, null, 2);
                                            return (
                                                <div style={{
                                                    marginTop: '0.5rem',
                                                    padding: '0.75rem',
                                                    backgroundColor: '#fef2f2',
                                                    borderRadius: '4px',
                                                    border: '1px solid #fecaca'
                                                }}>
                                                    <div style={{
                                                        fontSize: '0.7rem',
                                                        fontWeight: 600,
                                                        color: '#991b1b',
                                                        marginBottom: '0.25rem',
                                                        textTransform: 'uppercase'
                                                    }}>
                                                        Error
                                                    </div>
                                                    <div style={{
                                                        fontSize: '0.8rem',
                                                        color: '#dc2626',
                                                        wordBreak: 'break-word'
                                                    }}>
                                                        {errorText}
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        {/* Data field */}
                                        {(() => {
                                            const dataValue = detail.raw?.data;
                                            if (!dataValue || typeof dataValue !== 'object') return null;
                                            const entries = Object.entries(dataValue as Record<string, unknown>);
                                            if (entries.length === 0) return null;
                                            return (
                                                <div style={{
                                                    marginTop: '0.5rem',
                                                    padding: '0.75rem',
                                                    backgroundColor: '#f8fafc',
                                                    borderRadius: '4px',
                                                    border: '1px solid #e2e8f0'
                                                }}>
                                                    <div style={{
                                                        fontSize: '0.7rem',
                                                        fontWeight: 600,
                                                        color: '#475569',
                                                        marginBottom: '0.5rem',
                                                        textTransform: 'uppercase'
                                                    }}>
                                                        Data
                                                    </div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                                        {entries.map(([key, value]) => (
                                                            <div key={key} style={{
                                                                display: 'flex',
                                                                fontSize: '0.8rem',
                                                                lineHeight: 1.4
                                                            }}>
                                                                <span style={{
                                                                    color: '#64748b',
                                                                    minWidth: '100px',
                                                                    flexShrink: 0
                                                                }}>
                                                                    {key}:
                                                                </span>
                                                                <span style={{
                                                                    color: '#334155',
                                                                    wordBreak: 'break-word'
                                                                }}>
                                                                    {typeof value === 'object'
                                                                        ? JSON.stringify(value)
                                                                        : String(value)}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{
                                padding: '2rem',
                                textAlign: 'center',
                                color: '#6b7280'
                            }}>
                                No detailed error logs found
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Drawer backdrop */}
            {selectedErrorGroup && (
                <div
                    onClick={closeErrorDrawer}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        zIndex: 999
                    }}
                />
            )}
        </div>
    );
}
