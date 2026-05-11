'use client';

import React from 'react';

const chartLoadingStyle: React.CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.97)',
  padding: '1rem 1.25rem',
  borderRadius: '10px',
  boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  height: '120px',
  color: '#64748b',
};

const chartEmptyStyle: React.CSSProperties = {
  ...chartLoadingStyle,
  color: '#94a3b8',
  fontSize: '0.75rem',
};

export function ChartLoadingState() {
  return <div style={chartLoadingStyle}>Loading...</div>;
}

export function ChartEmptyState({ message }: { message: string }) {
  return <div style={chartEmptyStyle}>{message}</div>;
}
