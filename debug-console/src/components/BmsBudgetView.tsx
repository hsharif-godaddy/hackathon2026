'use client';

import React, { useCallback, useState } from 'react';

import { formatTimestamp } from '@/lib/date-utils';
import type {
    BmsCategoryAggregate,
    BmsDailyAggregate,
    BmsDailySpendData,
    BmsRollup,
    BmsSpendData,
} from '@/lib/spend-types';

type ActiveSpend = Extract<BmsSpendData, { useBms: true }>;

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

interface DailyState {
    status: 'idle' | 'loading' | 'loaded' | 'error';
    data: BmsDailyAggregate[];
    error: string | null;
}

const INITIAL_DAILY_STATE: DailyState = {
    status: 'idle',
    data: [],
    error: null,
};

function formatMoney(n: number): string {
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

function formatCredits(n: number): string {
    return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export interface DailyRow {
    date: string;
    budgetCostTotal: number;
    productCostTotal: number;
}

export function toDailyRow(d: BmsDailyAggregate): DailyRow {
    return {
        date: d.date,
        budgetCostTotal: Number(d.budgetCostTotal.toFixed(4)),
        productCostTotal: Number(d.productCostTotal.toFixed(4)),
    };
}

function SpendRollup({ rollup }: { rollup: BmsRollup }) {
    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1.5rem',
            flexWrap: 'wrap',
            padding: '0.5rem 0.75rem',
            backgroundColor: '#fff',
            borderRadius: '6px',
            border: '1px solid #e5e7eb',
            fontSize: '0.8rem',
        }}>
            <span style={{ color: '#6b7280' }}>
                Budget Cost:{' '}
                <span style={{ color: '#000', fontWeight: 700 }}>{formatMoney(rollup.budgetCostTotal)}</span>
            </span>
            <span style={{ color: '#6b7280' }}>
                Product Cost:{' '}
                <span style={{ color: '#000', fontWeight: 700 }}>{formatMoney(rollup.productCostTotal)}</span>
            </span>
            <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: '#9ca3af' }}>
                last 30 days, UTC
            </span>
        </div>
    );
}

