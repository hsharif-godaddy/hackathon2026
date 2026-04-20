'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

import { NOTES_MAX_WORDS, NOTES_RE } from '@/lib/credit-pack-constants';
import { formatTimestamp } from '@/lib/date-utils';

type AuthStatus = 'loading' | 'authenticated' | 'forbidden' | 'unauthorized';

function Countdown({ target }: { target: string }) {
    const [remaining, setRemaining] = useState('');

    useEffect(function tick() {
        function compute() {
            const diff = new Date(target).getTime() - Date.now();
            if (diff <= 0) {
                setRemaining('now — reload the page');
                return;
            }
            const h = Math.floor(diff / 3_600_000);
            const m = Math.floor((diff % 3_600_000) / 60_000);
            const s = Math.floor((diff % 60_000) / 1_000);
            setRemaining(`${h}h ${m}m ${s}s`);
        }
        compute();
        const id = setInterval(compute, 1_000);
        return () => clearInterval(id);
    }, [target]);

    return (
        <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 600, color: '#b45309' }}>
            {remaining}
        </span>
    );
}

function Timestamp({ iso, style }: { iso: string; style?: React.CSSProperties }) {
    return (
        <span title={iso} style={{ cursor: 'default', ...style }}>
            {formatTimestamp(iso)}
        </span>
    );
}

interface RecentCreditPack {
    es_id: string;
    timestamp: string;
    credits_max: number;
    use_before: string;
    next_credit_allowed_after: string;
    is_credit_allowed: boolean;
    added_by_shopper_id?: string;
    added_by_cid?: string;
    added_by_email?: string;
}

interface Eligibility {
    type: string;
    creditsMax: number;
    useBefore: string;
    recentCreditPack: RecentCreditPack | null;
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
                        <strong>Caution:</strong> This activity is logged for auditing purposes. Please use with care as it adds cost to the company by providing free credits to the user.
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
                            {eligibility ? (
                                (!eligibility.recentCreditPack || eligibility.recentCreditPack.is_credit_allowed)
                                    ? '✅ Eligible'
                                    : <>❌ Ineligible —
                                    <span style={{ fontSize: '0.875rem', color: '#6b7280' }}> &nbsp;
                                    Credit pack addition unlocks in <Countdown target={eligibility.recentCreditPack!.next_credit_allowed_after} />.</span></>
                            ) : 'Checking...'}
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
                            {(!eligibility.recentCreditPack || eligibility.recentCreditPack.is_credit_allowed) && (
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                                    gap: '1rem',
                                    padding: '1rem',
                                    backgroundColor: '#f9fafb',
                                    borderRadius: '6px',
                                    border: '1px solid #e5e7eb',
                                }}>
                                    <div>
                                        <div style={{ fontSize: '0.7rem', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Type</div>
                                        <div style={{ fontFamily: 'monospace', fontSize: '0.875rem', color: '#111827' }}>{eligibility.type}</div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.7rem', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Credits Max</div>
                                        <div style={{ fontFamily: 'monospace', fontSize: '0.875rem', color: '#111827' }}>{eligibility.creditsMax}</div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.7rem', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Use Before</div>
                                        <div style={{ fontFamily: 'monospace', fontSize: '0.875rem', color: '#111827' }}><Timestamp iso={eligibility.useBefore} /></div>
                                    </div>
                                </div>
                            )}

                            {eligibility.recentCreditPack && (
                                <div style={{ marginTop: '1.25rem' }}>
                                    <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', fontWeight: 600, color: '#1a1a1a' }}>
                                        Recent Credit Pack
                                    </h3>
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                                        gap: '1rem',
                                        padding: '1rem',
                                        backgroundColor: '#eff6ff',
                                        borderRadius: '6px',
                                        border: '1px solid #bfdbfe',
                                    }}>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Added At</div>
                                            <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#1e3a5f' }}><Timestamp iso={eligibility.recentCreditPack.timestamp} /></div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Credits</div>
                                            <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#1e3a5f' }}>{eligibility.recentCreditPack.credits_max}</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Use Before</div>
                                            <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#1e3a5f' }}><Timestamp iso={eligibility.recentCreditPack.use_before} /></div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Next Credit Allowed After</div>
                                            <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#1e3a5f' }}><Timestamp iso={eligibility.recentCreditPack.next_credit_allowed_after} /></div>
                                        </div>
                                        {eligibility.recentCreditPack.added_by_shopper_id && (
                                            <div>
                                                <div style={{ fontSize: '0.7rem', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Added By</div>
                                                <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#1e3a5f' }}>{eligibility.recentCreditPack.added_by_shopper_id}</div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {eligibility.recentCreditPack && !eligibility.recentCreditPack.is_credit_allowed && (
                                <div style={{
                                    marginTop: '1rem',
                                    padding: '0.75rem 1rem',
                                    borderRadius: '6px',
                                    fontSize: '0.875rem',
                                    backgroundColor: '#fefce8',
                                    border: '1px solid #fde68a',
                                    color: '#854d0e',
                                }}>
                                    Next credit pack can be added after <Timestamp iso={eligibility.recentCreditPack.next_credit_allowed_after} />.
                                </div>
                            )}

                            {(!eligibility.recentCreditPack || eligibility.recentCreditPack.is_credit_allowed) && (
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
                                        <label htmlFor="credit-pack-notes" style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: '#374151', marginBottom: '0.375rem' }}>
                                            Notes <span style={{ color: '#dc2626' }}>*</span>
                                        </label>
                                        <textarea
                                            id="credit-pack-notes"
                                            value={notes}
                                            onChange={function handleNotes(e) {
                                                setNotes(e.target.value.replace(NOTES_RE, ''));
                                            }}
                                            disabled={adding || addResult?.success === true}
                                            placeholder="Reason for adding the credit pack (required)"
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
                                                        body: JSON.stringify({ notes: notes.trim() }),
                                                    }
                                                );
                                                const body = await response.json().catch(() => ({}));
                                                if (response.ok) {
                                                    setAddResult({ success: true, message: `Credit pack added successfully (ID: ${body.grant?.llmBudgetUserId})` });
                                                } else if (response.status === 400 && body.error_code === 'CREDIT_PACK_ALREADY_ADDED') {
                                                    setAddResult({ success: false, message: body.error || `Failed to add credit pack (${response.status})` });
                                                    setTimeout(() => {
                                                        window.location.reload();
                                                    }, 2000);
                                                    return;
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
