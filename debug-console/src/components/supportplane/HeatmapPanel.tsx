'use client';

import { useState } from 'react';

import sp from '@/components/supportplane/sp.module.css';
import { seeded } from '@/components/supportplane/utils';

const HOURS = Array.from({ length: 24 }, (_, h) => ({
    label: h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h-12}pm`,
    value: seeded(h * 7, 2, 60) * (h >= 8 && h <= 17 ? 2.5 : 1),
}));
const DOW_DATA = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d, i) => ({
    label: d, value: seeded(i * 11, 20, 120) * (i < 5 ? 1.4 : 0.6),
}));

export default function HeatmapPanel() {
    const [mode, setMode] = useState<'hour'|'dow'>('hour');
    const cells = mode === 'hour' ? HOURS : DOW_DATA;
    const max   = Math.max(...cells.map((c) => c.value));
    return (
        <div className={sp.panel}>
            <div className={sp.panelHeader}>
                <div><div className={sp.panelTitle}>Activity Heatmap</div><div className={sp.panelSubtitle}>When customers contact L1 support</div></div>
                <div className={sp.tabRow}>
                    <button onClick={() => setMode('hour')} className={`${sp.tabBtn} ${mode==='hour'?sp.tabBtnActive:''}`}>By Hour</button>
                    <button onClick={() => setMode('dow')}  className={`${sp.tabBtn} ${mode==='dow' ?sp.tabBtnActive:''}`}>By Day</button>
                </div>
            </div>
            <div className={sp.chartCard}>
                <div className={sp.chartTitle}>{mode==='hour'?'24-hour distribution':'Day-of-week distribution'}</div>
                <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                    {cells.map((c) => {
                        const opacity = 0.12 + (c.value / max) * 0.88;
                        return (
                            <div key={c.label} style={{ display:'flex', alignItems:'center', gap:10 }}>
                                <span style={{ fontSize:11, color:'var(--sp-txm)', width:34, textAlign:'right', flexShrink:0 }}>{c.label}</span>
                                <div style={{ flex:1, height:22, borderRadius:4, background:`rgba(8,145,178,${opacity.toFixed(2)})`, transition:'background .3s' }} title={`~${Math.round(c.value)} contacts`} />
                                <span style={{ fontSize:11, color:'var(--sp-txm)', width:32, flexShrink:0 }}>{Math.round(c.value)}</span>
                            </div>
                        );
                    })}
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:14, justifyContent:'flex-end' }}>
                    <span style={{ fontSize:10, color:'var(--sp-txm)' }}>Low</span>
                    {[0.12,0.3,0.5,0.7,1].map((o) => (
                        <div key={o} style={{ width:16, height:12, borderRadius:3, background:`rgba(8,145,178,${o})` }} />
                    ))}
                    <span style={{ fontSize:10, color:'var(--sp-txm)' }}>High</span>
                </div>
            </div>
        </div>
    );
}
