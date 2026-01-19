'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import ProtectedRoute from '@/components/ProtectedRoute';

// Consistent error row highlighting
const ERROR_ROW_BG = 'rgba(239, 68, 68, 0.2)';

interface AgentBreakdown {
  agent_id: string;
  run_count: number;
  steps: number;
  input_tokens: number;
  output_tokens: number;
  cost: number;
}

interface TimelineEntry {
  timestamp: string;
  type: string;
  detail: string;
  extra_info?: string;
  steps?: number;
  input_tokens?: number;
  output_tokens?: number;
  cost?: number;
}

interface ToolUsage {
  tool_name: string;
  count: number;
}

interface AppDetails {
  app_id: string;
  run_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_steps: number;
  total_cost: number;
  agent_breakdown: AgentBreakdown[];
  timeline: TimelineEntry[];
  tool_usage: ToolUsage[];
  compression_stats: {
    events: number;
    total_saved_bytes: number;
    avg_compression_ratio: number;
  };
  summarization_stats: {
    total: number;
    successful: number;
    failed: number;
    avg_compression_ratio: number;
  };
  errors: unknown[];
}

interface GroupedTimelineEntry extends TimelineEntry {
  toolCalls?: TimelineEntry[];
  toolCount?: number;
}

function groupTimelineEntries(timeline: TimelineEntry[]): GroupedTimelineEntry[] {
  const result: GroupedTimelineEntry[] = [];
  let currentRun: GroupedTimelineEntry | null = null;
  const pendingOthers: TimelineEntry[] = [];

  // Timeline is sorted DESCENDING (most recent first).
  // In descending order: RUN appears first, then its tool calls appear AFTER it.
  // Non-tool entries (summarization, publish, etc.) should NOT break tool grouping.
  for (const entry of timeline) {
    if (entry.type === 'run') {
      // Push the previous run with its collected tools
      if (currentRun) {
        result.push(currentRun);
      }
      // Push any pending non-tool entries (they belong between runs)
      for (const other of pendingOthers) {
        result.push({ ...other });
      }
      pendingOthers.length = 0;
      // Start a new run entry
      currentRun = { ...entry, toolCalls: [], toolCount: 0 };
    } else if (entry.type === 'tool') {
      // Attach tool to the current run (the run we just passed)
      if (currentRun) {
        currentRun.toolCalls!.push(entry);
        currentRun.toolCount = currentRun.toolCalls!.length;
      } else {
        // Orphan tool with no run - show standalone
        result.push({ ...entry });
      }
    } else {
      // Non-run, non-tool entries - queue them to appear after the current run's tools
      pendingOthers.push(entry);
    }
  }

  // Push the last run if any
  if (currentRun) {
    result.push(currentRun);
  }

  // Push any remaining non-tool entries
  for (const other of pendingOthers) {
    result.push({ ...other });
  }

  return result;
}

const thStyle: React.CSSProperties = {
  padding: '0.6rem 0.75rem',
  textAlign: 'left',
  fontSize: '0.65rem',
  fontWeight: 600,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '2px solid #e2e8f0',
  cursor: 'pointer',
  userSelect: 'none',
  whiteSpace: 'nowrap'
};

const tdStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  fontSize: '0.75rem',
  color: '#374151',
  borderBottom: '1px solid #f1f5f9',
  verticalAlign: 'top'
};

function formatFullTimestamp(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(2) + ' MB';
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(2) + ' KB';
  return bytes + ' B';
}

