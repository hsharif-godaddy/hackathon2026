'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import ProtectedRoute from '@/components/ProtectedRoute';
import polish from '@/components/risq-polish.module.css';
import RisqAgenticQaPanel from '@/components/RisqAgenticQaPanel';
import RisqE2ePanel from '@/components/RisqE2ePanel';
import RisqKpiRow, { type RisqKpiSnapshot } from '@/components/RisqKpiRow';
import RisqReleasesPanel, { type RisqReleasesPayload } from '@/components/RisqReleasesPanel';
import RisqSignalsSection, { type RisqSignalsTab } from '@/components/RisqSignalsSection';

type QualityKpiPanel = 'agentic' | 'e2e';

interface LangfuseModelPayload {
  model: string | null;
  trace_id: string | null;
  error?: string;
}

function badgeShell(children: ReactNode) {
  return <div className={polish.badge}>{children}</div>;
}

const kpiInitial: RisqKpiSnapshot = {
  feedback: { loading: true, negative: 0, total: 0 },
  traces: { loading: true, total: 0 },
  wau: { loading: true, curr_wau: 0, pct_change: 0 },
  agenticQa: { loading: true, passed: 0, failed: 0, total: 0 },
  e2e: { loading: true, prodPass: null, testPass: null, prodStatus: null, testStatus: null },
};

