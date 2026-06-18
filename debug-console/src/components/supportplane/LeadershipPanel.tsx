'use client';

import {
    Bar, CartesianGrid, ComposedChart, Legend, Line,
    ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

import sp from '@/components/supportplane/sp.module.css';
import { MONTHS } from '@/components/supportplane/TrendsPanel';

export default function LeadershipPanel() {
    const AXIS = { tick:{fill:'var(--sp-txm)',fontSize:10}, tickLine:false, axisLine:false };
    const TT   = { contentStyle:{background:'var(--sp-s1)',border:'1px solid var(--sp-border)',borderRadius:8,fontSize:12} };
    const MOM = MONTHS.map((m, i, arr) => ({
        ...m,
        escRate: +((m.l2/m.l1)*100).toFixed(1),
        delta:   i > 0 ? m.l1 - arr[i-1]!.l1 : 0,
    }));
    const INITIATIVES = [
        { name: 'L1 Transcript Ingestion',  status: 'In Progress', pct: 60,  color: '#0891b2' },
        { name: 'AI Chat (GoCaaS)',          status: 'Live',        pct: 100, color: '#10b981' },
        { name: 'CIEC Jira Integration',     status: 'In Progress', pct: 35,  color: '#f59e0b' },
        { name: 'ServiceNow Credentials',    status: 'Pending',     pct: 10,  color: '#94a3b8' },
        { name: 'S3 Transcript Storage',     status: 'Pending',     pct: 5,   color: '#94a3b8' },
    ];
    return (
        <div className={sp.panel}>
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>Leadership View</div>
                    <div className={sp.panelSubtitle}>Executive summary — contact volume, escalation trends, initiative status</div>
                </div>
                <div className={sp.demoBadge} style={{ alignSelf: 'center' }}>Demo Data</div>
            </div>
            <div className={sp.statsGrid}>
                {[
                    { num: '5,557', label: 'L1 Contacts (5mo)',  delta: '+27% vs prior 5mo', up: true  },
                    { num: '14.8%', label: 'Avg Escalation Rate', delta: '−1.2pp MoM trend', up: true  },
                    { num: '2.5%',  label: 'CIEC Rate',           delta: 'Stable',            up: true  },
                    { num: '$0',    label: 'Infra Cost (SupportPlane)', delta: 'GoCaaS billed separately', up: true },
                ].map((s) => (
                    <div key={s.label} className={sp.statCard}>
                        <div className={sp.statNum}>{s.num}</div>
                        <div className={sp.statLabel}>{s.label}</div>
                        <div className={`${sp.statDelta} ${s.up ? sp.deltaUp : sp.deltaNt}`}>{s.delta}</div>
                    </div>
                ))}
            </div>
            <div className={sp.chartCard} style={{ marginTop: 16 }}>
                <div className={sp.chartTitle}>Monthly Volume &amp; Escalation Rate</div>
                <ResponsiveContainer width="100%" height={220}>
                    <ComposedChart data={MOM} margin={{top:4,right:8,left:-20,bottom:0}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--sp-s3)" />
                        <XAxis dataKey="month" {...AXIS} /><YAxis yAxisId="left" {...AXIS} />
                        <YAxis yAxisId="right" orientation="right" {...AXIS} tickFormatter={(v: number) => `${v}%`} domain={[0,30]} />
                        <Tooltip {...TT} />
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:12}} />
                        <Bar yAxisId="left" dataKey="l1" name="L1 Contacts" fill="#0891b2" radius={[3,3,0,0]} />
                        <Line yAxisId="right" type="monotone" dataKey="escRate" name="Esc Rate %" stroke="#ef4444" strokeWidth={2} dot={{ r:3 }} />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
            <div className={sp.chartCard} style={{ marginTop: 16 }}>
                <div className={sp.chartTitle}>Initiative Status</div>
                <div style={{ display:'flex', flexDirection:'column', gap:12, marginTop:8 }}>
                    {INITIATIVES.map((ini) => (
                        <div key={ini.name}>
                            <div style={{ display:'flex', justifyContent:'space-between', fontSize:12.5, marginBottom:5 }}>
                                <span style={{ fontWeight:500 }}>{ini.name}</span>
                                <span style={{ fontSize:11, fontWeight:600, color: ini.color }}>{ini.status} · {ini.pct}%</span>
                            </div>
                            <div style={{ height:6, background:'var(--sp-s3)', borderRadius:4 }}>
                                <div style={{ height:'100%', width:`${ini.pct}%`, background:ini.color, borderRadius:4, transition:'width .4s' }} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