function TimelineTable({ timeline }: { timeline: TimelineEntry[] }) {
  const [expandedRuns, setExpandedRuns] = useState<Set<number>>(new Set());
  const groupedTimeline = groupTimelineEntries(timeline);

  function toggleRun(idx: number) {
    setExpandedRuns(prev => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  }

  const typeColors: Record<string, string> = {
    run: '#2563eb',
    error: '#dc2626',
    summarization: '#8b5cf6',
    compression: '#0284c7',
    tool: '#ea580c',
    conversation: '#0891b2',
    publish: '#22c55e',
    client_error: '#f97316'
  };

  function renderRow(t: TimelineEntry, idx: number, isToolRow = false, parentIdx?: number) {
    const isError = t.type === 'error' || t.type === 'client_error' ||
      (t.type === 'summarization' && t.detail === 'failed') ||
      (t.type === 'conversation' && (t.detail === 'token_limit_reached' || t.detail === 'budget_exceeded')) ||
      (t.type === 'publish' && (t.detail === 'build_failed' || t.detail === 'archive_failed'));

    return (
      <tr
        key={isToolRow ? `${parentIdx}-tool-${idx}` : idx}
        style={{
          backgroundColor: isError
            ? ERROR_ROW_BG
            : isToolRow
              ? '#fafafa'
              : idx % 2 === 0 ? 'white' : '#fafbfc'
        }}
      >
        <td style={{ ...tdStyle, color: '#94a3b8', fontFamily: 'monospace', fontSize: '0.65rem', whiteSpace: 'nowrap' }}>
          {isToolRow && <span style={{ marginLeft: '1rem', color: '#d1d5db' }}>└─</span>}
          {formatFullTimestamp(t.timestamp)}
        </td>
        <td style={tdStyle}>
          <span style={{
            display: 'inline-block',
            padding: '0.1rem 0.4rem',
            borderRadius: '4px',
            backgroundColor: `${typeColors[t.type] || '#94a3b8'}15`,
            color: typeColors[t.type] || '#94a3b8',
            fontSize: '0.6rem',
            fontWeight: 600,
            textTransform: 'uppercase'
          }}>
            {t.type}
          </span>
        </td>
        <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.7rem' }}>
          {t.detail}
        </td>
        <td style={{ ...tdStyle, color: '#64748b', fontSize: '0.7rem', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {t.extra_info || '-'}
        </td>
      </tr>
    );
  }

  return (
    <div style={{ marginTop: '1rem' }}>
      <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem', color: '#374151' }}>Timeline</h3>
      <div style={{ maxHeight: 'calc(100vh - 400px)', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, backgroundColor: '#f8fafc', zIndex: 10 }}>
            <tr>
              <th style={thStyle}>Timestamp</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Detail</th>
              <th style={thStyle}>Info</th>
            </tr>
          </thead>
          <tbody>
            {groupedTimeline.map((grouped, idx) => {
              const isExpanded = expandedRuns.has(idx);
              const hasTools = (grouped.toolCount ?? 0) > 0;
              const isError = grouped.type === 'error' || grouped.type === 'client_error' ||
                (grouped.type === 'summarization' && grouped.detail === 'failed') ||
                (grouped.type === 'conversation' && (grouped.detail === 'token_limit_reached' || grouped.detail === 'budget_exceeded')) ||
                (grouped.type === 'publish' && (grouped.detail === 'build_failed' || grouped.detail === 'archive_failed'));

              return (
                <React.Fragment key={idx}>
                  <tr
                    style={{
                      backgroundColor: isError
                        ? ERROR_ROW_BG
                        : idx % 2 === 0 ? 'white' : '#fafbfc',
                      cursor: hasTools ? 'pointer' : 'default'
                    }}
                    onClick={() => hasTools && toggleRun(idx)}
                  >
                    <td style={{ ...tdStyle, color: '#94a3b8', fontFamily: 'monospace', fontSize: '0.65rem', whiteSpace: 'nowrap' }}>
                      {formatFullTimestamp(grouped.timestamp)}
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        padding: '0.1rem 0.4rem',
                        borderRadius: '4px',
                        backgroundColor: `${typeColors[grouped.type] || '#94a3b8'}15`,
                        color: typeColors[grouped.type] || '#94a3b8',
                        fontSize: '0.6rem',
                        fontWeight: 600,
                        textTransform: 'uppercase'
                      }}>
                        {grouped.type}
                        {hasTools && (
                          <>
                            <span style={{
                              fontSize: '0.5rem',
                              transition: 'transform 0.15s',
                              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'
                            }}>▶</span>
                            <span style={{
                              backgroundColor: '#e0e7ff',
                              color: '#4338ca',
                              borderRadius: '9999px',
                              padding: '0 0.35rem',
                              fontSize: '0.55rem',
                              fontWeight: 700
                            }}>
                              {grouped.toolCount}
                            </span>
                          </>
                        )}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.7rem' }}>
                      {grouped.detail}
                    </td>
                    <td style={{ ...tdStyle, color: '#64748b', fontSize: '0.7rem', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {(() => {
                        if (grouped.type === 'run' && grouped.cost !== undefined) {
                          return `$${grouped.cost.toFixed(4)} · ${grouped.steps || 0} steps · ${formatNumber(grouped.input_tokens || 0)}/${formatNumber(grouped.output_tokens || 0)} tok`;
                        }
                        if (grouped.type === 'summarization') {
                          const ratio = grouped.cost ? `${(grouped.cost * 100).toFixed(1)}%` : '-';
                          return `${formatNumber(grouped.input_tokens || 0)} → ${formatNumber(grouped.output_tokens || 0)} tok (${ratio})${grouped.extra_info ? ` · ${grouped.extra_info}` : ''}`;
                        }
                        if (grouped.type === 'conversation' && grouped.detail === 'token_limit_reached') {
                          return `${grouped.input_tokens || 0} processed, ${grouped.output_tokens || 0} dropped`;
                        }
                        if (grouped.type === 'compression') {
                          const ratio = grouped.cost ? `${(grouped.cost * 100).toFixed(1)}%` : '-';
                          return `${formatBytes(grouped.input_tokens || 0)} → ${formatBytes(grouped.output_tokens || 0)} (${ratio})`;
                        }
                        return grouped.extra_info || '-';
                      })()}
                    </td>
                  </tr>
                  {isExpanded && grouped.toolCalls?.map((tool, toolIdx) => renderRow(tool, toolIdx, true, idx))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AppDetailsContent() {
  const params = useParams<{ appId: string }>();
  const appId = params?.appId ?? '';
  const [appDetails, setAppDetails] = useState<AppDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDetails() {
      try {
        const res = await fetch(`/api/analytics/${appId}`);
        if (!res.ok) {
          throw new Error('Failed to fetch app details');
        }
        setAppDetails(await res.json());
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    }
    fetchDetails();
  }, [appId]);

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center'
      }}>
        <div style={{
          backgroundColor: 'white',
          borderRadius: '16px',
          padding: '3rem',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏳</div>
          <p style={{ color: '#64748b' }}>Loading app details...</p>
        </div>
      </div>
    );
  }

  if (error || !appDetails) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center'
      }}>
        <div style={{
          backgroundColor: 'white',
          borderRadius: '16px',
          padding: '3rem',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>❌</div>
          <p style={{ color: '#dc2626' }}>{error || 'App not found'}</p>
          <Link href="/analytics" style={{ color: '#2563eb', marginTop: '1rem', display: 'inline-block' }}>
            ← Back to Analytics
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '1.5rem'
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '16px',
        maxWidth: '1400px',
        margin: '0 auto',
        padding: '1.5rem',
        boxShadow: '0 25px 50px rgba(0,0,0,0.2)'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.25rem',
          paddingBottom: '1rem',
          borderBottom: '1px solid #e5e7eb'
        }}>
          <div>
            <h1 style={{ margin: 0, fontFamily: 'monospace', color: '#2563eb', fontSize: '1.5rem' }}>
              {appDetails.app_id}
            </h1>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
              <a
                href={`https://${appDetails.app_id}.preview.c24.airoapp.ai`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '0.75rem', color: '#f97316' }}
              >
                Open preview ↗
              </a>
            </div>
          </div>
          <Link
            href="/analytics"
            style={{
              background: '#f1f5f9',
              border: 'none',
              fontSize: '0.85rem',
              cursor: 'pointer',
              color: '#64748b',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            ← Back to Dashboard
          </Link>
        </div>

        {/* Agent Breakdown */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '0.75rem',
          marginBottom: '1.25rem'
        }}>
          {appDetails.agent_breakdown.map(agent => (
            <div key={agent.agent_id} style={{
              backgroundColor: '#f8fafc',
              borderRadius: '8px',
              padding: '0.75rem',
              borderLeft: '3px solid #3b82f6'
            }}>
              <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: '0.35rem', textTransform: 'uppercase', fontWeight: 600 }}>
                {agent.agent_id}
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#059669' }}>
                ${agent.cost.toFixed(2)}
              </div>
              <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                {agent.run_count} runs · {agent.steps} steps
              </div>
            </div>
          ))}
        </div>

        {/* Stats Row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '0.75rem',
          marginBottom: '1.25rem'
        }}>
          <div style={{ backgroundColor: '#f0f9ff', borderRadius: '8px', padding: '0.75rem' }}>
            <div style={{ fontSize: '0.6rem', color: '#0369a1', textTransform: 'uppercase', fontWeight: 600 }}>Compressions</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0284c7' }}>
              {appDetails.compression_stats.events}
            </div>
            <div style={{ fontSize: '0.6rem', color: '#64748b' }}>
              Saved {formatBytes(appDetails.compression_stats.total_saved_bytes)}
            </div>
          </div>
          <div style={{ backgroundColor: '#faf5ff', borderRadius: '8px', padding: '0.75rem' }}>
            <div style={{ fontSize: '0.6rem', color: '#7c3aed', textTransform: 'uppercase', fontWeight: 600 }}>Summarizations</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#8b5cf6' }}>
              {appDetails.summarization_stats.total}
            </div>
            <div style={{ fontSize: '0.6rem', color: '#64748b' }}>
              {appDetails.summarization_stats.successful} ok, {appDetails.summarization_stats.failed} failed
            </div>
          </div>
          <div style={{ backgroundColor: '#fef2f2', borderRadius: '8px', padding: '0.75rem' }}>
            <div style={{ fontSize: '0.6rem', color: '#b91c1c', textTransform: 'uppercase', fontWeight: 600 }}>Errors</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#dc2626' }}>
              {appDetails.errors.length}
            </div>
          </div>
          <div style={{ backgroundColor: '#f0fdf4', borderRadius: '8px', padding: '0.75rem' }}>
            <div style={{ fontSize: '0.6rem', color: '#166534', textTransform: 'uppercase', fontWeight: 600 }}>Total Cost</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#059669' }}>
              ${appDetails.total_cost.toFixed(2)}
            </div>
          </div>
          <div style={{ backgroundColor: '#fefce8', borderRadius: '8px', padding: '0.75rem' }}>
            <div style={{ fontSize: '0.6rem', color: '#a16207', textTransform: 'uppercase', fontWeight: 600 }}>Runs</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#ca8a04' }}>
              {formatNumber(appDetails.run_count)}
            </div>
          </div>
          <div style={{ backgroundColor: '#ecfeff', borderRadius: '8px', padding: '0.75rem' }}>
            <div style={{ fontSize: '0.6rem', color: '#0e7490', textTransform: 'uppercase', fontWeight: 600 }}>Steps</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#06b6d4' }}>
              {formatNumber(appDetails.total_steps)}
            </div>
          </div>
        </div>

        {/* Tools Used */}
        <div style={{ marginBottom: '1.25rem' }}>
          <h3 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: '#374151' }}>Tools Used</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
            {appDetails.tool_usage.length > 0 ? (
              appDetails.tool_usage.map(tool => (
                <span key={tool.tool_name} style={{
                  backgroundColor: '#f3e8ff',
                  border: '1px solid #c4b5fd',
                  borderRadius: '4px',
                  padding: '0.15rem 0.5rem',
                  fontSize: '0.65rem',
                  fontFamily: 'monospace',
                  color: '#7c3aed'
                }}>
                  {tool.tool_name} ({tool.count})
                </span>
              ))
            ) : (
              <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>No tool data</span>
            )}
          </div>
        </div>

        {/* Timeline */}
        <TimelineTable timeline={appDetails.timeline} />
      </div>
    </div>
  );
}

export default function AppDetailsPage() {
  return (
    <ProtectedRoute>
      <AppDetailsContent />
    </ProtectedRoute>
  );
}
