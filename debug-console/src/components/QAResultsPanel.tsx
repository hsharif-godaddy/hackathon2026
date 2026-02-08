'use client';

import React, { useCallback, useEffect, useState } from 'react';

interface QARun {
  id: string;
  scenario: string;
  success: boolean;
  timestamp: string;
  steps: number;
  durationMinutes: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costEstimateUSD: number;
  actionCount: number;
  previewUrl?: string;
  runNumber: string;
  gitBranch: string;
  runUrl?: string;
  uniquePageUrls?: string[];
  finalPageUrl?: string;
  message: string;
}

interface QARunDetail extends QARun {
  duration: number;
  durationSeconds: number;
  tokensPerStep: number;
  actionTypes: string[];
  uniqueActionTypes: string[];
  pageUrlCount: number;
  firstActionTimestamp: string;
  lastActionTimestamp: string;
  actionDurationMs: number;
  actionsJson: string;
  screenshotCount: number;
  screenshotTypes: string[];
  previewScreenshotCount: number;
  errorScreenshotCount: number;
  environment: string;
  gitSha: string;
  gitRef: string;
  runId: string;
  runAttempt: string;
  actor: string;
  triggerActor: string;
  repository: string;
  workflow: string;
  job: string;
  eventName: string;
  indexedAt: string;
  model: string;
  rawMessage: string;
  screenshots: Array<{
    type: string;
    url: string;
    timestamp: string;
    base64: string;
    scrollPosition?: string;
  }>;
  qualityScore: number;
  qualityGrade: string;
  qualityCriticalIssues: string;
  qualityRecommendations: string;
  accessibilityScore: number;
  accessibilityViolationsCritical: number;
  accessibilityViolationsSerious: number;
  businessFitScore: number;
  businessFitSiteType: string;
  contentScore: number;
  contentCoherence: number;
  contentRelevance: number;
  functionalScore: number;
  functionalBrokenLinks: number;
  functionalJsErrors: number;
  performanceScore: number;
  securityScore: number;
  securityIsHttps: boolean;
  seoScore: number;
  usabilityScore: number;
  visualScore: number;
  visualPlaceholders: number;
}

function extractAppId(finalPageUrl?: string, urls?: string[]): string | null {
  if (finalPageUrl) {
    const match = finalPageUrl.match(/\/develop\/([a-z0-9]+)(?:\?|$)/);
    if (match) return match[1];
  }
  if (!urls) return null;
  for (const url of urls) {
    if (url.includes('type=job')) continue;
    const match = url.match(/\/develop\/([a-z0-9]+)(?:\?|$)/);
    if (match) return match[1];
  }
  return null;
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  });
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  return `${minutes.toFixed(1)}m`;
}

interface ActionStep {
  type: string;
  reasoning?: string;
  action?: string;
  taskCompleted?: boolean;
  pageUrl?: string;
  timestampISO?: string;
  stepNumber?: number;
}

interface Screenshot {
  type: string;
  url: string;
  timestamp: string;
  base64: string;
  scrollPosition?: string;
}

interface ScreenshotGalleryProps {
  screenshots: Screenshot[];
  onSelect: (screenshot: { src: string; alt: string }) => void;
}

