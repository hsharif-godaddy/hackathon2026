'use client';

import React, { useState } from 'react';

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

type DetailTab = 'data' | 'metadata' | 'raw';

interface ActivityDetailPanelProps {
  activity: RecentActivity;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
}

function getLogLevelBadgeStyle(level: string): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '0.25rem 0.75rem',
    borderRadius: '4px',
    fontSize: '0.75rem',
    fontFamily: 'monospace',
    fontWeight: 600,
    border: '1px solid',
    display: 'inline-block'
  };

  const upperLevel = (level || '').toUpperCase();

  switch (upperLevel) {
    case 'ERROR':
      return { ...base, backgroundColor: '#fee2e2', color: '#991b1b', borderColor: '#fca5a5' };
    case 'WARN':
      return { ...base, backgroundColor: '#fef3c7', color: '#92400e', borderColor: '#fcd34d' };
    case 'INFO':
      return { ...base, backgroundColor: '#dbeafe', color: '#1e40af', borderColor: '#93c5fd' };
    case 'DEBUG':
      return { ...base, backgroundColor: '#f3f4f6', color: '#374151', borderColor: '#d1d5db' };
    default:
      return { ...base, backgroundColor: '#f3f4f6', color: '#4b5563', borderColor: '#e5e7eb' };
  }
}

function formatFullTimestamp(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      hour12: false
    });
  } catch {
    return timestamp;
  }
}

export default function ActivityDetailPanel({
  activity,
  onClose,
  onPrevious,
  onNext,
  hasPrevious = false,
  hasNext = false
}: ActivityDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('data');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(activity.raw, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.error('Failed to copy to clipboard');
    }
  };

  const tabs: { id: DetailTab; label: string }[] = [
    { id: 'data', label: 'Data' },
    { id: 'metadata', label: 'Metadata' },
    { id: 'raw', label: 'Raw JSON' }
  ];

  // Extract data from raw
  const rawData = activity.raw as Record<string, unknown>;
  const data = (rawData.data as Record<string, unknown>) || {};

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: 'white',
      borderLeft: '1px solid #e5e7eb'
    }}>
      {/* Header */}
      <div style={{
        padding: '0.75rem 1rem',
        borderBottom: '1px solid #e5e7eb',
        backgroundColor: '#f9fafb',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={getLogLevelBadgeStyle(activity.level || '')}>
            {(activity.level || '').toLowerCase()}
          </span>
          <span style={{
            fontSize: '0.75rem',
            color: '#6b7280',
            fontFamily: 'monospace'
          }}>
            {formatFullTimestamp(activity.timestamp)}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* Navigation buttons */}
          <button
            onClick={onPrevious}
            disabled={!hasPrevious}
            title="Previous log (↑)"
            style={{
              padding: '0.25rem 0.5rem',
              backgroundColor: hasPrevious ? '#f3f4f6' : '#f9fafb',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              cursor: hasPrevious ? 'pointer' : 'not-allowed',
              fontSize: '0.75rem',
              color: hasPrevious ? '#374151' : '#9ca3af',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            ↑
          </button>
          <button
            onClick={onNext}
            disabled={!hasNext}
            title="Next log (↓)"
            style={{
              padding: '0.25rem 0.5rem',
              backgroundColor: hasNext ? '#f3f4f6' : '#f9fafb',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              cursor: hasNext ? 'pointer' : 'not-allowed',
              fontSize: '0.75rem',
              color: hasNext ? '#374151' : '#9ca3af',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            ↓
          </button>
          <button
            onClick={onClose}
            title="Close (Esc)"
            style={{
              padding: '0.25rem 0.5rem',
              backgroundColor: '#f3f4f6',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.875rem',
              color: '#374151',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center'
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid #e5e7eb',
        backgroundColor: '#fafafa',
        flexShrink: 0
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.75rem',
              fontWeight: 500,
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #3b82f6' : '2px solid transparent',
              backgroundColor: 'transparent',
              color: activeTab === tab.id ? '#3b82f6' : '#6b7280',
              cursor: 'pointer',
              transition: 'all 0.15s'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '1rem'
      }}>
        {activeTab === 'data' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {Object.keys(data).length > 0 ? (
              <DataView data={data} />
            ) : (
              <div style={{
                padding: '1rem',
                backgroundColor: '#f9fafb',
                borderRadius: '6px',
                color: '#6b7280',
                textAlign: 'center',
                fontSize: '0.875rem'
              }}>
                No data available
              </div>
            )}
          </div>
        )}

        {activeTab === 'metadata' && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '0.75rem'
          }}>
            <MetadataField label="Timestamp" value={formatFullTimestamp(activity.timestamp)} mono />
            <MetadataField label="Level" value={activity.level} />
            {activity.event && <MetadataField label="Event" value={activity.event} mono />}
            {activity.service && <MetadataField label="Service" value={activity.service} mono />}
            {activity.source && <MetadataField label="Source" value={activity.source} mono />}
            {activity.message && <MetadataField label="Message" value={activity.message} />}
          </div>
        )}

        {activeTab === 'raw' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'flex-end'
            }}>
              <button
                onClick={handleCopy}
                style={{
                  fontSize: '0.7rem',
                  padding: '0.25rem 0.75rem',
                  backgroundColor: copied ? '#dcfce7' : '#f3f4f6',
                  border: `1px solid ${copied ? '#86efac' : '#d1d5db'}`,
                  borderRadius: '4px',
                  cursor: 'pointer',
                  color: copied ? '#166534' : '#374151',
                  fontWeight: 500,
                  transition: 'all 0.15s'
                }}
              >
                {copied ? '✓ Copied!' : 'Copy JSON'}
              </button>
            </div>
            <pre style={{
              fontSize: '0.7rem',
              padding: '0.75rem',
              borderRadius: '6px',
              border: '1px solid #e5e7eb',
              backgroundColor: '#1f2937',
              color: '#f3f4f6',
              overflowX: 'auto',
              margin: 0,
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              lineHeight: 1.4,
              flex: 1
            }}>
              {JSON.stringify(activity.raw, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function MetadataField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{
      padding: '0.5rem 0.75rem',
      backgroundColor: '#f9fafb',
      borderRadius: '6px',
      border: '1px solid #e5e7eb'
    }}>
      <div style={{
        fontSize: '0.6rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        marginBottom: '0.15rem',
        color: '#9ca3af',
        letterSpacing: '0.05em'
      }}>
        {label}
      </div>
      <div style={{
        fontSize: '0.8rem',
        color: '#1f2937',
        fontFamily: mono ? 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' : 'inherit',
        wordBreak: 'break-all'
      }}>
        {value}
      </div>
    </div>
  );
}

