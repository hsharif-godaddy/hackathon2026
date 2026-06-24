
// ── Panel IDs ─────────────────────────────────────────────────────────────────

export type PanelId =
    // ── Executive view ───────────────────────────────────────────
    | 'today'
    // ── Top-level dashboards ─────────────────────────────────────
    | 'dash-transcripts' | 'dash-feedback' | 'dash-tickets'
    // ── L1 Transcripts section ───────────────────────────────────
    | 'transcripts' | 'upload' | 'analysis' | 'transcript-chat' | 'derived-insights'
    // ── Feedback section (S3 / Athena) ───────────────────────────
    | 'feedback-overview' | 'feedback-trends' | 'feedback-ratings'
    | 'feedback-topics' | 'feedback-browse' | 'feedback-chat'
    // ── Support Tickets section (Jira) ───────────────────────────
    | 'ciec' | 'aabsp'
    // ── Deep Dives ───────────────────────────────────────────────
    | 'cannibalization' | 'refund'
    // ── System ───────────────────────────────────────────────────
    | 'app-logs'
    // ── Legacy (keep routing working) ───────────────────────────
    | 'dashboard' | 'ops' | 'leadership' | 'chat'
    | 'trends' | 'heatmap' | 'tagcloud' | 'funnel';

// ── Service health ─────────────────────────────────────────────────────────
// The live values come from GET /api/supportplane/services/health.
// This static list is used only as the loading skeleton (ok: null = amber).

export const SERVICE_HEALTH_SKELETON = [
    { name: 'GoCaaS (AI)',    ok: null as boolean | null },
    { name: 'Jira',           ok: null as boolean | null },
    { name: 'ServiceNow',     ok: null as boolean | null },
    { name: 'SharePoint',     ok: null as boolean | null },
    { name: 'S3 · Transcripts', ok: null as boolean | null },
    { name: 'S3 · Feedback',  ok: null as boolean | null },
];

// ── Jira ticket (source of truth is lib/jira-client.ts) ──────────────────────

export type { JiraTicket } from '@/lib/jira-client';

export function ageLabel(iso: string): string {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (days === 0) return 'Today';
    if (days === 1) return '1d';
    return `${days}d`;
}

// ── Nav config ────────────────────────────────────────────────────────────────

export interface NavItem { id: PanelId; label: string; icon: React.ReactNode; }
export interface NavGroup { label: string; items: NavItem[]; }

export const PANEL_LABELS: Record<PanelId, string> = {
    // Executive
    today: 'TODAY — Executive Cross-Domain View',
    // Dashboards
    'dash-transcripts': 'Dashboards — L1 Transcripts',
    'dash-feedback':    'Dashboards — Feedback Intelligence',
    'dash-tickets':     'Dashboards — Support Tickets',
    // L1 Transcripts
    transcripts:        'L1 Transcripts — Browse',
    upload:             'L1 Transcripts — Upload & Sync',
    analysis:           'L1 Transcripts — Deep Dive Analysis',
    'transcript-chat':  'L1 Transcripts — AI Chat',
    'derived-insights': 'L1 Transcripts — Derived Insights (ML)',
    // Feedback
    'feedback-overview': 'Feedback — Overview',
    'feedback-trends':   'Feedback — Trends (WoW / MoM)',
    'feedback-ratings':  'Feedback — Rating Distribution',
    'feedback-topics':   'Feedback — Topic Analysis',
    'feedback-browse':   'Feedback — Browse Data',
    'feedback-chat':     'Feedback — AI Chat',
    // Support Tickets
    ciec:  'Support Tickets — CIEC Board',
    aabsp: 'Support Tickets — AABSP Board',
    // Deep Dives
    cannibalization: 'Deep Dives — Cannibalization',
    refund:          'Deep Dives — Refund Audit',
    // System
    'app-logs': 'System — App Logs',
    // Legacy
    dashboard:  'Dashboards — Support Dashboard',
    ops:        'Dashboards — Ops Overview',
    leadership: 'Dashboards — Leadership View',
    chat:       'Dashboards — AI Chat',
    trends:     'Analytics — Trend Analysis',
    heatmap:    'Analytics — Heatmap',
    tagcloud:   'Analytics — Intent Tags',
    funnel:     'Analytics — Support Funnel',
};
