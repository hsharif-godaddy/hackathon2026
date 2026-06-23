'use client';

import { ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import sp from '@/components/supportplane/sp.module.css';
import { ageLabel } from '@/components/supportplane/types';
import type { JiraTicket } from '@/components/supportplane/types';
import { P_COLORS, S_COLORS } from './CIECPanel';

const BOARD_URL = 'https://godaddy-corp.atlassian.net/jira/software/projects/AABSP/boards';

export default function AABSPPanel() {
    const [status, setStatus] = useState<'idle'|'loading'|'configured'|'unconfigured'|'error'>('idle');
    const [tickets, setTickets] = useState<JiraTicket[]>([]);
    const [errorMsg, setErrorMsg] = useState('');

    const load = useCallback(async () => {
        setStatus('loading');
        try {
            const res = await fetch('/api/supportplane/jira?board=aabsp');
            const data = await res.json() as { configured?: boolean; tickets?: JiraTicket[]; error?: string; message?: string };
            if (data.configured === false) { setStatus('unconfigured'); return; }
            if (!res.ok || data.error) { setErrorMsg(data.error ?? data.message ?? 'Unknown error'); setStatus('error'); return; }
            setTickets(data.tickets ?? []);
            setStatus('configured');
        } catch (e) {
            setErrorMsg(e instanceof Error ? e.message : String(e));
            setStatus('error');
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    return (
        <div className={sp.panelRoot}>
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>AABSP Board</div>
                    <div className={sp.panelSub}>
                        Airo App Builder Sprint Planning ·
                        {status === 'configured' ? ` ${tickets.length} tickets` : ''}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <a href={BOARD_URL} target="_blank" rel="noopener noreferrer" className={sp.btnSecondary}>
                        <ExternalLink size={13} /> Open in Jira
                    </a>
                    <button className={sp.btnSecondary} onClick={load} disabled={status === 'loading'}>
                        {status === 'loading' ? 'Loading…' : 'Refresh'}
                    </button>
                </div>
            </div>

            {status === 'loading' && <div className={sp.emptyState}>Loading AABSP tickets…</div>}

            {status === 'unconfigured' && (
                <div className={sp.alertInfo}>
                    <strong>Jira not configured.</strong> Add <code>JIRA_BASE_URL</code>, <code>JIRA_EMAIL</code>, and <code>JIRA_API_TOKEN</code> to <code>.env.local</code>.
                </div>
            )}

            {status === 'error' && (
                <div className={sp.alertError}>
                    <strong>Error loading AABSP tickets:</strong> {errorMsg}
                </div>
            )}

            {status === 'configured' && (
                <div className={sp.card} style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                                <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                                    {['Key', 'Summary', 'Type', 'Status', 'Priority', 'Assignee', 'Age'].map(h => (
                                        <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--t3)', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {tickets.length === 0 ? (
                                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--t3)' }}>No tickets found</td></tr>
                                ) : tickets.map(t => {
                                    const pc = P_COLORS[t.priority] ?? { bg: 'var(--surface3)', color: 'var(--t2)' };
                                    const sc = S_COLORS[t.status] ?? { bg: 'var(--surface3)', color: 'var(--t2)' };
                                    return (
                                        <tr key={t.key} style={{ borderBottom: '1px solid var(--surface3)' }} className={sp.tableRow}>
                                            <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                                                <a href={t.url} target="_blank" rel="noopener noreferrer"
                                                    style={{ color: 'var(--blue)', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    {t.key} <ExternalLink size={10} />
                                                </a>
                                            </td>
                                            <td style={{ padding: '8px 12px', color: 'var(--t1)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {t.summary}
                                            </td>
                                            <td style={{ padding: '8px 12px', color: 'var(--t2)', whiteSpace: 'nowrap' }}>—</td>
                                            <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                                                <span style={{ ...sc, borderRadius: 4, padding: '2px 6px', fontSize: 11 }}>{t.status}</span>
                                            </td>
                                            <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                                                <span style={{ ...pc, borderRadius: 4, padding: '2px 6px', fontSize: 11 }}>{t.priority}</span>
                                            </td>
                                            <td style={{ padding: '8px 12px', color: 'var(--t2)', whiteSpace: 'nowrap' }}>{t.assignee ?? '—'}</td>
                                            <td style={{ padding: '8px 12px', color: 'var(--t3)', fontFamily: 'var(--mono)', fontSize: 11 }}>{ageLabel(t.created)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
