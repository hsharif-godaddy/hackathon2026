'use client';

import {
    Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

import sp from '@/components/supportplane/sp.module.css';
import { seeded } from '@/components/supportplane/utils';

const AHT_DATA = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d, i) => ({
    day: d,
    aht:  Math.round(seeded(i * 13, 3, 8) * 10) / 10,
    csat: Math.round((seeded(i * 17, 60, 95)) / 10) * 10,
}));
const CHANNEL_DATA = [
    { channel: 'Phone',    contacts: 724, pct: 58 },
    { channel: 'Live Chat',contacts: 324, pct: 26 },
    { channel: 'Email',    contacts: 124, pct: 10 },
    { channel: 'Social',   contacts: 75,  pct: 6  },
];
const ESC_REASONS = [
    { reason: 'Technical — App publish error', count: 42 },
    { reason: 'Billing — Refund > agent limit', count: 31 },
    { reason: 'Auth — Account locked', count: 27 },
    { reason: 'Domain — DNS not resolving', count: 19 },
    { reason: 'Performance — Timeout / crash', count: 14 },
];

export { AHT_DATA, CHANNEL_DATA, ESC_REASONS };

export default function OpsPanel() {
    const AXIS = { tick:{fill:'var(--sp-txm)',fontSize:10}, tickLine:false, axisLine:false };
    const TT   = { contentStyle:{background:'var(--sp-s1)',border:'1px solid var(--sp-border)',borderRadius:8,fontSize:12} };
    return (
        <div className={sp.panel}>
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>Operations Overview</div>
                    <div className={sp.panelSubtitle}>Agent performance, channel mix, and escalation root causes</div>
                </div>
                <div className={sp.demoBadge} style={{ alignSelf: 'center' }}>Demo Data</div>
            </div>
            <div className={sp.statsGrid}>
                {[
                    { num: '4.2m',  label: 'Avg Handle Time',    delta: '−8% WoW',  up: true  },
                    { num: '78%',   label: 'FCR Rate',            delta: '+3% WoW',  up: true  },
                    { num: '4.1/5', label: 'CSAT Score',          delta: '−0.2 WoW', up: false },
                    { num: '92%',   label: 'SLA Compliance',      delta: '+1% WoW',  up: true  },
                ].map((s) => (
                    <div key={s.label} className={sp.statCard}>
                        <div className={sp.statNum}>{s.num}</div>
                        <div className={sp.statLabel}>{s.label}</div>
                        <div className={`${sp.statDelta} ${s.up ? sp.deltaUp : sp.deltaNt}`}>{s.delta}</div>
                    </div>
                ))}
            </div>
            <div className={sp.chartRow} style={{ marginTop: 16 }}>
                <div className={sp.chartCard} style={{ marginBottom: 0 }}>
                    <div className={sp.chartTitle}>Avg Handle Time by Day (min)</div>
                    <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={AHT_DATA} margin={{top:4,right:8,left:-20,bottom:0}}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--sp-s3)" />
                            <XAxis dataKey="day" {...AXIS} /><YAxis {...AXIS} domain={[0,10]} />
                            <Tooltip {...TT} />
                            <Bar dataKey="aht" name="AHT (min)" fill="#0891b2" radius={[3,3,0,0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
                <div className={sp.chartCard} style={{ marginBottom: 0 }}>
                    <div className={sp.chartTitle}>Channel Mix</div>
                    <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:8 }}>
                        {CHANNEL_DATA.map((c) => (
                            <div key={c.channel}>
                                <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:4 }}>
                                    <span style={{ color:'var(--sp-tx2)' }}>{c.channel}</span>
                                    <span style={{ fontWeight:600 }}>{c.contacts} <span style={{ color:'var(--sp-txm)', fontWeight:400 }}>({c.pct}%)</span></span>
                                </div>
                                <div style={{ height:8, background:'var(--sp-s3)', borderRadius:4 }}>
                                    <div style={{ height:'100%', width:`${c.pct}%`, background:'#0891b2', borderRadius:4, transition:'width .4s' }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <div className={sp.chartCard} style={{ marginTop: 16 }}>
                <div className={sp.chartTitle}>Top Escalation Reasons (L1 → L2)</div>
                <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:8 }}>
                    {ESC_REASONS.map((r, i) => (
                        <div key={r.reason} style={{ display:'flex', alignItems:'center', gap:10 }}>
                            <span style={{ fontSize:11, color:'var(--sp-txm)', width:16, textAlign:'right', flexShrink:0 }}>{i+1}</span>
                            <span style={{ flex:1, fontSize:12.5 }}>{r.reason}</span>
                            <span style={{ fontSize:12, fontWeight:600, color:'#7c3aed', flexShrink:0 }}>{r.count}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