function BmsDailySpendTable({ days }: { days: BmsDailyAggregate[] }) {
    const total = days.reduce((acc, d) => acc + d.productCostTotal, 0);
    if (total === 0) {
        return (
            <div style={{ fontSize: '0.75rem', color: '#9ca3af', padding: '0.5rem 0' }}>
                No spend recorded in the last 30 days.
            </div>
        );
    }

    const rows = days.map(toDailyRow).sort((a, b) => b.date.localeCompare(a.date));

    return (
        <div style={{ maxHeight: '360px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                    <tr style={{ backgroundColor: '#f3f4f6', position: 'sticky', top: 0, borderBottom: '1px solid #d1d5db' }}>
                        <th style={{ ...TH_BASE, textAlign: 'left', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.7rem' }}>Date</th>
                        <th style={{ ...TH_BASE, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.7rem' }}>Budget Cost</th>
                        <th style={{ ...TH_BASE, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.7rem' }}>Product Cost</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => (
                        <tr key={row.date} style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                            <td style={{ ...TD_BASE, textAlign: 'left', color: '#374151' }}>{row.date}</td>
                            <td style={{ ...TD_BASE, color: '#000', fontWeight: 700 }}>{formatMoney(row.budgetCostTotal)}</td>
                            <td style={{ ...TD_BASE, color: '#000', fontWeight: 700 }}>{formatMoney(row.productCostTotal)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function BudgetHeaderCard({ budget }: { budget: NonNullable<ActiveSpend['budget']> }) {
    const total = parseFloat(budget.creditsTotal) || 0;
    const used = parseFloat(budget.creditsUsed) || 0;
    const pending = parseFloat(budget.creditsPending) || 0;
    const pctUsed = total > 0 ? (used / total) * 100 : 0;
    const barColor = pctUsed >= 90 ? '#dc2626' : pctUsed >= 70 ? '#d97706' : '#16a34a';

    return (
        <div style={{
            padding: '0.75rem',
            backgroundColor: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#111827' }}>
                    {formatCredits(used)} / {formatCredits(total)} credits
                </span>
                {pending > 0 && (
                    <span style={{ fontSize: '0.72rem', color: '#92400e' }}>
                        ({formatCredits(pending)} pending)
                    </span>
                )}
                <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#6b7280' }}>
                    {pctUsed.toFixed(1)}%
                </span>
            </div>
            <div style={{ height: 4, backgroundColor: '#e5e7eb', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                    height: '100%',
                    width: `${Math.min(100, pctUsed)}%`,
                    backgroundColor: barColor,
                    borderRadius: 2,
                }} />
            </div>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.7rem', color: '#6b7280' }}>
                <span>
                    productKey:{' '}
                    <span style={{ fontFamily: 'monospace', color: '#374151' }}>{budget.productKey || '—'}</span>
                </span>
                <span>
                    budgetId:{' '}
                    <span style={{ fontFamily: 'monospace', color: '#374151' }}>{budget.budgetId}</span>
                </span>
            </div>
        </div>
    );
}

function GrantRow({ grant }: { grant: ActiveSpend['grants'][number] }) {
    const remaining = grant.creditsMax - grant.creditsSpent;
    const pctUsed = grant.creditsMax > 0 ? (grant.creditsSpent / grant.creditsMax) * 100 : 0;
    const barColor = pctUsed >= 90 ? '#dc2626' : pctUsed >= 70 ? '#d97706' : '#16a34a';
    const status: { label: string; color: string; bg: string; border: string } = grant.finalState === 'expired'
        ? { label: 'expired', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' }
        : grant.finalState === 'consumed'
        ? { label: 'consumed', color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' }
        : grant.isAvailable
        ? { label: 'active', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' }
        : { label: grant.finalState ?? 'inactive', color: '#d97706', bg: '#fffbeb', border: '#fde68a' };

    return (
        <div style={{
            padding: '0.625rem 0.75rem',
            backgroundColor: status.label === 'active' ? '#f0fdf4' : '#fff',
            borderRadius: '6px',
            border: `1px solid ${status.label === 'active' ? '#bbf7d0' : '#e5e7eb'}`,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.4rem',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#111827' }}>
                    {formatCredits(grant.creditsSpent)} / {formatCredits(grant.creditsMax)} credits
                </span>
                <span style={{
                    display: 'inline-block',
                    padding: '0.125rem 0.5rem',
                    borderRadius: 9999,
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    color: status.color,
                    backgroundColor: status.bg,
                    border: `1px solid ${status.border}`,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                }}>
                    {status.label}
                </span>
                <span style={{
                    display: 'inline-block',
                    padding: '0.125rem 0.5rem',
                    borderRadius: 9999,
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    color: '#374151',
                    backgroundColor: '#f3f4f6',
                    border: '1px solid #e5e7eb',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    fontFamily: 'monospace',
                }}>
                    {grant.type}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#6b7280' }}>
                    {pctUsed.toFixed(1)}%
                </span>
            </div>
            <div style={{ height: 4, backgroundColor: '#e5e7eb', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                    height: '100%',
                    width: `${Math.min(100, pctUsed)}%`,
                    backgroundColor: barColor,
                    borderRadius: 2,
                }} />
            </div>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.7rem', color: '#6b7280' }}>
                <span>
                    Remaining:{' '}
                    <span style={{ color: '#374151', fontFamily: 'monospace' }}>{formatCredits(remaining)}</span>
                </span>
                <span>
                    Created:{' '}
                    <span style={{ color: '#374151' }}>{formatTimestamp(grant.createdAt)}</span>
                </span>
                {grant.useBefore && (
                    <span>
                        Use Before:{' '}
                        <span style={{ color: '#374151' }}>{formatTimestamp(grant.useBefore)}</span>
                    </span>
                )}
                <span style={{ flex: 1, minWidth: 0 }}>
                    Item ID:{' '}
                    <span style={{ color: '#374151', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {grant.id}
                    </span>
                </span>
            </div>
        </div>
    );
}

function CategoryBreakdownTable({ rows }: { rows: BmsCategoryAggregate[] }) {
    if (rows.length === 0) {
        return (
            <div style={{ fontSize: '0.75rem', color: '#9ca3af', padding: '0.5rem 0' }}>
                No category attribution recorded in the last 30 days.
            </div>
        );
    }
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Category breakdown ({rows.length})
            </div>
            <div style={{
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                backgroundColor: '#fff',
                overflow: 'hidden',
            }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                    <thead>
                        <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #d1d5db' }}>
                            <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.7rem' }}>Category</th>
                            <th style={{ textAlign: 'right', padding: '0.4rem 0.6rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.7rem' }}>Budget Cost</th>
                            <th style={{ textAlign: 'right', padding: '0.4rem 0.6rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.7rem' }}>Product Cost</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, i) => (
                            <tr key={row.category} style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                                <td style={{ padding: '0.4rem 0.6rem', fontFamily: 'monospace', color: '#374151' }}>
                                    {row.category}
                                </td>
                                <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontFamily: 'monospace', color: '#000', fontWeight: 700 }}>
                                    {formatMoney(row.budgetCostTotal)}
                                </td>
                                <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontFamily: 'monospace', color: '#000', fontWeight: 700 }}>
                                    {formatMoney(row.productCostTotal)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function DailySpendSection({ subscriptionId, productKey }: { subscriptionId: string; productKey: string | null }) {
    const [state, setState] = useState<DailyState>(INITIAL_DAILY_STATE);

    const load = useCallback(async () => {
        if (!productKey) {
            setState({ status: 'error', data: [], error: 'productKey unavailable — budget did not load' });
            return;
        }
        setState((s) => ({ ...s, status: 'loading', error: null }));
        try {
            const params = new URLSearchParams({ subscriptionId, productKey });
            const res = await fetch(`/api/bms/spend/daily?${params}`);
            const json: BmsDailySpendData = await res.json();
            if (!res.ok) {
                throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
            }
            setState({
                status: 'loaded',
                data: json.dailySpend ?? [],
                error: json.error ?? null,
            });
        } catch (err) {
            setState({
                status: 'error',
                data: [],
                error: err instanceof Error ? err.message : 'Failed to fetch daily spend',
            });
        }
    }, [subscriptionId, productKey]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Daily spend (last 30 days, UTC)
                </div>
                {state.status === 'idle' && (
                    <button
                        type="button"
                        onClick={load}
                        style={{
                            padding: '0.25rem 0.6rem',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            color: '#1d4ed8',
                            backgroundColor: '#eff6ff',
                            border: '1px solid #bfdbfe',
                            borderRadius: '6px',
                            cursor: 'pointer',
                        }}
                    >
                        Load daily breakdown
                    </button>
                )}
                {state.status === 'loading' && (
                    <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>Loading…</span>
                )}
                {(state.status === 'loaded' || state.status === 'error') && (
                    <button
                        type="button"
                        onClick={load}
                        style={{
                            padding: '0.2rem 0.5rem',
                            fontSize: '0.7rem',
                            color: '#6b7280',
                            backgroundColor: 'transparent',
                            border: '1px solid #e5e7eb',
                            borderRadius: '6px',
                            cursor: 'pointer',
                        }}
                    >
                        Refresh
                    </button>
                )}
            </div>

            {state.status === 'idle' && (
                <div style={{ fontSize: '0.72rem', color: '#9ca3af', fontStyle: 'italic' }}>
                    Click to fetch the per-day breakdown (30 BMS aggregate calls).
                </div>
            )}

            {state.error && (
                <div style={{
                    padding: '0.4rem 0.6rem',
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '6px',
                    fontSize: '0.72rem',
                    color: '#dc2626',
                }}>
                    {state.error}
                </div>
            )}

            {state.status === 'loaded' && <BmsDailySpendTable days={state.data} />}
        </div>
    );
}

interface Props {
    subscriptionId: string;
    spend: ActiveSpend;
}

export function BmsBudgetView({ subscriptionId, spend }: Props) {
    // Newest credits first (most recently created budget item on top).
    const sortedGrants = [...spend.grants].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {spend.budget && <BudgetHeaderCard budget={spend.budget} />}

            <SpendRollup rollup={spend.rollup} />

            {sortedGrants.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Budget items ({sortedGrants.length})
                    </div>
                    {sortedGrants.map((grant) => (
                        <GrantRow key={grant.id} grant={grant} />
                    ))}
                </div>
            )}

            <DailySpendSection subscriptionId={subscriptionId} productKey={spend.budget?.productKey ?? null} />

            <CategoryBreakdownTable rows={spend.categoryBreakdown} />
        </div>
    );
}
