'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

const TIME_RANGES = [
  { label: 'Last 15 minutes', value: '15m' },
  { label: 'Last 1 hour', value: '1h' },
  { label: 'Last 6 hours', value: '6h' },
  { label: 'Last 24 hours', value: '24h' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'All time', value: 'all' }
] as const;

function getTimeRangeStart(range: string): Date | null {
  const now = new Date();
  switch (range) {
    case '15m':
      return new Date(now.getTime() - 15 * 60 * 1000);
    case '1h':
      return new Date(now.getTime() - 60 * 60 * 1000);
    case '6h':
      return new Date(now.getTime() - 6 * 60 * 60 * 1000);
    case '24h':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case 'all':
    default:
      return null;
  }
}

interface LangfuseObservation {
  id: string;
  type: string;
  name: string;
  startTime?: string;
  endTime?: string | null;
  input?: unknown;
  output?: unknown;
  latency?: number | null;
  model?: string | null;
  totalTokens?: number;
  totalPrice?: number;
  parentObservationId?: string | null;
}

interface LangfuseTrace {
  id: string;
  name: string;
  timestamp: string;
  sessionId: string | null;
  userId: string | null;
  latency: number | null;
  totalCost: number;
  metadata: Record<string, unknown>;
  observations: string[] | LangfuseObservation[];
  scores: Array<{
    id: string;
    name: string;
    value: number;
    source: string;
    comment?: string;
  }>;
}

interface LangfuseTracesResponse {
  data: LangfuseTrace[];
  meta: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
  };
}

interface LangfusePanelProps {
  globalAppId?: string;
  onRemove?: () => void;
  onSessionClick?: (sessionId: string) => void;
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

function formatLatency(ms: number | null): string {
  if (ms === null || ms === 0) return '-';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatObservationData(data: unknown): string {
  if (data === null || data === undefined) return '';
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

function extractConversationId(sessionId: string | null): string {
  if (!sessionId) return '-';
  // Extract conversation ID from "Conversation ID: xxx" format
  const match = sessionId.match(/Conversation ID:\s*(.+)/);
  return match ? match[1] : sessionId;
}

export default function LangfusePanel({ globalAppId, onRemove, onSessionClick }: LangfusePanelProps) {
  const [traces, setTraces] = useState<LangfuseTrace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);
  const [traceDetails, setTraceDetails] = useState<Record<string, LangfuseTrace>>({});
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [appIdFilter, setAppIdFilter] = useState('');
  const [timeRange, setTimeRange] = useState<string>('6h');
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const PAGE_SIZE = 25;

  // Effective app ID for filtering (global takes precedence)
  const effectiveAppId = globalAppId || appIdFilter;

  const fetchTraces = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch more traces if filtering, since we filter client-side
      const fetchLimit = (effectiveAppId || timeRange !== 'all') ? PAGE_SIZE * 4 : PAGE_SIZE;

      // Build query params
      const params = new URLSearchParams({
        page: String(page),
        limit: String(fetchLimit)
      });

      // Add time range filter
      const startTime = getTimeRangeStart(timeRange);
      if (startTime) {
        params.append('fromTimestamp', startTime.toISOString());
      }

      const response = await fetch(`/api/langfuse/traces?${params}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch traces: ${response.status}`);
      }

      const data: LangfuseTracesResponse = await response.json();
      let filteredTraces = data.data || [];

      // Filter by time range client-side as backup (API may not support it fully)
      if (startTime) {
        filteredTraces = filteredTraces.filter(trace => {
          const traceTime = new Date(trace.timestamp);
          return traceTime >= startTime;
        });
      }

      // Filter by app ID if provided (check sessionId and metadata)
      if (effectiveAppId) {
        const filterLower = effectiveAppId.toLowerCase();
        filteredTraces = filteredTraces.filter(trace => {
          // Check sessionId (contains "Conversation ID: xxx")
          const sessionMatch = trace.sessionId?.toLowerCase().includes(filterLower);
          // Check metadata conversationId
          const metadataConvId = trace.metadata?.global_agent_conversationId as string;
          const metadataMatch = metadataConvId?.toLowerCase().includes(filterLower);
          // Check trace ID itself
          const traceIdMatch = trace.id.toLowerCase().includes(filterLower);
          return sessionMatch || metadataMatch || traceIdMatch;
        });
      }

      // Limit to PAGE_SIZE after filtering
      filteredTraces = filteredTraces.slice(0, PAGE_SIZE);

      setTraces(filteredTraces);
      setTotalPages((effectiveAppId || timeRange !== 'all') ? 1 : (data.meta?.totalPages || 1));
      setTotalItems((effectiveAppId || timeRange !== 'all') ? filteredTraces.length : (data.meta?.totalItems || 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch traces');
    } finally {
      setLoading(false);
    }
  }, [page, effectiveAppId, timeRange]);

