'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import SpendDailyTable from '@/components/SpendDailyTable';
import { formatTimestamp } from '@/lib/date-utils';
import type { MgmtAppDetails, MgmtDomainError, MgmtImageStatus, MgmtSubscription, MgmtSubscriptionGrants, MgmtVariantWithLifecycle } from '@/lib/mgmt-types';
import type { GrantBreakdown, LlmSpendData } from '@/lib/spend-types';

interface Props {
    appId: string;
    refreshKey: number;
    onRefresh?: () => void;
    onGrantsLoaded?: (subscriptionId: string, grants: MgmtSubscriptionGrants) => void;
    onAppLoaded?: (app: MgmtAppDetails | null) => void;
    llmSpend?: LlmSpendData | null;
    llmSpendLoading?: boolean;
    llmSpendError?: string | null;
}

const SPIN_STYLE = `@keyframes spin-icon{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`;

function ReloadIcon({ spinning }: { spinning: boolean }) {
    return (
        <>
            <style>{SPIN_STYLE}</style>
            <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                style={spinning ? { animation: 'spin-icon 1s linear infinite', display: 'inline-block' } : { display: 'inline-block' }}
            >
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
        </>
    );
}

function StatusBadge({ value, green, red }: { value: string; green: string[]; red?: string[] }) {
    const isGreen = green.includes(value);
    const isRed = red?.includes(value);
    const color = isGreen ? '#16a34a' : isRed ? '#dc2626' : '#d97706';
    const bg = isGreen ? '#f0fdf4' : isRed ? '#fef2f2' : '#fffbeb';
    const border = isGreen ? '#bbf7d0' : isRed ? '#fecaca' : '#fde68a';

    return (
        <span style={{
            display: 'inline-block',
            padding: '0.125rem 0.5rem',
            borderRadius: '9999px',
            fontSize: '0.7rem',
            fontWeight: 600,
            color,
            backgroundColor: bg,
            border: `1px solid ${border}`,
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
        }}>
            {value}
        </span>
    );
}

function camelToLabel(key: string): string {
    return key
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, s => s.toUpperCase())
        .trim();
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

function Timestamp({ iso, style }: { iso: string; style?: React.CSSProperties }) {
    return (
        <span title={iso} style={{ cursor: 'default', ...style }}>
            {formatTimestamp(iso)}
        </span>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '0.7rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {label}:
            </div>
            <div style={{ fontSize: '0.875rem', color: '#111827' }}>
                {children}
            </div>
        </div>
    );
}

const COMPONENTS = ['pre-start', 'agent', 'preview', 'publish'] as const;
type ComponentName = typeof COMPONENTS[number];

interface DetailedStatusBlockProps {
    name: ComponentName;
    url?: string;
    variant?: MgmtVariantWithLifecycle;
    imageStatus: MgmtImageStatus | null;
    imageStatusLoading: boolean;
}

// pre-start, agent, and preview all run in the preview variant stack
const VARIANT_FOR: Record<ComponentName, string> = {
    'pre-start': 'preview',
    'agent': 'preview',
    'preview': 'preview',
    'publish': 'publish',
};

