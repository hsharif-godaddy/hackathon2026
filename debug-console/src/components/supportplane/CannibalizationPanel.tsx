'use client';

import { ExternalLink, Layers } from 'lucide-react';

import sp from '@/components/supportplane/sp.module.css';

export default function CannibalizationPanel() {
    return (
        <div className={sp.panel}>
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>Cannibalization Analysis</div>
                    <div className={sp.panelSubtitle}>Overlap between AAB and existing GoDaddy products</div>
                </div>
                <a href="https://secureserver.sharepoint.com/sites/careservices" target="_blank" rel="noopener noreferrer" className={`${sp.btn} ${sp.btnSecondary}`}>
                    <ExternalLink size={13} />SharePoint Doc
                </a>
            </div>
            <div className={sp.chartCard}>
                <div className={sp.empty} style={{ padding: 32 }}>
                    <Layers size={36} className={sp.emptyIcon} />
                    <div className={sp.emptyTitle}>Connect SharePoint</div>
                    <div className={sp.emptySub}>Set SP_USERNAME / SP_PASSWORD in .env.local to load live analysis data</div>
                </div>
            </div>
        </div>
    );
}
