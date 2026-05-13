'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

import { NOTES_MAX_WORDS, NOTES_RE } from '@/lib/credit-pack-constants';
import { formatTimestamp } from '@/lib/date-utils';

type AuthStatus = 'loading' | 'authenticated' | 'forbidden' | 'unauthorized';

interface CreditGrant {
    id: string;
    type: string;
    source: string;
    creditsMax: number;
    creditsSpent: number;
    isAvailable: boolean;
    finalState: string | null;
    useBefore: string;
    createdAt: string;
    removedAt: string | null;
}


function Timestamp({ iso, style }: { iso: string; style?: React.CSSProperties }) {
    return (
        <span title={iso} style={{ cursor: 'default', ...style }}>
            {formatTimestamp(iso)}
        </span>
    );
}

interface Eligibility {
    type: string;
    creditsMax: number;
    creditPackOptions: number[];
    useBefore: string;
}

function redirectToSso(): void {
    const returnUrl = window.location.href;
    const hostname = window.location.hostname;

    let ssoLoginUrl = process.env.NEXT_PUBLIC_SSO_LOGIN_URL;
    if (!ssoLoginUrl) {
        const isTestEnv = hostname.includes('test-') || hostname.includes('.test.');
        const ssoDomain = isTestEnv ? 'sso.test-godaddy.com' : 'sso.godaddy.com';
        ssoLoginUrl = `https://${ssoDomain}/login`;
    }

    const params = new URLSearchParams({
        app: 'console.airo-builder',
        redirect: returnUrl,
        realm: 'jomax',
    });

    window.location.href = `${ssoLoginUrl}?${params.toString()}`;
}

