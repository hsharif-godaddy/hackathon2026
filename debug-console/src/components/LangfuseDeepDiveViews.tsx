'use client';

import React, { useEffect, useState } from 'react';

import { langfuseEbSessionUrl, langfuseEbTraceUrl } from '@/lib/langfuse-eb-ui';

const surface: React.CSSProperties = {
  marginTop: '0.65rem',
  background: 'linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)',
  border: '1px solid #e4eaf4',
  borderRadius: 12,
  overflow: 'hidden',
  boxShadow: '0 2px 14px rgba(59, 130, 246, 0.05)',
};

const headerRow: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.65rem',
  padding: '0.85rem 1rem',
  borderBottom: '1px solid #edf2fa',
  background: 'linear-gradient(180deg, #ffffff 0%, #f7faff 100%)',
};

const sectionBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  margin: '0 0 0.55rem 0',
  paddingLeft: '0.55rem',
  borderLeft: '4px solid #7c3aed',
  fontSize: '0.62rem',
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: '#64748b',
  textTransform: 'uppercase' as const,
};

const kvGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
  gap: '0.55rem',
};

const kvCard: React.CSSProperties = {
  border: '1px solid #e4eaf4',
  borderRadius: 8,
  padding: '0.55rem 0.65rem',
  background: 'linear-gradient(180deg, #ffffff 0%, #f7faff 100%)',
  minWidth: 0,
};

const kvLabel: React.CSSProperties = {
  fontSize: '0.58rem',
  fontWeight: 700,
  letterSpacing: '0.07em',
  color: '#94a3b8',
  textTransform: 'uppercase' as const,
  marginBottom: '0.28rem',
};

const kvValue: React.CSSProperties = {
  fontSize: '0.78rem',
  fontWeight: 600,
  color: '#0f172a',
  wordBreak: 'break-word' as const,
  lineHeight: 1.35,
};

const linkStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  fontWeight: 600,
  color: '#2563eb',
  textDecoration: 'none',
  whiteSpace: 'nowrap' as const,
};

const proseBox: React.CSSProperties = {
  margin: 0,
  padding: '0.65rem 0.75rem',
  fontSize: '0.78rem',
  lineHeight: 1.5,
  color: '#334155',
  background: 'linear-gradient(180deg, #fbfdff 0%, #f3f8ff 100%)',
  border: '1px solid #e4eaf4',
  borderRadius: 8,
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
  maxHeight: 220,
  overflow: 'auto',
};

const pill: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.24rem 0.58rem',
  margin: '0.15rem',
  fontSize: '0.65rem',
  fontWeight: 700,
  letterSpacing: '0.02em',
  borderRadius: 999,
  maxWidth: '100%',
  wordBreak: 'break-word' as const,
  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.65)',
  background: 'linear-gradient(180deg, #fffdf8 0%, #faf3e4 55%, #f5ead4 100%)',
  border: '1px solid #e5d5bc',
  color: '#9a3412',
};

