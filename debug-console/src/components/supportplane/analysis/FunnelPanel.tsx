'use client';

import { ArrowDown } from 'lucide-react';
import {
    Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

import sp from '@/components/supportplane/sp.module.css';
import { MONTHS } from './TrendsPanel';

const FUNNEL_STEPS = [
    { label: 'L1 — First Contact',           count: 1247, color: '#0891b2', desc: 'Customers contacting Care (phone / chat / email)' },
    { label: 'L2 — Escalated to Specialist', count: 184,  color: '#7c3aed', desc: 'L1 unable to resolve — escalated to L2 specialist' },
    { label: 'L3 / CIEC — Engineering',      count: 31,   color: '#ef4444', desc: 'Requires engineering intervention via CIEC' },
];

export default function FunnelPanel() {
    const top = FUNNEL_STEPS[0]!.count;
    const AXIS = { tick:{fill:'var(--sp-txm)',fontSize:10}, tickLine:false, axisLine:false };
    const TT   = { contentStyle:{background:'var(--sp-s1)',border:'1px solid var(--sp-border)',borderRadius:8,fontSize:12} };
    return (
        <div className={sp.panel}>
            <div className={sp.panelHeader}>
                <div><div className={sp.panelTitle}>Support Escalation Funnel</div><div className={sp.panelSubtitle}>L1 → L2 → L3/CIEC · 30-day period</div></div>
            </div>
            <div className={sp.chartCard}>
                <div className={sp.funnelWrap}>
                    {FUNNEL_STEPS.map((step, i) => {
                        const widthPct = 40 + (step.count / top) * 60;
                        const pct = i === 0 ? '100' : ((step.count / top) * 100).toFixed(1);
                        return (
                            <div key={step.label} className={sp.funnelStep}>
                                <div className={sp.funnelBar} title={step.desc}
                                    style={{ background:step.color, width:`${widthPct}%`, maxWidth:'100%' }}>
                                    <div>
                                        <div className={sp.funnelLabel}>{step.label}</div>
                                        <div className={sp.funnelPct}>{step.desc}</div>
                                    </div>
                                    <div style={{ textAlign:'right' }}>
                                        <div className={sp.funnelNum}>{step.count.toLocaleString()}</div>
                                        <div className={sp.funnelPct}>{pct}% of L1</div>
                                    </div>
                                </div>
                                {i < FUNNEL_STEPS.length - 1 && (
                                    <div className={sp.funnelArrow}><ArrowDown size={18} /></div>
                                )}
                            </div>
                        );
                    })}
                    <div className={sp.funnelNote}>
                        Escalation rate · L1→L2: {((184/1247)*100).toFixed(1)}% · L2→L3: {((31/184)*100).toFixed(1)}%
                    </div>
                </div>
            </div>
            <div className={sp.chartCard} style={{ marginTop:16 }}>
                <div className={sp.chartTitle}>Monthly Funnel Trend</div>
                <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={MONTHS} margin={{top:4,right:8,left:-20,bottom:0}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--sp-s3)" />
                        <XAxis dataKey="month" {...AXIS} /><YAxis {...AXIS} />
                        <Tooltip {...TT} />
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:12}} />
                        <Bar dataKey="l1" name="L1" fill="#0891b2" radius={[3,3,0,0]} />
                        <Bar dataKey="l2" name="L2" fill="#7c3aed" radius={[3,3,0,0]} />
                        <Bar dataKey="l3" name="L3" fill="#ef4444" radius={[3,3,0,0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
