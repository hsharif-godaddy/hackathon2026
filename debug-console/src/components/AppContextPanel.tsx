'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import ActivityDetailPanel from './ActivityDetailPanel';
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

    // Activity logs pagination state
    const [activityLogs, setActivityLogs] = useState<RecentActivity[]>([]);
    const [activityPage, setActivityPage] = useState(0);
    const [activityTotal, setActivityTotal] = useState(0);
    const [activityHasMore, setActivityHasMore] = useState(false);
    const [activityLoading, setActivityLoading] = useState(false);
    const [activityLoadingMore, setActivityLoadingMore] = useState(false);
    const ACTIVITY_PAGE_SIZE = 50;

    // Activity detail panel state
    const [selectedActivityIndex, setSelectedActivityIndex] = useState<number | null>(null);
    const [activityViewMode, setActivityViewMode] = useState<'split' | 'drawer'>('drawer');
    const [activityDetailWidth, setActivityDetailWidth] = useState(450);
    const [isResizingActivityPanel, setIsResizingActivityPanel] = useState(false);
    const activityPanelRef = useRef<HTMLDivElement>(null);

    // Conversation log detail panel state
    const [selectedConversationIndex, setSelectedConversationIndex] = useState<number | null>(null);
    const [conversationViewMode, setConversationViewMode] = useState<'split' | 'drawer'>('drawer');
    const [conversationDetailWidth, setConversationDetailWidth] = useState(550);
    const [isResizingConversationPanel, setIsResizingConversationPanel] = useState(false);
    const conversationPanelRef = useRef<HTMLDivElement>(null);

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

    // Fetch activity logs when activity tab is active
    useEffect(() => {
        async function fetchActivityLogs() {
            if (!appId || activeTab !== 'activity') return;

            setActivityLoading(true);
            setActivityPage(0);

            try {
                let url = `/api/activity-logs?appId=${encodeURIComponent(appId)}&page=0&pageSize=${ACTIVITY_PAGE_SIZE}`;
                if (useCustomTime && customStartTime && customEndTime) {
                    url += `&startTime=${encodeURIComponent(new Date(customStartTime).toISOString())}`;
                    url += `&endTime=${encodeURIComponent(new Date(customEndTime).toISOString())}`;
                } else {
                    url += `&timeRange=${timeRange}`;
                }

                const response = await fetch(url);
                if (response.ok) {
                    const data = await response.json();
                    setActivityLogs(data.logs || []);
                    setActivityTotal(data.pagination?.total || 0);
                    setActivityHasMore(data.pagination?.hasMore || false);
                }
            } catch (err) {
                console.error('Error fetching activity logs:', err);
            } finally {
                setActivityLoading(false);
            }
        }

        fetchActivityLogs();
    }, [appId, activeTab, timeRange, useCustomTime, customStartTime, customEndTime]);

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

    const handleLoadMoreActivity = async () => {
        if (!appId || activityLoadingMore || !activityHasMore) return;

        setActivityLoadingMore(true);
        const nextPage = activityPage + 1;

        try {
            let url = `/api/activity-logs?appId=${encodeURIComponent(appId)}&page=${nextPage}&pageSize=${ACTIVITY_PAGE_SIZE}`;
            if (useCustomTime && customStartTime && customEndTime) {
                url += `&startTime=${encodeURIComponent(new Date(customStartTime).toISOString())}`;
                url += `&endTime=${encodeURIComponent(new Date(customEndTime).toISOString())}`;
            } else {
                url += `&timeRange=${timeRange}`;
            }

            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                setActivityLogs((prev) => [...prev, ...(data.logs || [])]);
                setActivityHasMore(data.pagination?.hasMore || false);
                setActivityPage(nextPage);
            }
        } catch (err) {
            console.error('Error loading more activity logs:', err);
        } finally {
            setActivityLoadingMore(false);
        }
    };

    // Activity detail panel handlers
    const handleActivitySelect = useCallback((index: number) => {
        setSelectedActivityIndex(index);
    }, []);

    const closeActivityDetailPanel = useCallback(() => {
        setSelectedActivityIndex(null);
    }, []);

    const selectPreviousActivity = useCallback(() => {
        if (selectedActivityIndex !== null && selectedActivityIndex > 0) {
            setSelectedActivityIndex(selectedActivityIndex - 1);
        }
    }, [selectedActivityIndex]);

    const selectNextActivity = useCallback(() => {
        if (selectedActivityIndex !== null && selectedActivityIndex < activityLogs.length - 1) {
            setSelectedActivityIndex(selectedActivityIndex + 1);
        }
    }, [selectedActivityIndex, activityLogs.length]);

    // Keyboard navigation for activity panel
    useEffect(() => {
        if (activeTab !== 'activity' || selectedActivityIndex === null) return;

        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeActivityDetailPanel();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectPreviousActivity();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectNextActivity();
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeTab, selectedActivityIndex, closeActivityDetailPanel, selectPreviousActivity, selectNextActivity]);

    // Resize handlers for split view
    useEffect(() => {
        if (!isResizingActivityPanel) return;

        function handleMouseMove(e: MouseEvent) {
            if (activityPanelRef.current) {
                const containerRect = activityPanelRef.current.getBoundingClientRect();
                const newWidth = containerRect.right - e.clientX;
                setActivityDetailWidth(Math.max(300, Math.min(800, newWidth)));
            }
        }

        function handleMouseUp() {
            setIsResizingActivityPanel(false);
        }

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizingActivityPanel]);

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

    // Resize handlers for conversation split view
    useEffect(() => {
        if (!isResizingConversationPanel) return;

        function handleMouseMove(e: MouseEvent) {
            if (conversationPanelRef.current) {
                const containerRect = conversationPanelRef.current.getBoundingClientRect();
                const newWidth = containerRect.right - e.clientX;
                setConversationDetailWidth(Math.max(350, Math.min(900, newWidth)));
            }
        }

        function handleMouseUp() {
            setIsResizingConversationPanel(false);
        }

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizingConversationPanel]);

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

                        {/* Lifetime Stats Section */}
                        {context.lifetimeStats && (
                            <div
                                style={{
                                    padding: '1.25rem',
                                    backgroundColor: '#f0fdf4',
                                    borderRadius: '8px',
                                    border: '1px solid #86efac'
                                }}
                            >
                                <h3
                                    style={{
                                        margin: '0 0 1rem 0',
                                        fontSize: '1rem',
                                        fontWeight: 600,
                                        color: '#166534',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem'
                                    }}
                                >
                                    <span style={{ fontSize: '1.25rem' }}>📊</span>
                                    Lifetime Statistics
                                </h3>

                                {/* Lifetime Summary Cards */}
                                <div
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                                        gap: '0.75rem',
                                        marginBottom: '1rem'
                                    }}
                                >
                                    <div
                                        style={{
                                            padding: '0.75rem',
                                            backgroundColor: '#ffffff',
                                            borderRadius: '6px',
                                            border: '1px solid #bbf7d0'
                                        }}
                                    >
                                        <div
                                            style={{
                                                fontSize: '0.7rem',
                                                color: '#166534',
                                                marginBottom: '0.25rem',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.05em'
                                            }}
                                        >
                                            Total Logs (All Time)
                                        </div>
                                        <div
                                            style={{
                                                fontSize: '1.25rem',
                                                fontWeight: 700,
                                                color: '#15803d'
                                            }}
                                        >
                                            {context.lifetimeStats.totalLogs.toLocaleString()}
                                        </div>
                                    </div>

                                    <div
                                        style={{
                                            padding: '0.75rem',
                                            backgroundColor: '#ffffff',
                                            borderRadius: '6px',
                                            border: '1px solid #bbf7d0'
                                        }}
                                    >
                                        <div
                                            style={{
                                                fontSize: '0.7rem',
                                                color: '#166534',
                                                marginBottom: '0.25rem',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.05em'
                                            }}
                                        >
                                            First Activity
                                        </div>
                                        <div
                                            style={{
                                                fontSize: '0.85rem',
                                                fontWeight: 600,
                                                color: '#15803d'
                                            }}
                                        >
                                            {context.lifetimeStats.firstActivity
                                                ? formatTimestamp(context.lifetimeStats.firstActivity)
                                                : '-'}
                                        </div>
                                    </div>

                                    <div
                                        style={{
                                            padding: '0.75rem',
                                            backgroundColor: '#ffffff',
                                            borderRadius: '6px',
                                            border: '1px solid #bbf7d0'
                                        }}
                                    >
                                        <div
                                            style={{
                                                fontSize: '0.7rem',
                                                color: '#166534',
                                                marginBottom: '0.25rem',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.05em'
                                            }}
                                        >
                                            Last Activity
                                        </div>
                                        <div
                                            style={{
                                                fontSize: '0.85rem',
                                                fontWeight: 600,
                                                color: '#15803d'
                                            }}
                                        >
                                            {context.lifetimeStats.lastActivity
                                                ? formatTimestamp(context.lifetimeStats.lastActivity)
                                                : '-'}
                                        </div>
                                    </div>
                                </div>

                                {/* Lifetime Breakdown */}
                                <div
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                                        gap: '1rem'
                                    }}
                                >
                                    {/* Lifetime Logs by Level */}
                                    <div
                                        style={{
                                            padding: '0.75rem',
                                            backgroundColor: '#ffffff',
                                            borderRadius: '6px',
                                            border: '1px solid #bbf7d0'
                                        }}
                                    >
                                        <h4
                                            style={{
                                                margin: '0 0 0.5rem 0',
                                                fontSize: '0.75rem',
                                                fontWeight: 600,
                                                color: '#166534',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.05em'
                                            }}
                                        >
                                            All-Time by Level
                                        </h4>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                            {Object.entries(context.lifetimeStats.byLevel)
                                                .sort(([, a], [, b]) => b - a)
                                                .slice(0, 6)
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
                                                                fontSize: '0.8rem',
                                                                fontWeight: 500,
                                                                color: '#166534'
                                                            }}
                                                        >
                                                            {count.toLocaleString()}
                                                        </span>
                                                    </div>
                                                ))}
                                        </div>
                                    </div>

                                    {/* Lifetime Logs by Service */}
                                    <div
                                        style={{
                                            padding: '0.75rem',
                                            backgroundColor: '#ffffff',
                                            borderRadius: '6px',
                                            border: '1px solid #bbf7d0'
                                        }}
                                    >
                                        <h4
                                            style={{
                                                margin: '0 0 0.5rem 0',
                                                fontSize: '0.75rem',
                                                fontWeight: 600,
                                                color: '#166534',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.05em'
                                            }}
                                        >
                                            All-Time by Service
                                        </h4>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                            {Object.entries(context.lifetimeStats.byService)
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
                                                                fontSize: '0.8rem',
                                                                fontFamily: 'monospace',
                                                                color: '#374151',
                                                                overflow: 'hidden',
                                                                textOverflow: 'ellipsis',
                                                                whiteSpace: 'nowrap',
                                                                maxWidth: '120px'
                                                            }}
                                                            title={service}
                                                        >
                                                            {service}
                                                        </span>
                                                        <span
                                                            style={{
                                                                fontSize: '0.8rem',
                                                                fontWeight: 500,
                                                                color: '#166534'
                                                            }}
                                                        >
                                                            {count.toLocaleString()}
                                                        </span>
                                                    </div>
                                                ))}
                                        </div>
                                    </div>

                                    {/* Lifetime Logs by Event */}
                                    <div
                                        style={{
                                            padding: '0.75rem',
                                            backgroundColor: '#ffffff',
                                            borderRadius: '6px',
                                            border: '1px solid #bbf7d0'
                                        }}
                                    >
                                        <h4
                                            style={{
                                                margin: '0 0 0.5rem 0',
                                                fontSize: '0.75rem',
                                                fontWeight: 600,
                                                color: '#166534',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.05em'
                                            }}
                                        >
                                            All-Time by Event
                                        </h4>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                            {Object.entries(context.lifetimeStats.byEvent)
                                                .sort(([, a], [, b]) => b - a)
                                                .slice(0, 5)
                                                .map(([event, count]) => (
                                                    <div
                                                        key={event}
                                                        style={{
                                                            display: 'flex',
                                                            justifyContent: 'space-between',
                                                            alignItems: 'center'
                                                        }}
                                                    >
                                                        <span
                                                            style={{
                                                                fontSize: '0.8rem',
                                                                fontFamily: 'monospace',
                                                                color: '#374151',
                                                                overflow: 'hidden',
                                                                textOverflow: 'ellipsis',
                                                                whiteSpace: 'nowrap',
                                                                maxWidth: '120px'
                                                            }}
                                                            title={event}
                                                        >
                                                            {event}
                                                        </span>
                                                        <span
                                                            style={{
                                                                fontSize: '0.8rem',
                                                                fontWeight: 500,
                                                                color: '#166534'
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

                    </div>
                )}

                {activeTab === 'activity' && (
                    <div ref={activityPanelRef} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%' }}>
                        {/* Activity Stats Header */}
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '0.75rem 1rem',
                                backgroundColor: '#f0f9ff',
                                borderRadius: '6px',
                                border: '1px solid #bae6fd'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                <span style={{ fontSize: '0.875rem', color: '#1e40af', fontWeight: 600 }}>
                                    📋 Activity Logs
                                </span>
                                <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                                    Showing {activityLogs.length.toLocaleString()} of {activityTotal.toLocaleString()} logs
                                </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                {/* View Mode Toggle */}
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.25rem',
                                    backgroundColor: '#1e3a5f',
                                    borderRadius: '6px',
                                    padding: '0.15rem',
                                    border: '1px solid #2563eb'
                                }}>
                                    <button
                                        onClick={() => setActivityViewMode('split')}
                                        style={{
                                            padding: '0.35rem 0.75rem',
                                            fontSize: '0.75rem',
                                            fontWeight: 600,
                                            border: 'none',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            backgroundColor: activityViewMode === 'split' ? '#3b82f6' : 'transparent',
                                            color: activityViewMode === 'split' ? 'white' : '#93c5fd',
                                            transition: 'all 0.15s'
                                        }}
                                    >
                                        Split
                                    </button>
                                    <button
                                        onClick={() => setActivityViewMode('drawer')}
                                        style={{
                                            padding: '0.35rem 0.75rem',
                                            fontSize: '0.75rem',
                                            fontWeight: 600,
                                            border: 'none',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            backgroundColor: activityViewMode === 'drawer' ? '#3b82f6' : 'transparent',
                                            color: activityViewMode === 'drawer' ? 'white' : '#93c5fd',
                                            transition: 'all 0.15s'
                                        }}
                                    >
                                        Drawer
                                    </button>
                                </div>
                                {activityLoading && (
                                    <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Loading...</span>
                                )}
                            </div>
                        </div>

                        {/* Activity Logs - Split View or Table Only */}
                        {activityViewMode === 'split' && selectedActivityIndex !== null ? (
                            <div style={{ display: 'flex', flex: 1, minHeight: '500px', gap: '0' }}>
                                {/* Table Section */}
                                <div style={{
                                    flex: 1,
                                    minWidth: 0,
                                    overflowY: 'auto',
                                    border: '1px solid #6b7280',
                                    borderRadius: '6px 0 0 6px',
                                    borderRight: 'none'
                                }}>
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
                                                <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, width: '80px', color: '#374151' }}>Level</th>
                                                <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, width: '120px', color: '#374151' }}>Source</th>
                                                <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, color: '#374151' }}>Message</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {activityLoading && activityLogs.length === 0 ? (
                                                <tr>
                                                    <td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                                                        Loading activity logs...
                                                    </td>
                                                </tr>
                                            ) : activityLogs.length === 0 ? (
                                                <tr>
                                                    <td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                                                        No activity logs found for this time range.
                                                    </td>
                                                </tr>
                                            ) : (
                                                activityLogs.map((activity, index) => (
                                                    <tr
                                                        key={activity.id}
                                                        onClick={() => handleActivitySelect(index)}
                                                        style={{
                                                            borderBottom: '1px solid #9ca3af',
                                                            cursor: 'pointer',
                                                            transition: 'background-color 0.2s',
                                                            backgroundColor: selectedActivityIndex === index ? '#dbeafe' : 'transparent'
                                                        }}
                                                        onMouseEnter={(e) => {
                                                            if (selectedActivityIndex !== index) {
                                                                e.currentTarget.style.backgroundColor = '#f9fafb';
                                                            }
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            if (selectedActivityIndex !== index) {
                                                                e.currentTarget.style.backgroundColor = 'transparent';
                                                            }
                                                        }}
                                                    >
                                                        <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', whiteSpace: 'nowrap', fontSize: '0.75rem', color: '#6b7280' }}>
                                                            {formatTimestamp(activity.timestamp)}
                                                        </td>
                                                        <td style={{ padding: '0.75rem 1rem' }}>
                                                            <span style={getLogLevelBadgeStyle(activity.level)}>{activity.level.toLowerCase()}</span>
                                                        </td>
                                                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', color: '#6b7280', fontFamily: 'monospace' }}>
                                                            {activity.source || '-'}
                                                        </td>
                                                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {activity.message}
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Resize Handle */}
                                <div
                                    onMouseDown={() => setIsResizingActivityPanel(true)}
                                    style={{
                                        width: '6px',
                                        backgroundColor: '#e5e7eb',
                                        cursor: 'col-resize',
                                        borderTop: '1px solid #6b7280',
                                        borderBottom: '1px solid #6b7280',
                                        transition: 'background-color 0.15s'
                                    }}
                                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#93c5fd'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#e5e7eb'; }}
                                />

                                {/* Detail Panel */}
                                <div style={{
                                    width: activityDetailWidth,
                                    flexShrink: 0,
                                    border: '1px solid #6b7280',
                                    borderRadius: '0 6px 6px 0',
                                    overflow: 'hidden'
                                }}>
                                    <ActivityDetailPanel
                                        activity={activityLogs[selectedActivityIndex]}
                                        onClose={closeActivityDetailPanel}
                                        onPrevious={selectPreviousActivity}
                                        onNext={selectNextActivity}
                                        hasPrevious={selectedActivityIndex > 0}
                                        hasNext={selectedActivityIndex < activityLogs.length - 1}
                                    />
                                </div>
                            </div>
                        ) : (
                            /* Full width table when no selection or drawer mode */
                            <div style={{
                                maxHeight: '500px',
                                overflowY: 'auto',
                                border: '1px solid #6b7280',
                                borderRadius: '6px'
                            }}>
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
                                            <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, width: '80px', color: '#374151' }}>Level</th>
                                            <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, width: '120px', color: '#374151' }}>Source</th>
                                            <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, width: '200px', color: '#374151' }}>Event</th>
                                            <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, color: '#374151' }}>Message</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {activityLoading && activityLogs.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                                                    Loading activity logs...
                                                </td>
                                            </tr>
                                        ) : activityLogs.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                                                    No activity logs found for this time range.
                                                </td>
                                            </tr>
                                        ) : (
                                            activityLogs.map((activity, index) => (
                                                <tr
                                                    key={activity.id}
                                                    onClick={() => handleActivitySelect(index)}
                                                    style={{
                                                        borderBottom: '1px solid #9ca3af',
                                                        cursor: 'pointer',
                                                        transition: 'background-color 0.2s',
                                                        backgroundColor: selectedActivityIndex === index ? '#dbeafe' : 'transparent'
                                                    }}
                                                    onMouseEnter={(e) => {
                                                        if (selectedActivityIndex !== index) {
                                                            e.currentTarget.style.backgroundColor = '#f9fafb';
                                                        }
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        if (selectedActivityIndex !== index) {
                                                            e.currentTarget.style.backgroundColor = 'transparent';
                                                        }
                                                    }}
                                                >
                                                    <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', whiteSpace: 'nowrap', fontSize: '0.75rem', color: '#6b7280' }}>
                                                        {formatTimestamp(activity.timestamp)}
                                                    </td>
                                                    <td style={{ padding: '0.75rem 1rem' }}>
                                                        <span style={getLogLevelBadgeStyle(activity.level)}>{activity.level.toLowerCase()}</span>
                                                    </td>
                                                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', color: '#6b7280', fontFamily: 'monospace' }}>
                                                        {activity.source || '-'}
                                                    </td>
                                                    <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.75rem', color: '#6b7280', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={activity.event || '-'}>
                                                        {activity.event || '-'}
                                                    </td>
                                                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {activity.message}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* Drawer Mode Detail Panel */}
                        {activityViewMode === 'drawer' && selectedActivityIndex !== null && (
                            <div style={{
                                position: 'fixed',
                                top: '60px',
                                right: 0,
                                bottom: 0,
                                width: '600px',
                                maxWidth: '90vw',
                                backgroundColor: 'white',
                                boxShadow: '-4px 0 20px rgba(0,0,0,0.15)',
                                zIndex: 1000,
                                borderTopLeftRadius: '8px'
                            }}>
                                <ActivityDetailPanel
                                    activity={activityLogs[selectedActivityIndex]}
                                    onClose={closeActivityDetailPanel}
                                    onPrevious={selectPreviousActivity}
                                    onNext={selectNextActivity}
                                    hasPrevious={selectedActivityIndex > 0}
                                    hasNext={selectedActivityIndex < activityLogs.length - 1}
                                />
                            </div>
                        )}

                        {/* Load More Button */}
                        {activityHasMore && (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '0.5rem' }}>
                                <button
                                    onClick={handleLoadMoreActivity}
                                    disabled={activityLoadingMore}
                                    style={{
                                        padding: '0.75rem 2rem',
                                        backgroundColor: activityLoadingMore ? '#e5e7eb' : '#3b82f6',
                                        color: activityLoadingMore ? '#6b7280' : 'white',
                                        border: 'none',
                                        borderRadius: '6px',
                                        fontSize: '0.875rem',
                                        fontWeight: 500,
                                        cursor: activityLoadingMore ? 'not-allowed' : 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem'
                                    }}
                                >
                                    {activityLoadingMore ? (
                                        <>
                                            <span>Loading...</span>
                                        </>
                                    ) : (
                                        <>
                                            <span>Load More</span>
                                            <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                                                ({Math.min(ACTIVITY_PAGE_SIZE, activityTotal - activityLogs.length).toLocaleString()} more)
                                            </span>
                                        </>
                                    )}
                                </button>
                            </div>
                        )}

                        {/* Pagination Info */}
                        {activityLogs.length > 0 && (
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'center',
                                    fontSize: '0.75rem',
                                    color: '#6b7280'
                                }}
                            >
                                Page {activityPage + 1} • Loaded {activityLogs.length.toLocaleString()} of {activityTotal.toLocaleString()} logs
                            </div>
                        )}
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                {/* View Mode Toggle */}
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.25rem',
                                    backgroundColor: '#1e3a5f',
                                    borderRadius: '6px',
                                    padding: '0.15rem',
                                    border: '1px solid #2563eb'
                                }}>
                                    <button
                                        onClick={() => setConversationViewMode('split')}
                                        style={{
                                            padding: '0.35rem 0.75rem',
                                            fontSize: '0.75rem',
                                            fontWeight: 600,
                                            border: 'none',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            backgroundColor: conversationViewMode === 'split' ? '#3b82f6' : 'transparent',
                                            color: conversationViewMode === 'split' ? 'white' : '#93c5fd',
                                            transition: 'all 0.15s'
                                        }}
                                    >
                                        Split
                                    </button>
                                    <button
                                        onClick={() => setConversationViewMode('drawer')}
                                        style={{
                                            padding: '0.35rem 0.75rem',
                                            fontSize: '0.75rem',
                                            fontWeight: 600,
                                            border: 'none',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            backgroundColor: conversationViewMode === 'drawer' ? '#3b82f6' : 'transparent',
                                            color: conversationViewMode === 'drawer' ? 'white' : '#93c5fd',
                                            transition: 'all 0.15s'
                                        }}
                                    >
                                        Drawer
                                    </button>
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
                        </div>

                        {/* Conversation Logs - Split View or Table Only */}
                        {conversationViewMode === 'split' && selectedConversationIndex !== null && context.apmTraces.total > 0 ? (
                            <div style={{ display: 'flex', flex: 1, minHeight: '550px', gap: '0' }}>
                                {/* Table Section */}
                                <div style={{
                                    flex: 1,
                                    minWidth: 0,
                                    overflowY: 'auto',
                                    border: '1px solid #6b7280',
                                    borderRadius: '6px 0 0 6px',
                                    borderRight: 'none'
                                }}>
                                    <table style={{ width: '100%', fontSize: '0.875rem', borderCollapse: 'collapse' }}>
                                        <thead style={{
                                            backgroundColor: '#f9fafb',
                                            borderBottom: '1px solid #6b7280',
                                            position: 'sticky',
                                            top: 0,
                                            zIndex: 5
                                        }}>
                                            <tr>
                                                <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, width: '150px', color: '#374151' }}>Timestamp</th>
                                                <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, width: '150px', color: '#374151' }}>Operation</th>
                                                <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, width: '100px', color: '#374151' }}>Duration</th>
                                                <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, color: '#374151' }}>Prompt</th>
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
                                                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', color: '#6b7280' }}>
                                                        {trace.duration ? `${trace.duration.toFixed(0)} ms` : '-'}
                                                    </td>
                                                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {((trace.raw?.labels as Record<string, unknown>)?.ai_prompt as string) || '-'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Resize Handle */}
                                <div
                                    onMouseDown={() => setIsResizingConversationPanel(true)}
                                    style={{
                                        width: '6px',
                                        backgroundColor: '#e5e7eb',
                                        cursor: 'col-resize',
                                        borderTop: '1px solid #6b7280',
                                        borderBottom: '1px solid #6b7280',
                                        transition: 'background-color 0.15s'
                                    }}
                                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#93c5fd'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#e5e7eb'; }}
                                />

                                {/* Detail Panel */}
                                <div style={{
                                    width: conversationDetailWidth,
                                    flexShrink: 0,
                                    border: '1px solid #6b7280',
                                    borderRadius: '0 6px 6px 0',
                                    overflow: 'hidden'
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
                            </div>
                        ) : (
                            /* Full width table when no selection or drawer mode */
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
                                        No APM traces found for ai.streamText operations in the selected time range
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Drawer Mode Detail Panel */}
                        {conversationViewMode === 'drawer' && selectedConversationIndex !== null && context.apmTraces.total > 0 && (
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
        </div>
    );
}
