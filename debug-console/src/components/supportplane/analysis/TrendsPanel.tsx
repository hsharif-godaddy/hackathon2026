'use client';

import { useState } from 'react';
import {
    Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
    ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

import sp from '@/components/supportplane/sp.module.css';
import { seeded } from '@/components/supportplane/utils';

export { seeded };

export const DAYS = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(2026, 4, 16 + i);
    return { date: `${d.getMonth()+1}/${d.getDate()}`, l1: seeded(i,30,70), l2: seeded(i+100,5,18), l3: seeded(i+200,1,6) };
});
export const WEEKS = Array.from({ length: 12 }, (_, i) => ({ week: `W${i+1}`, l1: seeded(i,200,450), l2: seeded(i+50,30,90), l3: seeded(i+100,5,25) }));
export const MONTHS = [
    { month: 'Jan', l1: 980,  l2: 142, l3: 22 },
    { month: 'Feb', l1: 1050, l2: 158, l3: 25 },
    { month: 'Mar', l1: 1180, l2: 171, l3: 29 },
    { month: 'Apr', l1: 1100, l2: 163, l3: 27 },
    { month: 'May', l1: 1247, l2: 184, l3: 31 },
];

type Gran = 'day' | 'week' | 'month';

export default function TrendsPanel() {
    const [gran, setGran] = useState<Gran>('day');
    const data = gran === 'day' ? DAYS : gran === 'week' ? WEEKS : MONTHS;
    const xKey = gran === 'day' ? 'date' : gran === 'week' ? 'week' : 'month';
    const AXIS = { tick: { fill: 'var(--sp-txm)', fontSize: 10 }, tickLine: false, axisLine: false };
    const TT   = { contentStyle: { background: 'var(--sp-s1)', border: '1px solid var(--sp-border)', borderRadius: 8, fontSize: 12 } };

    return (
        <div className={sp.panel}>
            <div className={sp.panelHeader}>
                <div><div className={sp.panelTitle}>Trend Analysis</div><div className={sp.panelSubtitle}>Contact volume across support tiers</div></div>
                <div className={sp.tabRow}>
                    {(['day','week','month'] as Gran[]).map((g) => (
                        <button key={g} onClick={() => setGran(g)} className={`${sp.tabBtn} ${gran===g ? sp.tabBtnActive : ''}`}>
                            {g==='day'?'Daily':g==='week'?'Weekly':'Monthly'}
                        </button>
                    ))}
                </div>
            </div>
            <div className={sp.chartCard}>
                <div className={sp.chartTitle}>L1 / L2 / L3 Volume</div>
                <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={data} margin={{ top:4, right:8, left:-20, bottom:0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--sp-s3)" />
                        <XAxis dataKey={xKey} {...AXIS} />
                        <YAxis {...AXIS} />
                        <Tooltip {...TT} labelStyle={{ color:'var(--sp-tx2)', fontWeight:600 }} />
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize:12 }} />
                        <Line dataKey="l1" name="L1 Contacts" stroke="#0891b2" strokeWidth={2} dot={false} />
                        <Line dataKey="l2" name="L2 Escalated" stroke="#7c3aed" strokeWidth={2} dot={false} />
                        <Line dataKey="l3" name="L3 / CIEC"   stroke="#ef4444" strokeWidth={2} dot={false} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
            <div className={sp.chartRow}>
                <div className={sp.chartCard} style={{ marginBottom:0 }}>
                    <div className={sp.chartTitle}>L1 Area</div>
                    <ResponsiveContainer width="100%" height={180}>
                        <AreaChart data={data} margin={{ top:4, right:8, left:-20, bottom:0 }}>
                            <defs>
                                <linearGradient id="l1g" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%"  stopColor="#0891b2" stopOpacity={0.4} />
                                    <stop offset="95%" stopColor="#0891b2" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--sp-s3)" />
                            <XAxis dataKey={xKey} {...AXIS} /><YAxis {...AXIS} />
                            <Tooltip {...TT} />
                            <Area dataKey="l1" name="L1" stroke="#0891b2" fill="url(#l1g)" strokeWidth={2} dot={false} />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
                <div className={sp.chartCard} style={{ marginBottom:0 }}>
                    <div className={sp.chartTitle}>Escalation Breakdown (last 7)</div>
                    <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={data.slice(-7)} margin={{ top:4, right:8, left:-20, bottom:0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--sp-s3)" />
                            <XAxis dataKey={xKey} {...AXIS} /><YAxis {...AXIS} />
                            <Tooltip {...TT} />
                            <Bar dataKey="l2" name="L2" fill="#7c3aed" radius={[3,3,0,0]} />
                            <Bar dataKey="l3" name="L3" fill="#ef4444" radius={[3,3,0,0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}
