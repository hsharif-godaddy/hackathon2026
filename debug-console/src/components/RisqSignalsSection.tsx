'use client';

import { useMemo, type CSSProperties, type ReactNode } from 'react';

import C1AnalyticsPanel from '@/components/C1AnalyticsPanel';
import LangfuseInsightsPanel from '@/components/LangfuseInsightsPanel';
import polish from '@/components/risq-polish.module.css';
import RisqCustomerFeedbackPanel from '@/components/RisqCustomerFeedbackPanel';

export type RisqSignalsTab = 'langfuse' | 'c1' | 'feedback' | 'layer5';

export interface RisqSignalsSectionProps {
  signalsTab: RisqSignalsTab;
  onSignalsTabChange: (tab: RisqSignalsTab) => void;
}

const layer5Tools: ReadonlyArray<{
  icon: string;
  title: string;
  description: string;
  href: string | null;
}> = [
  {
    icon: '📊',
    title: 'Langfuse',
    description: 'Trace detail, observation tree, LLM I/O, spans, tool calls, eval scores, experiments',
    href: 'https://agentobser-langfuse.int.godaddy.com/project/cmj7ew7m20026tr41gsi9knd4',
  },
  {
    icon: '🖥️',
    title: 'Console',
    description: 'App status, deployment states, subscription, credit usage, error logs',
    href: 'https://console.airo-builder.godaddy.com/',
  },
  {
    icon: '📈',
    title: 'Elastic / Kibana',
    description: 'Full latency histograms, error breakdowns, tool-level operational detail',
    href: 'https://airobuilde-prod-usw2.kb.us-west-2.aws.found.io:9243/app/home',
  },
  {
    icon: '✅',
    title: 'E2E Run Dashboard',
    description: 'Scheduled Playwright E2E runs on main — success rate, per-run status and duration, links to the GitHub run report',
    href: 'https://console.airo-builder.godaddy.com/e2e-run-dashboard',
  },
  {
    icon: '🎬',
    title: 'FullStory',
    description: 'Full user interaction video, click heatmaps, frustration signals',
    href: 'https://app.fullstory.com/ui/YKBRC/spaces/lH0Koqn0GIoV?tab=home',
  },
  {
    icon: '🗄️',
    title: 'ClickHouse',
    description: 'Raw event data, funnel queries, retention analysis, custom SQL exploration',
    href: 'https://clickhouse.airo-builder.godaddy.com/',
  },
  {
    icon: '📉',
    title: 'QuickSight',
    description: 'DAU/MAU, retention, cohort analysis, funnel breakdowns',
    href: 'https://us-west-2.quicksight.aws.amazon.com/sn/account/gd-aws-usa-gpd-ckpanalytics/accounts/561403605607/dashboards/9719b5b3-45a2-4729-bbbc-2f9239322e93/sheets/9719b5b3-45a2-4729-bbbc-2f9239322e93_edf5ea98-df37-4167-80d6-04145f40bcfa',
  },
  {
    icon: '💬',
    title: 'Slack #releases',
    description: 'Release notes, deploy thread, rollback discussion',
    href: 'https://godaddy.enterprise.slack.com/archives/C0AQ4817Q3Z',
  },
  {
    icon: '💬',
    title: 'Slack #feedback',
    description: 'User feedback, thumbs up/down signals, sentiment reports',
    href: 'https://godaddy.enterprise.slack.com/archives/C09E8ETF1FE',
  },
  {
    icon: '🚨',
    title: 'Incident Management',
    description: 'Full incident timeline, runbook, post-mortem',
    href: null,
  },
];

const shell: CSSProperties = {
  background: 'linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)',
  border: '1px solid #e4eaf4',
  borderRadius: 14,
  boxShadow: '0 4px 22px rgba(59, 130, 246, 0.06)',
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  overflow: 'hidden',
};

function tabButtonStyle(active: boolean): CSSProperties {
  if (active) {
    return {
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      minWidth: 0,
      padding: '0.5rem 0.65rem 0.65rem',
      border: '1px solid #e5e7eb',
      borderRadius: 14,
      backgroundColor: '#ffffff',
      cursor: 'pointer',
      fontSize: '0.8rem',
      fontWeight: 600,
      color: '#2563eb',
      textAlign: 'center',
      lineHeight: 1.3,
      boxSizing: 'border-box',
      boxShadow: '0 2px 10px rgba(15, 23, 42, 0.06)',
      transition: 'color 0.2s ease, border-color 0.2s ease, box-shadow 0.22s ease, transform 0.2s ease',
    };
  }
  return {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    minWidth: 0,
    padding: '0.5rem 0.65rem',
    border: '1px solid transparent',
    borderRadius: 14,
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontWeight: 500,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 1.3,
    boxSizing: 'border-box',
    transition: 'color 0.2s ease, background-color 0.22s ease, transform 0.18s ease',
  };
}

const tabGradientUnderline: CSSProperties = {
  position: 'absolute',
  left: '12%',
  right: '12%',
  bottom: 4,
  height: 3,
  borderRadius: 999,
  background: 'linear-gradient(90deg, #2563eb 0%, #7c3aed 55%, #a855f7 100%)',
  pointerEvents: 'none',
};

