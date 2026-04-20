'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
    DEFAULT_CARE_LOOKBACK_MINUTES,
    type CareConversationInfo,
    type CareConversationItem,
    type CareConversationLeg,
    type CareConversationsResponse,
    type CareTranscriptMessage,
    type CareTranscriptResponse,
} from '@/lib/care-types';
import { formatTimestamp } from '@/lib/date-utils';

interface Props {
    shopperId: string | null | undefined;
    refreshKey: number;
    onRefresh?: () => void;
}

export default function CarePanel({ shopperId, refreshKey, onRefresh }: Props) {
    const [items, setItems] = useState<CareConversationItem[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});

    const sortedItems = useMemo(() => {
        if (!items) return null;
        return [...items].sort((a, b) => {
            const ta = Date.parse(a.conversationInfo.createdAt || '') || 0;
            const tb = Date.parse(b.conversationInfo.createdAt || '') || 0;
            return tb - ta;
        });
    }, [items]);

    const fetchList = useCallback(async () => {
        if (!shopperId) {
            setItems(null);
            setError(null);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(
                `/api/care/conversations?shopperId=${encodeURIComponent(shopperId)}&lastMinutes=${DEFAULT_CARE_LOOKBACK_MINUTES}`,
                { cache: 'no-store' }
            );
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data?.error || `HTTP ${res.status}`);
            }
            const payload = data as CareConversationsResponse;
            setItems(payload.data || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setItems(null);
        } finally {
            setLoading(false);
        }
    }, [shopperId]);

    useEffect(() => {
        fetchList();
    }, [fetchList, refreshKey]);

    if (!shopperId) {
        return (
            <div style={{ padding: '1rem', color: '#6b7280' }}>
                Shopper ID not yet available — load app details first.
            </div>
        );
    }

    return (
        <div style={{ padding: '0 0.25rem' }}>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '1rem',
                    gap: '0.5rem',
                    flexWrap: 'wrap',
                }}
            >
                <div style={{ fontSize: '0.875rem', color: '#374151' }}>
                    Conversations for shopper <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>{shopperId}</code>
                    <span style={{ marginLeft: '0.5rem', color: '#6b7280', fontSize: '0.75rem' }}>(last 30 days)</span>
                </div>
                <button
                    onClick={() => onRefresh?.()}
                    disabled={loading}
                    style={{
                        padding: '0.375rem 0.875rem',
                        background: '#3b82f6',
                        color: 'white',
                        border: 'none',
                        borderRadius: 6,
                        fontSize: '0.813rem',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        opacity: loading ? 0.6 : 1,
                    }}
                >
                    {loading ? 'Refreshing…' : 'Refresh'}
                </button>
            </div>

            {error && (
                <div
                    style={{
                        padding: '0.75rem 1rem',
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        color: '#991b1b',
                        borderRadius: 6,
                        marginBottom: '1rem',
                        fontSize: '0.813rem',
                    }}
                >
                    Failed to load conversations: {error}
                </div>
            )}

            {loading && !items && (
                <div style={{ padding: '2rem', color: '#6b7280', textAlign: 'center' }}>Loading conversations…</div>
            )}

            {!loading && sortedItems && sortedItems.length === 0 && (
                <div style={{ padding: '2rem', color: '#6b7280', textAlign: 'center' }}>
                    No conversations found in the selected window.
                </div>
            )}

            {sortedItems && sortedItems.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {sortedItems.map(item => {
                        // ucid is the stable per-conversation identifier and the only
                        // field guaranteed to be present (see CareConversationInfo).
                        // Use it for both the React key and the expand-state map so
                        // they can't drift out of sync when `id` is also defined.
                        const { ucid } = item.conversationInfo;
                        return (
                            <ConversationCard
                                key={ucid}
                                info={item.conversationInfo}
                                expanded={!!expanded[ucid]}
                                onToggle={() =>
                                    setExpanded(prev => ({
                                        ...prev,
                                        [ucid]: !prev[ucid],
                                    }))
                                }
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function ConversationCard({
    info,
    expanded,
    onToggle,
}: {
    info: CareConversationInfo;
    expanded: boolean;
    onToggle: () => void;
}) {
    const legs = info.conversations || [];
    const duration = useMemo(() => formatDuration(info.durationSeconds), [info.durationSeconds]);

    return (
        <div
            style={{
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                background: 'white',
                overflow: 'hidden',
            }}
        >
            <button
                onClick={onToggle}
                style={{
                    width: '100%',
                    background: '#f9fafb',
                    border: 'none',
                    borderBottom: expanded ? '1px solid #e5e7eb' : 'none',
                    padding: '0.75rem 1rem',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.375rem',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.75rem' }}>{expanded ? '▾' : '▸'}</span>
                    <Badge color="#1d4ed8" bg="#dbeafe">{info.app || 'unknown app'}</Badge>
                    <Badge color="#6b21a8" bg="#f3e8ff">{info.channel || info.platform || 'chat'}</Badge>
                    {info.market && <Badge color="#374151" bg="#e5e7eb">{info.market}</Badge>}
                    {info.deviceInfo && <Badge color="#374151" bg="#e5e7eb">{info.deviceInfo}</Badge>}
                    <Badge color="#065f46" bg="#d1fae5">{legs.length} leg{legs.length === 1 ? '' : 's'}</Badge>
                    {duration && <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{duration}</span>}
                    <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#6b7280' }}>
                        {info.createdAt ? formatTimestamp(info.createdAt) : ''}
                    </span>
                </div>
                {info.summary && (
                    <div style={{ fontSize: '0.813rem', color: '#374151', lineHeight: 1.5 }}>
                        {info.summary}
                    </div>
                )}
                <div style={{ fontSize: '0.7rem', color: '#9ca3af', fontFamily: 'monospace' }}>
                    ucid: {info.ucid}
                </div>
            </button>
            {expanded && (
                <div style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {info.location && (
                        <div style={{ fontSize: '0.75rem', color: '#6b7280', wordBreak: 'break-all' }}>
                            <strong style={{ color: '#374151' }}>Location:</strong> {info.location}
                        </div>
                    )}
                    {legs.map(leg => (
                        <LegBlock key={`${leg.contactId}-${leg.agentId || 'na'}`} leg={leg} />
                    ))}
                </div>
            )}
        </div>
    );
}

function LegBlock({ leg }: { leg: CareConversationLeg }) {
    const [open, setOpen] = useState(false);
    const [transcript, setTranscript] = useState<CareTranscriptMessage[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [accessDenied, setAccessDenied] = useState(false);
    const duration = formatDuration(leg.durationSeconds);

    const loadTranscript = useCallback(async () => {
        if (!leg.contactId) return;
        setLoading(true);
        setError(null);
        setAccessDenied(false);
        try {
            const res = await fetch(
                `/api/care/transcripts/${encodeURIComponent(leg.contactId)}?includeSurveyResponses=true`,
                { cache: 'no-store' }
            );
            if (res.status === 401 || res.status === 403) {
                setAccessDenied(true);
                return;
            }
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
            const payload = data as CareTranscriptResponse;
            setTranscript(payload.data?.transcripts || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [leg.contactId]);

    function toggle() {
        const next = !open;
        setOpen(next);
        if (next && !transcript && !loading) {
            loadTranscript();
        }
    }

    return (
        <div
            style={{
                border: '1px solid #e5e7eb',
                borderRadius: 6,
                background: '#fafafa',
                overflow: 'hidden',
            }}
        >
            <button
                onClick={toggle}
                style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    padding: '0.625rem 0.75rem',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.75rem' }}>{open ? '▾' : '▸'}</span>
                    <Badge color="#374151" bg="#e5e7eb">{leg.state || 'UNKNOWN'}</Badge>
                    <Badge color="#1d4ed8" bg="#dbeafe">{leg.supportLevel || leg.agentType || 'agent'}</Badge>
                    {duration && <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{duration}</span>}
                    <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#6b7280' }}>
                        {leg.conversationStartTimestamp ? formatTimestamp(leg.conversationStartTimestamp) : ''}
                    </span>
                </div>
                <div style={{ fontSize: '0.7rem', color: '#9ca3af', fontFamily: 'monospace' }}>
                    contactId: {leg.contactId}
                </div>
            </button>
            {open && (
                <div style={{ padding: '0.75rem', borderTop: '1px solid #e5e7eb', background: 'white' }}>
                    {loading && <div style={{ color: '#6b7280', fontSize: '0.813rem' }}>Loading transcript…</div>}
                    {accessDenied && (
                        <div style={{ color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', padding: '0.5rem 0.75rem', borderRadius: 4, fontSize: '0.813rem' }}>
                            Access denied — you don&apos;t have permission to view this transcript.
                        </div>
                    )}
                    {error && !accessDenied && (
                        <div style={{ color: '#991b1b', fontSize: '0.813rem' }}>
                            Failed to load transcript: {error}
                        </div>
                    )}
                    {transcript && transcript.length === 0 && (
                        <div style={{ color: '#6b7280', fontSize: '0.813rem' }}>No messages in transcript.</div>
                    )}
                    {transcript && transcript.length > 0 && (
                        <TranscriptList messages={transcript} />
                    )}
                </div>
            )}
        </div>
    );
}

function TranscriptList({ messages }: { messages: CareTranscriptMessage[] }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {messages.map(msg => (
                <div
                    key={msg.messageId}
                    style={{
                        padding: '0.5rem 0.75rem',
                        background: roleBackground(msg.participantRole),
                        borderRadius: 6,
                        border: '1px solid #e5e7eb',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#111827' }}>
                            {msg.participantName || msg.participantRole || 'Unknown'}
                        </span>
                        {msg.source && <Badge color="#6b7280" bg="#f3f4f6">{msg.source}</Badge>}
                        <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: '#9ca3af' }}>
                            {msg.absoluteTime ? formatTimestamp(msg.absoluteTime) : ''}
                        </span>
                    </div>
                    {msg.content && (
                        <div style={{ fontSize: '0.813rem', color: '#374151', whiteSpace: 'pre-wrap' }}>
                            {msg.content}
                        </div>
                    )}
                    {msg.attachments && msg.attachments.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.375rem' }}>
                            {msg.attachments.map((a, idx) => (
                                <a
                                    key={`${msg.messageId}-att-${idx}`}
                                    href={a.attachmentUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ fontSize: '0.75rem', color: '#3b82f6' }}
                                >
                                    📎 {a.attachmentName || a.attachmentUrl}
                                </a>
                            ))}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

function Badge({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
    return (
        <span
            style={{
                padding: '2px 8px',
                borderRadius: 4,
                background: bg,
                color,
                fontSize: '0.7rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.02em',
            }}
        >
            {children}
        </span>
    );
}

function roleBackground(role?: string): string {
    if (!role) return '#fafafa';
    const r = role.toLowerCase();
    if (r.includes('agent') || r.includes('guide')) return '#eff6ff';
    if (r.includes('customer') || r.includes('consumer')) return '#f0fdf4';
    if (r.includes('system') || r.includes('bot')) return '#fefce8';
    return '#fafafa';
}

function formatDuration(seconds?: string | number): string | null {
    if (seconds == null) return null;
    const n = typeof seconds === 'string' ? parseInt(seconds, 10) : seconds;
    if (!Number.isFinite(n) || n <= 0) return null;
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    const s = n % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}
