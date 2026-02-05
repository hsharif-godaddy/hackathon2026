'use client';

import React, { useCallback, useEffect, useState } from 'react';

interface PublishEvent {
  id: string;
  timestamp: string;
  appId: string;
  event: string;
  eventType: 'begin' | 'success' | 'build_failed' | 'archive_failed';
  success: boolean;
  commitHash?: string;
  errorMessage?: string;
}

interface PublishEventsResponse {
  events: PublishEvent[];
  summary: Record<string, { total: number; success: number; failed: number; lastPublish?: string }>;
  total: number;
}

interface Props {
  appId?: string;
  timeRange?: string;
  refreshKey?: number;
  onRefresh?: () => void;
}

function timeRangeToDays(timeRange: string): number {
  switch (timeRange) {
    case '15m': return 1;
    case '1h': return 1;
    case '6h': return 1;
    case '24h': return 1;
    case '7d': return 7;
    default: return 7;
  }
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

function getEventTypeStyle(eventType: PublishEvent['eventType']): React.CSSProperties {
  switch (eventType) {
    case 'begin':
      return { backgroundColor: '#dbeafe', color: '#1e40af' };
    case 'success':
      return { backgroundColor: '#dcfce7', color: '#166534' };
    case 'build_failed':
    case 'archive_failed':
      return { backgroundColor: '#fee2e2', color: '#991b1b' };
    default:
      return { backgroundColor: '#f3f4f6', color: '#374151' };
  }
}

function getEventTypeLabel(eventType: PublishEvent['eventType']): string {
  switch (eventType) {
    case 'begin': return 'Started';
    case 'success': return 'Success';
    case 'build_failed': return 'Build Failed';
    case 'archive_failed': return 'Archive Failed';
    default: return eventType;
  }
}

export default function PublishEventsPanel({ appId, timeRange = '7d', refreshKey, onRefresh }: Props) {
  const [events, setEvents] = useState<PublishEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedError, setExpandedError] = useState<string | null>(null);

  const days = timeRangeToDays(timeRange);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: String(days), limit: '200' });
      if (appId) params.set('appId', appId);

      const res = await fetch(`/api/publish-events?${params}`);
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);

      const data: PublishEventsResponse = await res.json();
      setEvents(data.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch publish events');
    } finally {
      setLoading(false);
    }
  }, [appId, days]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents, refreshKey]);

  return (
    <div style={{ padding: '1rem' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1rem'
      }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
          Publish Events {appId ? `for ${appId}` : '(All Apps)'}
        </h3>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading}
            style={{
              padding: '0.625rem 1.25rem',
              backgroundColor: loading ? '#9ca3af' : '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '0.875rem',
              fontWeight: 500,
              opacity: loading ? 0.6 : 1
            }}
          >
            Refresh
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{
          padding: '0.75rem',
          backgroundColor: '#fee2e2',
          color: '#991b1b',
          borderRadius: '4px',
          marginBottom: '1rem',
          fontSize: '0.875rem'
        }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && events.length === 0 && (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
          Loading publish events...
        </div>
      )}

      {/* Empty state */}
      {!loading && events.length === 0 && (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
          No publish events found for the selected time range.
        </div>
      )}

      {/* Events list */}
      {events.length > 0 && (
        <div style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          border: '1px solid #e5e7eb',
          overflow: 'hidden'
        }}>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: appId ? '150px 140px 100px 1fr' : '100px 150px 140px 100px 1fr',
            padding: '0.75rem 1rem',
            backgroundColor: '#f9fafb',
            borderBottom: '1px solid #e5e7eb',
            fontSize: '0.75rem',
            fontWeight: 600,
            color: '#6b7280',
            textTransform: 'uppercase'
          }}>
            {!appId && <div>App ID</div>}
            <div>Timestamp</div>
            <div>Event</div>
            <div>Status</div>
            <div>Details</div>
          </div>

          {/* Table rows */}
          <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
            {events.map((event) => (
              <div key={event.id}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: appId ? '150px 140px 100px 1fr' : '100px 150px 140px 100px 1fr',
                    padding: '0.75rem 1rem',
                    borderBottom: expandedError === event.id ? 'none' : '1px solid #f3f4f6',
                    fontSize: '0.875rem',
                    alignItems: 'center',
                    cursor: event.errorMessage ? 'pointer' : 'default',
                    backgroundColor: expandedError === event.id ? '#fef2f2' : 'transparent'
                  }}
                  onClick={() => event.errorMessage && setExpandedError(expandedError === event.id ? null : event.id)}
                >
                  {!appId && (
                    <div style={{
                      fontFamily: 'monospace',
                      fontSize: '0.75rem',
                      color: '#3b82f6'
                    }}>
                      {event.appId}
                    </div>
                  )}
                  <div style={{ color: '#6b7280', fontSize: '0.8rem' }}>
                    {formatTimestamp(event.timestamp)}
                  </div>
                  <div style={{ color: '#374151', fontSize: '0.8rem' }}>
                    {event.event.replace('route.publish.', '')}
                  </div>
                  <div>
                    <span style={{
                      display: 'inline-block',
                      padding: '0.25rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      ...getEventTypeStyle(event.eventType)
                    }}>
                      {getEventTypeLabel(event.eventType)}
                    </span>
                  </div>
                  <div style={{
                    fontSize: '0.75rem',
                    color: '#6b7280',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    {event.commitHash && (
                      <span style={{ fontFamily: 'monospace' }}>
                        {event.commitHash.substring(0, 7)}
                      </span>
                    )}
                    {event.errorMessage && (
                      <span style={{
                        color: '#991b1b',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem'
                      }}>
                        <span style={{ fontSize: '0.7rem' }}>
                          {expandedError === event.id ? '▼' : '▶'}
                        </span>
                        Error (click to {expandedError === event.id ? 'hide' : 'view'})
                      </span>
                    )}
                  </div>
                </div>
                {/* Expanded error message */}
                {expandedError === event.id && event.errorMessage && (
                  <div style={{
                    padding: '0.75rem 1rem',
                    backgroundColor: '#fef2f2',
                    borderBottom: '1px solid #f3f4f6',
                    marginLeft: appId ? '150px' : '100px'
                  }}>
                    <pre style={{
                      margin: 0,
                      padding: '0.75rem',
                      backgroundColor: '#1f2937',
                      color: '#f87171',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontFamily: 'monospace',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: '300px',
                      overflowY: 'auto'
                    }}>
                      {event.errorMessage}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
