'use client';

import React from 'react';

export interface LogSource {
  id: string;
  name: string;
  description: string;
}

interface LogSourceSelectorProps {
  sources: LogSource[];
  selectedSource: string;
  onSourceChange: (sourceId: string) => void;
}

export default function LogSourceSelector({
  sources,
  selectedSource,
  onSourceChange
}: LogSourceSelectorProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem'
    }}>
      <label htmlFor="log-source" style={{
        fontSize: '0.875rem',
        fontWeight: 500,
        color: '#374151'
      }}>
        Log Source
      </label>
      <select
        id="log-source"
        value={selectedSource}
        onChange={(e) => onSourceChange(e.target.value)}
        style={{
          padding: '0.5rem',
          border: '1px solid #d1d5db',
          borderRadius: '6px',
          fontSize: '0.875rem',
          cursor: 'pointer',
          backgroundColor: 'white'
        }}
      >
        {sources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.name}
          </option>
        ))}
      </select>
      {sources.find(s => s.id === selectedSource)?.description && (
        <p style={{
          margin: 0,
          fontSize: '0.75rem',
          color: '#6b7280',
          fontStyle: 'italic'
        }}>
          {sources.find(s => s.id === selectedSource)?.description}
        </p>
      )}
    </div>
  );
}