export default function AddCreditPackPage() {
    const params = useParams<{ appId: string; subscriptionId: string }>();
    const appId = params?.appId;
    const subscriptionId = params?.subscriptionId;
    const [status, setStatus] = useState<AuthStatus>('loading');
    const [eligibility, setEligibility] = useState<Eligibility | null>(null);
    const [eligibilityError, setEligibilityError] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [addResult, setAddResult] = useState<{ success: boolean; message: string } | null>(null);
    const [notes, setNotes] = useState('');
    const [selectedCredits, setSelectedCredits] = useState<number>(100);
    const [grants, setGrants] = useState<CreditGrant[] | null>(null);
    const [grantsError, setGrantsError] = useState<string | null>(null);
    const [grantsExpanded, setGrantsExpanded] = useState(false);
    const hasActiveAdminGrant = grants !== null && grants.some(g => g.isAvailable);
    const wordCount = notes.trim() ? notes.trim().split(/\s+/).filter(Boolean).length : 0;

    useEffect(() => {
        fetch('/api/auth/ops-admin')
            .then(function handleResponse(response) {
                if (response.ok) {
                    setStatus('authenticated');
                } else if (response.status === 401) {
                    setStatus('unauthorized');
                } else {
                    setStatus('forbidden');
                }
            })
            .catch(() => setStatus('forbidden'));
    }, []);

    useEffect(() => {
        if (status !== 'authenticated' || !appId || !subscriptionId) return;

        fetch(`/api/mgmt/apps/${encodeURIComponent(appId)}/subscriptions/${encodeURIComponent(subscriptionId)}/credit-pack/eligibility`)
            .then(async function handleEligibility(response) {
                if (response.ok) {
                    setEligibility(await response.json());
                } else {
                    const body = await response.json().catch(() => ({}));
                    setEligibilityError(body.error || `Failed to fetch eligibility (${response.status})`);
                }
            })
            .catch((err: Error) => setEligibilityError(err.message));
    }, [status, appId, subscriptionId]);

    useEffect(() => {
        if (status !== 'authenticated' || !subscriptionId) return;

        fetch(`/api/mgmt/subscriptions/${encodeURIComponent(subscriptionId)}/grants`)
            .then(async function handleGrants(response) {
                if (response.ok) {
                    const data = await response.json() as { grants: CreditGrant[] };
                    setGrants(data.grants.filter(g => g.type === 'credit-pack' && g.source === 'admin'));
                } else {
                    const body = await response.json().catch(() => ({}));
                    setGrantsError(body.error || `Failed to load admin credit history (${response.status})`);
                }
            })
            .catch((err: Error) => setGrantsError(err.message));
    }, [status, subscriptionId]);

    useEffect(() => {
        if (status === 'unauthorized') {
            redirectToSso();
        }
    }, [status]);

    if (status === 'loading' || status === 'unauthorized') {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
                <div>{status === 'loading' ? 'Checking credentials...' : 'Authentication required! Redirecting to OKTA...'}</div>
            </div>
        );
    }

    if (status === 'forbidden') {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
                <div style={{ textAlign: 'center' }}>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 600, color: '#dc2626' }}>Access Denied</h1>
                    <p style={{ color: '#666', marginTop: '0.5rem' }}>You do not have permission to access this page.</p>
                    <a href="/" style={{ color: '#3b82f6', textDecoration: 'none', fontSize: '0.875rem' }}>
                        ← Back to Dashboard
                    </a>
                </div>
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5', padding: '2rem' }}>
            <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
                <header style={{
                    backgroundColor: 'white',
                    padding: '1.5rem 2rem',
                    borderRadius: '8px',
                    marginBottom: '1.5rem',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 600, color: '#1a1a1a' }}>
                                Add Credit Pack
                            </h1>
                            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem', color: '#666' }}>
                                App: <code style={{ backgroundColor: '#f0f0f0', padding: '2px 6px', borderRadius: '4px' }}>{appId}</code>
                                {' · '}
                                Subscription: <code style={{ backgroundColor: '#f0f0f0', padding: '2px 6px', borderRadius: '4px' }}>{subscriptionId}</code>
                            </p>
                        </div>
                        <a href={`/?appId=${encodeURIComponent(appId ?? '')}`} style={{ color: '#3b82f6', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 500 }}>
                            ← Back to Dashboard
                        </a>
                    </div>
                </header>

                <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.75rem',
                    padding: '0.875rem 1rem',
                    backgroundColor: '#fffbeb',
                    border: '1px solid #fde68a',
                    borderRadius: '8px',
                    marginBottom: '1.5rem',
                }}>
                    <span style={{ fontSize: '1.25rem', lineHeight: 1, flexShrink: 0 }}>⚠️</span>
                    <p style={{ margin: 0, fontSize: '0.8125rem', color: '#92400e', lineHeight: 1.5 }}>
                        <strong>Caution:</strong> Activity is logged for auditing purposes. Please use carefully - it adds cost to the company, always validate if user actually lost credits based on agent conversation.
                    </p>
                </div>

                <div style={{
                    backgroundColor: 'white',
                    padding: '1.5rem 2rem',
                    borderRadius: '8px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: '#1a1a1a' }}>
                            {eligibility ? 'Provide credits' : 'Checking...'}
                        </h2>
                        <span style={{
                            fontSize: '0.7rem',
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

                    {eligibilityError && (
                        <div style={{ padding: '0.75rem 1rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#dc2626', fontSize: '0.875rem' }}>
                            {eligibilityError}
                        </div>
                    )}

                    {!eligibility && !eligibilityError && (
                        <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>Loading eligibility…</span>
                    )}

                    {eligibility && (
                        <>
                            {grantsError && (
                                <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#dc2626', fontSize: '0.8125rem' }}>
                                    Could not load admin credit history: {grantsError}. Existing credits may not be visible — proceed with caution.
                                </div>
                            )}

                            {grants !== null && grants.length > 0 && (
                                <div style={{ marginTop: '1.5rem' }}>
                                    <button
                                        onClick={() => setGrantsExpanded(v => !v)}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.375rem',
                                            background: 'none',
                                            border: 'none',
                                            padding: 0,
                                            cursor: 'pointer',
                                            fontSize: '1rem',
                                            fontWeight: 600,
                                            color: hasActiveAdminGrant ? '#dc2626' : '#1a1a1a',
                                            marginBottom: grantsExpanded ? '0.75rem' : 0,
                                        }}
                                    >
                                        <span style={{ fontSize: '0.75rem', color: hasActiveAdminGrant ? '#dc2626' : '#6b7280' }}>{grantsExpanded ? '▾' : '▸'}</span>
                                        Admin Credit History ({grants.length})
                                    </button>
                                    {grantsExpanded && (<div style={{ overflowX: 'auto' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', fontFamily: 'monospace' }}>
                                            <thead>
                                                <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                                                    {(['Created', 'Source', 'Credits', 'Spent', 'Use Before', 'State', 'Available'] as const).map(col => (
                                                        <th key={col} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{col}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {grants.map((grant, i) => {
                                                    const expired = new Date(grant.useBefore) < new Date();
                                                    const rowBg = i % 2 === 0 ? 'white' : '#f9fafb';
                                                    return (
                                                        <tr key={grant.id} style={{ backgroundColor: rowBg, borderBottom: '1px solid #f3f4f6', opacity: expired ? 0.6 : 1 }}>
                                                            <td style={{ padding: '0.5rem 0.75rem', color: '#111827', whiteSpace: 'nowrap' }}><Timestamp iso={grant.createdAt} /></td>
                                                            <td style={{ padding: '0.5rem 0.75rem', color: '#6b7280', fontFamily: 'monospace', fontSize: '0.75rem' }}>{grant.source}</td>
                                                            <td style={{ padding: '0.5rem 0.75rem', color: '#111827' }}>{grant.creditsMax}</td>
                                                            <td style={{ padding: '0.5rem 0.75rem', color: '#111827' }}>{grant.creditsSpent}</td>
                                                            <td style={{ padding: '0.5rem 0.75rem', color: expired ? '#9ca3af' : '#111827', whiteSpace: 'nowrap' }}><Timestamp iso={grant.useBefore} /></td>
                                                            <td style={{ padding: '0.5rem 0.75rem' }}>
                                                                <span style={{
                                                                    display: 'inline-block',
                                                                    padding: '0.125rem 0.5rem',
                                                                    borderRadius: '4px',
                                                                    fontSize: '0.7rem',
                                                                    fontWeight: 600,
                                                                    backgroundColor: grant.finalState ? '#fef2f2' : expired ? '#f3f4f6' : '#f0fdf4',
                                                                    color: grant.finalState ? '#dc2626' : expired ? '#6b7280' : '#166534',
                                                                }}>
                                                                    {grant.finalState ?? (expired ? 'expired' : 'active')}
                                                                </span>
                                                            </td>
                                                            <td style={{ padding: '0.5rem 0.75rem', color: grant.isAvailable ? '#166534' : '#9ca3af' }}>{grant.isAvailable ? 'yes' : 'no'}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>)}
                                </div>
                            )}

                            {(
                                <>
                                    {addResult && (
                                        <div style={{
                                            marginTop: '1rem',
                                            padding: '0.75rem 1rem',
                                            borderRadius: '6px',
                                            fontSize: '0.875rem',
                                            backgroundColor: addResult.success ? '#f0fdf4' : '#fef2f2',
                                            border: `1px solid ${addResult.success ? '#bbf7d0' : '#fecaca'}`,
                                            color: addResult.success ? '#166534' : '#dc2626',
                                        }}>
                                            {addResult.message}
                                        </div>
                                    )}

                                    <div style={{ marginTop: '1rem' }}>
                                        <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>
                                            Credits <span style={{ fontWeight: 400, color: '#6b7280' }}>(use before &mdash; <Timestamp iso={eligibility.useBefore} />)</span> <span style={{ color: '#dc2626' }}>*</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                                            {(eligibility.creditPackOptions ?? [100, 250]).map((option: number) => (
                                                <label
                                                    key={option}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.5rem',
                                                        padding: '0.5rem 1rem',
                                                        border: `2px solid ${selectedCredits === option ? '#2563eb' : '#d1d5db'}`,
                                                        borderRadius: '6px',
                                                        cursor: adding || addResult?.success === true ? 'not-allowed' : 'pointer',
                                                        backgroundColor: selectedCredits === option ? '#eff6ff' : 'white',
                                                        fontSize: '0.875rem',
                                                        fontWeight: selectedCredits === option ? 600 : 400,
                                                        color: selectedCredits === option ? '#1d4ed8' : '#374151',
                                                        opacity: adding || addResult?.success === true ? 0.6 : 1,
                                                    }}
                                                >
                                                    <input
                                                        type="radio"
                                                        name="creditsAmount"
                                                        value={option}
                                                        checked={selectedCredits === option}
                                                        disabled={adding || addResult?.success === true}
                                                        onChange={() => setSelectedCredits(option)}
                                                        style={{ accentColor: '#2563eb' }}
                                                    />
                                                    {option} credits
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    <div style={{ marginTop: '1rem' }}>
                                        <label htmlFor="credit-pack-notes" style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: '0.25rem' }}>
                                            Notes <span style={{ color: '#dc2626' }}>*</span>
                                        </label>
                                        <p style={{ margin: '0 0 0.375rem 0', fontSize: '0.75rem', color: '#6b7280' }}>
                                            Provide links to discussions, tickets, or support cases that justify this credit grant. Include any relevant context.
                                        </p>
                                        <textarea
                                            id="credit-pack-notes"
                                            value={notes}
                                            onChange={function handleNotes(e) {
                                                setNotes(e.target.value.replace(NOTES_RE, ''));
                                            }}
                                            disabled={adding || addResult?.success === true}
                                            placeholder="e.g. https://link-to-ticket-or-discussion — reason for the credit grant"
                                            rows={4}
                                            style={{
                                                width: '100%',
                                                padding: '0.625rem 0.75rem',
                                                fontSize: '0.875rem',
                                                fontFamily: 'inherit',
                                                border: '1px solid #d1d5db',
                                                borderRadius: '6px',
                                                resize: 'vertical',
                                                boxSizing: 'border-box',
                                            }}
                                        />
                                        <div style={{
                                            marginTop: '0.25rem',
                                            fontSize: '0.75rem',
                                            fontWeight: 500,
                                            textAlign: 'right',
                                            color: wordCount >= NOTES_MAX_WORDS - 1 ? '#dc2626'
                                                : wordCount >= NOTES_MAX_WORDS - 20 ? '#d97706'
                                                : '#16a34a',
                                        }}>
                                            {wordCount} / {NOTES_MAX_WORDS} words
                                        </div>
                                    </div>

                                    <button
                                        disabled={adding || addResult?.success === true || !notes.trim() || wordCount > NOTES_MAX_WORDS}
                                        onClick={async function handleAdd() {
                                            setAdding(true);
                                            setAddResult(null);
                                            try {
                                                const response = await fetch(
                                                    `/api/mgmt/apps/${encodeURIComponent(appId!)}/subscriptions/${encodeURIComponent(subscriptionId!)}/credit-pack/add`,
                                                    {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ notes: notes.trim(), creditsMax: selectedCredits }),
                                                    }
                                                );
                                                const body = await response.json().catch(() => ({}));
                                                if (response.ok) {
                                                    setAddResult({ success: true, message: `Credit pack added successfully (ID: ${body.grant?.llmBudgetUserId})` });
                                                } else {
                                                    setAddResult({ success: false, message: body.error || `Failed to add credit pack (${response.status})` });
                                                }
                                            } catch (err: unknown) {
                                                setAddResult({ success: false, message: err instanceof Error ? err.message : 'Unknown error' });
                                            } finally {
                                                setAdding(false);
                                            }
                                        }}
                                        style={{
                                            marginTop: '1rem',
                                            padding: '0.625rem 1.5rem',
                                            fontSize: '0.875rem',
                                            fontWeight: 600,
                                            color: 'white',
                                            backgroundColor: adding || addResult?.success === true || !notes.trim() || wordCount > NOTES_MAX_WORDS ? '#9ca3af' : '#2563eb',
                                            border: 'none',
                                            borderRadius: '6px',
                                            cursor: adding || addResult?.success === true || !notes.trim() || wordCount > NOTES_MAX_WORDS ? 'not-allowed' : 'pointer',
                                        }}
                                    >
                                        {adding ? 'Adding…' : addResult?.success ? 'Added' : 'Add Credit Pack'}
                                    </button>
                                </>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