const preJson: React.CSSProperties = {
  marginTop: '0.45rem',
  padding: '0.55rem',
  fontSize: '0.68rem',
  lineHeight: 1.35,
  background: 'linear-gradient(180deg, #fbfdff 0%, #f3f8ff 100%)',
  border: '1px solid #e4eaf4',
  borderRadius: 8,
  maxHeight: 240,
  overflow: 'auto',
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
  color: '#0f172a',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function formatCost(value: number | null | undefined): string {
  if (value == null) return '—';
  if (value < 0.01) return `$${value.toFixed(6)}`;
  if (value < 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatLatency(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)} ms`;
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const m = Math.floor(seconds / 60);
  const s = (seconds - m * 60).toFixed(0);
  return `${m}m ${s}s`;
}

/** Compact latency for session trace tables (e.g. `9.47s`, `3.4m`). */
function formatLatencyTable(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds)) return '—';
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const m = seconds / 60;
  return `${m.toFixed(1)}m`;
}

function formatTs(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
}

function stringifyJson(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function textFromIo(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function traceAppId(metadata: unknown): string | null {
  if (!isRecord(metadata)) return null;
  const a = metadata.business_data_appId;
  if (typeof a === 'string' && a) return a;
  const b = metadata.appId;
  return typeof b === 'string' && b ? b : null;
}

function outcomeBadgeStyle(outcome: string | null): React.CSSProperties {
  const chip: React.CSSProperties = {
    boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.55)',
  };
  const o = (outcome || '').toUpperCase();
  if (o === 'SUCCESS' || o === 'OK') {
    return {
      ...chip,
      background: 'linear-gradient(180deg, #f0fdf4 0%, #dcfce7 55%, #bbf7d0 100%)',
      color: '#14532d',
      border: '1px solid #86efac',
    };
  }
  if (o === 'ERROR' || o === 'FAILED' || o.includes('FAIL')) {
    return {
      ...chip,
      background: 'linear-gradient(180deg, #fff1f2 0%, #ffe4e6 55%, #fecdd3 100%)',
      color: '#9f1239',
      border: '1px solid #f9a8d4',
    };
  }
  return {
    ...chip,
    background: 'linear-gradient(180deg, #fffdf8 0%, #faf3e4 55%, #f5ead4 100%)',
    color: '#9a3412',
    border: '1px solid #e5d5bc',
  };
}

function KvCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={kvCard}>
      <div style={kvLabel}>{label}</div>
      <div style={kvValue}>{value}</div>
    </div>
  );
}

function RawJsonDetails({ data }: { data: unknown }) {
  return (
    <details style={{ marginTop: '0.75rem' }}>
      <summary style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b', cursor: 'pointer' }}>
        Raw JSON
      </summary>
      <pre style={preJson}>{stringifyJson(data)}</pre>
    </details>
  );
}

function ExternalArrowLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={linkStyle}>
      {children} →
    </a>
  );
}

export function EbTraceDetailView({ data, embedded = false }: { data: unknown; embedded?: boolean }) {
  if (!isRecord(data) || typeof data.id !== 'string') {
    return (
      <div style={{ marginTop: '0.55rem' }}>
        <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.35rem' }}>Unexpected shape — raw payload:</div>
        <pre style={preJson}>{stringifyJson(data)}</pre>
      </div>
    );
  }

  const id = data.id;
  const name = typeof data.name === 'string' ? data.name : '—';
  const ts = typeof data.timestamp === 'string' ? data.timestamp : null;
  const userId = typeof data.userId === 'string' ? data.userId : null;
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId : null;
  const env = typeof data.environment === 'string' ? data.environment : null;
  const tags = Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === 'string') : [];
  const latency = typeof data.latency === 'number' ? data.latency : null;
  const totalCost = typeof data.totalCost === 'number' ? data.totalCost : null;
  const observations = Array.isArray(data.observations) ? data.observations.length : 0;
  const scores = Array.isArray(data.scores) ? data.scores : [];
  const meta = data.metadata;
  const executionOutcome =
    isRecord(meta) && typeof meta.executionOutcome === 'string' ? meta.executionOutcome : null;
  const responseType = isRecord(meta) && typeof meta.responseType === 'string' ? meta.responseType : null;
  const appIdFromMeta = traceAppId(meta);
  const inputText = textFromIo(data.input);
  const outputText = textFromIo(data.output);

  const header = embedded ? (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.65rem' }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#334155', fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>{id}</div>
      <ExternalArrowLink href={langfuseEbTraceUrl(id)}>Open in Langfuse</ExternalArrowLink>
    </div>
  ) : (
    <div style={headerRow}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', letterSpacing: '0.04em' }}>Trace</div>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f172a', marginTop: '0.15rem' }}>
          <span style={{ color: '#2563eb', fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>{id}</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        {executionOutcome ? (
          <span
            style={{
              padding: '0.22rem 0.58rem',
              borderRadius: 999,
              fontSize: '0.62rem',
              fontWeight: 800,
              letterSpacing: '0.05em',
              textTransform: 'uppercase' as const,
              ...outcomeBadgeStyle(executionOutcome),
            }}
          >
            {executionOutcome}
          </span>
        ) : (
          <span
            style={{
              padding: '0.22rem 0.58rem',
              borderRadius: 999,
              fontSize: '0.62rem',
              fontWeight: 800,
              letterSpacing: '0.05em',
              textTransform: 'uppercase' as const,
              ...outcomeBadgeStyle('OK'),
            }}
          >
            OK
          </span>
        )}
        <ExternalArrowLink href={langfuseEbTraceUrl(id)}>Open in Langfuse</ExternalArrowLink>
      </div>
    </div>
  );

  const body = (
    <div style={{ padding: embedded ? '0.35rem 0 0' : '0.85rem 1rem 1rem' }}>
        <div style={kvGrid}>
          <KvCard label="Name" value={name} />
          <KvCard label="Timestamp" value={formatTs(ts)} />
          <KvCard label="Environment" value={env || '—'} />
          <KvCard label="User" value={userId ? <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem' }}>{userId}</span> : '—'} />
          <KvCard
            label="Session"
            value={
              sessionId ? (
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem' }}>{sessionId}</span>
              ) : (
                '—'
              )
            }
          />
          <KvCard label="App ID" value={appIdFromMeta ? <span style={{ fontFamily: 'ui-monospace, monospace' }}>{appIdFromMeta}</span> : '—'} />
          <KvCard label="Latency" value={formatLatency(latency)} />
          <KvCard label="Cost" value={formatCost(totalCost)} />
          <KvCard label="Observations" value={String(observations)} />
          {responseType ? <KvCard label="Response type" value={responseType} /> : null}
        </div>

        {tags.length > 0 ? (
          <div style={{ marginTop: '0.85rem' }}>
            <div style={sectionBar}>Tags</div>
            <div style={{ lineHeight: 1.6 }}>
              {tags.map(function tagPill(t) {
                return (
                  <span key={t} style={pill}>
                    {t}
                  </span>
                );
              })}
            </div>
          </div>
        ) : null}

        {scores.length > 0 ? (
          <div style={{ marginTop: '0.85rem' }}>
            <div style={sectionBar}>Scores</div>
            <div>
              {scores.map(function scorePill(s: unknown, idx: number) {
                if (!isRecord(s)) return null;
                const n = typeof s.name === 'string' ? s.name : 'score';
                const sv = s.stringValue != null && String(s.stringValue) !== '' ? String(s.stringValue) : null;
                const num = typeof s.value === 'number' ? s.value : null;
                const shown = sv ?? (num != null ? String(num) : '—');
                const title = typeof s.comment === 'string' ? s.comment : undefined;
                const key = typeof s.id === 'string' ? s.id : `score-${idx}`;
                return (
                  <span key={key} style={pill} title={title}>
                    {n}: {shown}
                  </span>
                );
              })}
            </div>
          </div>
        ) : null}

        {inputText ? (
          <div style={{ marginTop: '0.85rem' }}>
            <div style={sectionBar}>Input</div>
            <pre style={proseBox}>{inputText}</pre>
          </div>
        ) : null}

        {outputText ? (
          <div style={{ marginTop: '0.85rem' }}>
            <div style={sectionBar}>Output</div>
            <pre style={proseBox}>{outputText}</pre>
          </div>
        ) : null}

        {isRecord(meta) && Object.keys(meta).length > 0 ? (
          <div style={{ marginTop: '0.85rem' }}>
            <div style={sectionBar}>Metadata (summary)</div>
            <MetadataSummary metadata={meta} />
          </div>
        ) : null}

        <RawJsonDetails data={data} />
    </div>
  );

  if (embedded) {
    return (
      <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '0.35rem' }}>
        {header}
        {body}
      </div>
    );
  }

  return (
    <div style={surface}>
      {header}
      {body}
    </div>
  );
}

function MetadataSummary({ metadata }: { metadata: Record<string, unknown> }) {
  const skip = new Set([
    'attributes',
    'resourceAttributes',
    'scope',
    'responseData',
  ]);
  const rows: Array<{ k: string; v: string }> = [];
  for (const [k, v] of Object.entries(metadata)) {
    if (skip.has(k)) continue;
    if (v == null) continue;
    if (typeof v === 'object') continue;
    rows.push({ k, v: String(v) });
  }
  if (rows.length === 0) {
    return <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Nested objects hidden — use Raw JSON for full tree.</div>;
  }
  return (
    <div style={{ ...kvGrid, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
      {rows.map(function row(r) {
        return <KvCard key={r.k} label={r.k.replace(/_/g, ' ')} value={<span style={{ fontSize: '0.72rem' }}>{r.v}</span>} />;
      })}
    </div>
  );
}

function shortenTraceId(id: string, keep = 16): string {
  if (id.length <= keep) return id;
  return `${id.slice(0, keep)}…`;
}

function formatTraceTimeOnly(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function traceRowLevel(trace: Record<string, unknown>): string {
  const lv = trace.level;
  if (typeof lv === 'string' && lv.trim()) return lv;
  return '—';
}

const sessionSummaryBlock: React.CSSProperties = {
  marginTop: '0.5rem',
  fontSize: '0.78rem',
  color: '#475569',
  lineHeight: 1.65,
};

const sessionTableWrap: React.CSSProperties = {
  marginTop: '0.65rem',
  border: '1px solid #e4eaf4',
  borderRadius: 8,
  overflow: 'auto',
  maxHeight: 'min(70vh, 720px)',
  backgroundColor: '#ffffff',
};

const sessionTh: React.CSSProperties = {
  textAlign: 'left' as const,
  fontSize: '0.58rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
  color: '#64748b',
  textTransform: 'uppercase' as const,
  padding: '0.5rem 0.55rem',
  borderBottom: '1px solid #e2e8f0',
  backgroundColor: '#f8fafc',
  whiteSpace: 'nowrap' as const,
  position: 'sticky' as const,
  top: 0,
  zIndex: 1,
};

const sessionTd: React.CSSProperties = {
  fontSize: '0.76rem',
  padding: '0.42rem 0.55rem',
  borderBottom: '1px solid #f1f5f9',
  color: '#334155',
  verticalAlign: 'middle' as const,
};

const sessionTdMono: React.CSSProperties = {
  ...sessionTd,
  fontFamily: 'ui-monospace, monospace',
  fontSize: '0.72rem',
};

export function EbSessionDetailView({ data }: { data: unknown }) {
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null);

  if (!isRecord(data) || typeof data.sessionId !== 'string') {
    return (
      <div style={{ marginTop: '0.55rem' }}>
        <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.35rem' }}>Unexpected shape — raw payload:</div>
        <pre style={preJson}>{stringifyJson(data)}</pre>
      </div>
    );
  }

  const sessionId = data.sessionId;
  const traces = (Array.isArray(data.traces) ? data.traces : []).filter(function filterTrace(t): t is Record<string, unknown> {
    return isRecord(t) && typeof t.id === 'string';
  });
  const totalItems = typeof data.totalItems === 'number' ? data.totalItems : traces.length;
  const listed = typeof data.listedTraceIds === 'number' ? data.listedTraceIds : traces.length;
  const fetched = typeof data.fetchedTraces === 'number' ? data.fetchedTraces : traces.length;

  let earliestMs = Infinity;
  let costSum = 0;
  let costCount = 0;
  for (const t of traces) {
    const ts = typeof t.timestamp === 'string' ? t.timestamp : null;
    if (ts) {
      const ms = new Date(ts).getTime();
      if (!Number.isNaN(ms) && ms < earliestMs) earliestMs = ms;
    }
    const c = t.totalCost;
    if (typeof c === 'number' && !Number.isNaN(c)) {
      costSum += c;
      costCount += 1;
    }
  }
  const createdLabel = earliestMs !== Infinity ? formatTs(new Date(earliestMs).toISOString()) : '—';
  const costPartialNote = fetched < totalItems;

  return (
    <div style={surface}>
      <div style={headerRow}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', letterSpacing: '0.04em' }}>Session</div>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#2563eb', fontFamily: 'ui-monospace, monospace', marginTop: '0.15rem', wordBreak: 'break-all' }}>
            {sessionId}
          </div>
          <div style={sessionSummaryBlock}>
            <div>
              <span style={{ color: '#94a3b8', fontWeight: 600 }}>Created: </span>
              {createdLabel}
            </div>
            <div>
              <span style={{ color: '#94a3b8', fontWeight: 600 }}>Traces: </span>
              {String(totalItems)}
              {fetched < totalItems ? (
                <span style={{ color: '#94a3b8', fontSize: '0.72rem', marginLeft: '0.35rem' }}>
                  ({fetched} loaded in this view)
                </span>
              ) : null}
            </div>
            <div>
              <span style={{ color: '#94a3b8', fontWeight: 600 }}>Total cost: </span>
              <span style={{ fontWeight: 700, color: '#059669' }}>{costCount > 0 ? formatCost(costSum) : '—'}</span>
              {costPartialNote && costCount > 0 ? (
                <span style={{ color: '#94a3b8', fontSize: '0.72rem', marginLeft: '0.35rem' }}>(sum of loaded traces)</span>
              ) : null}
            </div>
          </div>
        </div>
        <ExternalArrowLink href={langfuseEbSessionUrl(sessionId)}>Open in Langfuse</ExternalArrowLink>
      </div>
      <div style={{ padding: '0.85rem 1rem 1rem' }}>
        <div style={kvGrid}>
          <KvCard label="Traces in session (loaded)" value={String(fetched)} />
          <KvCard label="Listed from API" value={String(listed)} />
          <KvCard label="Total (reported)" value={String(totalItems)} />
        </div>

        <div style={{ marginTop: '0.85rem' }}>
          <div style={sectionBar}>Traces (chronological)</div>
          <div style={sessionTableWrap}>
            {traces.length === 0 ? (
              <div style={{ padding: '1rem', fontSize: '0.78rem', color: '#94a3b8', textAlign: 'center' }}>No traces in this session.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '6%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={sessionTh}>Trace ID</th>
                    <th style={sessionTh}>Name</th>
                    <th style={sessionTh}>Time</th>
                    <th style={sessionTh}>Latency</th>
                    <th style={sessionTh}>Cost</th>
                    <th style={sessionTh}>Level</th>
                    <th style={{ ...sessionTh, textAlign: 'center' }}>Link</th>
                    <th style={{ ...sessionTh, textAlign: 'center' }}>More</th>
                  </tr>
                </thead>
                <tbody>
                  {traces.map(function sessionTableRow(t) {
                    const id = t.id as string;
                    const name = typeof t.name === 'string' ? t.name : '—';
                    const ts = typeof t.timestamp === 'string' ? t.timestamp : null;
                    const latency = typeof t.latency === 'number' ? t.latency : null;
                    const cost = typeof t.totalCost === 'number' ? t.totalCost : null;
                    const expanded = expandedTraceId === id;
                    return (
                      <React.Fragment key={id}>
                        <tr>
                          <td style={sessionTdMono} title={id}>
                            {shortenTraceId(id)}
                          </td>
                          <td style={{ ...sessionTd, wordBreak: 'break-word' }}>{name}</td>
                          <td style={sessionTdMono}>{formatTraceTimeOnly(ts)}</td>
                          <td style={sessionTd}>{formatLatencyTable(latency)}</td>
                          <td style={{ ...sessionTd, fontWeight: 600, color: '#059669' }}>{formatCost(cost)}</td>
                          <td style={sessionTd}>{traceRowLevel(t)}</td>
                          <td style={{ ...sessionTd, textAlign: 'center' }}>
                            <a href={langfuseEbTraceUrl(id)} target="_blank" rel="noopener noreferrer" style={{ ...linkStyle, fontSize: '0.85rem' }}>
                              →
                            </a>
                          </td>
                          <td style={{ ...sessionTd, textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={function toggleExpand() {
                                setExpandedTraceId(expanded ? null : id);
                              }}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                cursor: 'pointer',
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                color: '#64748b',
                                padding: '0.15rem 0.25rem',
                              }}
                              aria-expanded={expanded}
                              aria-label={expanded ? 'Collapse trace details' : 'Expand trace details'}
                            >
                              {expanded ? '▼' : '▶'}
                            </button>
                          </td>
                        </tr>
                        {expanded ? (
                          <tr>
                            <td colSpan={8} style={{ padding: 0, borderBottom: '1px solid #e2e8f0', backgroundColor: '#fbfdff' }}>
                              <div style={{ padding: '0.55rem 0.65rem 0.75rem' }}>
                                <EbTraceDetailView data={t} embedded />
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <RawJsonDetails data={data} />
      </div>
    </div>
  );
}

function statusPill(
  active: boolean,
  label: string,
  activeStyle: { background: string; color: string; border: string },
  inactiveStyle?: { background: string; color: string; border: string },
) {
  const inactive = inactiveStyle ?? {
    background: 'linear-gradient(90deg, #f8fbff 0%, #f0f4fa 100%)',
    color: '#64748b',
    border: '1px solid #dce4f0',
  };
  const s = active ? activeStyle : inactive;
  return (
    <span
      style={{
        padding: '0.22rem 0.58rem',
        borderRadius: 999,
        fontSize: '0.6rem',
        fontWeight: 800,
        letterSpacing: '0.06em',
        textTransform: 'uppercase' as const,
        background: s.background,
        color: s.color,
        border: s.border,
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.55)',
      }}
    >
      {label}
    </span>
  );
}

export function MgmtAppDetailView({ data }: { data: unknown }) {
  // Hooks must be called unconditionally before any early returns.
  const [previewShareToken, setPreviewShareToken] = useState<string | null>(null);

  const rawId = isRecord(data) && typeof data.id === 'string' ? data.id : null;
  const rawPreview = isRecord(data) && isRecord(data.urls) ? (data.urls as Record<string, unknown>)['preview'] : null;

  useEffect(() => {
    if (typeof rawId !== 'string' || typeof rawPreview !== 'string') {
      setPreviewShareToken(null);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/agent/share-token/${encodeURIComponent(rawId)}`, { signal: controller.signal })
      .then(async res => {
        if (!res.ok) return;
        const fetchedData = await res.json() as { token: string | null };
        if (typeof fetchedData.token === 'string') setPreviewShareToken(fetchedData.token);
      })
      .catch(() => { /* fail open */ });
    return () => controller.abort();
  }, [rawId, rawPreview]);

  if (!isRecord(data) || typeof data.id !== 'string') {
    return (
      <div style={{ marginTop: '0.55rem' }}>
        <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.35rem' }}>Unexpected shape — raw payload:</div>
        <pre style={preJson}>{stringifyJson(data)}</pre>
      </div>
    );
  }

  const app = data;
  const id = data.id;
  const variables = isRecord(app.variables) ? app.variables : null;
  const title = variables && typeof variables.title === 'string' ? variables.title : id;
  const initialPrompt = variables && typeof variables.initialPrompt === 'string' ? variables.initialPrompt : null;
  const compositionId = typeof app.compositionId === 'string' ? app.compositionId : '—';
  const compositionVersion = typeof app.compositionVersion === 'string' ? app.compositionVersion : '—';
  const cellId = typeof app.cellId === 'string' ? app.cellId : '—';
  const status = typeof app.status === 'string' ? app.status : '—';
  const published = app.published === true;
  const domains = Array.isArray(app.domains) ? app.domains : [];
  const urls = isRecord(app.urls) ? app.urls : null;
  const subscriptionId = typeof app.subscriptionId === 'string' ? app.subscriptionId : '—';
  const systemId = typeof app.systemId === 'string' ? app.systemId : '—';
  const shopperId = app.shopperId != null ? String(app.shopperId) : '—';
  const customerId = typeof app.customerId === 'string' ? app.customerId : '—';
  const entitlementId = typeof app.entitlementId === 'string' ? app.entitlementId : '—';
  const uid = app.uid != null ? String(app.uid) : '—';
  const provisionType = typeof app.provisionType === 'string' ? app.provisionType : '—';
  const createdAt = typeof app.createdAt === 'string' ? app.createdAt : null;
  const updatedAt = typeof app.updatedAt === 'string' ? app.updatedAt : null;
  const resolvedImages = Array.isArray(app.resolvedImages) ? app.resolvedImages : [];
  const databases = Array.isArray(app.databases) ? app.databases : [];
  const filesystems = Array.isArray(app.filesystems) ? app.filesystems : [];
  const variantsWithLifecycle = Array.isArray(app.variantsWithLifecycle) ? app.variantsWithLifecycle : [];

  const active = status.toLowerCase() === 'active';

  return (
    <div style={surface}>
      <div style={{ ...headerRow, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>{title}</div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.25rem', lineHeight: 1.45 }}>
            App <span style={{ fontFamily: 'ui-monospace, monospace', color: '#334155' }}>{id}</span> · {compositionId}{' '}
            {compositionVersion} · cell {cellId}
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', justifyContent: 'flex-end' }}>
          {statusPill(active, active ? 'ACTIVE' : status.toUpperCase(), {
            background: 'linear-gradient(180deg, #f0fdf4 0%, #dcfce7 55%, #bbf7d0 100%)',
            color: '#14532d',
            border: '1px solid #86efac',
          })}
          {statusPill(
            published,
            published ? 'PUBLISHED' : 'NOT PUBLISHED',
            {
              background: 'linear-gradient(180deg, #f0fdf4 0%, #dcfce7 55%, #bbf7d0 100%)',
              color: '#14532d',
              border: '1px solid #86efac',
            },
            {
              background: 'linear-gradient(180deg, #fffdf8 0%, #faf3e4 55%, #f5ead4 100%)',
              color: '#9a3412',
              border: '1px solid #e5d5bc',
            },
          )}
        </div>
      </div>

      <div style={{ padding: '0.85rem 1rem 1rem' }}>
        <div style={kvGrid}>
          <KvCard label="Subscription" value={<span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.74rem' }}>{subscriptionId}</span>} />
          <KvCard label="System" value={<span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.74rem' }}>{systemId}</span>} />
          <KvCard label="Shopper ID" value={shopperId} />
          <KvCard
            label="Customer ID"
            value={<span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.68rem' }}>{customerId}</span>}
          />
          <KvCard
            label="Entitlement"
            value={<span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.68rem' }}>{entitlementId}</span>}
          />
          <KvCard label="UID" value={uid} />
        </div>

        <div style={{ ...kvGrid, marginTop: '0.55rem' }}>
          <KvCard label="Provision type" value={provisionType} />
          <KvCard label="Template" value={typeof app.template === 'string' ? app.template : 'default'} />
          <KvCard label="Created" value={formatTs(createdAt)} />
          <KvCard label="Updated" value={formatTs(updatedAt)} />
        </div>

        {urls ? (
          <div style={{ marginTop: '0.9rem' }}>
            <div style={sectionBar}>Live URLs</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
              {typeof urls.agent === 'string' ? <ExternalArrowLink href={urls.agent}>agent</ExternalArrowLink> : null}
              {typeof urls.preview === 'string' ? (
                <ExternalArrowLink href={
                  previewShareToken
                    ? (() => {
                        try {
                          const u = new URL(urls.preview as string);
                          u.searchParams.set('airoShareToken', previewShareToken);
                          return u.toString();
                        } catch {
                          return urls.preview as string;
                        }
                      })()
                    : urls.preview
                }>preview</ExternalArrowLink>
              ) : null}
              {typeof urls.publish === 'string' ? <ExternalArrowLink href={urls.publish}>publish</ExternalArrowLink> : null}
            </div>
          </div>
        ) : null}

        <div style={{ marginTop: '0.9rem' }}>
          <div style={sectionBar}>Domains</div>
          <div style={{ fontSize: '0.62rem', fontWeight: 800, color: '#64748b', marginBottom: '0.35rem' }}>ACTIVE</div>
          {domains.length > 0 ? (
            <div style={{ ...proseBox, maxHeight: 120, fontFamily: 'ui-monospace, monospace', fontSize: '0.74rem' }}>
              {domains.map(function domLine(d: unknown) {
                return typeof d === 'string' ? `${d}\n` : `${JSON.stringify(d)}\n`;
              })}
            </div>
          ) : (
            <div style={{ ...proseBox, color: '#94a3b8', maxHeight: 'none' }}>No domains on record</div>
          )}
        </div>

        {initialPrompt ? (
          <div style={{ marginTop: '0.9rem' }}>
            <div style={sectionBar}>Initial prompt</div>
            <pre style={{ ...proseBox, maxHeight: 160 }}>{initialPrompt}</pre>
          </div>
        ) : null}

        {variantsWithLifecycle.length > 0 ? (
          <details style={{ marginTop: '0.75rem' }}>
            <summary style={{ ...sectionBar, cursor: 'pointer', borderLeft: '4px solid #94a3b8' }}>Variants & lifecycle</summary>
            <pre style={preJson}>{stringifyJson(variantsWithLifecycle)}</pre>
          </details>
        ) : null}

        {resolvedImages.length > 0 ? (
          <details style={{ marginTop: '0.5rem' }}>
            <summary style={{ ...sectionBar, cursor: 'pointer', borderLeft: '4px solid #94a3b8' }}>
              Resolved images ({resolvedImages.length})
            </summary>
            <pre style={{ ...preJson, maxHeight: 200 }}>{stringifyJson(resolvedImages)}</pre>
          </details>
        ) : null}

        {databases.length > 0 ? (
          <details style={{ marginTop: '0.5rem' }}>
            <summary style={{ ...sectionBar, cursor: 'pointer', borderLeft: '4px solid #94a3b8' }}>
              Databases ({databases.length})
            </summary>
            <pre style={preJson}>{stringifyJson(databases)}</pre>
          </details>
        ) : null}

        {filesystems.length > 0 ? (
          <details style={{ marginTop: '0.5rem' }}>
            <summary style={{ ...sectionBar, cursor: 'pointer', borderLeft: '4px solid #94a3b8' }}>
              Filesystems ({filesystems.length})
            </summary>
            <pre style={preJson}>{stringifyJson(filesystems)}</pre>
          </details>
        ) : null}

        <RawJsonDetails data={data} />
      </div>
    </div>
  );
}
