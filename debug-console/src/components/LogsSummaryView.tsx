'use client';

import React, { useMemo, useState } from 'react';

import { formatTimestamp } from '@/lib/date-utils';
import type { LogEntry } from '@/lib/log-types';
import { groupErrorLogs } from '@/lib/log-error-groups';
import WarningStrip from './WarningStrip';

interface LogsSummaryViewProps {
  /**
   * The full set of error-level logs already fetched by the parent's
   * `useLogFetcher` instance. Grouping is a pure derivation; instances
   * shown on expand are filtered from this same array (no separate
   * `/api/error-details` round-trip).
   */
  allLogs: LogEntry[];
  loading: boolean;
  error: string | null;
  /**
   * True when at least one source has a `nextCursor`. Both the total
   * counter and per-group counts are lower bounds when set, so they
   * render as `${n}+`.
   */
  hasMore: boolean;
  warnings: { id: string; message: string }[];
  loadMore: () => Promise<void> | void;
  retryRequest: (requestId: string) => Promise<void> | void;
  sourceLabels: Record<string, string>;
}

const INSTANCE_PREVIEW_LIMIT = 5;

export default function LogsSummaryView({
  allLogs,
  loading,
  error,
  hasMore,
  warnings,
  loadMore,
  retryRequest,
  sourceLabels,
}: LogsSummaryViewProps) {
  const [expandedError, setExpandedError] = useState<string | null>(null);

  const { groups, total } = useMemo(() => groupErrorLogs(allLogs), [allLogs]);

  // Only one group can be expanded at a time, so we filter once per
  // (allLogs, expandedError) change rather than scanning the array on every
  // render of every collapsed group.
  const expandedInstances = useMemo(() => {
    if (!expandedError) return [];
    return allLogs.filter(
      (log) => log.level === 'error' && (log.message || '').trim() === expandedError,
    );
  }, [allLogs, expandedError]);

  const handleExpandError = (errorMessage: string) => {
    setExpandedError((prev) => (prev === errorMessage ? null : errorMessage));
  };

  const renderTotal = (n: number) => (hasMore ? `${n}+` : `${n}`);

  if (loading && allLogs.length === 0) {
    return (
      <div
        style={{
          padding: '3rem 2rem',
          textAlign: 'center',
          backgroundColor: '#f9fafb',
          borderRadius: '6px',
          border: '1px solid #e5e7eb',
        }}
      >
        <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>⏳</div>
        <p style={{ margin: 0, color: '#6b7280', fontSize: '0.875rem' }}>
          Loading error summary...
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {error && (
        <div
          style={{
            border: '1px solid #ef4444',
            borderRadius: '8px',
            padding: '1rem',
            backgroundColor: '#fef2f2',
          }}
        >
          <p style={{ margin: '0 0 0.5rem 0', fontWeight: 600, color: '#dc2626' }}>
            Error loading summary
          </p>
          <p style={{ margin: 0, fontSize: '0.875rem', color: '#991b1b' }}>{error}</p>
        </div>
      )}

      {/* Surfacing per-source soft failures here is a behavior gain over
          the previous server-side summary, which silently zeroed any
          source that failed. */}
      <WarningStrip
        warnings={warnings}
        loading={loading}
        onRetry={retryRequest}
        sourceLabels={sourceLabels}
      />


      {/* Error Summary Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1rem',
          backgroundColor: total ? '#fef2f2' : '#f0fdf4',
          borderRadius: '6px',
          border: total ? '1px solid #fecaca' : '1px solid #bbf7d0',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <h3
            style={{
              margin: 0,
              fontSize: '1rem',
              fontWeight: 600,
              color: total ? '#991b1b' : '#166534',
            }}
          >
            Error Summary
          </h3>
          <div
            style={{
              fontSize: '0.75rem',
              fontStyle: 'italic',
              color: total ? '#991b1b' : '#166534',
              opacity: 0.75,
            }}
          >
            Errors don&apos;t mean the user wasted credits — correlate with chats to confirm.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.875rem', fontWeight: 500 }}>
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontSize: '1.5rem',
                fontWeight: 700,
                color: total ? '#dc2626' : '#16a34a',
              }}
            >
              {renderTotal(total)}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Total Errors</div>
          </div>
        </div>
      </div>

      {/* Error Groups */}
      {groups.length > 0 ? (
        <div
          style={{
            padding: '1rem',
            backgroundColor: '#f9fafb',
            borderRadius: '6px',
            border: '1px solid #e5e7eb',
          }}
        >
          <h4
            style={{
              margin: '0 0 0.75rem 0',
              fontSize: '0.875rem',
              fontWeight: 600,
              color: '#374151',
            }}
          >
            Errors by Message
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {groups.map((group) => {
              const isExpanded = expandedError === group.message;
              const instances = isExpanded ? expandedInstances : [];
              return (
                <div key={group.message}>
                  <div
                    onClick={() => handleExpandError(group.message)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.75rem 1rem',
                      backgroundColor: isExpanded ? '#fef2f2' : 'white',
                      borderRadius: isExpanded ? '4px 4px 0 0' : '4px',
                      border: '1px solid #e5e7eb',
                      cursor: 'pointer',
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        fontSize: '0.875rem',
                        color: '#374151',
                        wordBreak: 'break-word',
                        marginRight: '1rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                          {isExpanded ? '▼' : '▶'}
                        </span>
                        <div>
                          {group.event && (
                            <span
                              style={{
                                fontSize: '0.7rem',
                                fontFamily: 'monospace',
                                color: '#6366f1',
                                backgroundColor: '#eef2ff',
                                padding: '0.125rem 0.375rem',
                                borderRadius: '3px',
                                marginRight: '0.5rem',
                              }}
                            >
                              {group.event}
                            </span>
                          )}
                          {group.message}
                        </div>
                      </div>
                      {group.lastSeen && (
                        <div
                          style={{
                            fontSize: '0.7rem',
                            color: '#6b7280',
                            marginTop: '0.25rem',
                            fontFamily: 'monospace',
                            marginLeft: '1.25rem',
                          }}
                        >
                          Last seen: {formatTimestamp(group.lastSeen)}
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: '0.875rem',
                        fontWeight: 600,
                        color: '#dc2626',
                        backgroundColor: '#fef2f2',
                        padding: '0.25rem 0.75rem',
                        borderRadius: '9999px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {renderTotal(group.count)}×
                    </div>
                  </div>
                  {isExpanded && (
                    <div
                      style={{
                        padding: '0.75rem 1rem',
                        backgroundColor: '#f9fafb',
                        borderRadius: '0 0 4px 4px',
                        border: '1px solid #e5e7eb',
                        borderTop: 'none',
                      }}
                    >
                      {instances.length === 0 ? (
                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                          No detailed instances loaded
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {instances.slice(0, INSTANCE_PREVIEW_LIMIT).map((detail, idx) => (
                            <div
                              key={detail.id ?? idx}
                              style={{
                                padding: '0.5rem',
                                backgroundColor: 'white',
                                borderRadius: '4px',
                                border: '1px solid #e5e7eb',
                                fontSize: '0.75rem',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  gap: '1rem',
                                  marginBottom: '0.25rem',
                                }}
                              >
                                <span
                                  style={{ color: '#6b7280', fontFamily: 'monospace' }}
                                >
                                  {formatTimestamp(detail.timestamp)}
                                </span>
                                {detail.event && (
                                  <span style={{ color: '#3b82f6' }}>{detail.event}</span>
                                )}
                                {detail.service && (
                                  <span style={{ color: '#059669' }}>{detail.service}</span>
                                )}
                              </div>
                              <div style={{ color: '#374151', wordBreak: 'break-word' }}>
                                {detail.message}
                              </div>
                              {!!detail.data && (
                                <details style={{ marginTop: '0.25rem' }}>
                                  <summary
                                    style={{
                                      cursor: 'pointer',
                                      color: '#6b7280',
                                      fontSize: '0.7rem',
                                    }}
                                  >
                                    View raw data
                                  </summary>
                                  <pre
                                    style={{
                                      marginTop: '0.25rem',
                                      padding: '0.5rem',
                                      backgroundColor: '#1f2937',
                                      color: '#f3f4f6',
                                      borderRadius: '4px',
                                      fontSize: '0.65rem',
                                      overflow: 'auto',
                                      maxHeight: '200px',
                                    }}
                                  >
                                    {JSON.stringify(detail.data, null, 2)}
                                  </pre>
                                </details>
                              )}
                            </div>
                          ))}
                          {instances.length > INSTANCE_PREVIEW_LIMIT && (
                            <div
                              style={{
                                fontSize: '0.7rem',
                                color: '#6b7280',
                                textAlign: 'center',
                              }}
                            >
                              Showing {INSTANCE_PREVIEW_LIMIT} of {instances.length} loaded instances
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : !loading ? (
        <div
          style={{
            padding: '2rem',
            textAlign: 'center',
            color: '#166534',
            backgroundColor: '#f0fdf4',
            borderRadius: '6px',
            border: '1px solid #bbf7d0',
          }}
        >
          ✓ No errors found in the selected time range
        </div>
      ) : null}

      {/* Load more — counts in summary mode are lower bounds while
          `hasMore` is true. Bumping this grows the loaded window and
          may surface new groups or shift counts. */}
      {hasMore && groups.length > 0 && (
        <div style={{ textAlign: 'center' }}>
          <button
            onClick={() => loadMore()}
            disabled={loading}
            style={{
              padding: '0.5rem 1.5rem',
              backgroundColor: '#f3f4f6',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '0.875rem',
              fontWeight: 500,
            }}
          >
            {loading ? 'Loading more…' : 'Load more for accurate counts'}
          </button>
        </div>
      )}
    </div>
  );
}