function RisqContent() {
  const [release, setRelease] = useState<RisqReleasesPayload | null>(null);
  const [releaseErr, setReleaseErr] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [modelErr, setModelErr] = useState<string | null>(null);
  const [kpi, setKpi] = useState<RisqKpiSnapshot>(kpiInitial);
  const signalsSectionRef = useRef<HTMLDivElement>(null);
  const [signalsTab, setSignalsTab] = useState<RisqSignalsTab>('langfuse');
  const [qualityPanel, setQualityPanel] = useState<QualityKpiPanel | null>(null);

  function navigateToSignalsTab(next: RisqSignalsTab) {
    setSignalsTab(next);
    window.setTimeout(function scrollToSignalsSection() {
      signalsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  useEffect(() => {
    let cancelled = false;
    async function loadReleases() {
      try {
        const res = await fetch('/api/releases');
        const body: unknown = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          const err =
            body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
              ? (body as { error: string }).error
              : `HTTP ${res.status}`;
          setReleaseErr(err);
          setRelease(null);
          return;
        }
        setReleaseErr(null);
        setRelease(body as RisqReleasesPayload);
      } catch (e) {
        if (!cancelled) setReleaseErr(e instanceof Error ? e.message : 'Request failed');
      }
    }
    void loadReleases();
    return function cleanup() {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadModel() {
      try {
        const res = await fetch('/api/langfuse-analytics?action=model');
        const body = (await res.json().catch(() => null)) as LangfuseModelPayload | null;
        if (cancelled) return;
        if (!res.ok) {
          setModelErr(body?.error ?? `HTTP ${res.status}`);
          setModel(null);
          return;
        }
        setModelErr(null);
        setModel(body?.model ?? null);
      } catch (e) {
        if (!cancelled) setModelErr(e instanceof Error ? e.message : 'Request failed');
      }
    }
    void loadModel();
    return function cleanupModel() {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadKpis() {
      const now = new Date();
      const from7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const toIso = now.toISOString();
      const lfUrl = `/api/langfuse-analytics?action=overview&fromTimestamp=${encodeURIComponent(from7d)}&toTimestamp=${encodeURIComponent(toIso)}`;

      const [fbRes, lfRes, wauRes, qaRes, e2eRes] = await Promise.all([
        fetch('/api/feedback/summary?days=1'),
        fetch(lfUrl),
        fetch('/api/c1-analytics?action=wau'),
        fetch('/api/qa-results?action=summary-7d'),
        fetch('/api/e2e-runs?action=summary'),
      ]);

      if (cancelled) return;

      const qaJson = (await qaRes.json().catch(() => ({}))) as {
        error?: string;
        passed?: number;
        failed?: number;
        total?: number;
      };
      const agenticQa: RisqKpiSnapshot['agenticQa'] = qaRes.ok
        ? {
            loading: false,
            passed: qaJson.passed ?? 0,
            failed: qaJson.failed ?? 0,
            total: qaJson.total ?? 0,
          }
        : {
            loading: false,
            error: typeof qaJson.error === 'string' ? qaJson.error : `HTTP ${qaRes.status}`,
            passed: 0,
            failed: 0,
            total: 0,
          };

      const e2eJson = (await e2eRes.json().catch(() => ({}))) as {
        error?: string;
        prodPass?: boolean | null;
        testPass?: boolean | null;
        prodStatus?: string | null;
        testStatus?: string | null;
      };
      const e2e: RisqKpiSnapshot['e2e'] = e2eRes.ok
        ? {
            loading: false,
            prodPass: e2eJson.prodPass ?? null,
            testPass: e2eJson.testPass ?? null,
            prodStatus: e2eJson.prodStatus ?? null,
            testStatus: e2eJson.testStatus ?? null,
          }
        : {
            loading: false,
            error: typeof e2eJson.error === 'string' ? e2eJson.error : `HTTP ${e2eRes.status}`,
            prodPass: null,
            testPass: null,
            prodStatus: null,
            testStatus: null,
          };

      const fbJson = (await fbRes.json().catch(() => ({}))) as {
        error?: string;
        negative?: number;
        total?: number;
      };
      const feedback: RisqKpiSnapshot['feedback'] = fbRes.ok
        ? {
            loading: false,
            negative: fbJson.negative ?? 0,
            total: fbJson.total ?? 0,
          }
        : {
            loading: false,
            error: typeof fbJson.error === 'string' ? fbJson.error : `HTTP ${fbRes.status}`,
            negative: 0,
            total: 0,
          };

      const lfJson = (await lfRes.json().catch(() => ({}))) as { error?: string; total_traces?: number };
      const traces: RisqKpiSnapshot['traces'] = lfRes.ok
        ? { loading: false, total: lfJson.total_traces ?? 0 }
        : {
            loading: false,
            error: typeof lfJson.error === 'string' ? lfJson.error : `HTTP ${lfRes.status}`,
            total: 0,
          };

      const wauJson = (await wauRes.json().catch(() => ({}))) as {
        error?: string;
        curr_wau?: number;
        pct_change?: number;
      };
      const wau: RisqKpiSnapshot['wau'] = wauRes.ok
        ? {
            loading: false,
            curr_wau: wauJson.curr_wau ?? 0,
            pct_change: wauJson.pct_change ?? 0,
          }
        : {
            loading: false,
            error: typeof wauJson.error === 'string' ? wauJson.error : `HTTP ${wauRes.status}`,
            curr_wau: 0,
            pct_change: 0,
          };

      setKpi({ feedback, traces, wau, agenticQa, e2e });
    }
    void loadKpis();
    return function cleanupKpis() {
      cancelled = true;
    };
  }, []);

  const tagDisplay = release?.tag ?? '—';
  const modelDisplay = model ?? '—';

  return (
    <div className={polish.page} style={{ fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <div className={polish.pageInner}>
        <header className={polish.header}>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <h1
              style={{
                margin: 0,
                fontSize: '1.42rem',
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: '#1e293b',
              }}
            >
              Airo Builder <span style={{ color: '#5b21b6' }}>RISQ</span>
            </h1>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#64748b', fontWeight: 500 }}>
              Release Intelligence, Signals & Quality
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              flex: '2 1 280px',
            }}
          >
            {badgeShell(
              <>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: '#22c55e',
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: '#6b7280', fontWeight: 600 }}>Release</span>
                <span
                  style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    color: '#2563eb',
                    fontWeight: 600,
                  }}
                >
                  {releaseErr ? 'unavailable' : tagDisplay}
                </span>
              </>,
            )}
            {badgeShell(
              <>
                <span style={{ color: '#6b7280', fontWeight: 600 }}>Model</span>
                <span
                  style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    color: '#2563eb',
                    fontWeight: 600,
                  }}
                >
                  {modelErr ? 'unavailable' : modelDisplay}
                </span>
              </>,
            )}
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '0.65rem',
              flex: '1 1 200px',
              justifyContent: 'flex-end',
            }}
          >
            <a href="/" className={polish.returnLink}>
              Return to dashboard
            </a>
          </div>
        </header>

        <div className={polish.kpiBand}>
          <RisqKpiRow
            {...kpi}
            onFeedbackClick={function kpiFeedbackNavigate() {
              navigateToSignalsTab('feedback');
            }}
            onTracesClick={function kpiTracesNavigate() {
              navigateToSignalsTab('langfuse');
            }}
            onAgenticQaClick={function kpiAgenticToggle() {
              setQualityPanel(function (v) {
                return v === 'agentic' ? null : 'agentic';
              });
            }}
            onE2eClick={function kpiE2eToggle() {
              setQualityPanel(function (v) {
                return v === 'e2e' ? null : 'e2e';
              });
            }}
            qualityPanelSelection={qualityPanel}
            onWauClick={function kpiWauNavigate() {
              navigateToSignalsTab('c1');
            }}
          />
        </div>

        {qualityPanel === 'agentic' ? (
          <div
            id="risq-kpi-detail-panel"
            className={polish.detailPanel}
            style={{
              marginBottom: '1.15rem',
              borderRadius: 16,
              border: '1px solid #e4eaf4',
              background: 'linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)',
              boxShadow: '0 6px 28px rgba(59, 130, 246, 0.07)',
              overflow: 'hidden',
              scrollMarginTop: '0.75rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                borderBottom: '1px solid #edf2fa',
                background: 'linear-gradient(180deg, #ffffff 0%, #f7faff 100%)',
              }}
            >
              <h2 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, letterSpacing: '-0.02em', color: '#0f172a' }}>
                Agentic QA
              </h2>
              <button
                type="button"
                onClick={function dismissQualityPanel() {
                  setQualityPanel(null);
                }}
                style={{
                  padding: '0.4rem 0.85rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#475569',
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
            <div style={{ padding: '0.65rem 0.75rem 1rem' }}>
              <RisqAgenticQaPanel />
            </div>
          </div>
        ) : qualityPanel === 'e2e' ? (
          <div id="risq-kpi-detail-panel" className={polish.detailPanel} style={{ marginBottom: '1.15rem', scrollMarginTop: '0.75rem' }}>
            <RisqE2ePanel
              onDismiss={function dismissE2ePanel() {
                setQualityPanel(null);
              }}
            />
          </div>
        ) : null}

        {(releaseErr || modelErr) && (
          <div
            style={{
              marginBottom: '1rem',
              padding: '0.75rem 1rem',
              borderRadius: '10px',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              fontSize: '0.82rem',
            }}
          >
            {releaseErr ? <div>Releases: {releaseErr}</div> : null}
            {modelErr ? <div>Langfuse model: {modelErr}</div> : null}
          </div>
        )}

        <div id="risq-releases" style={{ scrollMarginTop: '0.85rem', marginTop: '0.35rem' }}>
          {release ? (
            <div style={{ marginTop: '0.35rem' }}>
              <RisqReleasesPanel release={release} />
            </div>
          ) : null}
        </div>

        <div ref={signalsSectionRef} id="risq-signals-section" style={{ scrollMarginTop: '0.85rem', marginTop: '0.5rem' }}>
          <RisqSignalsSection signalsTab={signalsTab} onSignalsTabChange={setSignalsTab} />
        </div>
      </div>
    </div>
  );
}

export default function RisqPage() {
  return (
    <ProtectedRoute>
      <RisqContent />
    </ProtectedRoute>
  );
}
