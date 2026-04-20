'use client';

import React from 'react';

import type { SpendDay } from '@/lib/spend-types';

function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

const TH_BASE: React.CSSProperties = {
    padding: '0.4rem 0.75rem',
    textAlign: 'right',
    fontWeight: 600,
};

const TD_BASE: React.CSSProperties = {
    padding: '0.35rem 0.75rem',
    textAlign: 'right',
    fontFamily: 'monospace',
};

export default function SpendDailyTable({ days }: { days: SpendDay[] }) {
    if (days.length === 0) {
        return <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>No spend data</span>;
    }

    return (
        <div style={{ maxHeight: '360px', overflowY: 'auto', border: '1px solid #f3f4f6', borderRadius: '4px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                    <tr style={{ backgroundColor: '#f9fafb', position: 'sticky', top: 0 }}>
                        <th style={{ ...TH_BASE, textAlign: 'left', color: '#374151' }}>Date</th>
                        <th style={{ ...TH_BASE, color: '#059669' }}>Spend</th>
                        <th style={{ ...TH_BASE, color: '#3b82f6' }}>Input</th>
                        <th style={{ ...TH_BASE, color: '#8b5cf6' }}>Cache Read</th>
                        <th style={{ ...TH_BASE, color: '#d97706' }}>Cache Write</th>
                        <th style={{ ...TH_BASE, color: '#10b981' }}>Output</th>
                        <th style={{ ...TH_BASE, color: '#374151' }}>Total</th>
                        <th style={{ ...TH_BASE, color: '#6b7280' }}>Reqs</th>
                    </tr>
                </thead>
                <tbody>
                    {days.map(day => (
                        <tr key={day.date} style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ ...TD_BASE, textAlign: 'left', color: '#374151' }}>{day.date}</td>
                            <td style={{ ...TD_BASE, color: '#059669', fontWeight: 600 }}>${day.spend.toFixed(4)}</td>
                            <td style={{ ...TD_BASE, color: '#3b82f6' }}>{formatTokens(day.promptTokens)}</td>
                            <td style={{ ...TD_BASE, color: '#8b5cf6' }}>
                                {day.cacheReadTokens > 0 ? formatTokens(day.cacheReadTokens) : '—'}
                            </td>
                            <td style={{ ...TD_BASE, color: '#d97706' }}>
                                {day.cacheWriteTokens > 0 ? formatTokens(day.cacheWriteTokens) : '—'}
                            </td>
                            <td style={{ ...TD_BASE, color: '#10b981' }}>{formatTokens(day.completionTokens)}</td>
                            <td style={{ ...TD_BASE, color: '#374151', fontWeight: 600 }}>{formatTokens(day.totalTokens)}</td>
                            <td style={{ ...TD_BASE, color: '#8b5cf6' }}>{day.requests.toLocaleString()}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
