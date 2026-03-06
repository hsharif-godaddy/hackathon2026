'use client';

import React, { useEffect, useRef, useState } from 'react';

import type { MgmtAppDetails, MgmtImageStatus, MgmtVariantWithLifecycle } from '@/lib/mgmt-control-plane-adapter';

interface Props {
    appId: string;
    refreshKey: number;
    onRefresh?: () => void;
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

function formatLocal(iso: string): string {
    return new Date(iso).toLocaleString('en-US', {
        month: 'short', day: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
}

function Timestamp({ iso, style }: { iso: string; style?: React.CSSProperties }) {
    return (
        <span title={iso} style={{ cursor: 'default', ...style }}>
            {formatLocal(iso)}
        </span>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <div style={{ fontSize: '0.7rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                {label}
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
            padding: '0.75rem 1rem',
            backgroundColor: '#f9fafb',
            borderRadius: '6px',
            border: '1px solid #e5e7eb',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem'
        }}>
            {/* Main row: left (name + URL + image) | right (variant lifecycle) */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>

                {/* Left: name, URL, image status */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', flex: 1, minWidth: 0 }}>
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
                {variant && (
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

export default function AppDetailsPanel({ appId, refreshKey, onRefresh }: Props) {
    const [app, setApp] = useState<MgmtAppDetails | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [imageStatus, setImageStatus] = useState<MgmtImageStatus | null>(null);
    const [imageStatusLoading, setImageStatusLoading] = useState(false);
    const [reloadPhase, setReloadPhase] = useState<'idle' | 'calling' | 'polling'>('idle');
    const [reloadStatusText, setReloadStatusText] = useState('');
    const [reloadError, setReloadError] = useState<string | null>(null);
    const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    }, [appId]); // eslint-disable-line react-hooks/exhaustive-deps

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

            let tryCount = 0;

            const poll = () => {
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
                }, 7000);
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
        setImageStatus(null);
        setLoading(true);
        setImageStatusLoading(true);
        setError(null);

        fetch(`/api/mgmt/apps/${encodeURIComponent(appId)}`)
            .then(async res => {
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
                return data as MgmtAppDetails;
            })
            .then(appData => {
                setApp(appData);
                setLoading(false);

                const params = new URLSearchParams();
                if (appData.subscriptionId) params.set('subscriptionId', appData.subscriptionId);
                if (appData.systemId) params.set('systemId', appData.systemId);

                return fetch(`/api/mgmt/apps/${encodeURIComponent(appId)}/image-status?${params}`)
                    .then(async res => {
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
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
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
                <Field label="Cell">
                    <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{app.cellId}</span>
                </Field>
                <Field label="Composition">
                    {app.compositionId} {app.compositionVersion}
                </Field>
                <Field label="Provision Type">
                    <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{app.provisionType}</span>
                </Field>
                <Field label="Shopper ID">
                    <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{app.shopperId}</span>
                </Field>
                <Field label="System ID">
                    <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{app.systemId}</span>
                </Field>
                <Field label="Subscription ID">
                    <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{app.subscriptionId}</span>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
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
                    {app.domains.map(domain => (
                        <div key={domain.fqdn} style={{
                            padding: '0.75rem 1rem',
                            backgroundColor: '#f9fafb',
                            borderRadius: '6px',
                            border: '1px solid #e5e7eb',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '1rem'
                        }}>
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
                                </div>
                                <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#374151', wordBreak: 'break-all' }}>
                                    custom domain
                                </span>
                            </div>
                            <div style={{ flexShrink: 0 }}>
                                <Timestamp iso={domain.updatedAt} style={{ fontSize: '0.7rem', color: '#9ca3af' }} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Initial Prompt */}
            {app.variables.initialPrompt && (
                <div style={{ padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
                    <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>Initial Prompt</h4>
                    <pre style={{
                        margin: 0,
                        fontSize: '0.875rem',
                        color: '#374151',
                        lineHeight: 1.6,
                        fontFamily: 'inherit',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        overflowX: 'auto'
                    }}>
                        {app.variables.initialPrompt}
                    </pre>
                </div>
            )}
        </div>
    );
}
