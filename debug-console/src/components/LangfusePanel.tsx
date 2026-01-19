'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
  onSessionClick?: (sessionId: string) => void;
  langfuseBaseUrl?: string;
  langfuseProjectId?: string;
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

function extractConversationId(sessionId: string | null): string {
  if (!sessionId) return '-';
  // Extract conversation ID from "Conversation ID: xxx" format
  const match = sessionId.match(/Conversation ID:\s*(.+)/);
  return match ? match[1] : sessionId;
}

export default function LangfusePanel({ globalAppId, onSessionClick, langfuseBaseUrl, langfuseProjectId }: LangfusePanelProps) {
  const [traces, setTraces] = useState<LangfuseTrace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [traceDetails, setTraceDetails] = useState<Record<string, LangfuseTrace>>({});
  const [timeRange, setTimeRange] = useState<string>('6h');
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const PAGE_SIZE = 10;

  // Check if Langfuse links are available
  const hasLangfuseLinks = !!(langfuseBaseUrl && langfuseProjectId);

  // Generate Langfuse user (App ID) URL - links to user's traces page
  const getLangfuseUserUrl = (userId: string): string | null => {
    if (!hasLangfuseLinks) return null;
    return `${langfuseBaseUrl}/project/${langfuseProjectId}/users/${userId}`;
  };

  // Generate Langfuse trace URL
  const getLangfuseTraceUrl = (traceId: string): string | null => {
    if (!hasLangfuseLinks) return null;
    return `${langfuseBaseUrl}/project/${langfuseProjectId}/traces/${traceId}`;
  };

  const fetchTraces = useCallback(async () => {
    // Only fetch when appId is present
    if (!globalAppId) {
      setTraces([]);
      setTotalItems(0);
      setTotalPages(1);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Build query params
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE)
      });

      // Add appId filter - API uses userId parameter for this
      // See: https://api.reference.langfuse.com/#tag/trace/GET/api/public/traces
      params.append('appId', globalAppId);

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
      const traces = data.data || [];

      setTraces(traces);
      setTotalPages(data.meta?.totalPages || 1);
      setTotalItems(data.meta?.totalItems || traces.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch traces');
    } finally {
      setLoading(false);
    }
  }, [page, globalAppId, timeRange]);

  // Track which traces we've already attempted to prefetch
  const prefetchedTraceIds = useRef<Set<string>>(new Set());
  const prefetchAbortController = useRef<AbortController | null>(null);

  const fetchTraceDetails = useCallback(async (traceId: string): Promise<boolean> => {
    if (traceDetails[traceId]) return true;

    try {
      const response = await fetch(`/api/langfuse/traces/${traceId}`);
      if (response.ok) {
        const data = await response.json();
        setTraceDetails(prev => ({ ...prev, [traceId]: data }));
        return true;
      }
    } catch (err) {
      console.error('Failed to fetch trace details:', err);
    }
    return false;
  }, [traceDetails]);

  // Prefetch trace details for all visible traces in background
  const prefetchTraceDetails = useCallback(async (traceIds: string[]) => {
    // Cancel any ongoing prefetch
    if (prefetchAbortController.current) {
      prefetchAbortController.current.abort();
    }
    prefetchAbortController.current = new AbortController();

    // Filter out already fetched or attempted traces
    const idsToFetch = traceIds.filter(id =>
      !traceDetails[id] && !prefetchedTraceIds.current.has(id)
    );
    if (idsToFetch.length === 0) return;

    // Mark as attempted
    idsToFetch.forEach(id => prefetchedTraceIds.current.add(id));

    // Fetch in parallel with a small batch size to avoid overwhelming the server
    const BATCH_SIZE = 3;
    for (let i = 0; i < idsToFetch.length; i += BATCH_SIZE) {
      // Check if aborted
      if (prefetchAbortController.current?.signal.aborted) return;

      const batch = idsToFetch.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(id => fetchTraceDetails(id)));

      // Small delay between batches to be nice to the server
      if (i + BATCH_SIZE < idsToFetch.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }, [traceDetails, fetchTraceDetails]);

  useEffect(() => {
    // Clear prefetch tracking when fetching new traces
    prefetchedTraceIds.current.clear();
    fetchTraces();
  }, [fetchTraces]);

  // Prefetch details for all traces after they're loaded
  useEffect(() => {
    if (traces.length > 0 && !loading) {
      const traceIds = traces.map(t => t.id);
      prefetchTraceDetails(traceIds);
    }

    // Cleanup on unmount or when traces change
    return () => {
      if (prefetchAbortController.current) {
        prefetchAbortController.current.abort();
      }
    };
  }, [traces, loading, prefetchTraceDetails]);

  // Fetch details immediately when drawer is opened (in case prefetch hasn't completed)
  useEffect(() => {
    if (selectedTraceId && !traceDetails[selectedTraceId]) {
      fetchTraceDetails(selectedTraceId);
    }
  }, [selectedTraceId, traceDetails, fetchTraceDetails]);

  // Memoized selected trace details
  const selectedTraceDetails = useMemo(() => {
    if (!selectedTraceId) return null;
    return traceDetails[selectedTraceId] || traces.find(t => t.id === selectedTraceId) || null;
  }, [selectedTraceId, traceDetails, traces]);

  // Parse observations into categorized groups for the drawer
  const parsedObservations = useMemo(() => {
    if (!selectedTraceDetails?.observations || !Array.isArray(selectedTraceDetails.observations)) {
      return { generations: [], toolCalls: [], spans: [] };
    }

    const generations: LangfuseObservation[] = [];
    const toolCalls: LangfuseObservation[] = [];
    const spans: LangfuseObservation[] = [];

    for (const obs of selectedTraceDetails.observations) {
      if (typeof obs === 'string') continue;
      const observation = obs as LangfuseObservation;

      if (observation.type === 'GENERATION') {
        generations.push(observation);
      } else if (observation.name?.toLowerCase().includes('tool') ||
        observation.type === 'EVENT' ||
        (observation.input && typeof observation.input === 'object' && 'tool' in (observation.input as Record<string, unknown>))) {
        toolCalls.push(observation);
      } else {
        spans.push(observation);
      }
    }

    return { generations, toolCalls, spans };
  }, [selectedTraceDetails]);

  // Extract full conversation messages from trace (all user and agent messages)
  interface ConversationMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
  }

  const conversationMessages = useMemo((): ConversationMessage[] => {
    if (!parsedObservations.generations.length) {
      return [];
    }

    const messages: ConversationMessage[] = [];
    const seenMessages = new Set<string>(); // Dedupe messages

    // Helper to extract text from JSON array with type: "text" format
    // e.g., [{"type": "text", "text": "actual content"}] -> "actual content"
    const extractTextFromJsonArray = (content: unknown): string | null => {
      if (!Array.isArray(content)) return null;

      const textParts: string[] = [];
      for (const item of content) {
        if (typeof item === 'object' && item !== null) {
          const obj = item as Record<string, unknown>;
          if (obj.type === 'text' && typeof obj.text === 'string') {
            textParts.push(obj.text);
          }
        }
      }

      return textParts.length > 0 ? textParts.join('\n\n') : null;
    };

    // Helper to extract content from various formats
    const extractContent = (content: unknown): string => {
      if (typeof content === 'string') {
        // Try parsing as JSON to check for type: text format
        try {
          const parsed = JSON.parse(content);
          const extracted = extractTextFromJsonArray(parsed);
          if (extracted) return extracted;
        } catch {
          // Not JSON, return as-is
        }
        return content;
      }
      if (content === null || content === undefined) return '';

      // Check if it's an array with type: text format
      const extracted = extractTextFromJsonArray(content);
      if (extracted) return extracted;

      return JSON.stringify(content, null, 2);
    };

    // Helper to add message if not duplicate
    const addMessage = (role: 'user' | 'assistant' | 'system', content: string) => {
      const key = `${role}:${content}`;
      if (!seenMessages.has(key) && content.trim()) {
        seenMessages.add(key);
        messages.push({ role, content });
      }
    };

    // Process all generations to extract conversation messages
    for (const gen of parsedObservations.generations) {
      // Extract messages from input (conversation history)
      if (gen.input) {
        const input = gen.input as unknown;
        let inputMessages: unknown[] = [];

        if (Array.isArray(input)) {
          inputMessages = input;
        } else if (typeof input === 'object' && input !== null) {
          const inputObj = input as Record<string, unknown>;
          if ('messages' in inputObj && Array.isArray(inputObj.messages)) {
            inputMessages = inputObj.messages;
          }
        }

        // Process input messages
        for (const msg of inputMessages) {
          if (typeof msg === 'object' && msg !== null) {
            const msgObj = msg as Record<string, unknown>;
            const role = msgObj.role as string;
            if ((role === 'user' || role === 'assistant' || role === 'system') && msgObj.content) {
              addMessage(role, extractContent(msgObj.content));
            }
          }
        }
      }

      // Extract agent response from output
      if (gen.output) {
        const output = gen.output as unknown;
        let responseContent: string | null = null;

        if (typeof output === 'string') {
          responseContent = extractContent(output);
        } else if (typeof output === 'object' && output !== null) {
          const outputObj = output as Record<string, unknown>;
          if ('content' in outputObj && outputObj.content) {
            responseContent = extractContent(outputObj.content);
          } else if ('message' in outputObj) {
            const message = outputObj.message as Record<string, unknown>;
            if (message && 'content' in message) {
              responseContent = extractContent(message.content);
            }
          } else if ('choices' in outputObj && Array.isArray(outputObj.choices)) {
            const choice = outputObj.choices[0] as Record<string, unknown>;
            if (choice && 'message' in choice) {
              const msg = choice.message as Record<string, unknown>;
              if (msg && 'content' in msg) {
                responseContent = extractContent(msg.content);
              }
            }
          }
        }

        if (responseContent) {
          addMessage('assistant', responseContent);
        }
      }
    }

    return messages;
  }, [parsedObservations.generations]);

  // Track expanded conversation messages
  const [expandedMessages, setExpandedMessages] = useState<Set<number>>(new Set());

  // Reset expanded messages when trace changes
  useEffect(() => {
    setExpandedMessages(new Set());
  }, [selectedTraceId]);

  // State to control showing detailed trace information
  const [showDetailedInfo, setShowDetailedInfo] = useState(false);

  // Reset showDetailedInfo when trace changes
  useEffect(() => {
    setShowDetailedInfo(false);
  }, [selectedTraceId]);

  const handleCloseDrawer = () => {
    setSelectedTraceId(null);
    setExpandedSections(new Set());
  };

  const renderTraceRow = (trace: LangfuseTrace) => {
    const isSelected = selectedTraceId === trace.id;
    const conversationId = extractConversationId(trace.sessionId);
    const agentName = (trace.metadata?.global_agent_agentName as string) || 'Unknown Agent';

    return (
      <React.Fragment key={trace.id}>
        <tr
          onClick={() => {
            if (selectedTraceId !== trace.id) {
              setExpandedSections(new Set());
            }
            setSelectedTraceId(trace.id);
            if (!traceDetails[trace.id]) {
              fetchTraceDetails(trace.id);
            }
          }}
          style={{
            cursor: 'pointer',
            backgroundColor: isSelected ? '#f0f9ff' : 'transparent',
            transition: 'background-color 0.15s'
          }}
          onMouseEnter={(e) => {
            if (!isSelected) e.currentTarget.style.backgroundColor = '#f9fafb';
          }}
          onMouseLeave={(e) => {
            if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
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
            {trace.userId ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span
                  style={{
                    backgroundColor: '#fef3c7',
                    color: '#92400e',
                    padding: '0.125rem 0.5rem',
                    borderRadius: '4px',
                    fontSize: '0.7rem'
                  }}
                >
                  {trace.userId}
                </span>
                {hasLangfuseLinks && (
                  <a
                    href={getLangfuseUserUrl(trace.userId) || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      color: '#8b5cf6',
                      textDecoration: 'none',
                      fontSize: '0.875rem'
                    }}
                    title="View user in Langfuse"
                  >
                    🔗
                  </a>
                )}
              </span>
            ) : (
              <span style={{ color: '#9ca3af' }}>-</span>
            )}
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
          {hasLangfuseLinks && (
            <td style={{ padding: '0.75rem', fontSize: '0.813rem', textAlign: 'center' }}>
              <a
                href={getLangfuseTraceUrl(trace.id) || '#'}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{
                  color: '#8b5cf6',
                  textDecoration: 'none',
                  fontSize: '1rem'
                }}
                title="Open trace in Langfuse"
              >
                📊
              </a>
            </td>
          )}
        </tr>
      </React.Fragment>
    );
  };

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  // Render readable content from observation input/output
  const renderReadableContent = (data: unknown, label: string, sectionId: string, bgColor: string = '#f8fafc'): React.ReactNode => {
    if (data === null || data === undefined) return null;

    const MAX_COLLAPSED_LINES = 12;
    const isExpanded = expandedSections.has(sectionId);

    // Convert data to displayable text
    const getTextContent = (item: unknown): string => {
      if (typeof item === 'string') return item;
      if (item === null || item === undefined) return '';
      return JSON.stringify(item, null, 2);
    };

    // Build content elements and track if we need "See more"
    let textForLineCount = '';
    let content: React.ReactNode;

    if (typeof data === 'string') {
      textForLineCount = data;
      content = data;
    } else if (Array.isArray(data)) {
      // Handle array of messages (common in LLM calls)
      const elements: React.ReactNode[] = [];
      for (let idx = 0; idx < data.length; idx++) {
        const item = data[idx];
        if (typeof item === 'object' && item !== null) {
          const obj = item as Record<string, unknown>;
          // Check for message format
          if ('role' in obj && 'content' in obj) {
            const contentText = getTextContent(obj.content);
            textForLineCount += `${obj.role}\n${contentText}\n\n`;
            elements.push(
              <div key={idx} style={{ marginBottom: idx < data.length - 1 ? '0.75rem' : 0 }}>
                <span style={{
                  display: 'inline-block',
                  backgroundColor: obj.role === 'user' ? '#dbeafe' : obj.role === 'assistant' ? '#dcfce7' : '#fef3c7',
                  color: obj.role === 'user' ? '#1e40af' : obj.role === 'assistant' ? '#166534' : '#92400e',
                  padding: '0.125rem 0.5rem',
                  borderRadius: '4px',
                  fontSize: '0.625rem',
                  fontWeight: 600,
                  marginBottom: '0.25rem',
                  textTransform: 'uppercase'
                }}>
                  {String(obj.role)}
                </span>
                <div style={{ marginTop: '0.25rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {contentText}
                </div>
              </div>
            );
          } else {
            const jsonText = JSON.stringify(item, null, 2);
            textForLineCount += jsonText + '\n';
            elements.push(<pre key={idx} style={{ margin: 0 }}>{jsonText}</pre>);
          }
        } else {
          textForLineCount += String(item) + '\n';
          elements.push(<div key={idx}>{String(item)}</div>);
        }
      }
      content = elements;
    } else if (typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      // Check for common patterns
      if ('messages' in obj && Array.isArray(obj.messages)) {
        return renderReadableContent(obj.messages, label, sectionId, bgColor);
      }
      if ('content' in obj) {
        textForLineCount = getTextContent(obj.content);
        content = textForLineCount;
      } else {
        textForLineCount = JSON.stringify(data, null, 2);
        content = <pre style={{ margin: 0 }}>{textForLineCount}</pre>;
      }
    } else {
      textForLineCount = String(data);
      content = textForLineCount;
    }

    // Count lines to determine if we need "See more"
    const lineCount = textForLineCount.split('\n').length;
    const needsExpansion = lineCount > MAX_COLLAPSED_LINES;

    return (
      <div style={{ marginBottom: '1rem' }}>
        <div style={{
          fontSize: '0.75rem',
          fontWeight: 600,
          color: '#374151',
          marginBottom: '0.5rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}>
          {label}
        </div>
        <div style={{
          backgroundColor: bgColor,
          padding: '0.75rem',
          borderRadius: '6px',
          fontSize: '0.813rem',
          fontFamily: typeof content === 'string' ? 'inherit' : 'monospace',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          position: 'relative',
          maxHeight: (!needsExpansion || isExpanded) ? 'none' : '240px',
          overflow: 'hidden'
        }}>
          {content}
          {needsExpansion && !isExpanded && (
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '60px',
              background: `linear-gradient(transparent, ${bgColor})`,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              paddingBottom: '0.5rem'
            }}>
              <button
                onClick={() => toggleSection(sectionId)}
                style={{
                  background: 'white',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  padding: '0.25rem 0.75rem',
                  fontSize: '0.75rem',
                  color: '#6b7280',
                  cursor: 'pointer',
                  fontWeight: 500
                }}
              >
                See more ({lineCount} lines)
              </button>
            </div>
          )}
        </div>
        {needsExpansion && isExpanded && (
          <button
            onClick={() => toggleSection(sectionId)}
            style={{
              background: 'none',
              border: 'none',
              padding: '0.25rem 0',
              fontSize: '0.75rem',
              color: '#6b7280',
              cursor: 'pointer',
              fontWeight: 500,
              marginTop: '0.25rem'
            }}
          >
            See less
          </button>
        )}
      </div>
    );
  };

  // Render the trace details drawer using Portal to ensure it's above all other elements
  const renderTraceDrawer = () => {
    if (!selectedTraceId) return null;
    if (typeof document === 'undefined') return null;

    const details = traceDetails[selectedTraceId];
    const trace = traces.find(t => t.id === selectedTraceId);
    const isLoading = !details;

    return createPortal(
      <>
        {/* Backdrop */}
        <div
          onClick={handleCloseDrawer}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            zIndex: 9999
          }}
        />

        {/* Drawer */}
        <div style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '600px',
          maxWidth: '90vw',
          backgroundColor: 'white',
          boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.15)',
          zIndex: 10000,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          {/* Drawer Header */}
          <div style={{
            padding: '1rem 1.25rem',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#f8fafc'
          }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#1f2937' }}>
                Trace Details
              </h3>
              <span style={{ fontSize: '0.75rem', color: '#6b7280', fontFamily: 'monospace' }}>
                {selectedTraceId}
              </span>
            </div>
            <button
              onClick={handleCloseDrawer}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '1.5rem',
                cursor: 'pointer',
                color: '#6b7280',
                padding: '0.25rem',
                lineHeight: 1
              }}
            >
              ×
            </button>
          </div>

          {/* Drawer Content */}
          <div style={{
            flex: 1,
            overflow: 'auto',
            padding: '1.25rem'
          }}>
            {isLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
                Loading trace details...
              </div>
            ) : (
              <>
                {/* Conversation Messages - Full conversation flow */}
                {conversationMessages.length > 0 && (
                  <div style={{ marginBottom: '1.5rem' }}>
                    <h4 style={{
                      margin: '0 0 0.75rem 0',
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: '#1f2937',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem'
                    }}>
                      <span style={{ fontSize: '1rem' }}>💬</span>
                      Conversation ({conversationMessages.length} messages)
                    </h4>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {conversationMessages.map((msg, idx) => {
                        const isUser = msg.role === 'user';
                        const isAssistant = msg.role === 'assistant';
                        const isSystem = msg.role === 'system';
                        const bgColor = isUser ? '#f0f9ff' : isAssistant ? '#f0fdf4' : '#fffbeb';
                        const borderColor = isUser ? '#3b82f6' : isAssistant ? '#22c55e' : '#f59e0b';

                        // Calculate if content needs expansion
                        const lineCount = msg.content.split('\n').length;
                        const charCount = msg.content.length;
                        const maxLines = isSystem ? 6 : 12;
                        const maxChars = isSystem ? 400 : 800;
                        const needsExpansion = lineCount > maxLines || charCount > maxChars;
                        const isExpanded = expandedMessages.has(idx);

                        return (
                          <div key={idx}>
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              marginBottom: '0.375rem'
                            }}>
                              <span style={{
                                backgroundColor: isUser ? '#dbeafe' : isAssistant ? '#dcfce7' : '#fef3c7',
                                color: isUser ? '#1e40af' : isAssistant ? '#166534' : '#92400e',
                                padding: '0.2rem 0.5rem',
                                borderRadius: '4px',
                                fontSize: '0.65rem',
                                fontWeight: 600,
                                textTransform: 'uppercase'
                              }}>
                                {isUser ? '👤 User' : isAssistant ? '🤖 Agent' : '⚙️ System'}
                              </span>
                              <span style={{ fontSize: '0.7rem', color: '#9ca3af' }}>
                                #{idx + 1}
                              </span>
                            </div>
                            <div style={{
                              backgroundColor: bgColor,
                              padding: '0.875rem',
                              borderRadius: '8px',
                              borderLeft: `4px solid ${borderColor}`,
                              fontSize: '0.813rem',
                              lineHeight: 1.6,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              position: 'relative',
                              maxHeight: (!needsExpansion || isExpanded) ? 'none' : (isSystem ? '120px' : '200px'),
                              overflow: 'hidden'
                            }}>
                              {msg.content}
                              {needsExpansion && !isExpanded && (
                                <div style={{
                                  position: 'absolute',
                                  bottom: 0,
                                  left: 0,
                                  right: 0,
                                  height: '50px',
                                  background: `linear-gradient(transparent, ${bgColor})`,
                                  display: 'flex',
                                  alignItems: 'flex-end',
                                  justifyContent: 'center',
                                  paddingBottom: '0.5rem'
                                }}>
                                  <button
                                    onClick={() => setExpandedMessages(prev => {
                                      const next = new Set(prev);
                                      next.add(idx);
                                      return next;
                                    })}
                                    style={{
                                      background: 'white',
                                      border: '1px solid #d1d5db',
                                      borderRadius: '4px',
                                      padding: '0.25rem 0.75rem',
                                      fontSize: '0.75rem',
                                      color: '#6b7280',
                                      cursor: 'pointer',
                                      fontWeight: 500
                                    }}
                                  >
                                    See more ({lineCount} lines)
                                  </button>
                                </div>
                              )}
                            </div>
                            {needsExpansion && isExpanded && (
                              <button
                                onClick={() => setExpandedMessages(prev => {
                                  const next = new Set(prev);
                                  next.delete(idx);
                                  return next;
                                })}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  padding: '0.25rem 0',
                                  fontSize: '0.75rem',
                                  color: '#6b7280',
                                  cursor: 'pointer',
                                  fontWeight: 500,
                                  marginTop: '0.25rem'
                                }}
                              >
                                See less
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Quick Stats */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                  gap: '0.75rem',
                  marginBottom: '1.5rem'
                }}>
                  <div style={{ backgroundColor: '#f3e8ff', padding: '0.75rem', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.625rem', color: '#7c3aed', fontWeight: 600, textTransform: 'uppercase' }}>Latency</div>
                    <div style={{ fontSize: '1rem', fontWeight: 600, color: '#5b21b6' }}>
                      {formatLatency(details?.latency ?? trace?.latency ?? null)}
                    </div>
                  </div>
                  <div style={{ backgroundColor: '#dbeafe', padding: '0.75rem', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.625rem', color: '#1e40af', fontWeight: 600, textTransform: 'uppercase' }}>Observations</div>
                    <div style={{ fontSize: '1rem', fontWeight: 600, color: '#1e3a8a' }}>
                      {Array.isArray(details?.observations) ? details.observations.length : 0}
                    </div>
                  </div>
                  <div style={{ backgroundColor: '#dcfce7', padding: '0.75rem', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.625rem', color: '#166534', fontWeight: 600, textTransform: 'uppercase' }}>Cost</div>
                    <div style={{ fontSize: '1rem', fontWeight: 600, color: '#14532d' }}>
                      ${(details?.totalCost ?? trace?.totalCost ?? 0).toFixed(4)}
                    </div>
                  </div>
                  <div style={{ backgroundColor: '#fef3c7', padding: '0.75rem', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.625rem', color: '#92400e', fontWeight: 600, textTransform: 'uppercase' }}>Agent</div>
                    <div style={{ fontSize: '0.813rem', fontWeight: 600, color: '#78350f', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {(details?.metadata?.global_agent_agentName as string) || 'Unknown'}
                    </div>
                  </div>
                </div>

                {/* Toggle for Detailed Information */}
                <button
                  onClick={() => setShowDetailedInfo(!showDetailedInfo)}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    backgroundColor: showDetailedInfo ? '#f3f4f6' : '#fafafa',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: '#374151',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    marginBottom: '1rem',
                    transition: 'background-color 0.15s'
                  }}
                >
                  <span>{showDetailedInfo ? '▼' : '▶'}</span>
                  {showDetailedInfo ? 'Hide' : 'Show'} Detailed Trace Information
                  <span style={{
                    backgroundColor: '#e5e7eb',
                    padding: '0.125rem 0.5rem',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    color: '#6b7280'
                  }}>
                    {parsedObservations.generations.length + parsedObservations.toolCalls.length + parsedObservations.spans.length} items
                  </span>
                </button>

                {/* Detailed Information (Collapsible) */}
                {showDetailedInfo && (
                  <>
                    {/* LLM Generations - Input/Output */}
                    {parsedObservations.generations.length > 0 && (
                      <div style={{ marginBottom: '1.5rem' }}>
                        <h4 style={{
                          margin: '0 0 0.75rem 0',
                          fontSize: '0.875rem',
                          fontWeight: 600,
                          color: '#1f2937',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem'
                        }}>
                          <span style={{ fontSize: '1rem' }}>🤖</span>
                          LLM Generations ({parsedObservations.generations.length})
                        </h4>
                        {parsedObservations.generations.map((gen, idx) => (
                          <div
                            key={gen.id || idx}
                            style={{
                              backgroundColor: '#fafafa',
                              borderRadius: '8px',
                              border: '1px solid #e5e7eb',
                              marginBottom: '1rem',
                              overflow: 'hidden'
                            }}
                          >
                            <div style={{
                              padding: '0.75rem',
                              backgroundColor: '#f3f4f6',
                              borderBottom: '1px solid #e5e7eb',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center'
                            }}>
                              <span style={{ fontWeight: 500, fontSize: '0.875rem' }}>{gen.name}</span>
                              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                {gen.model && (
                                  <span style={{
                                    backgroundColor: '#e0e7ff',
                                    color: '#3730a3',
                                    padding: '0.125rem 0.5rem',
                                    borderRadius: '4px',
                                    fontSize: '0.625rem',
                                    fontWeight: 600
                                  }}>
                                    {gen.model}
                                  </span>
                                )}
                                {gen.latency && (
                                  <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                                    {formatLatency(gen.latency)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div style={{ padding: '0.75rem' }}>
                              {renderReadableContent(gen.input, 'Input', `gen-${gen.id || idx}-input`, '#f0f9ff')}
                              {renderReadableContent(gen.output, 'Output', `gen-${gen.id || idx}-output`, '#f0fdf4')}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Tool Calls */}
                    {parsedObservations.toolCalls.length > 0 && (
                      <div style={{ marginBottom: '1.5rem' }}>
                        <h4 style={{
                          margin: '0 0 0.75rem 0',
                          fontSize: '0.875rem',
                          fontWeight: 600,
                          color: '#1f2937',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem'
                        }}>
                          <span style={{ fontSize: '1rem' }}>🔧</span>
                          Tool Calls ({parsedObservations.toolCalls.length})
                        </h4>
                        {parsedObservations.toolCalls.map((tool, idx) => (
                          <div
                            key={tool.id || idx}
                            style={{
                              backgroundColor: '#fffbeb',
                              borderRadius: '8px',
                              border: '1px solid #fbbf24',
                              marginBottom: '0.75rem',
                              overflow: 'hidden'
                            }}
                          >
                            <div style={{
                              padding: '0.5rem 0.75rem',
                              backgroundColor: '#fef3c7',
                              borderBottom: '1px solid #fbbf24',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center'
                            }}>
                              <span style={{
                                fontWeight: 600,
                                fontSize: '0.813rem',
                                color: '#92400e'
                              }}>
                                {tool.name}
                              </span>
                              {tool.latency && (
                                <span style={{ fontSize: '0.75rem', color: '#b45309' }}>
                                  {formatLatency(tool.latency)}
                                </span>
                              )}
                            </div>
                            <div style={{ padding: '0.75rem' }}>
                              {tool.input !== null && tool.input !== undefined && renderReadableContent(tool.input, 'Arguments', `tool-${tool.id || idx}-input`, '#fffbeb')}
                              {tool.output !== null && tool.output !== undefined && renderReadableContent(tool.output, 'Result', `tool-${tool.id || idx}-output`, '#fef9c3')}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Other Spans */}
                    {parsedObservations.spans.length > 0 && (
                      <div style={{ marginBottom: '1.5rem' }}>
                        <h4 style={{
                          margin: '0 0 0.75rem 0',
                          fontSize: '0.875rem',
                          fontWeight: 600,
                          color: '#1f2937',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem'
                        }}>
                          <span style={{ fontSize: '1rem' }}>📊</span>
                          Spans ({parsedObservations.spans.length})
                        </h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {parsedObservations.spans.map((span, idx) => (
                            <div
                              key={span.id || idx}
                              style={{
                                backgroundColor: '#f8fafc',
                                padding: '0.75rem',
                                borderRadius: '6px',
                                border: '1px solid #e2e8f0'
                              }}
                            >
                              <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: span.input || span.output ? '0.5rem' : 0
                              }}>
                                <span style={{ fontWeight: 500, fontSize: '0.813rem' }}>{span.name}</span>
                                {span.latency && (
                                  <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                                    {formatLatency(span.latency)}
                                  </span>
                                )}
                              </div>
                              {span.input !== null && span.input !== undefined && renderReadableContent(span.input, 'Input', `span-${span.id || idx}-input`, '#f1f5f9')}
                              {span.output !== null && span.output !== undefined && renderReadableContent(span.output, 'Output', `span-${span.id || idx}-output`, '#ecfdf5')}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Metadata Section */}
                    {details?.metadata && Object.keys(details.metadata).length > 0 && (() => {
                      const metadataJson = JSON.stringify(details.metadata, null, 2);
                      const lineCount = metadataJson.split('\n').length;
                      const needsExpansion = lineCount > 12;
                      const isMetadataExpanded = expandedSections.has('metadata');

                      return (
                        <div>
                          <h4 style={{
                            margin: '0 0 0.75rem 0',
                            fontSize: '0.875rem',
                            fontWeight: 600,
                            color: '#1f2937',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem'
                          }}>
                            <span style={{ fontSize: '1rem' }}>ℹ️</span>
                            Metadata
                          </h4>
                          <div style={{
                            backgroundColor: '#1e293b',
                            padding: '0.75rem',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            fontFamily: 'monospace',
                            color: '#e2e8f0',
                            position: 'relative',
                            maxHeight: (!needsExpansion || isMetadataExpanded) ? 'none' : '200px',
                            overflow: 'hidden'
                          }}>
                            <pre style={{ margin: 0 }}>
                              {metadataJson}
                            </pre>
                            {needsExpansion && !isMetadataExpanded && (
                              <div style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                right: 0,
                                height: '60px',
                                background: 'linear-gradient(transparent, #1e293b)',
                                display: 'flex',
                                alignItems: 'flex-end',
                                justifyContent: 'center',
                                paddingBottom: '0.5rem'
                              }}>
                                <button
                                  onClick={() => toggleSection('metadata')}
                                  style={{
                                    background: '#334155',
                                    border: '1px solid #475569',
                                    borderRadius: '4px',
                                    padding: '0.25rem 0.75rem',
                                    fontSize: '0.75rem',
                                    color: '#e2e8f0',
                                    cursor: 'pointer',
                                    fontWeight: 500
                                  }}
                                >
                                  See more ({lineCount} lines)
                                </button>
                              </div>
                            )}
                          </div>
                          {needsExpansion && isMetadataExpanded && (
                            <button
                              onClick={() => toggleSection('metadata')}
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: '0.25rem 0',
                                fontSize: '0.75rem',
                                color: '#6b7280',
                                cursor: 'pointer',
                                fontWeight: 500,
                                marginTop: '0.25rem'
                              }}
                            >
                              See less
                            </button>
                          )}
                        </div>
                      );
                    })()}

                    {/* Scores Section */}
                    {details?.scores && details.scores.length > 0 && (
                      <div style={{ marginTop: '1.5rem' }}>
                        <h4 style={{
                          margin: '0 0 0.75rem 0',
                          fontSize: '0.875rem',
                          fontWeight: 600,
                          color: '#1f2937',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem'
                        }}>
                          <span style={{ fontSize: '1rem' }}>⭐</span>
                          Scores ({details.scores.length})
                        </h4>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {details.scores.map((score) => (
                            <div
                              key={score.id}
                              style={{
                                backgroundColor: score.value > 0.5 ? '#dcfce7' : '#fee2e2',
                                padding: '0.5rem 0.75rem',
                                borderRadius: '6px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem'
                              }}
                            >
                              <span style={{ fontSize: '0.813rem', fontWeight: 500 }}>{score.name}</span>
                              <span style={{
                                backgroundColor: 'rgba(255,255,255,0.5)',
                                padding: '0.125rem 0.375rem',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                fontWeight: 600
                              }}>
                                {score.value}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {/* Drawer Footer */}
          {hasLangfuseLinks && (
            <div style={{
              padding: '0.75rem 1.25rem',
              borderTop: '1px solid #e5e7eb',
              backgroundColor: '#f8fafc',
              textAlign: 'center'
            }}>
              <a
                href={getLangfuseTraceUrl(selectedTraceId) || '#'}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: '#8b5cf6',
                  textDecoration: 'none',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.375rem'
                }}
              >
                📊 Open in Langfuse
              </a>
            </div>
          )}
        </div>
      </>,
      document.body
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
            Conversation Traces
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
          {globalAppId && (
            <span style={{
              backgroundColor: '#dbeafe',
              color: '#1e40af',
              padding: '0.125rem 0.5rem',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: 500
            }}>
              Filtered: {globalAppId.substring(0, 12)}...
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

          <button
            onClick={() => fetchTraces()}
            disabled={loading || !globalAppId}
            style={{
              padding: '0.375rem 0.75rem',
              backgroundColor: 'white',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              cursor: (loading || !globalAppId) ? 'not-allowed' : 'pointer',
              fontSize: '0.813rem',
              opacity: !globalAppId ? 0.6 : 1
            }}
          >
            Refresh
          </button>
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

      {/* Empty State - No App ID */}
      {!globalAppId ? (
        <div style={{
          textAlign: 'center',
          padding: '2rem',
          backgroundColor: '#f9fafb',
          borderRadius: '6px'
        }}>
          <p style={{ margin: 0, fontWeight: 500 }}>Enter an App ID to view traces</p>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
            Use the App Context filter in the header or enter an App ID above
          </p>
        </div>
      ) : loading && traces.length === 0 ? (
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
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>App ID</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Conversation</th>
                  <th style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600, color: '#374151' }}>Latency</th>
                  <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600, color: '#374151' }}>Obs.</th>
                  <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600, color: '#374151' }}>Scores</th>
                  {hasLangfuseLinks && <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600, color: '#374151' }}>Trace</th>}
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

      {/* Trace Details Drawer */}
      {renderTraceDrawer()}
    </div>
  );
}
