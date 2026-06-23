'use client';

import { CreditCard, ExternalLink } from 'lucide-react';

import sp from '@/components/supportplane/sp.module.css';

export default function RefundAuditPanel() {
    return (
        <div className={sp.panel}>
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>Refund Audit</div>
                    <div className={sp.panelSubtitle}>Refund patterns, anomalies, and policy compliance</div>
                </div>
                <a href="https://secureserver.sharepoint.com/sites/careservices" target="_blank" rel="noopener noreferrer" className={`${sp.btn} ${sp.btnSecondary}`}>
                    <ExternalLink size={13} />Refund Doc
                </a>
            </div>
            <div className={sp.statsGrid}>
                {[
                    { num: '43',   label: 'Refunds (30d)',   color: '#ef4444' },
                    { num: '$3.2k',label: 'Total Value',     color: '#f59e0b' },
                    { num: '68%',  label: 'Policy Compliant',color: '#10b981' },
                ].map((s) => (
                    <div key={s.label} className={sp.statCard}>
                        <div className={sp.statNum} style={{ color: s.color }}>{s.num}</div>
                        <div className={sp.statLabel}>{s.label}</div>
                    </div>
                ))}
            </div>
            <div className={sp.chartCard} style={{ marginTop: 16 }}>
                <div className={sp.empty} style={{ padding: 24 }}>
                    <CreditCard size={32} className={sp.emptyIcon} />
                    <div className={sp.emptyTitle}>ServiceNow Integration</div>
                    <div className={sp.emptySub}>Connect SERVICENOW credentials to pull live refund case data</div>
                </div>
            </div>
        </div>
    );
}
