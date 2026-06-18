'use client';

import sp from '@/components/supportplane/sp.module.css';

const INTENTS = [
    { label: 'Website Builder Help', count: 312 }, { label: 'Domain Setup',        count: 247 },
    { label: 'Billing & Refund',     count: 203 }, { label: 'AI App Errors',       count: 188 },
    { label: 'Publishing Failed',    count: 165 }, { label: "Can't Login",         count: 142 },
    { label: 'Plan Upgrade',         count: 138 }, { label: 'Feature Request',     count: 120 },
    { label: 'Slow Performance',     count: 109 }, { label: 'DNS Issues',          count: 98  },
    { label: 'SSL Certificate',      count: 87  }, { label: 'Email Setup',         count: 82  },
    { label: 'App Cannibalization',  count: 76  }, { label: 'Credit Card Decline', count: 70  },
    { label: 'Mobile Preview',       count: 65  }, { label: 'Image Upload',        count: 59  },
    { label: 'Template Issues',      count: 54  }, { label: 'API Errors',          count: 48  },
    { label: 'Cancellation',         count: 43  }, { label: 'Trial Expired',       count: 38  },
];
const TC = [
    { bg:'#0891b21a', color:'#0891b2' }, { bg:'#7c3aed1a', color:'#7c3aed' },
    { bg:'#10b9811a', color:'#10b981' }, { bg:'#f59e0b1a', color:'#f59e0b' },
    { bg:'#ef44441a', color:'#ef4444' }, { bg:'#4f46e51a', color:'#4f46e5' },
];

export default function TagCloudPanel() {
    const max   = INTENTS[0]!.count;
    const total = INTENTS.reduce((s, x) => s + x.count, 0);
    return (
        <div className={sp.panel}>
            <div className={sp.panelHeader}>
                <div><div className={sp.panelTitle}>Intent Tag Cloud</div><div className={sp.panelSubtitle}>Top contact reasons — last 30 days. Size = volume.</div></div>
            </div>
            <div className={sp.chartCard}>
                <div className={sp.tagCloud}>
                    {INTENTS.map((t, i) => {
                        const c = TC[i % TC.length]!;
                        const fs = Math.round((0.7 + (t.count / max) * 0.9) * 13);
                        return (
                            <span key={t.label} className={sp.tagItem} title={`${t.count} contacts`}
                                style={{ fontSize:`${fs}px`, background:c.bg, color:c.color, border:`1px solid ${c.color}25` }}>
                                {t.label}
                            </span>
                        );
                    })}
                </div>
            </div>
            <div className={sp.chartCard} style={{ marginTop:16 }}>
                <div className={sp.chartTitle}>Top 10 Intents</div>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5 }}>
                    <thead>
                        <tr>
                            {['#','Intent','Contacts','Share'].map((h,i) => (
                                <th key={h} style={{ textAlign:i>1?'right':'left', padding:'5px 8px', color:'var(--sp-txm)', fontWeight:600, borderBottom:'1px solid var(--sp-border)' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {INTENTS.slice(0,10).map((t, i) => (
                            <tr key={t.label}>
                                <td style={{ padding:'5px 8px', color:'var(--sp-txm)', borderBottom:'1px solid var(--sp-s3)' }}>{i+1}</td>
                                <td style={{ padding:'5px 8px', fontWeight:500, borderBottom:'1px solid var(--sp-s3)' }}>{t.label}</td>
                                <td style={{ padding:'5px 8px', textAlign:'right', borderBottom:'1px solid var(--sp-s3)' }}>{t.count}</td>
                                <td style={{ padding:'5px 8px', textAlign:'right', borderBottom:'1px solid var(--sp-s3)', color:'var(--sp-accent)', fontWeight:600 }}>
                                    {((t.count/total)*100).toFixed(1)}%
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