const toolGrid: CSSProperties = {
  display: 'grid',
  width: '100%',
  boxSizing: 'border-box',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
  gap: '0.95rem',
};

function toolCardBase(link: boolean): CSSProperties {
  return {
    display: 'block',
    padding: '1.12rem 1.15rem',
    borderRadius: 12,
    border: '1px solid #e5e7eb',
    backgroundColor: '#ffffff',
    boxShadow: '0 2px 10px rgba(15,23,42,0.055)',
    textDecoration: 'none',
    color: 'inherit',
    boxSizing: 'border-box',
    cursor: link ? 'pointer' : 'default',
    opacity: link ? 1 : 0.92,
  };
}

const tabs: ReadonlyArray<{ id: RisqSignalsTab; line: string }> = [
  { id: 'langfuse', line: 'Layer 2: Langfuse analysis' },
  { id: 'c1', line: 'Layer 3: Engagement Analytics — C1 Customers' },
  { id: 'feedback', line: 'Layer 4: Customer feedback' },
  { id: 'layer5', line: 'Layer 5: Apps & tools' },
];

function SignalsTabPanel({
  tabId,
  activeTab,
  children,
}: {
  tabId: RisqSignalsTab;
  activeTab: RisqSignalsTab;
  children: ReactNode;
}) {
  return (
    <div hidden={activeTab !== tabId} role="tabpanel">
      {children}
    </div>
  );
}

export default function RisqSignalsSection({ signalsTab, onSignalsTabChange }: RisqSignalsSectionProps) {
  const lfWindow = useMemo(function computeLfWindow() {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { from: start.toISOString(), to: end.toISOString() };
  }, []);

  return (
    <div style={{ marginTop: '1.45rem' }}>
      <div style={{ marginBottom: '0.65rem' }}>
        <h2
          style={{
            margin: 0,
            fontSize: '0.95rem',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: '#0f172a',
          }}
        >
          Signals
        </h2>
        <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.78rem', color: '#64748b', fontWeight: 500 }}>
          Deep dives and external tools — pick a lane.
        </p>
      </div>

      <div className={polish.signalsShell} style={{ ...shell, width: '100%', boxSizing: 'border-box' }}>
        <div className={polish.signalsTabBar} role="tablist" aria-label="RISQ signal sources">
          {tabs.map(function mapTab(tab) {
            const active = signalsTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={[polish.tabButton, !active ? polish.tabButtonInactive : null].filter(Boolean).join(' ')}
                onClick={function selectTab() {
                  onSignalsTabChange(tab.id);
                }}
                style={tabButtonStyle(active)}
              >
                <span style={{ display: 'block', whiteSpace: 'normal', wordBreak: 'break-word' }}>{tab.line}</span>
                {active ? <span aria-hidden style={tabGradientUnderline} /> : null}
              </button>
            );
          })}
        </div>

        <div style={{ padding: '1.05rem 1rem 1.2rem', width: '100%', boxSizing: 'border-box' }}>
          <SignalsTabPanel tabId="langfuse" activeTab={signalsTab}>
            <LangfuseInsightsPanel fromTimestamp={lfWindow.from} toTimestamp={lfWindow.to} />
          </SignalsTabPanel>
          <SignalsTabPanel tabId="c1" activeTab={signalsTab}>
            <C1AnalyticsPanel />
          </SignalsTabPanel>
          <SignalsTabPanel tabId="feedback" activeTab={signalsTab}>
            <RisqCustomerFeedbackPanel />
          </SignalsTabPanel>
          <SignalsTabPanel tabId="layer5" activeTab={signalsTab}>
            <div
              style={{
                width: 'calc(100% + 2rem)',
                maxWidth: 'none',
                marginLeft: '-1rem',
                marginRight: '-1rem',
                boxSizing: 'border-box',
                backgroundColor: '#ffffff',
                border: '1px solid #e5e7eb',
                borderRadius: 12,
                padding: '1.05rem 1rem',
                boxShadow: '0 2px 12px rgba(15,23,42,0.06)',
              }}
            >
              <div style={toolGrid}>
                {layer5Tools.map(function mapLayer5Tool(tool) {
                  const inner = (
                    <>
                      <div style={{ fontSize: '1.35rem', lineHeight: 1, marginBottom: '0.45rem' }}>{tool.icon}</div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.35rem' }}>
                        {tool.title}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#64748b', lineHeight: 1.45 }}>{tool.description}</div>
                    </>
                  );
                  if (tool.href) {
                    return (
                      <a
                        key={tool.title}
                        href={tool.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${polish.layer5ToolCard} ${polish.layer5ToolCardLink}`}
                        style={toolCardBase(true)}
                      >
                        {inner}
                      </a>
                    );
                  }
                  return (
                    <div key={tool.title} className={`${polish.layer5ToolCard} ${polish.layer5ToolCardStatic}`} style={toolCardBase(false)}>
                      {inner}
                    </div>
                  );
                })}
              </div>
            </div>
          </SignalsTabPanel>
        </div>
      </div>
    </div>
  );
}
