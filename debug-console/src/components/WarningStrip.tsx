'use client';

import React from 'react';

interface WarningStripProps {
  warnings: { id: string; message: string }[];
  loading: boolean;
  onRetry: (id: string) => void;
  sourceLabels: Record<string, string>;
}

/**
 * Per-source soft-failure strip. The fetch hook's HTTP 200 + warning
 * responses surface here (one row per failing source) with a Retry button
 * that re-fires just the failing leg, leaving other sources' results
 * untouched.
 */
export default function WarningStrip({
  warnings,
  loading,
  onRetry,
  sourceLabels,
}: WarningStripProps) {
  if (warnings.length === 0) return null;
  return (
    <div
      style={{
        border: '1px solid #f59e0b',
        borderRadius: '8px',
        padding: '0.75rem 1rem',
        marginBottom: '0.75rem',
        backgroundColor: '#fffbeb',
      }}
    >
      <p
        style={{
          margin: '0 0 0.5rem 0',
          fontWeight: 600,
          color: '#92400e',
          fontSize: '0.875rem',
        }}
      >
        Some sources failed to load
      </p>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.375rem',
        }}
      >
        {warnings.map(({ id, message }) => (
          <li
            key={id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.75rem',
            }}
          >
            <span
              style={{
                fontSize: '0.813rem',
                color: '#78350f',
                flex: 1,
                minWidth: 0,
                wordBreak: 'break-word',
              }}
            >
              <strong>{sourceLabels[id] || id}:</strong> {message}
            </span>
            <button
              onClick={() => onRetry(id)}
              disabled={loading}
              style={{
                padding: '0.25rem 0.75rem',
                backgroundColor: '#f59e0b',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '0.75rem',
                fontWeight: 500,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.375rem',
                flexShrink: 0,
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading && (
                <span
                  aria-hidden
                  style={{
                    display: 'inline-block',
                    width: '12px',
                    height: '12px',
                    border: '2px solid rgba(255,255,255,0.4)',
                    borderTopColor: 'white',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                    flexShrink: 0,
                  }}
                />
              )}
              Retry
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