  const fetchTraceDetails = async (traceId: string) => {
    if (traceDetails[traceId]) return;

    try {
      const response = await fetch(`/api/langfuse/traces/${traceId}`);
      if (response.ok) {
        const data = await response.json();
        setTraceDetails(prev => ({ ...prev, [traceId]: data }));
      }
    } catch (err) {
      console.error('Failed to fetch trace details:', err);
    }
  };

  useEffect(() => {
    fetchTraces();
  }, [fetchTraces]);

  useEffect(() => {
    if (autoRefresh) {
      refreshIntervalRef.current = setInterval(fetchTraces, 10000);
    } else if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [autoRefresh, fetchTraces]);

  const handleExpandTrace = (traceId: string) => {
    if (expandedTrace === traceId) {
      setExpandedTrace(null);
    } else {
      setExpandedTrace(traceId);
      fetchTraceDetails(traceId);
    }
  };

  const renderTraceRow = (trace: LangfuseTrace) => {
    const isExpanded = expandedTrace === trace.id;
    const details = traceDetails[trace.id];
    const conversationId = extractConversationId(trace.sessionId);
    const agentName = (trace.metadata?.global_agent_agentName as string) || 'Unknown Agent';

    return (
      <React.Fragment key={trace.id}>
        <tr
          onClick={() => handleExpandTrace(trace.id)}
          style={{
            cursor: 'pointer',
            backgroundColor: isExpanded ? '#f0f9ff' : 'transparent',
            transition: 'background-color 0.15s'
          }}
          onMouseEnter={(e) => {
            if (!isExpanded) e.currentTarget.style.backgroundColor = '#f9fafb';
          }}
          onMouseLeave={(e) => {
            if (!isExpanded) e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          <td style={{ padding: '0.75rem', fontSize: '0.75rem', fontFamily: 'monospace', color: '#6b7280' }}>
            {trace.id.substring(0, 8)}...
          </td>
          <td style={{ padding: '0.75rem', fontSize: '0.813rem' }}>
            {formatTimestamp(trace.timestamp)}
          </td>
          <td style={{ padding: '0.75rem', fontSize: '0.813rem' }}>
            <span style={{
              backgroundColor: '#dbeafe',
              color: '#1e40af',
              padding: '0.125rem 0.5rem',
              borderRadius: '4px',
              fontSize: '0.75rem'
            }}>
              {agentName}
            </span>
          </td>
          <td style={{ padding: '0.75rem', fontSize: '0.75rem', fontFamily: 'monospace' }}>
            <span
              style={{ cursor: onSessionClick ? 'pointer' : 'default', color: '#3b82f6' }}
              onClick={(e) => {
                e.stopPropagation();
                if (onSessionClick && trace.sessionId) {
                  onSessionClick(conversationId);
                }
              }}
            >
              {conversationId.substring(0, 8)}...
            </span>
          </td>
          <td style={{ padding: '0.75rem', fontSize: '0.813rem', textAlign: 'right' }}>
            {formatLatency(trace.latency)}
          </td>
          <td style={{ padding: '0.75rem', fontSize: '0.813rem', textAlign: 'center' }}>
            {Array.isArray(trace.observations) ? trace.observations.length : 0}
          </td>
          <td style={{ padding: '0.75rem', fontSize: '0.813rem', textAlign: 'center' }}>
            {trace.scores?.length || 0}
          </td>
        </tr>

        {isExpanded && (
          <tr>
            <td colSpan={7} style={{ padding: 0, backgroundColor: '#f8fafc' }}>
              <div style={{ padding: '1rem', borderTop: '1px solid #e5e7eb' }}>
                {!details ? (
                  <div style={{ textAlign: 'center', padding: '1rem', color: '#6b7280' }}>
                    Loading trace details...
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: '1rem' }}>
                    {/* Metadata */}
                    <div>
                      <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: 600 }}>
                        Metadata
                      </h4>
                      <div style={{
                        backgroundColor: '#1e293b',
                        padding: '0.75rem',
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        fontFamily: 'monospace',
                        color: '#e2e8f0',
                        maxHeight: '150px',
                        overflow: 'auto'
                      }}>
                        <pre style={{ margin: 0 }}>
                          {JSON.stringify(details.metadata, null, 2)}
                        </pre>
                      </div>
                    </div>

                    {/* Observations */}
                    {details.observations && Array.isArray(details.observations) && details.observations.length > 0 && (
                      <div>
                        <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: 600 }}>
                          Observations ({details.observations.length})
                        </h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '400px', overflow: 'auto' }}>
                          {details.observations.map((obs, idx) => {
                            const observation: LangfuseObservation = typeof obs === 'string'
                              ? { id: obs, type: 'SPAN', name: obs }
                              : obs as LangfuseObservation;
                            const obsType = observation.type || 'SPAN';
                            const typeColors: Record<string, { bg: string; text: string }> = {
                              'GENERATION': { bg: '#dcfce7', text: '#166534' },
                              'SPAN': { bg: '#fef3c7', text: '#92400e' },
                              'EVENT': { bg: '#dbeafe', text: '#1e40af' }
                            };
                            const colors = typeColors[obsType] || typeColors['SPAN'];

                            return (
                              <div
                                key={observation.id || idx}
                                style={{
                                  backgroundColor: 'white',
                                  padding: '0.75rem',
                                  borderRadius: '6px',
                                  border: '1px solid #e5e7eb'
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                  <span style={{
                                    backgroundColor: colors.bg,
                                    color: colors.text,
                                    padding: '0.125rem 0.5rem',
                                    borderRadius: '4px',
                                    fontSize: '0.625rem',
                                    fontWeight: 600
                                  }}>
                                    {obsType}
                                  </span>
                                  <span style={{ fontSize: '0.75rem', color: '#6b7280', fontFamily: 'monospace' }}>
                                    {observation.id?.substring(0, 16) || idx}
                                  </span>
                                </div>
                                <div style={{ fontSize: '0.813rem', fontWeight: 500, marginBottom: '0.25rem' }}>
                                  {observation.name}
                                </div>
                                {observation.input !== null && observation.input !== undefined && (
                                  <div style={{ marginTop: '0.5rem' }}>
                                    <div style={{ fontSize: '0.625rem', color: '#6b7280', marginBottom: '0.25rem' }}>INPUT:</div>
                                    <pre style={{
                                      backgroundColor: '#f8fafc',
                                      padding: '0.5rem',
                                      borderRadius: '4px',
                                      fontSize: '0.75rem',
                                      fontFamily: 'monospace',
                                      maxHeight: '100px',
                                      overflow: 'auto',
                                      margin: 0,
                                      whiteSpace: 'pre-wrap',
                                      wordBreak: 'break-word'
                                    }}>
                                      {formatObservationData(observation.input)}
                                    </pre>
                                  </div>
                                )}
                                {observation.output !== null && observation.output !== undefined && (
                                  <div style={{ marginTop: '0.5rem' }}>
                                    <div style={{ fontSize: '0.625rem', color: '#6b7280', marginBottom: '0.25rem' }}>OUTPUT:</div>
                                    <pre style={{
                                      backgroundColor: '#f0fdf4',
                                      padding: '0.5rem',
                                      borderRadius: '4px',
                                      fontSize: '0.75rem',
                                      fontFamily: 'monospace',
                                      maxHeight: '100px',
                                      overflow: 'auto',
                                      margin: 0,
                                      whiteSpace: 'pre-wrap',
                                      wordBreak: 'break-word'
                                    }}>
                                      {formatObservationData(observation.output)}
                                    </pre>
                                  </div>
                                )}
                                {observation.latency && (
                                  <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#6b7280' }}>
                                    Latency: {formatLatency(observation.latency)}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Scores */}
                    {details.scores && details.scores.length > 0 && (
                      <div>
                        <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: 600 }}>
                          Scores ({details.scores.length})
                        </h4>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {details.scores.map((score) => (
                            <div
                              key={score.id}
                              style={{
                                backgroundColor: 'white',
                                padding: '0.5rem 0.75rem',
                                borderRadius: '6px',
                                border: '1px solid #e5e7eb',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem'
                              }}
                            >
                              <span style={{ fontSize: '0.813rem', fontWeight: 500 }}>{score.name}</span>
                              <span style={{
                                backgroundColor: score.value > 0.5 ? '#dcfce7' : '#fee2e2',
                                color: score.value > 0.5 ? '#166534' : '#991b1b',
                                padding: '0.125rem 0.375rem',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                fontWeight: 600
                              }}>
                                {score.value}
                              </span>
                              <span style={{ fontSize: '0.625rem', color: '#9ca3af' }}>
                                ({score.source})
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  };

  return (
    <div style={{
      backgroundColor: 'white',
      padding: '1rem',
      borderRadius: '8px',
      border: '2px solid #8b5cf6',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1rem',
        flexWrap: 'wrap',
        gap: '0.75rem',
        paddingLeft: '36px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h2 style={{
            margin: 0,
            fontSize: '1rem',
            fontWeight: 600,
            color: '#1a1a1a',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <span style={{ fontSize: '1.25rem' }}>🔍</span>
            Langfuse Traces
          </h2>
          <span style={{
            backgroundColor: '#f3e8ff',
            color: '#7c3aed',
            padding: '0.125rem 0.5rem',
            borderRadius: '4px',
            fontSize: '0.75rem',
            fontWeight: 500
          }}>
            {totalItems.toLocaleString()} traces
          </span>
          {effectiveAppId && (
            <span style={{
              backgroundColor: '#dbeafe',
              color: '#1e40af',
              padding: '0.125rem 0.5rem',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem'
            }}>
              Filtered: {effectiveAppId.substring(0, 12)}...
              {!globalAppId && (
                <button
                  onClick={() => setAppIdFilter('')}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    fontSize: '0.875rem',
                    color: '#1e40af'
                  }}
                >
                  ×
                </button>
              )}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Time Range Filter */}
          <select
            value={timeRange}
            onChange={(e) => {
              setTimeRange(e.target.value);
              setPage(1);
            }}
            style={{
              padding: '0.375rem 0.5rem',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              fontSize: '0.75rem',
              backgroundColor: 'white',
              cursor: 'pointer'
            }}
          >
            {TIME_RANGES.map((range) => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </select>

          {/* App ID Filter */}
          {!globalAppId && (
            <input
              type="text"
              value={appIdFilter}
              onChange={(e) => setAppIdFilter(e.target.value)}
              placeholder="Filter by App/Conv ID..."
              style={{
                padding: '0.375rem 0.5rem',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '0.75rem',
                width: '160px'
              }}
            />
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.813rem', color: '#6b7280' }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh
          </label>
          <button
            onClick={() => fetchTraces()}
            disabled={loading}
            style={{
              padding: '0.375rem 0.75rem',
              backgroundColor: 'white',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '0.813rem'
            }}
          >
            Refresh
          </button>
          {onRemove && (
            <button
              onClick={onRemove}
              style={{
                padding: '0.375rem 0.75rem',
                backgroundColor: '#fee2e2',
                color: '#dc2626',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.813rem'
              }}
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div style={{
          backgroundColor: '#fee2e2',
          color: '#991b1b',
          padding: '0.75rem',
          borderRadius: '6px',
          marginBottom: '1rem',
          fontSize: '0.875rem'
        }}>
          {error}
        </div>
      )}

      {/* Loading State */}
      {loading && traces.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '2rem',
          color: '#6b7280'
        }}>
          Loading Langfuse traces...
        </div>
      ) : traces.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '2rem',
          backgroundColor: '#f9fafb',
          borderRadius: '6px'
        }}>
          <p style={{ margin: 0, fontWeight: 500 }}>No traces found</p>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
            Try adjusting your filters or time range
          </p>
        </div>
      ) : (
        <>
          {/* Stats Row */}
          <div style={{
            display: 'flex',
            gap: '1rem',
            marginBottom: '1rem',
            fontSize: '0.813rem',
            color: '#6b7280'
          }}>
            Showing {traces.length} of {totalItems.toLocaleString()} traces
            {loading && <span style={{ color: '#3b82f6' }}>• Refreshing...</span>}
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto', flex: 1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>ID</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Timestamp</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Agent</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Conversation</th>
                  <th style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600, color: '#374151' }}>Latency</th>
                  <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600, color: '#374151' }}>Obs.</th>
                  <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600, color: '#374151' }}>Scores</th>
                </tr>
              </thead>
              <tbody>
                {traces.map(renderTraceRow)}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '1rem',
            paddingTop: '1rem',
            borderTop: '1px solid #e5e7eb'
          }}>
            <span style={{ fontSize: '0.813rem', color: '#6b7280' }}>
              Page {page} of {totalPages}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
                style={{
                  padding: '0.375rem 0.75rem',
                  backgroundColor: page === 1 ? '#f3f4f6' : 'white',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  cursor: page === 1 ? 'not-allowed' : 'pointer',
                  fontSize: '0.813rem'
                }}
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages || loading}
                style={{
                  padding: '0.375rem 0.75rem',
                  backgroundColor: page === totalPages ? '#f3f4f6' : 'white',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  cursor: page === totalPages ? 'not-allowed' : 'pointer',
                  fontSize: '0.813rem'
                }}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