function ScreenshotGallery({ screenshots, onSelect }: ScreenshotGalleryProps) {
  if (!screenshots?.length) return null;

  return (
    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
      {screenshots.map((ss, idx) => (
        <div
          key={idx}
          onClick={() => onSelect({
            src: `data:image/png;base64,${ss.base64}`,
            alt: `${ss.type}${ss.scrollPosition ? ' (' + ss.scrollPosition + ')' : ''} — ${ss.url}`
          })}
          style={{ cursor: 'zoom-in', position: 'relative', borderRadius: '6px', overflow: 'hidden', border: '1px solid #e2e8f0', flexShrink: 0 }}
        >
          <img
            src={`data:image/png;base64,${ss.base64}`}
            alt={ss.type}
            style={{ height: '80px', width: 'auto', display: 'block' }}
          />
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff',
            fontSize: '0.5rem', padding: '0.15rem 0.3rem',
            textAlign: 'center', fontWeight: 600
          }}>
            {ss.type}{ss.scrollPosition ? ` (${ss.scrollPosition})` : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

function parseActions(json: string): ActionStep[] {
  try {
    return JSON.parse(json);
  } catch (err) {
    console.error('Failed to parse actions JSON:', err);
    return [];
  }
}

const INFO_BAR_STYLE: React.CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderRadius: '6px',
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '0.6rem',
  fontSize: '0.7rem',
  color: '#475569'
};

const BAR_LABEL_STYLE: React.CSSProperties = {
  fontSize: '0.6rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginRight: '0.25rem',
  whiteSpace: 'nowrap'
};

const SEP = <span style={{ color: '#cbd5e1', margin: '0 0.1rem' }}>·</span>;

function InfoStat({ label, value, color, suffix }: { label: string; value: string | number; color?: string; suffix?: string }) {
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      {label}{label ? ' ' : ''}<strong style={{ color: color || '#1e293b' }}>{value}</strong>{suffix && <span style={{ color: '#94a3b8' }}>{suffix}</span>}
    </span>
  );
}

function scoreColor(score: number): string {
  if (score >= 90) return '#16a34a';
  if (score >= 70) return '#ca8a04';
  if (score >= 50) return '#ea580c';
  return '#dc2626';
}

function gradeColor(grade: string): string {
  if (grade === 'A' || grade === 'A+') return '#16a34a';
  if (grade === 'B' || grade === 'B+') return '#2563eb';
  if (grade === 'C' || grade === 'C+') return '#ca8a04';
  return '#dc2626';
}

function ActionTimeline({ actions }: { actions: ActionStep[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  const typeColors: Record<string, { bg: string; fg: string }> = {
    screenshot: { bg: '#dbeafe', fg: '#1e40af' },
    ariaTree: { bg: '#e0e7ff', fg: '#3730a3' },
    think: { bg: '#fef3c7', fg: '#92400e' },
    act: { bg: '#dcfce7', fg: '#166534' },
    wait: { bg: '#f3f4f6', fg: '#374151' },
    keys: { bg: '#ede9fe', fg: '#5b21b6' },
    scroll: { bg: '#f1f5f9', fg: '#475569' },
    done: { bg: '#d1fae5', fg: '#065f46' },
  };

  // Group consecutive same-type actions
  const grouped: Array<{ type: string; steps: ActionStep[]; startIdx: number }> = [];
  for (const action of actions) {
    const last = grouped[grouped.length - 1];
    if (last && last.type === action.type && !action.reasoning && !action.action) {
      last.steps.push(action);
    } else {
      grouped.push({ type: action.type, steps: [action], startIdx: grouped.length });
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '400px', overflowY: 'auto' }}>
      {grouped.map((group, idx) => {
        const first = group.steps[0];
        const colors = typeColors[group.type] || { bg: '#f3f4f6', fg: '#374151' };
        const hasDetail = first.reasoning || first.action;
        const isExpanded = expanded === idx;

        return (
          <div key={idx}>
            <div
              onClick={() => hasDetail && setExpanded(isExpanded ? null : idx)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.35rem 0.5rem',
                borderRadius: '4px',
                cursor: hasDetail ? 'pointer' : 'default',
                backgroundColor: isExpanded ? '#f8fafc' : 'transparent',
                fontSize: '0.75rem'
              }}
            >
              <span style={{
                display: 'inline-block',
                padding: '0.125rem 0.5rem',
                borderRadius: '3px',
                backgroundColor: colors.bg,
                color: colors.fg,
                fontWeight: 600,
                fontSize: '0.65rem',
                fontFamily: 'monospace',
                minWidth: '65px',
                textAlign: 'center'
              }}>
                {group.type}
              </span>
              <span style={{ color: '#64748b', fontSize: '0.7rem', fontFamily: 'monospace' }}>
                #{first.stepNumber}
                {group.steps.length > 1 && `–${group.steps[group.steps.length - 1].stepNumber}`}
              </span>
              {first.action && (
                <span style={{ color: '#334155', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {first.action}
                </span>
              )}
              {first.reasoning && !first.action && (
                <span style={{ color: '#64748b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {first.reasoning.substring(0, 80)}...
                </span>
              )}
              {hasDetail && (
                <span style={{ color: '#94a3b8', fontSize: '0.6rem' }}>
                  {isExpanded ? '▼' : '▶'}
                </span>
              )}
            </div>
            {isExpanded && first.reasoning && (
              <div style={{
                marginLeft: '80px',
                padding: '0.5rem 0.75rem',
                backgroundColor: '#f8fafc',
                borderRadius: '4px',
                fontSize: '0.7rem',
                color: '#475569',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                maxHeight: '200px',
                overflowY: 'auto',
                borderLeft: `2px solid ${colors.bg}`
              }}>
                {first.reasoning}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ScreenshotLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        backgroundColor: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'zoom-out'
      }}
    >
      <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
        <img src={src} alt={alt} style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: '8px', boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }} />
        <div style={{
          position: 'absolute', bottom: '-2rem', left: 0, right: 0,
          textAlign: 'center', color: '#94a3b8', fontSize: '0.75rem'
        }}>
          {alt}
        </div>
      </div>
    </div>
  );
}

export default function QAResultsPanel() {
  const [runs, setRuns] = useState<QARun[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [detail, setDetail] = useState<QARunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [expandedScreenshot, setExpandedScreenshot] = useState<{ src: string; alt: string } | null>(null);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    setRunsError(null);
    try {
      const res = await fetch('/api/qa-results?action=list');
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs || []);
      } else {
        setRunsError('Failed to load QA runs. Please try again.');
      }
    } catch (err) {
      console.error('Failed to fetch QA runs:', err);
      setRunsError('Failed to load QA runs. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }

    setDetailLoading(true);
    setDetailError(null);
    const params = new URLSearchParams({ action: 'detail', id: selectedId });
    fetch(`/api/qa-results?${params}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.run) {
          setDetail(data.run);
        } else {
          setDetail(null);
          setDetailError('Run details not found');
        }
      })
      .catch(err => {
        console.error('Failed to load run details:', err);
        setDetail(null);
        setDetailError('Failed to load run details. Please try again.');
      })
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  const appId = detail ? extractAppId(detail.finalPageUrl, detail.uniquePageUrls) : null;
  const actions = detail?.actionsJson ? parseActions(detail.actionsJson) : [];

  // Langfuse stats for the appId
  const [langfuseStats, setLangfuseStats] = useState<{
    traces: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    totalCost: number;
    models: string[];
    langfuseUrl: string | null;
  } | null>(null);
  const [langfuseLoading, setLangfuseLoading] = useState(false);

  useEffect(() => {
    if (!appId) {
      setLangfuseStats(null);
      return;
    }

    setLangfuseLoading(true);
    const tracesParams = new URLSearchParams({ appId, limit: '100' });
    Promise.all([
      fetch(`/api/langfuse/traces?${tracesParams}`).then(r => r.ok ? r.json() : null),
      fetch('/api/langfuse/config').then(r => r.ok ? r.json() : null)
    ])
      .then(function processLangfuseStats([tracesData, config]) {
        if (!tracesData?.data) {
          setLangfuseStats(null);
          return;
        }
        const traces = tracesData.data;
        let totalTokens = 0, promptTokens = 0, completionTokens = 0, totalCost = 0;
        const modelSet = new Set<string>();

        for (const t of traces) {
          totalTokens += t.totalTokens || 0;
          promptTokens += t.promptTokens || 0;
          completionTokens += t.completionTokens || 0;
          totalCost += t.totalCost || 0;
          const model = t.metadata?.attributes?.['ai.model.id'];
          if (model) modelSet.add(model);
        }

        const langfuseUrl = config?.baseUrl && config?.projectId
          ? `${config.baseUrl}/project/${config.projectId}/users/${appId}`
          : null;

        setLangfuseStats({
          traces: tracesData.meta?.totalItems || traces.length,
          totalTokens,
          promptTokens,
          completionTokens,
          totalCost,
          models: Array.from(modelSet),
          langfuseUrl
        });
      })
      .catch(err => {
        console.error('Failed to fetch Langfuse stats:', err);
        setLangfuseStats(null);
      })
      .finally(() => setLangfuseLoading(false));
  }, [appId]);

  return (
    <div style={{
      backgroundColor: 'rgba(255,255,255,0.97)',
      padding: '1.5rem',
      borderRadius: '12px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.08)'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>
            Agentic QA Results
          </h3>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#64748b' }}>
            Automated end-to-end test runs against Airo Builder
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={loading}
            style={{
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              fontSize: '0.8rem',
              backgroundColor: 'white',
              cursor: 'pointer',
              minWidth: '300px'
            }}
          >
            <option value="">Select a run...</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {formatDate(run.timestamp)} — {run.scenario} ({formatDuration(run.durationMinutes)}, ${run.costEstimateUSD.toFixed(2)})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Runs list error */}
      {runsError && !loading && (
        <div style={{
          padding: '1rem',
          marginBottom: '1rem',
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '8px',
          color: '#dc2626',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>{runsError}</span>
          <button
            onClick={fetchRuns}
            style={{
              padding: '0.25rem 0.75rem',
              backgroundColor: '#dc2626',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.75rem'
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading */}
      {detailLoading && (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
          Loading run details...
        </div>
      )}

      {/* Error */}
      {detailError && !detailLoading && (
        <div style={{
          padding: '1rem',
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '8px',
          color: '#dc2626',
          textAlign: 'center'
        }}>
          {detailError}
        </div>
      )}

      {/* Empty state */}
      {!selectedId && !loading && (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', fontSize: '0.85rem' }}>
          Select a successful QA run from the dropdown to view detailed analytics
        </div>
      )}

      {/* Detail view */}
      {detail && !detailLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Overview bar */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.75rem 1rem',
            backgroundColor: detail.success ? '#f0fdf4' : '#fef2f2',
            borderRadius: '8px',
            border: `1px solid ${detail.success ? '#bbf7d0' : '#fecaca'}`
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{
                fontSize: '1.25rem',
                width: '2rem',
                height: '2rem',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: detail.success ? '#dcfce7' : '#fee2e2',
                color: detail.success ? '#16a34a' : '#dc2626'
              }}>
                {detail.success ? '✓' : '✗'}
              </span>
              <div>
                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.95rem' }}>
                  {detail.scenario}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.125rem' }}>
                  Run #{detail.runNumber} · {detail.gitBranch} · {detail.environment}
                  {detail.gitSha && ` · ${detail.gitSha.substring(0, 7)}`}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {detail.previewUrl && (
                <a href={detail.previewUrl} target="_blank" rel="noopener noreferrer" style={{
                  padding: '0.375rem 0.75rem',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  borderRadius: '5px',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  textDecoration: 'none'
                }}>
                  Preview
                </a>
              )}
              {appId && (
                <a href={`/?appId=${appId}&tab=conversation`} target="_blank" rel="noopener noreferrer" style={{
                  padding: '0.375rem 0.75rem',
                  backgroundColor: '#6366f1',
                  color: 'white',
                  borderRadius: '5px',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  textDecoration: 'none'
                }}>
                  Dashboard
                </a>
              )}
              {detail.runUrl && (
                <a href={detail.runUrl} target="_blank" rel="noopener noreferrer" style={{
                  padding: '0.375rem 0.75rem',
                  backgroundColor: '#1f2937',
                  color: 'white',
                  borderRadius: '5px',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  textDecoration: 'none'
                }}>
                  GitHub
                </a>
              )}
            </div>
          </div>

          {/* QA Run LLM bar */}
          <div style={{ ...INFO_BAR_STYLE, backgroundColor: '#f0f9ff', border: '1px solid #bae6fd' }}>
            <span style={{ ...BAR_LABEL_STYLE, color: '#0369a1' }}>QA Run LLM</span>
            <InfoStat label="" value={formatDuration(detail.durationMinutes)} suffix=" duration" />
            {SEP}
            <InfoStat label="" value={detail.steps} suffix=" steps" />
            {SEP}
            <InfoStat label="" value={detail.actionCount} suffix=" actions" />
            {SEP}
            <InfoStat label="" value={`$${detail.costEstimateUSD.toFixed(2)}`} color="#dc2626" suffix=" cost" />
            {SEP}
            <InfoStat label="" value={(detail.totalTokens / 1000).toFixed(1) + 'k'} suffix=" tokens" />
            <span style={{ color: '#94a3b8', fontSize: '0.65rem' }}>
              ({(detail.inputTokens / 1000).toFixed(1)}k in / {(detail.outputTokens / 1000).toFixed(1)}k out)
            </span>
            {SEP}
            <InfoStat label="" value={detail.tokensPerStep} suffix=" tok/step" />
            {detail.model && detail.model !== 'unknown' && (
              <>{SEP}<span style={{ fontSize: '0.6rem', color: '#64748b', fontFamily: 'monospace' }}>{detail.model}</span></>
            )}
          </div>

          {/* Site Run LLM bar (Langfuse) */}
          {appId && (
            <div style={{ ...INFO_BAR_STYLE, backgroundColor: '#faf5ff', border: '1px solid #e9d5ff', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
                <span style={{ ...BAR_LABEL_STYLE, color: '#7c3aed' }}>Site Run LLM</span>
                {langfuseLoading && <span style={{ fontSize: '0.7rem', color: '#8b5cf6' }}>Loading...</span>}
                {langfuseStats && !langfuseLoading && (
                  <>
                    <InfoStat label="" value={langfuseStats.traces} suffix=" traces" />
                    {langfuseStats.totalTokens > 0 && (
                      <>
                        {SEP}
                        <InfoStat label="" value={(langfuseStats.totalTokens / 1000).toFixed(1) + 'k'} suffix=" tokens" />
                        <span style={{ color: '#94a3b8', fontSize: '0.65rem' }}>
                          ({(langfuseStats.promptTokens / 1000).toFixed(1)}k in / {(langfuseStats.completionTokens / 1000).toFixed(1)}k out)
                        </span>
                      </>
                    )}
                    {langfuseStats.totalCost > 0 && (
                      <>{SEP}<InfoStat label="" value={`$${langfuseStats.totalCost.toFixed(4)}`} color="#dc2626" suffix=" cost" /></>
                    )}
                    {langfuseStats.models.length > 0 && (
                      <>{SEP}<span style={{ fontSize: '0.6rem', color: '#64748b', fontFamily: 'monospace' }}>{langfuseStats.models.join(', ')}</span></>
                    )}
                  </>
                )}
                {!langfuseStats && !langfuseLoading && <span style={{ color: '#94a3b8' }}>No data</span>}
              </div>
              {langfuseStats?.langfuseUrl && (
                <a href={langfuseStats.langfuseUrl} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: '0.6rem', fontWeight: 600, color: '#7c3aed', textDecoration: 'none', padding: '0.2rem 0.5rem', backgroundColor: '#ede9fe', borderRadius: '4px' }}>
                  Langfuse
                </a>
              )}
            </div>
          )}

          {/* Site Quality */}
          {detail.qualityScore != null && (
            <div style={{ padding: '0.75rem 1rem', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              {/* Header: Grade + Overall Score + Score cards inline */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  width: '2.2rem', height: '2.2rem', borderRadius: '50%',
                  backgroundColor: gradeColor(detail.qualityGrade),
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1rem', fontWeight: 800, flexShrink: 0
                }}>
                  {detail.qualityGrade}
                </div>
                <div style={{ flexShrink: 0 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b' }}>
                    Overall: {detail.qualityScore}/100
                  </div>
                  {detail.businessFitSiteType && (
                    <div style={{ fontSize: '0.6rem', color: '#64748b' }}>{detail.businessFitSiteType}</div>
                  )}
                </div>
                <span style={{ color: '#d1d5db', fontSize: '1rem' }}>│</span>
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', flex: 1 }}>
                  {([
                    ['Perf', detail.performanceScore],
                    ['A11y', detail.accessibilityScore],
                    ['SEO', detail.seoScore],
                    ['Func', detail.functionalScore],
                    ['Visual', detail.visualScore],
                    ['Content', detail.contentScore],
                    ['Security', detail.securityScore],
                    ['Usability', detail.usabilityScore],
                    ['BizFit', detail.businessFitScore],
                  ] as [string, number][]).map(([label, score]) => (
                    <div key={label} style={{ minWidth: '52px' }}>
                      <div style={{ fontSize: '0.55rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>{label}</div>
                      <div style={{ height: '4px', backgroundColor: '#e2e8f0', borderRadius: '2px', overflow: 'hidden', marginTop: '0.15rem' }}>
                        <div style={{ height: '100%', width: `${score}%`, backgroundColor: scoreColor(score), borderRadius: '2px' }} />
                      </div>
                      <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#1e293b', marginTop: '0.1rem' }}>{score}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Result message */}
          <div style={{
            padding: '0.75rem 1rem',
            backgroundColor: '#f8fafc',
            borderRadius: '8px',
            border: '1px solid #e2e8f0'
          }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
              Result Summary
            </div>

            {/* Screenshots */}
            <ScreenshotGallery
              screenshots={detail.screenshots}
              onSelect={setExpandedScreenshot}
            />

            <div style={{ fontSize: '0.8rem', color: '#334155', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {detail.rawMessage || detail.message}
            </div>
            {detail.qualityScore != null && (
              <div style={{ marginTop: '0.5rem', padding: '0.4rem 0.6rem', backgroundColor: detail.qualityCriticalIssues ? '#fef2f2' : '#f0fdf4', borderRadius: '4px', border: `1px solid ${detail.qualityCriticalIssues ? '#fecaca' : '#bbf7d0'}` }}>
                <div style={{ fontSize: '0.6rem', fontWeight: 700, color: detail.qualityCriticalIssues ? '#dc2626' : '#16a34a', textTransform: 'uppercase', marginBottom: '0.125rem' }}>Critical Issues</div>
                <div style={{ fontSize: '0.7rem', color: detail.qualityCriticalIssues ? '#991b1b' : '#64748b', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {detail.qualityCriticalIssues || 'None'}
                </div>
              </div>
            )}
            {detail.qualityScore != null && (
              <div style={{ marginTop: '0.4rem', padding: '0.4rem 0.6rem', backgroundColor: detail.qualityRecommendations ? '#fffbeb' : '#f0fdf4', borderRadius: '4px', border: `1px solid ${detail.qualityRecommendations ? '#fde68a' : '#bbf7d0'}` }}>
                <div style={{ fontSize: '0.6rem', fontWeight: 700, color: detail.qualityRecommendations ? '#92400e' : '#16a34a', textTransform: 'uppercase', marginBottom: '0.125rem' }}>Recommendations</div>
                <div style={{ fontSize: '0.7rem', color: detail.qualityRecommendations ? '#78350f' : '#64748b', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {detail.qualityRecommendations || 'None'}
                </div>
              </div>
            )}
          </div>

          {/* Timing */}
          <div style={{
            padding: '0.75rem 1rem',
            backgroundColor: '#f8fafc',
            borderRadius: '8px',
            border: '1px solid #e2e8f0'
          }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
              Timing & Environment
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem', fontSize: '0.75rem', color: '#475569' }}>
              <div><strong>Started:</strong> {detail.firstActionTimestamp ? formatDate(detail.firstActionTimestamp) : 'N/A'}</div>
              <div><strong>Ended:</strong> {detail.lastActionTimestamp ? formatDate(detail.lastActionTimestamp) : 'N/A'}</div>
              <div><strong>Action Duration:</strong> {detail.actionDurationMs ? (detail.actionDurationMs / 1000).toFixed(1) + 's' : 'N/A'}</div>
              <div><strong>Pages Visited:</strong> {detail.pageUrlCount || 0}</div>
              <div><strong>Screenshots:</strong> {detail.screenshotCount || 0} ({(detail.screenshotTypes || []).join(', ')})</div>
              <div><strong>Model:</strong> {detail.model || 'unknown'}</div>
              <div><strong>Actor:</strong> {detail.actor || 'N/A'}</div>
              <div><strong>Workflow:</strong> {detail.workflow || 'N/A'}</div>
            </div>
          </div>

          {/* Action Timeline */}
          {actions.length > 0 && (
            <div style={{
              padding: '0.75rem 1rem',
              backgroundColor: '#f8fafc',
              borderRadius: '8px',
              border: '1px solid #e2e8f0'
            }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
                Action Timeline ({actions.length} steps)
              </div>
              <ActionTimeline actions={actions} />
            </div>
          )}
        </div>
      )}

      {/* Screenshot lightbox */}
      {expandedScreenshot && (
        <ScreenshotLightbox
          src={expandedScreenshot.src}
          alt={expandedScreenshot.alt}
          onClose={() => setExpandedScreenshot(null)}
        />
      )}
    </div>
  );
}
