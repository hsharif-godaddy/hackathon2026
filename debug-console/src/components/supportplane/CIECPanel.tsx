'use client';

import { ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import sp from '@/components/supportplane/sp.module.css';
import { ageLabel } from '@/components/supportplane/types';
import type { JiraTicket } from '@/components/supportplane/types';

const P_COLORS: Record<string,{bg:string;color:string}> = {
    Highest:{bg:'#ef44441a',color:'#ef4444'}, High:{bg:'#ef44441a',color:'#ef4444'},
    Medium:{bg:'#f59e0b1a',color:'#f59e0b'}, Low:{bg:'#10b9811a',color:'#10b981'}, Lowest:{bg:'#10b9811a',color:'#10b981'},
};
const S_COLORS: Record<string,{bg:string;color:string}> = {
    'Open':{bg:'#0891b21a',color:'#0891b2'}, 'To Do':{bg:'#0891b21a',color:'#0891b2'},
    'In Progress':{bg:'#7c3aed1a',color:'#7c3aed'}, 'In Review':{bg:'#7c3aed1a',color:'#7c3aed'},
};

export { P_COLORS, S_COLORS };

export default function CIECPanel() {
    const [status, setStatus] = useState<'idle'|'loading'|'configured'|'unconfigured'|'error'>('idle');
    const [tickets, setTickets] = useState<JiraTicket[]>([]);
    const [errorMsg, setErrorMsg] = useState('');

    const load = useCallback(async () => {
        setStatus('loading');
        try {
            const res = await fetch('/api/supportplane/jira?board=ciec');
            const data = await res.json() as { configured?: boolean; tickets?: JiraTicket[]; error?: string; message?: string };
            if (!data.configured) { setStatus('unconfigured'); return; }
            if (!res.ok || data.error) { setErrorMsg(data.error ?? 'Unknown error'); setStatus('error'); return; }
            setTickets(data.tickets ?? []);
            setStatus('configured');
        } catch (e) {
            setErrorMsg(String(e));
            setStatus('error');
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const highCount = tickets.filter(t => t.priority === 'High' || t.priority === 'Highest').length;
    const oldest = tickets.length > 0
        ? ageLabel(tickets.reduce((a, b) => a.created < b.created ? a : b).created)
        : '—';

    return (
        <div className={sp.panel}>
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>CIEC Open Tickets</div>
                    <div className={sp.panelSubtitle}>Engineering escalations from L2 / L3 care · live from Jira</div>
                </div>
                <button className={`${sp.btn} ${sp.btnPrimary}`} onClick={load} disabled={status === 'loading'}>
                    {status === 'loading' ? 'Loading…' : 'Refresh'}
                </button>
            </div>

            {status === 'unconfigured' && (
                <div className={sp.demoBanner}>
                    <span className={sp.demoBadge}>Not configured</span>
                    Add <code>JIRA_CLIENT_ID</code>, <code>JIRA_CLIENT_SECRET</code>, and <code>JIRA_CLOUD_ID</code> to Katana secrets to load live CIEC tickets.
                </div>
            )}

            {status === 'error' && (
                <div className={sp.demoBanner} style={{background:'#ef44441a',borderColor:'#ef444430'}}>
                    <span className={sp.demoBadge} style={{background:'#ef44441a',color:'#ef4444',borderColor:'#ef444440'}}>Error</span>
                    {errorMsg}
                </div>
            )}

            {status === 'configured' && (
                <>
                    <div className={sp.statsGrid} style={{ gridTemplateColumns:'repeat(3,1fr)', marginBottom:20 }}>
                        {[
                            {num:String(tickets.length), label:'Open / In-Progress', color:'#ef4444'},
                            {num:String(highCount),      label:'High Priority',      color:'#f59e0b'},
                            {num:oldest,                 label:'Oldest Ticket',      color:'#0891b2'},
                        ].map((s) => (
                            <div key={s.label} className={sp.statCard}>
                                <div className={sp.statNum} style={{color:s.color}}>{s.num}</div>
                                <div className={sp.statLabel}>{s.label}</div>
                            </div>
                        ))}
                    </div>
                    <div className={sp.ticketList}>
                        {tickets.length === 0 && (
                            <div style={{padding:'32px 0',textAlign:'center',color:'var(--sp-txm)',fontSize:13}}>No open tickets</div>
                        )}
                        {tickets.map((t) => {
                            const pc = P_COLORS[t.priority] ?? P_COLORS['Medium']!;
                            const sc = S_COLORS[t.status] ?? S_COLORS['Open']!;
                            return (
                                <a key={t.key} href={t.url} target="_blank" rel="noopener noreferrer" className={sp.ticketRow}>
                                    <span className={sp.ticketKey}>{t.key}</span>
                                    <div style={{flex:1,minWidth:0}}>
                                        <div className={sp.ticketSummary}>{t.summary}</div>
                                        <div className={sp.ticketMeta}>
                                            <span className={sp.ticketPill} style={{background:sc.bg,color:sc.color}}>{t.status}</span>
                                            <span className={sp.ticketPill} style={{background:pc.bg,color:pc.color}}>{t.priority}</span>
                                            {t.assignee && <span style={{fontSize:11,color:'var(--sp-txm)'}}>{t.assignee}</span>}
                                            <span style={{fontSize:11,color:'var(--sp-txm)'}}>Age: {ageLabel(t.created)}</span>
                                        </div>
                                    </div>
                                    <ExternalLink size={13} style={{color:'var(--sp-txm)',flexShrink:0}} />
                                </a>
                            );
                        })}
                    </div>
                </>
            )}

            {(status === 'idle' || status === 'loading') && (
                <div style={{padding:'32px 0',textAlign:'center',color:'var(--sp-txm)',fontSize:13}}>
                    {status === 'loading' ? 'Fetching tickets from Jira…' : ''}
                </div>
            )}
        </div>
    );
}
