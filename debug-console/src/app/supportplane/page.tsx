'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import ProtectedRoute from '@/components/ProtectedRoute';
import AABSPPanel from '@/components/supportplane/tickets/AABSPPanel';
import AnalysisPanel from '@/components/supportplane/analysis/AnalysisPanel';
import CIECPanel from '@/components/supportplane/tickets/CIECPanel';
import CannibalizationPanel from '@/components/supportplane/overview/CannibalizationPanel';
import ChatPanel from '@/components/supportplane/overview/ChatPanel';
import DashboardPanel from '@/components/supportplane/overview/DashboardPanel';
import FeedbackBrowsePanel from '@/components/supportplane/feedback/BrowsePanel';
import FeedbackChatPanel from '@/components/supportplane/feedback/ChatPanel';
import FeedbackDashboard from '@/components/supportplane/feedback/Dashboard';
import FeedbackOverviewPanel from '@/components/supportplane/feedback/OverviewPanel';
import FeedbackRatingsPanel from '@/components/supportplane/feedback/RatingsPanel';
import FeedbackTopicsPanel from '@/components/supportplane/feedback/TopicsPanel';
import FeedbackTrendsPanel from '@/components/supportplane/feedback/TrendsPanel';
import FunnelPanel from '@/components/supportplane/analysis/FunnelPanel';
import Header from '@/components/supportplane/_shell/Header';
import HeatmapPanel from '@/components/supportplane/analysis/HeatmapPanel';
import LeadershipPanel from '@/components/supportplane/overview/LeadershipPanel';
import OpsPanel from '@/components/supportplane/overview/OpsPanel';
import RefundAuditPanel from '@/components/supportplane/overview/RefundAuditPanel';
import Sidebar from '@/components/supportplane/_shell/Sidebar';
import TagCloudPanel from '@/components/supportplane/analysis/TagCloudPanel';
import TicketsDashboard from '@/components/supportplane/tickets/Dashboard';
import TodayPanel from '@/components/supportplane/overview/TodayPanel';
import TranscriptChatPanel from '@/components/supportplane/transcripts/ChatPanel';
import TranscriptsDashboard from '@/components/supportplane/transcripts/Dashboard';
import TranscriptsBrowsePanel from '@/components/supportplane/transcripts/BrowsePanel';
import TrendsPanel from '@/components/supportplane/analysis/TrendsPanel';
import UploadPanel from '@/components/supportplane/transcripts/UploadPanel';
import { type PanelId } from '@/components/supportplane/types';
import { useAuth } from '@/hooks/useAuth';
import { SupportPlaneDataProvider, useSupportPlaneData } from '@/contexts/SupportPlaneDataContext';
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
        <SupportPlaneDataProvider>
            <SupportPlaneAppContent
                containerRef={containerRef}
                theme={theme}
                panel={panel}
                setPanel={setPanel}
                collapsed={collapsed}
                toggleSidebar={toggleSidebar}
                toggleTheme={toggleTheme}
                user={user}
                goToSync={goToSync}
                syncTrigger={syncTrigger}
            />
        </SupportPlaneDataProvider>
    );
}

interface SupportPlaneAppContentProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
    theme: 'light' | 'dark';
    panel: PanelId;
    setPanel: (panel: PanelId) => void;
    collapsed: boolean;
    toggleSidebar: () => void;
    toggleTheme: () => void;
    user: ReturnType<typeof useAuth>['user'];
    goToSync: () => void;
    syncTrigger: number;
}

function SupportPlaneAppContent({
    containerRef,
    theme,
    panel,
    setPanel,
    collapsed,
    toggleSidebar,
    toggleTheme,
    user,
    goToSync,
    syncTrigger,
}: SupportPlaneAppContentProps) {
    const { loading: contextLoading } = useSupportPlaneData();

    React.useEffect(() => {
        containerRef.current?.setAttribute('data-theme', theme);
    }, [theme, containerRef]);

    return (
        <>
            <style>{`
                @keyframes sp-spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
            <div ref={containerRef} className={sp.sp} data-theme={theme}>
                <Sidebar active={panel} collapsed={collapsed} onSelect={setPanel} onToggle={toggleSidebar} />
                <div className={sp.main}>
                    <Header panel={panel} isDark={theme === 'dark'} email={user?.email ?? user?.shopperId} onToggle={toggleTheme} />
                    {/* Global loading indicator during initial data fetch */}
                    {contextLoading && (
                        <div style={{
                            padding: '8px 16px',
                            background: 'var(--sp-s2)',
                            borderBottom: '1px solid var(--sp-border)',
                            color: 'var(--sp-txm)',
                            fontSize: 12,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                        }}>
                            <div style={{
                                width: 12,
                                height: 12,
                                border: '2px solid var(--sp-txm)',
                                borderTopColor: 'transparent',
                                borderRadius: '50%',
                                animation: 'sp-spin 0.8s linear infinite',
                            }} />
                            Loading Support Plane data...
                        </div>
                    )}
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
        </>
    );
}

export default function SupportPlanePage() {
    return (
        <ProtectedRoute>
            <SupportPlaneApp />
        </ProtectedRoute>
    );
}
