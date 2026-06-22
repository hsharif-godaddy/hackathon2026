'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import ProtectedRoute from '@/components/ProtectedRoute';
import AABSPPanel from '@/components/supportplane/AABSPPanel';
import AnalysisPanel from '@/components/supportplane/AnalysisPanel';
import CIECPanel from '@/components/supportplane/CIECPanel';
import CannibalizationPanel from '@/components/supportplane/CannibalizationPanel';
import ChatPanel from '@/components/supportplane/ChatPanel';
import DashboardPanel from '@/components/supportplane/DashboardPanel';
import FeedbackBrowsePanel from '@/components/supportplane/FeedbackBrowsePanel';
import FeedbackChatPanel from '@/components/supportplane/FeedbackChatPanel';
import FeedbackDashboard from '@/components/supportplane/FeedbackDashboard';
import FeedbackOverviewPanel from '@/components/supportplane/FeedbackOverviewPanel';
import FeedbackRatingsPanel from '@/components/supportplane/FeedbackRatingsPanel';
import FeedbackTopicsPanel from '@/components/supportplane/FeedbackTopicsPanel';
import FeedbackTrendsPanel from '@/components/supportplane/FeedbackTrendsPanel';
import FunnelPanel from '@/components/supportplane/FunnelPanel';
import Header from '@/components/supportplane/Header';
import HeatmapPanel from '@/components/supportplane/HeatmapPanel';
import LeadershipPanel from '@/components/supportplane/LeadershipPanel';
import OpsPanel from '@/components/supportplane/OpsPanel';
import RefundAuditPanel from '@/components/supportplane/RefundAuditPanel';
import Sidebar from '@/components/supportplane/Sidebar';
import TagCloudPanel from '@/components/supportplane/TagCloudPanel';
import TicketsDashboard from '@/components/supportplane/TicketsDashboard';
import TodayPanel from '@/components/supportplane/TodayPanel';
import TranscriptChatPanel from '@/components/supportplane/TranscriptChatPanel';
import TranscriptsDashboard from '@/components/supportplane/TranscriptsDashboard';
import TranscriptsBrowsePanel from '@/components/supportplane/TranscriptsBrowsePanel';
import TrendsPanel from '@/components/supportplane/TrendsPanel';
import UploadPanel from '@/components/supportplane/UploadPanel';
import { type PanelId } from '@/components/supportplane/types';
import { useAuth } from '@/hooks/useAuth';
import sp from '@/components/supportplane/sp.module.css';

function SupportPlaneApp() {
    const { user } = useAuth();
    const [theme,       setTheme]       = useState<'light' | 'dark'>('dark');
    const [collapsed,   setCollapsed]   = useState(false);
    const [panel,       setPanel]       = useState<PanelId>('today');
    const [syncTrigger, setSyncTrigger] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);

    // Navigate to Browse Data tab and auto-start sync. Called from any feedback panel's sync button.
    const goToSync = useCallback(() => {
        setPanel('feedback-browse');
        setSyncTrigger(t => t + 1);
    }, []);

    useEffect(() => {
        const t = localStorage.getItem('sp-theme');
        if (t === 'light' || t === 'dark') setTheme(t);
        setCollapsed(localStorage.getItem('sp-collapsed') === 'true');
    }, []);

    useEffect(() => {
        containerRef.current?.setAttribute('data-theme', theme);
    }, [theme]);

    const toggleTheme = useCallback(() => {
        setTheme((t) => {
            const n = t === 'dark' ? 'light' : 'dark';
            localStorage.setItem('sp-theme', n);
            return n;
        });
    }, []);

    const toggleSidebar = useCallback(() => {
        setCollapsed((c) => {
            localStorage.setItem('sp-collapsed', String(!c));
            return !c;
        });
    }, []);

    return (
        <div ref={containerRef} className={sp.sp} data-theme={theme}>
            <Sidebar active={panel} collapsed={collapsed} onSelect={setPanel} onToggle={toggleSidebar} />
            <div className={sp.main}>
                <Header panel={panel} isDark={theme === 'dark'} email={user?.email} onToggle={toggleTheme} />
                <div className={sp.content}>
                    {/* Executive View */}
                    {panel === 'today' && <TodayPanel onNav={setPanel} />}

                    {/* Top-level Dashboards */}
                    {panel === 'dash-transcripts' && <TranscriptsDashboard onNav={setPanel} />}
                    {panel === 'dash-feedback'    && <FeedbackDashboard    onNav={setPanel} />}
                    {panel === 'dash-tickets'     && <TicketsDashboard     onNav={setPanel} />}

                    {/* L1 Transcripts section */}
                    {/* Keep TranscriptsBrowsePanel mounted to preserve loaded data and avoid re-fetching on every nav */}
                    <div style={{display: panel === 'transcripts' ? 'contents' : 'none'}}>
                        <TranscriptsBrowsePanel onUpload={() => setPanel('upload')} />
                    </div>
                    {panel === 'upload'          && <UploadPanel onUploadComplete={() => setPanel('transcripts')} />}
                    {panel === 'analysis'        && <AnalysisPanel />}
                    {panel === 'transcript-chat' && <TranscriptChatPanel />}

                    {/* Feedback section (S3 / Athena) */}
                    {panel === 'feedback-overview' && <FeedbackOverviewPanel onNav={setPanel} onSync={goToSync} />}
                    {panel === 'feedback-trends'   && <FeedbackTrendsPanel />}
                    {panel === 'feedback-ratings'  && <FeedbackRatingsPanel />}
                    {panel === 'feedback-topics'   && <FeedbackTopicsPanel />}
                    {panel === 'feedback-browse'   && <FeedbackBrowsePanel syncTrigger={syncTrigger} />}
                    {panel === 'feedback-chat'     && <FeedbackChatPanel />}

                    {/* Support Tickets */}
                    {panel === 'ciec'  && <CIECPanel />}
                    {panel === 'aabsp' && <AABSPPanel />}

                    {/* Deep Dives */}
                    {panel === 'cannibalization' && <CannibalizationPanel />}
                    {panel === 'refund'          && <RefundAuditPanel />}

                    {/* Legacy panels */}
                    {panel === 'dashboard'  && <DashboardPanel onNav={setPanel} />}
                    {panel === 'ops'        && <OpsPanel />}
                    {panel === 'leadership' && <LeadershipPanel />}
                    {panel === 'chat'       && <ChatPanel />}
                    {panel === 'trends'     && <TrendsPanel />}
                    {panel === 'heatmap'    && <HeatmapPanel />}
                    {panel === 'tagcloud'   && <TagCloudPanel />}
                    {panel === 'funnel'     && <FunnelPanel />}
                </div>
            </div>
        </div>
    );
}

export default function SupportPlanePage() {
    return (
        <ProtectedRoute>
            <SupportPlaneApp />
        </ProtectedRoute>
    );
}