function DataView({ data, depth = 0 }: { data: Record<string, unknown>; depth?: number }) {
  const entries = Object.entries(data);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: depth === 0 ? '0.5rem' : '0.25rem'
    }}>
      {entries.map(([key, value]) => (
        <DataField key={key} fieldKey={key} value={value} depth={depth} />
      ))}
    </div>
  );
}

function DataField({ fieldKey, value, depth }: { fieldKey: string; value: unknown; depth: number }) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);

  const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
  const isArray = Array.isArray(value);
  const isComplex = isObject || isArray;

  const formatValue = (val: unknown): string => {
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'number') return String(val);
    if (typeof val === 'string') return val;
    return JSON.stringify(val);
  };

  const getValueColor = (val: unknown): string => {
    if (val === null || val === undefined) return '#9ca3af';
    if (typeof val === 'boolean') return '#8b5cf6';
    if (typeof val === 'number') return '#059669';
    if (typeof val === 'string') return '#1f2937';
    return '#6b7280';
  };

  const formatKey = (k: string): string => {
    return k
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/^./, str => str.toUpperCase());
  };

  if (isComplex) {
    const itemCount = isArray ? (value as unknown[]).length : Object.keys(value as object).length;
    const typeLabel = isArray ? `Array[${itemCount}]` : `Object{${itemCount}}`;

    return (
      <div style={{
        backgroundColor: depth === 0 ? '#f9fafb' : 'transparent',
        borderRadius: depth === 0 ? '6px' : '0',
        border: depth === 0 ? '1px solid #e5e7eb' : 'none',
        borderLeft: depth > 0 ? '2px solid #e5e7eb' : 'none',
        paddingLeft: depth > 0 ? '0.75rem' : '0',
        marginLeft: depth > 0 ? '0.25rem' : '0'
      }}>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            width: '100%',
            padding: depth === 0 ? '0.5rem 0.75rem' : '0.25rem 0',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left'
          }}
        >
          <span style={{
            fontSize: '0.7rem',
            color: '#6b7280',
            transition: 'transform 0.15s',
            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'
          }}>
            ▶
          </span>
          <span style={{
            fontSize: '0.75rem',
            fontWeight: 600,
            color: '#374151'
          }}>
            {formatKey(fieldKey)}
          </span>
          <span style={{
            fontSize: '0.65rem',
            color: '#9ca3af',
            fontFamily: 'monospace'
          }}>
            {typeLabel}
          </span>
        </button>
        {isExpanded && (
          <div style={{
            padding: depth === 0 ? '0 0.75rem 0.5rem' : '0.25rem 0'
          }}>
            {isArray ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {(value as unknown[]).map((item, idx) => (
                  <DataField key={idx} fieldKey={`[${idx}]`} value={item} depth={depth + 1} />
                ))}
              </div>
            ) : (
              <DataView data={value as Record<string, unknown>} depth={depth + 1} />
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: '0.75rem',
      padding: depth === 0 ? '0.5rem 0.75rem' : '0.15rem 0',
      backgroundColor: depth === 0 ? '#f9fafb' : 'transparent',
      borderRadius: depth === 0 ? '6px' : '0',
      border: depth === 0 ? '1px solid #e5e7eb' : 'none'
    }}>
      <span style={{
        fontSize: '0.75rem',
        fontWeight: 500,
        color: '#6b7280',
        minWidth: '100px',
        flexShrink: 0
      }}>
        {formatKey(fieldKey)}
      </span>
      <span style={{
        fontSize: '0.8rem',
        color: getValueColor(value),
        fontFamily: typeof value === 'number' || typeof value === 'boolean' ? 'monospace' : 'inherit',
        wordBreak: 'break-word',
        flex: 1,
        whiteSpace: 'pre-wrap'
      }}>
        {formatValue(value)}
      </span>
    </div>
  );
}