function DetailedStatusBlock({ name, url, variant, imageStatus, imageStatusLoading }: DetailedStatusBlockProps) {
    const image = imageStatus?.images?.find(i => i.imageType === name);

    return (
        <div style={{
            padding: '0.5rem 0.75rem',
            backgroundColor: '#f9fafb',
            borderRadius: '6px',
            border: '1px solid #e5e7eb',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem'
        }}>
            {/* Main row: left (name + URL + image) | right (variant lifecycle) */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>

                {/* Left: name, URL, image status */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#111827' }}>
                        {name}
                    </span>
                    {url && (
                        <a href={url} target="_blank" rel="noopener noreferrer"
                            style={{ color: '#3b82f6', fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>
                            {url}
                        </a>
                    )}
                    {imageStatusLoading ? (
                        <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Loading image status…</span>
                    ) : image ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <StatusBadge value={image.match ? 'current' : 'stale'} green={['current']} red={['stale']} />
                            <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>deployed</span>
                            <code style={{ fontSize: '0.75rem', color: '#374151', backgroundColor: '#e5e7eb', padding: '0.125rem 0.375rem', borderRadius: '4px' }}>
                                {image.deployedTag}
                            </code>
                            {!image.match && (
                                <>
                                    <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>expected</span>
                                    <code style={{ fontSize: '0.75rem', color: '#92400e', backgroundColor: '#fef3c7', padding: '0.125rem 0.375rem', borderRadius: '4px' }}>
                                        {image.expectedTag}
                                    </code>
                                </>
                            )}
                        </div>
                    ) : (
                        <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>No image data</span>
                    )}
                </div>

                {/* Right: variant lifecycle */}
                {variant && variant.lifecycle && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem', flexShrink: 0 }}>
                        <StatusBadge value={variant.lifecycle.lifecycleState} green={['running']} red={['stopped', 'failed']} />
                        <span style={{ fontSize: '0.7rem', color: '#6b7280', fontFamily: 'monospace' }}>
                            {variant.lifecycle.reason}
                        </span>
                        <Timestamp iso={variant.lifecycle.stateChangedAt} style={{ fontSize: '0.7rem', color: '#9ca3af' }} />
                    </div>
                )}
            </div>
        </div>
    );
}

function formatCredits(n: number): string {
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function InitialPromptBlock({ prompt }: { prompt: string }) {
    const [expanded, setExpanded] = useState(false);
    const PREVIEW_LINES = 5;
    const lines = prompt.split('\n');
    const isTruncatable = lines.length > PREVIEW_LINES;
    const displayed = expanded || !isTruncatable
        ? prompt
        : lines.slice(0, PREVIEW_LINES).join('\n');

    return (
        <div style={{ padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
            <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>
                Initial Prompt
            </h4>
            <pre style={{
                margin: 0,
                fontSize: '0.875rem',
                color: '#374151',
                lineHeight: 1.6,
                fontFamily: 'inherit',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflowX: 'auto',
                ...(expanded || !isTruncatable ? {} : {
                    display: '-webkit-box',
                    WebkitLineClamp: PREVIEW_LINES,
                    WebkitBoxOrient: 'vertical' as const,
                    overflow: 'hidden'
                })
            }}>
                {displayed}
            </pre>
            {isTruncatable && (
                <button
                    type="button"
                    onClick={() => setExpanded(e => !e)}
                    style={{
                        marginTop: '0.5rem',
                        background: 'transparent',
                        border: 'none',
                        color: '#3b82f6',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        padding: 0
                    }}
                >
                    {expanded ? 'Show less ▴' : `Show all (${lines.length} lines) ▾`}
                </button>
            )}
        </div>
    );
}

type Grant = MgmtSubscriptionGrants['grants'][number];

function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

interface GrantItemProps {
    grant: Grant;
    isActive: boolean;
    collapsible?: boolean;
    showStatusBadge?: boolean;
    spend?: GrantBreakdown;
}

function GrantItem({ grant, isActive, collapsible = true, showStatusBadge = true, spend }: GrantItemProps) {
    const [expanded, setExpanded] = useState(true);
    const showDetails = !collapsible || expanded;
    const pctUsed = grant.creditsMax > 0 ? (grant.creditsSpent / grant.creditsMax) * 100 : 0;
    const barColor = pctUsed >= 90 ? '#dc2626' : pctUsed >= 70 ? '#d97706' : '#16a34a';

    return (
        <div style={{
            padding: '0.625rem 0.75rem',
            backgroundColor: isActive ? '#f0fdf4' : '#fff',
            borderRadius: '6px',
            border: `1px solid ${isActive ? '#bbf7d0' : '#e5e7eb'}`,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.4rem'
        }}>
            {/* Header row: credits + badges + percent — all inline */}
            <div
                onClick={collapsible ? () => setExpanded(e => !e) : undefined}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    flexWrap: 'wrap',
                    cursor: collapsible ? 'pointer' : 'default'
                }}
            >
                {collapsible && (
                    <span style={{ fontSize: '0.7rem', color: '#9ca3af', lineHeight: 1, width: '0.75rem' }}>
                        {expanded ? '▾' : '▸'}
                    </span>
                )}
                <span style={{ fontSize: '0.85rem', color: '#111827', fontWeight: 600 }}>
                    {formatCredits(grant.creditsSpent)} / {formatCredits(grant.creditsMax)} credits
                </span>
                {showStatusBadge && isActive && <StatusBadge value="active" green={['active']} />}
                {showStatusBadge && !isActive && grant.isAvailable && <StatusBadge value="available" green={['available']} />}
                {showStatusBadge && !grant.isAvailable && (
                    <StatusBadge
                        value={grant.finalState ?? 'spent'}
                        green={[]}
                        red={['expired', 'cancelled']}
                    />
                )}
                <StatusBadge value={grant.type} green={['recurring', 'paid']} red={[]} />
                {grant.source && (
                    <span style={{ fontSize: '0.7rem', color: '#6b7280', fontFamily: 'monospace' }}>{grant.source}</span>
                )}
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {spend && (
                        <>
                            <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: '#059669', fontWeight: 700 }}>
                                ${spend.totalSpend.toFixed(4)}
                            </span>
                            <span style={{ fontSize: '0.72rem', color: '#6b7280' }}>
                                {formatTokens(spend.totalTokens)} tokens
                            </span>
                            <span style={{ fontSize: '0.72rem', color: '#8b5cf6' }}>
                                {spend.totalRequests.toLocaleString()} reqs
                            </span>
                        </>
                    )}
                    <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                        {pctUsed.toFixed(1)}%
                    </span>
                </span>
            </div>

            {/* Progress bar — always visible */}
            <div style={{ height: '4px', backgroundColor: '#e5e7eb', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{
                    height: '100%',
                    width: `${Math.min(100, pctUsed)}%`,
                    backgroundColor: barColor,
                    borderRadius: '2px'
                }} />
            </div>

            {showDetails && (
                <>
                    <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.375rem' }}>
                            <span style={{ fontSize: '0.65rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Created:</span>
                            <Timestamp iso={grant.createdAt} style={{ fontSize: '0.75rem', color: '#374151' }} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.375rem' }}>
                            <span style={{ fontSize: '0.65rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Use Before:</span>
                            <Timestamp iso={grant.useBefore} style={{ fontSize: '0.75rem', color: '#374151' }} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.375rem', flex: 1, minWidth: 0 }}>
                            <span style={{ fontSize: '0.65rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>LLM Budget User:</span>
                            <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#374151', wordBreak: 'break-all' }}>
                                {grant.llmBudgetUserId}
                            </span>
                        </div>
                    </div>

                    {spend && spend.dailySpend.length > 0 && (
                        <div style={{ marginTop: '0.25rem' }}>
                            <SpendDailyTable days={spend.dailySpend} />
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

function ConsumedGrantsGroup({ grants, spendByUser }: { grants: Grant[]; spendByUser: Map<string, GrantBreakdown> }) {
    const [expanded, setExpanded] = useState(false);
    const totalSpent = grants.reduce((sum, g) => sum + g.creditsSpent, 0);
    const totalMax = grants.reduce((sum, g) => sum + g.creditsMax, 0);
    const totalDollars = grants.reduce(
        (sum, g) => sum + (spendByUser.get(g.llmBudgetUserId)?.totalSpend ?? 0),
        0
    );

    return (
        <div style={{
            border: '1px solid #e5e7eb',
            borderRadius: '6px',
            backgroundColor: '#fafafa',
            display: 'flex',
            flexDirection: 'column'
        }}>
            <button
                type="button"
                onClick={() => setExpanded(e => !e)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.625rem 0.75rem',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%'
                }}
            >
                <span style={{ fontSize: '0.7rem', color: '#9ca3af', lineHeight: 1, width: '0.75rem' }}>
                    {expanded ? '▾' : '▸'}
                </span>
                <StatusBadge value={`consumed (${grants.length})`} green={[]} red={[]} />
                <StatusBadge value="credit-pack" green={[]} red={[]} />
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {totalDollars > 0 && (
                        <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: '#059669', fontWeight: 700 }}>
                            ${totalDollars.toFixed(2)}
                        </span>
                    )}
                    <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                        {formatCredits(totalSpent)} / {formatCredits(totalMax)} credits used
                    </span>
                </span>
            </button>
            {expanded && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0 0.5rem 0.5rem' }}>
                    {grants.map(grant => (
                        <GrantItem
                            key={grant.id}
                            grant={grant}
                            isActive={false}
                            collapsible={false}
                            showStatusBadge={false}
                            spend={spendByUser.get(grant.llmBudgetUserId)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

interface SubscriptionBlockProps {
    subscription: MgmtSubscription | null;
    subscriptionLoading: boolean;
    grants: MgmtSubscriptionGrants | null;
    grantsLoading: boolean;
    llmSpend?: LlmSpendData | null;
    llmSpendLoading?: boolean;
    llmSpendError?: string | null;
}

function SubscriptionBlock({ subscription, subscriptionLoading, grants, grantsLoading, llmSpend, llmSpendLoading, llmSpendError }: SubscriptionBlockProps) {
    const isLoading = subscriptionLoading || grantsLoading;
    const spendByUser = React.useMemo(() => {
        const map = new Map<string, GrantBreakdown>();
        llmSpend?.grantBreakdowns.forEach(g => map.set(g.grantUserId, g));
        return map;
    }, [llmSpend]);

    const { availableGrants, consumedGrants } = React.useMemo(() => {
        if (!grants) return { availableGrants: [] as Grant[], consumedGrants: [] as Grant[] };
        const sorted = [...grants.grants]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return {
            availableGrants: sorted.filter(g => g.isAvailable),
            consumedGrants: sorted.filter(g => !g.isAvailable),
        };
    }, [grants]);

    return (
        <div style={{ padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
            <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>
                Subscription Details
            </h4>
            {isLoading && !subscription && !grants ? (
                <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>Loading subscription details…</span>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {/* Subscription fields */}
                    {subscription && (
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                            gap: '0.75rem'
                        }}>
                            <Field label="Plan">
                                <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{subscription.plan}</span>
                            </Field>
                            <Field label="Sub Status">
                                <StatusBadge value={subscription.status} green={['active']} red={['inactive', 'cancelled', 'expired']} />
                            </Field>
                        </div>
                    )}

                    {/* LLM spend totals */}
                    {llmSpendError ? (
                        <div style={{
                            padding: '0.5rem 0.75rem',
                            backgroundColor: '#fef2f2',
                            border: '1px solid #fecaca',
                            borderRadius: '6px',
                            fontSize: '0.78rem',
                            color: '#dc2626'
                        }}>
                            Failed to load LLM spend: {llmSpendError}
                        </div>
                    ) : llmSpendLoading && !llmSpend ? (
                        <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Loading LLM spend data…</span>
                    ) : llmSpend ? (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '1.5rem',
                            flexWrap: 'wrap',
                            padding: '0.5rem 0.75rem',
                            backgroundColor: '#fff',
                            borderRadius: '6px',
                            border: '1px solid #e5e7eb',
                            fontSize: '0.8rem'
                        }}>
                            <span>
                                Total Spend:{' '}
                                <strong style={{ color: '#059669' }}>${llmSpend.totalSpend.toFixed(2)}</strong>
                            </span>
                            <span style={{ color: '#6b7280' }}>
                                {formatTokens(llmSpend.totalTokens)} tokens
                            </span>
                            <span style={{ color: '#6b7280' }}>
                                {llmSpend.totalRequests.toLocaleString()} requests
                            </span>
                            {llmSpend.truncated && (
                                <span style={{ marginLeft: 'auto', color: '#92400e', fontSize: '0.72rem' }}>
                                    ⚠ truncated — {llmSpend.docCount} matched, showing first 500
                                </span>
                            )}
                        </div>
                    ) : null}

                    {/* Grants list — all grants, newest first */}
                    {grantsLoading && !grants ? (
                        <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Loading grant data…</span>
                    ) : grants && grants.grants.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Grants ({grants.grants.length})
                            </div>
                            {availableGrants.map(grant => (
                                <GrantItem
                                    key={grant.id}
                                    grant={grant}
                                    isActive={grant.id === grants.activeGrant}
                                    spend={spendByUser.get(grant.llmBudgetUserId)}
                                />
                            ))}
                            {consumedGrants.length > 0 && (
                                <ConsumedGrantsGroup grants={consumedGrants} spendByUser={spendByUser} />
                            )}
                        </div>
                    ) : grants ? (
                        <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>No grants found</span>
                    ) : null}
                </div>
            )}
        </div>
    );
}

export default function AppDetailsPanel({ appId, refreshKey, onRefresh, onGrantsLoaded, onAppLoaded, llmSpend, llmSpendLoading, llmSpendError }: Props) {
    const [app, setApp] = useState<MgmtAppDetails | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [imageStatus, setImageStatus] = useState<MgmtImageStatus | null>(null);
    const [imageStatusLoading, setImageStatusLoading] = useState(false);
    const [subscription, setSubscription] = useState<MgmtSubscription | null>(null);
    const [subscriptionLoading, setSubscriptionLoading] = useState(false);
    const [grants, setGrants] = useState<MgmtSubscriptionGrants | null>(null);
    const [grantsLoading, setGrantsLoading] = useState(false);
    const [domainErrors, setDomainErrors] = useState<Record<string, MgmtDomainError | null>>({});
    const [domainErrorLoading, setDomainErrorLoading] = useState<Record<string, boolean>>({});
    const [domainErrorMsg, setDomainErrorMsg] = useState<Record<string, string>>({});
    const [reloadPhase, setReloadPhase] = useState<'idle' | 'calling' | 'polling'>('idle');
    const [reloadStatusText, setReloadStatusText] = useState('');
    const [reloadError, setReloadError] = useState<string | null>(null);
    const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Stable refs for parent callbacks — avoids including them in the subscription
    // useEffect dep array (which would re-run on every poll tick if passed as new function refs).
    const onGrantsLoadedRef = useRef(onGrantsLoaded);
    onGrantsLoadedRef.current = onGrantsLoaded;
    const onAppLoadedRef = useRef(onAppLoaded);
    onAppLoadedRef.current = onAppLoaded;

    function stopPolling() {
        if (pollingRef.current) {
            clearTimeout(pollingRef.current);
            pollingRef.current = null;
        }
    }

    // Clean up polling on unmount
    useEffect(() => () => stopPolling(), []);

    // Reset reload state when appId changes
    useEffect(() => {
        stopPolling();
        setReloadPhase('idle');
        setReloadStatusText('');
        setReloadError(null);
        setSubscription(null);
        setGrants(null);
    }, [appId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Fetch subscription + grants when subscriptionId becomes known.
    useEffect(() => {
        const subId = app?.subscriptionId;
        if (!subId) return;

        setSubscriptionLoading(true);
        setGrantsLoading(true);

        const controller = new AbortController();

        fetch(`/api/mgmt/subscriptions/${encodeURIComponent(subId)}`, { signal: controller.signal })
            .then(async res => {
                const data = await res.json();
                if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
                return data as MgmtSubscription;
            })
            .then(data => setSubscription(data))
            .catch(err => { if (err.name !== 'AbortError') console.warn('[AppDetailsPanel] subscription fetch failed', err); })
            .finally(() => { if (!controller.signal.aborted) setSubscriptionLoading(false); });

        fetch(`/api/mgmt/subscriptions/${encodeURIComponent(subId)}/grants`, { signal: controller.signal })
            .then(async res => {
                const data = await res.json();
                if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
                return data as MgmtSubscriptionGrants;
            })
            .then(data => { setGrants(data); onGrantsLoadedRef.current?.(subId, data); })
            .catch(err => { if (err.name !== 'AbortError') console.warn('[AppDetailsPanel] grants fetch failed', err); })
            .finally(() => { if (!controller.signal.aborted) setGrantsLoading(false); });

        return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [app?.subscriptionId]);

    const fetchDomainError = useCallback(async function fetchDomainError(fqdn: string) {
        if (!app?.subscriptionId || !app?.systemId) return;
        setDomainErrorLoading(prev => ({ ...prev, [fqdn]: true }));
        setDomainErrorMsg(prev => ({ ...prev, [fqdn]: '' }));
        try {
            const params = new URLSearchParams({ fqdn, subscriptionId: app.subscriptionId, systemId: app.systemId });
            const res = await fetch(`/api/mgmt/apps/${encodeURIComponent(appId)}/domain-error?${params}`);
            const data = await res.json();
            if (!res.ok) {
                setDomainErrors(prev => ({ ...prev, [fqdn]: null }));
                setDomainErrorMsg(prev => ({ ...prev, [fqdn]: data.error ?? `HTTP ${res.status}` }));
            } else {
                setDomainErrors(prev => ({ ...prev, [fqdn]: data as MgmtDomainError }));
            }
        } catch (err) {
            setDomainErrors(prev => ({ ...prev, [fqdn]: null }));
            setDomainErrorMsg(prev => ({ ...prev, [fqdn]: err instanceof Error ? err.message : 'Request failed' }));
        } finally {
            setDomainErrorLoading(prev => ({ ...prev, [fqdn]: false }));
        }
    }, [app?.subscriptionId, app?.systemId, appId]);

    async function handleReload() {
        if (!app) return;
        stopPolling();
        setReloadPhase('calling');
        setReloadStatusText('');
        setReloadError(null);

        try {
            const res = await fetch(`/api/mgmt/apps/${encodeURIComponent(appId)}/reload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscriptionId: app.subscriptionId, systemId: app.systemId })
            });
            const data = await res.json();

            if (!res.ok) {
                setReloadError(data.error ?? `Reload failed (HTTP ${res.status})`);
                setReloadPhase('idle');
                return;
            }

            setReloadStatusText(data.status ?? 'unknown');
            setReloadPhase('polling');

            // Cap polling so we don't spin forever if the deploy stalls.
            // 60 attempts * 7s ≈ 7 minutes — well past a normal reload window.
            const POLL_INTERVAL_MS = 7000;
            const MAX_POLL_ATTEMPTS = 60;
            let tryCount = 0;

            const poll = () => {
                if (tryCount >= MAX_POLL_ATTEMPTS) {
                    stopPolling();
                    setReloadPhase('idle');
                    setReloadError(`Reload timed out after ${MAX_POLL_ATTEMPTS} polls (~${Math.round((MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 60000)} min). Refresh manually to recheck.`);
                    return;
                }
                pollingRef.current = setTimeout(async () => {
                    try {
                        const pollParams = new URLSearchParams();
                        if (app.subscriptionId) pollParams.set('subscriptionId', app.subscriptionId);
                        if (app.systemId) pollParams.set('systemId', app.systemId);
                        pollParams.set('tryCount', String(tryCount++));
                        const pollRes = await fetch(`/api/mgmt/apps/${encodeURIComponent(appId)}/image-status?${pollParams}`);
                        const pollData: MgmtImageStatus = await pollRes.json();
                        setImageStatus(pollData);
                        setReloadStatusText(pollData.status);

                        if (pollData.status === 'current') {
                            stopPolling();
                            setReloadPhase('idle');
                            onRefresh?.();
                        } else if (pollingRef.current !== null) {
                            poll();
                        }
                    } catch (err) {
                        console.warn('[AppDetailsPanel] Poll error (will retry)', err);
                        if (pollingRef.current !== null) poll();
                    }
                }, POLL_INTERVAL_MS);
            };
            poll();
        } catch (err) {
            console.error('[AppDetailsPanel] Reload request failed', err);
            setReloadError(err instanceof Error ? err.message : 'Reload request failed');
            setReloadPhase('idle');
        }
    }

    useEffect(() => {
        if (!appId) return;

        setApp(null);
        onAppLoadedRef.current?.(null);
        setImageStatus(null);
        setLoading(true);
        setImageStatusLoading(true);
        setError(null);
        setDomainErrors({});
        setDomainErrorLoading({});
        setDomainErrorMsg({});

        fetch(`/api/mgmt/apps/${encodeURIComponent(appId)}`)
            .then(async res => {
                if (res.status >= 500) throw new Error(`Internal error (${res.status}) — the management service may be temporarily unavailable`);
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
                return data as MgmtAppDetails;
            })
            .then(appData => {
                setApp(appData);
                onAppLoadedRef.current?.(appData);
                setLoading(false);

                const params = new URLSearchParams();
                if (appData.subscriptionId) params.set('subscriptionId', appData.subscriptionId);
                if (appData.systemId) params.set('systemId', appData.systemId);

                return fetch(`/api/mgmt/apps/${encodeURIComponent(appId)}/image-status?${params}`)
                    .then(async res => {
                        if (res.status >= 500) throw new Error(`Internal error (${res.status})`);
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
                        return data as MgmtImageStatus;
                    })
                    .then(setImageStatus)
                    .catch(() => setImageStatus(null))
                    .finally(() => setImageStatusLoading(false));
            })
            .catch(err => {
                setError(err instanceof Error ? err.message : String(err));
                setLoading(false);
                setImageStatusLoading(false);
            });

        return () => stopPolling();
    }, [appId, refreshKey]);

    if (loading) {
        return (
            <div style={{ padding: '1.5rem', textAlign: 'center', backgroundColor: '#f9fafb', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
                <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>Loading app details...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div style={{ padding: '1rem', backgroundColor: '#fef2f2', borderRadius: '6px', border: '1px solid #fecaca', fontSize: '0.875rem', color: '#991b1b' }}>
                Failed to load app details: {error}
            </div>
        );
    }

    if (!app) return null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#111827' }}>
                    App Details
                </h3>
                <span style={{
                    fontSize: '0.75rem',
                    color: '#6b7280',
                    backgroundColor: '#f3f4f6',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    padding: '0.25rem 0.625rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.375rem'
                }}>
                    🕐 Timestamps are shown in the local time zone — hover the timestamp to see the ISO
                </span>
            </div>

            {/* Core info grid — includes static fields + variables */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: '1rem',
                padding: '1rem',
                backgroundColor: '#f9fafb',
                borderRadius: '6px',
                border: '1px solid #e5e7eb'
            }}>
                <Field label="Status">
                    <StatusBadge value={app.status} green={['active']} red={['inactive', 'deleted']} />
                </Field>
                <Field label="Published">
                    <StatusBadge value={app.published ? 'yes' : 'no'} green={['yes']} red={['no']} />
                </Field>
                <Field label="Shopper ID">
                    <a
                        href={`https://crm.int.godaddy.com/app/_/customer/search/results?shopperId=${encodeURIComponent(app.shopperId)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                    >{app.shopperId}</a>
                </Field>
                {subscription?.customerId && (
                    <Field label="Customer ID">
                        <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>{subscription.customerId}</span>
                    </Field>
                )}
                <Field label="Subscription ID">
                    <a
                        href={`/apps/${encodeURIComponent(app.id)}/subscriptions/${encodeURIComponent(app.subscriptionId)}/add-credit-pack`}
                        style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                    >{app.subscriptionId}</a>
                </Field>
                <Field label="Updated">
                    <Timestamp iso={app.updatedAt} style={{ fontSize: '0.8rem' }} />
                </Field>
                {Object.entries(app.variables)
                    .filter(([key]) => key !== 'initialPrompt' && key !== 'airoSubscriptionId')
                    .map(([key, value]) => (
                        <Field key={key} label={camelToLabel(key)}>
                            {ISO_RE.test(value)
                                ? <Timestamp iso={value} style={{ fontSize: '0.8rem' }} />
                                : <span style={{ wordBreak: 'break-word' }}>{value}</span>
                            }
                        </Field>
                    ))}
            </div>

            {/* Initial Prompt — shown right under core App Details */}
            {app.variables.initialPrompt && (
                <InitialPromptBlock prompt={app.variables.initialPrompt} />
            )}

            {/* Detailed Status */}
            <div style={{ padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                    <h4 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>Detailed Status</h4>
                    {imageStatus && (
                        <StatusBadge value={imageStatus.status} green={['current']} red={['stale', 'unknown', 'unavailable']} />
                    )}
                    {app && (imageStatus?.status === 'stale' || reloadPhase !== 'idle') && (
                        <button
                            onClick={handleReload}
                            disabled={reloadPhase !== 'idle'}
                            style={{
                                marginLeft: 'auto',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.375rem',
                                padding: '0.375rem 0.75rem',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                color: reloadPhase !== 'idle' ? '#6b7280' : 'white',
                                backgroundColor: reloadPhase !== 'idle' ? '#f3f4f6' : '#3b82f6',
                                border: '1px solid',
                                borderColor: reloadPhase !== 'idle' ? '#d1d5db' : '#3b82f6',
                                borderRadius: '6px',
                                cursor: reloadPhase !== 'idle' ? 'not-allowed' : 'pointer',
                                whiteSpace: 'nowrap'
                            }}
                        >
                            <ReloadIcon spinning={reloadPhase !== 'idle'} />
                            {reloadPhase === 'idle'
                                ? 'Update to Latest'
                                : `Status: ${reloadStatusText || '…'}`
                            }
                        </button>
                    )}
                </div>
                {reloadError && (
                    <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '0.8rem', color: '#dc2626' }}>
                        {reloadError}
                    </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.5rem' }}>
                    {COMPONENTS.map(name => (
                        <DetailedStatusBlock
                            key={name}
                            name={name}
                            url={app.urls[name]}
                            variant={app.variantsWithLifecycle.find(v => v.variant === VARIANT_FOR[name])}
                            imageStatus={imageStatus}
                            imageStatusLoading={imageStatusLoading}
                        />
                    ))}

                    {/* Custom domains */}
                    {app.domains.map(domain => {
                        const isErrorStatus = ['inactive', 'failed', 'error'].includes(domain.status);
                        const domainErr = domainErrors[domain.fqdn];
                        const isLoadingErr = domainErrorLoading[domain.fqdn] ?? false;
                        const errMsg = domainErrorMsg[domain.fqdn];
                        return (
                            <div key={domain.fqdn} style={{
                                padding: '0.75rem 1rem',
                                backgroundColor: '#f9fafb',
                                borderRadius: '6px',
                                border: '1px solid #e5e7eb',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.5rem'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                            <a href={`https://${domain.fqdn}`} target="_blank" rel="noopener noreferrer"
                                                style={{ fontSize: '0.875rem', fontWeight: 700, color: '#3b82f6', textDecoration: 'none', wordBreak: 'break-all' }}>
                                                {domain.fqdn}
                                            </a>
                                            {domain.isPrimary && (
                                                <StatusBadge value="primary" green={['primary']} />
                                            )}
                                            <StatusBadge value={domain.status} green={['active']} red={['inactive', 'failed', 'error']} />
                                            {domain.domainType && (
                                                <span style={{ fontSize: '0.7rem', color: '#6b7280', fontFamily: 'monospace' }}>
                                                    {domain.domainType}
                                                </span>
                                            )}
                                            {isErrorStatus && app.subscriptionId && app.systemId && (
                                                <button
                                                    onClick={() => fetchDomainError(domain.fqdn)}
                                                    disabled={isLoadingErr}
                                                    style={{
                                                        marginLeft: '0.25rem',
                                                        padding: '0.125rem 0.5rem',
                                                        fontSize: '0.7rem',
                                                        fontWeight: 600,
                                                        color: isLoadingErr ? '#6b7280' : '#dc2626',
                                                        backgroundColor: isLoadingErr ? '#f3f4f6' : '#fef2f2',
                                                        border: '1px solid',
                                                        borderColor: isLoadingErr ? '#d1d5db' : '#fecaca',
                                                        borderRadius: '4px',
                                                        cursor: isLoadingErr ? 'not-allowed' : 'pointer',
                                                        whiteSpace: 'nowrap'
                                                    }}
                                                >
                                                    {isLoadingErr ? 'Loading…' : 'Error Details'}
                                                </button>
                                            )}
                                        </div>
                                        <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#374151', wordBreak: 'break-all' }}>
                                            custom domain
                                        </span>
                                    </div>
                                    <div style={{ flexShrink: 0 }}>
                                        <Timestamp iso={domain.updatedAt} style={{ fontSize: '0.7rem', color: '#9ca3af' }} />
                                    </div>
                                </div>

                                {isErrorStatus && errMsg && (
                                    <div style={{ padding: '0.5rem 0.75rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '4px', fontSize: '0.8rem', color: '#dc2626' }}>
                                        {errMsg}
                                    </div>
                                )}

                                {isErrorStatus && domainErr && (
                                    <div style={{ padding: '0.75rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '4px', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#991b1b' }}>
                                                {domainErr.error.code}
                                            </span>
                                            <span style={{ fontSize: '0.75rem', color: '#dc2626' }}>
                                                {domainErr.error.message}
                                            </span>
                                            <button
                                                onClick={() => setDomainErrors(prev => ({ ...prev, [domain.fqdn]: null }))}
                                                style={{
                                                    marginLeft: 'auto',
                                                    padding: '0.125rem 0.375rem',
                                                    fontSize: '0.7rem',
                                                    color: '#991b1b',
                                                    backgroundColor: 'transparent',
                                                    border: '1px solid #fecaca',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer',
                                                    lineHeight: 1
                                                }}
                                            >
                                                ✕
                                            </button>
                                        </div>
                                        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                                            <div>
                                                <div style={{ fontSize: '0.65rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Action</div>
                                                <span style={{ fontSize: '0.75rem', color: '#374151', fontFamily: 'monospace' }}>{domainErr.error.action}</span>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: '0.65rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Can Retry</div>
                                                <StatusBadge value={domainErr.error.canRetry ? 'yes' : 'no'} green={['yes']} red={['no']} />
                                            </div>
                                            <div>
                                                <div style={{ fontSize: '0.65rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Failed Step</div>
                                                <span style={{ fontSize: '0.75rem', color: '#374151', fontFamily: 'monospace' }}>{domainErr.failedStep}</span>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: '0.65rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Job ID</div>
                                                <span style={{ fontSize: '0.75rem', color: '#374151', fontFamily: 'monospace' }}>{domainErr.jobId}</span>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: '0.65rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Completed At</div>
                                                <Timestamp iso={domainErr.completedAt} style={{ fontSize: '0.75rem', color: '#374151' }} />
                                            </div>
                                        </div>
                                        {domainErr.affectedDomains.length > 0 && (
                                            <div>
                                                <div style={{ fontSize: '0.65rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Affected Domains</div>
                                                <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                                                    {domainErr.affectedDomains.map(d => (
                                                        <code key={d} style={{ fontSize: '0.75rem', color: '#374151', backgroundColor: '#fee2e2', padding: '0.125rem 0.375rem', borderRadius: '4px' }}>
                                                            {d}
                                                        </code>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Subscription Details */}
            {app.subscriptionId && (
                <SubscriptionBlock
                    subscription={subscription}
                    subscriptionLoading={subscriptionLoading}
                    grants={grants}
                    grantsLoading={grantsLoading}
                    llmSpend={llmSpend}
                    llmSpendLoading={llmSpendLoading}
                    llmSpendError={llmSpendError}
                />
            )}

        </div>
    );
}
