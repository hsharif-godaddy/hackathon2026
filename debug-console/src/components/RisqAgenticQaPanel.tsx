'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const GREEN = '#4caf50';
const RED = '#f44336';
const CARD = {
  backgroundColor: '#ffffff',
  borderRadius: 12,
  border: '1px solid #e5e7eb',
  boxShadow: '0 1px 3px rgba(15,23,42,0.06)',
  padding: '1.1rem 1.25rem',
  marginBottom: '1rem',
} as const;

interface QaDayPoint {
  ts: number;
  passed: number;
  failed: number;
}

interface QaScenarioAgg {
  scenario: string;
  passed: number;
  failed: number;
  trend: QaDayPoint[];
}

interface QaRunSummary {
  runNumber: string;
  timestamp: string;
  passed: number;
  failed: number;
  environment: string;
  eventName: string;
  triggerActor: string;
}

interface QaListRun {
  id: string;
  scenario: string;
  success: boolean;
  timestamp: string;
  durationMinutes: number;
  totalTokens: number;
  costEstimateUSD: number;
  runUrl?: string;
  runNumber?: number | string;
  qualityScore?: number;
  qualityGrade?: string;
}

function formatDayLabel(ts: number): string {
  const d = new Date(ts);
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const startY = new Date(startToday);
  startY.setDate(startY.getDate() - 1);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  if (day.getTime() === startToday.getTime()) return 'Today';
  if (day.getTime() === startY.getTime()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function padTrendToDays(trend: QaDayPoint[], template: QaDayPoint[]): QaDayPoint[] {
  if (template.length === 0) return trend;
  const byTs = new Map(trend.map(t => [t.ts, t]));
  return template.map(function pick(t) {
    const hit = byTs.get(t.ts);
    return hit ?? { ts: t.ts, passed: 0, failed: 0 };
  });
}

function runStatusIcon(passed: number, failed: number): string {
  if (failed > 0 && passed === 0) return '❌';
  if (passed > 0 && failed === 0) return '✅';
  if (failed > 0 && passed > 0) return '◐';
  return '🚫';
}

function triggerLabel(eventName: string, triggerActor: string): string {
  const e = (eventName || '').toLowerCase();
  if (e === 'schedule' || e === 'scheduled') return 'scheduled';
  if (triggerActor) return `by ${triggerActor}`;
  return 'scheduled';
}

function gradeBadgeStyle(grade: string): { bg: string; color: string } {
  const g = (grade || '').toUpperCase().charAt(0);
  if (g === 'A') return { bg: '#dcfce7', color: '#15803d' };
  if (g === 'B') return { bg: '#dbeafe', color: '#1d4ed8' };
  if (g === 'C') return { bg: '#fef9c3', color: '#a16207' };
  return { bg: '#fee2e2', color: '#b91c1c' };
}

function ratioPillStyle(passed: number, total: number): { bg: string; color: string } {
  if (total === 0) return { bg: '#f3f4f6', color: '#6b7280' };
  const r = passed / total;
  if (r >= 0.7) return { bg: '#ecfdf5', color: '#15803d' };
  if (r >= 0.4) return { bg: '#fef9c3', color: '#a16207' };
  return { bg: '#fef2f2', color: '#b91c1c' };
}

function formatUtcTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${y}-${mo}-${day} ${h}:${mi}`;
}

function formatRunDropdownLine(r: QaRunSummary): string {
  const d = new Date(r.timestamp);
  const dateStr = Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const icon = runStatusIcon(r.passed, r.failed);
  const trig = triggerLabel(r.eventName, r.triggerActor);
  return `#${r.runNumber} · ${dateStr} · ${icon} Agentic QA - ${r.environment} (${trig})`;
}

export default function RisqAgenticQaPanel() {
  const [summary, setSummary] = useState<{ passed: number; failed: number; total: number } | null>(null);
  const [summaryErr, setSummaryErr] = useState<string | null>(null);
  const [days, setDays] = useState<QaDayPoint[]>([]);
  const [scenarios, setScenarios] = useState<QaScenarioAgg[]>([]);
  const [analyticsErr, setAnalyticsErr] = useState<string | null>(null);
  const [runSummaries, setRunSummaries] = useState<QaRunSummary[]>([]);
  const [runsErr, setRunsErr] = useState<string | null>(null);
  const [listRuns, setListRuns] = useState<QaListRun[]>([]);
  const [listErr, setListErr] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<string>('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showPass, setShowPass] = useState(true);
  const [showFail, setShowFail] = useState(true);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const loadCore = useCallback(async function loadCore() {
    setSummaryErr(null);
    setAnalyticsErr(null);
    setRunsErr(null);
    setListErr(null);
    const sumUrl = '/api/qa-results?action=summary-7d';
    const anParams = new URLSearchParams({ action: 'analytics-7d' });
    if (selectedRun) anParams.set('run', selectedRun);
    const rsUrl = '/api/qa-results?action=run-summaries';
    const listParams = new URLSearchParams({ action: 'list-7d', limit: '30' });
    if (selectedRun) listParams.set('run', selectedRun);

    const [sumRes, anRes, rsRes, listRes] = await Promise.all([
      fetch(sumUrl),
      fetch(`/api/qa-results?${anParams}`),
      fetch(rsUrl),
      fetch(`/api/qa-results?${listParams}`),
    ]);

    const sumJson = (await sumRes.json().catch(() => ({}))) as {
      error?: string;
      passed?: number;
      failed?: number;
      total?: number;
    };
    if (!sumRes.ok) {
      setSummary(null);
      setSummaryErr(typeof sumJson.error === 'string' ? sumJson.error : `HTTP ${sumRes.status}`);
    } else {
      setSummary({
        passed: sumJson.passed ?? 0,
        failed: sumJson.failed ?? 0,
        total: sumJson.total ?? 0,
      });
    }

    const anJson = (await anRes.json().catch(() => ({}))) as {
      error?: string;
      days?: QaDayPoint[];
      scenarios?: QaScenarioAgg[];
    };
    if (!anRes.ok) {
      setDays([]);
      setScenarios([]);
      setAnalyticsErr(typeof anJson.error === 'string' ? anJson.error : `HTTP ${anRes.status}`);
    } else {
      setDays(anJson.days ?? []);
      setScenarios(anJson.scenarios ?? []);
      setAnalyticsErr(null);
    }

    const rsJson = (await rsRes.json().catch(() => ({}))) as { error?: string; runs?: QaRunSummary[] };
    if (!rsRes.ok) {
      setRunSummaries([]);
      setRunsErr(typeof rsJson.error === 'string' ? rsJson.error : `HTTP ${rsRes.status}`);
    } else {
      setRunSummaries(rsJson.runs ?? []);
      setRunsErr(null);
    }

    const listJson = (await listRes.json().catch(() => ({}))) as { error?: string; runs?: QaListRun[] };
    if (!listRes.ok) {
      setListRuns([]);
      setListErr(typeof listJson.error === 'string' ? listJson.error : `HTTP ${listRes.status}`);
    } else {
      setListRuns(listJson.runs ?? []);
      setListErr(null);
    }
  }, [selectedRun]);

  useEffect(
    function loadOnMountAndRun() {
      void loadCore();
    },
    [loadCore],
  );

  useEffect(
    function closeDropdownOnOutsideClick() {
      if (!dropdownOpen) return;
      function onDocMouseDown(e: MouseEvent) {
        if (!dropdownRef.current?.contains(e.target as Node)) {
          setDropdownOpen(false);
        }
      }
      document.addEventListener('mousedown', onDocMouseDown);
      return function removeListener() {
        document.removeEventListener('mousedown', onDocMouseDown);
      };
    },
    [dropdownOpen],
  );

  const chartRows = days.map(function mapDay(d) {
    return {
      label: formatDayLabel(d.ts),
      passed: showPass ? d.passed : 0,
      failed: showFail ? d.failed : 0,
      rawPassed: d.passed,
      rawFailed: d.failed,
    };
  });

  const sumPass = chartRows.reduce(function sumP(a, r) {
    return a + r.rawPassed;
  }, 0);
  const sumFail = chartRows.reduce(function sumF(a, r) {
    return a + r.rawFailed;
  }, 0);
  const denom = sumPass + sumFail;
  const avgPct = denom > 0 ? Math.round((sumPass / denom) * 100) : 0;

  const passedCount = summary?.passed ?? 0;
  const failedCount = summary?.failed ?? 0;
  const totalRuns = summary?.total ?? 0;
  const passRatePct = totalRuns > 0 ? Math.round((passedCount / totalRuns) * 100) : 0;

  const listPassed = listRuns.filter(r => r.success).length;
  const listFailed = listRuns.filter(r => !r.success).length;

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <div style={{ ...CARD, marginTop: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <span style={{ fontSize: '1.35rem' }} aria-hidden>
            🤖
          </span>
          <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: '#111827' }}>Agentic QA Analytics</h2>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#6b7280' }}>Overview</span>
          <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Last 7 days · up to 100 runs</span>
        </div>

        {summaryErr ? (
          <p style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{summaryErr}</p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '0.75rem',
              marginTop: '0.85rem',
            }}
          >
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '1rem' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.1em', color: '#6b7280' }}>TOTAL RUNS</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#111827', marginTop: '0.35rem' }}>{totalRuns}</div>
            </div>
            <div style={{ background: '#ecfdf5', border: '1px solid #bbf7d0', borderRadius: 10, padding: '1rem' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.1em', color: '#15803d' }}>PASSED</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#15803d', marginTop: '0.35rem' }}>{passedCount}</div>
            </div>
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '1rem' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.1em', color: '#b91c1c' }}>FAILED</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#b91c1c', marginTop: '0.35rem' }}>{failedCount}</div>
            </div>
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '1rem' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.1em', color: '#1d4ed8' }}>PASS RATE</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#1d4ed8', marginTop: '0.35rem' }}>{passRatePct}%</div>
            </div>
          </div>
        )}
      </div>

      <div style={CARD}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '1rem', fontWeight: 700, color: '#111827' }}>📈 QA Trends</span>
          <span
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              padding: '0.2rem 0.55rem',
              borderRadius: 999,
              background: '#dbeafe',
              color: '#1d4ed8',
            }}
          >
            7 days
          </span>
        </div>

        {analyticsErr ? (
          <p style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{analyticsErr}</p>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.78rem', color: '#374151' }}>
                <span style={{ color: GREEN }}>●</span> {sumPass} Pass &nbsp;
                <span style={{ color: RED }}>●</span> {sumFail} Fail &nbsp;
                <span style={{ color: '#6b7280' }}>📊</span> {avgPct}% Avg →
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.75rem' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, color: '#15803d' }}>
                <input
                  type="checkbox"
                  checked={showPass}
                  onChange={function togglePass() {
                    setShowPass(function (p) {
                      const next = !p;
                      if (!next && !showFail) return p;
                      return next;
                    });
                  }}
                />
                Pass
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, color: '#b91c1c' }}>
                <input
                  type="checkbox"
                  checked={showFail}
                  onChange={function toggleFail() {
                    setShowFail(function (f) {
                      const next = !f;
                      if (!next && !showPass) return f;
                      return next;
                    });
                  }}
                />
                Fail
              </label>
            </div>
            <div style={{ width: '100%', height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={{ stroke: '#e5e7eb' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    formatter={function tooltipFmt(value: number, name: string) {
                      return [value, name === 'passed' ? 'Passed' : 'Failed'];
                    }}
                    labelStyle={{ fontWeight: 700 }}
                  />
                  <Bar dataKey="passed" stackId="a" fill={GREEN} radius={[0, 0, 0, 0]}>
                    <LabelList
                      dataKey="passed"
                      position="center"
                      fill="#fff"
                      fontSize={11}
                      fontWeight={700}
                      formatter={function fmtPass(v: number) {
                        return v > 0 ? String(v) : '';
                      }}
                    />
                  </Bar>
                  <Bar dataKey="failed" stackId="a" fill={RED} radius={[6, 6, 0, 0]}>
                    <LabelList
                      dataKey="failed"
                      position="center"
                      fill="#fff"
                      fontSize={11}
                      fontWeight={700}
                      formatter={function fmtFail(v: number) {
                        return v > 0 ? String(v) : '';
                      }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>

      <div style={CARD}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.65rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1rem', fontWeight: 700, color: '#111827' }}>📊 Scenario Performance Trends</span>
            <span
              style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                padding: '0.2rem 0.55rem',
                borderRadius: 999,
                background: '#dbeafe',
                color: '#1d4ed8',
              }}
            >
              7 days
            </span>
          </div>
          <span style={{ fontSize: '0.8rem', color: '#6b7280', fontWeight: 600 }}>
            📈 {scenarios.length} Scenarios
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', fontSize: '0.78rem', marginBottom: '0.75rem', color: '#374151' }}>
          <span>
            <span style={{ color: GREEN }}>✓</span> Passed
          </span>
          <span>
            <span style={{ color: RED }}>✗</span> Failed
          </span>
          <span style={{ marginLeft: 'auto', fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.12em', color: '#9ca3af' }}>7-DAY TREND</span>
        </div>

        {analyticsErr ? null : scenarios.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: '0.85rem' }}>No scenario aggregates for this window.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
            {scenarios.map(function scenarioRow(s) {
              const total = s.passed + s.failed;
              const trend = padTrendToDays(s.trend, days);
              const pill = ratioPillStyle(s.passed, total);
              const barData = [{ name: s.scenario, passed: s.passed, failed: s.failed }];
              const sparkMax = Math.max(
                1,
                ...trend.map(function sparkSum(t) {
                  return t.passed + t.failed;
                }),
              );
              return (
                <div
                  key={s.scenario}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(120px, 1.1fr) minmax(140px, 2fr) 56px auto',
                    gap: '0.65rem',
                    alignItems: 'center',
                    padding: '0.45rem 0',
                    borderBottom: '1px solid #f3f4f6',
                  }}
                >
                  <div style={{ fontSize: '0.82rem', color: '#111827', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.scenario}>
                    {s.scenario}
                  </div>
                  <div style={{ height: 28, minWidth: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart layout="vertical" data={barData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }} barCategoryGap={4}>
                        <XAxis type="number" hide domain={[0, Math.max(total, 1)]} />
                        <YAxis type="category" dataKey="name" hide width={0} />
                        <Bar dataKey="passed" stackId="s" fill={GREEN} radius={[6, 0, 0, 6]} barSize={22}>
                          <LabelList
                            dataKey="passed"
                            position="center"
                            fill="#fff"
                            fontSize={10}
                            fontWeight={700}
                            formatter={function p(v: number) {
                              return v > 0 ? String(v) : '';
                            }}
                          />
                        </Bar>
                        <Bar dataKey="failed" stackId="s" fill={RED} radius={[0, 6, 6, 0]} barSize={22}>
                          <LabelList
                            dataKey="failed"
                            position="center"
                            fill="#fff"
                            fontSize={10}
                            fontWeight={700}
                            formatter={function f(v: number) {
                              return v > 0 ? String(v) : '';
                            }}
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ width: 52, height: 36 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={trend.map(function mapT(t, i) {
                          return { i: String(i), passed: t.passed, failed: t.failed };
                        })}
                        margin={{ top: 2, right: 0, left: 0, bottom: 2 }}
                      >
                        <XAxis dataKey="i" hide />
                        <YAxis hide domain={[0, sparkMax]} />
                        <Bar dataKey="passed" stackId="t" fill={GREEN} barSize={4} />
                        <Bar dataKey="failed" stackId="t" fill={RED} barSize={4} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div
                    style={{
                      justifySelf: 'end',
                      padding: '0.25rem 0.55rem',
                      borderRadius: 8,
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      background: pill.bg,
                      color: pill.color,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s.passed}/{total}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={CARD}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#111827', marginBottom: '0.35rem' }}>📋 QA Runs</div>
            <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>
              Latest 30 results (7 days){' '}
              <span style={{ color: GREEN, fontWeight: 600 }}>✅ {listPassed} passed</span>{' '}
              <span style={{ color: RED, fontWeight: 600 }}>❌ {listFailed} failed</span>
            </div>
          </div>
          <div ref={dropdownRef} style={{ position: 'relative', minWidth: 220 }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: '0.25rem' }}>GitHub Run:</span>
            <button
              type="button"
              onClick={function openDd() {
                setDropdownOpen(!dropdownOpen);
              }}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '0.5rem 0.75rem',
                borderRadius: 8,
                border: '1px solid #d1d5db',
                background: '#fff',
                fontSize: '0.8rem',
                fontWeight: 600,
                color: '#111827',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedRun ? `#${selectedRun}` : 'All runs (7 days)'}
              </span>
              <span style={{ color: '#9ca3af' }}>▾</span>
            </button>
            {dropdownOpen ? (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '100%',
                  marginTop: 4,
                  minWidth: 'min(420px, 92vw)',
                  maxHeight: 320,
                  overflowY: 'auto',
                  background: '#1f2937',
                  borderRadius: 10,
                  boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
                  zIndex: 50,
                  padding: '0.35rem 0',
                }}
              >
                <button
                  type="button"
                  onClick={function pickAll() {
                    setSelectedRun('');
                    setDropdownOpen(false);
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.55rem 0.85rem',
                    border: 'none',
                    background: selectedRun === '' ? '#2563eb' : 'transparent',
                    color: '#fff',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {selectedRun === '' ? '✓ ' : ''}All runs (7 days)
                </button>
                {runSummaries.map(function mapRs(r) {
                  const sel = selectedRun === r.runNumber;
                  return (
                    <button
                      key={r.runNumber}
                      type="button"
                      onClick={function pickRun() {
                        setSelectedRun(r.runNumber);
                        setDropdownOpen(false);
                      }}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '0.5rem 0.85rem',
                        border: 'none',
                        background: sel ? '#374151' : 'transparent',
                        color: '#f9fafb',
                        fontSize: '0.74rem',
                        cursor: 'pointer',
                        lineHeight: 1.35,
                      }}
                    >
                      {sel ? '✓ ' : ''}
                      {formatRunDropdownLine(r)}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
        {runsErr ? <p style={{ color: '#b91c1c', fontSize: '0.85rem', marginTop: '0.75rem' }}>{runsErr}</p> : null}
        {listErr ? <p style={{ color: '#b91c1c', fontSize: '0.85rem', marginTop: '0.35rem' }}>{listErr}</p> : null}

        <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: 720 }}>
            <thead>
              <tr style={{ color: '#6b7280', fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.06em', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem 0.35rem', borderBottom: '1px solid #e5e7eb' }}>SCENARIO</th>
                <th style={{ padding: '0.5rem 0.35rem', borderBottom: '1px solid #e5e7eb' }}>TIME (UTC)</th>
                <th style={{ padding: '0.5rem 0.35rem', borderBottom: '1px solid #e5e7eb' }}>STATUS</th>
                <th style={{ padding: '0.5rem 0.35rem', borderBottom: '1px solid #e5e7eb' }}>QUALITY</th>
                <th style={{ padding: '0.5rem 0.35rem', borderBottom: '1px solid #e5e7eb' }}>GRADE</th>
                <th style={{ padding: '0.5rem 0.35rem', borderBottom: '1px solid #e5e7eb' }}>DURATION</th>
                <th style={{ padding: '0.5rem 0.35rem', borderBottom: '1px solid #e5e7eb' }}>TOKENS</th>
                <th style={{ padding: '0.5rem 0.35rem', borderBottom: '1px solid #e5e7eb' }}>COST</th>
                <th style={{ padding: '0.5rem 0.35rem', borderBottom: '1px solid #e5e7eb', textAlign: 'right' }}>GITHUB</th>
              </tr>
            </thead>
            <tbody>
              {listRuns.map(function mapRow(run) {
                const g = run.qualityGrade?.trim();
                const gs = g ? gradeBadgeStyle(g) : null;
                const rowBg = run.success ? 'transparent' : '#fef2f2';
                return (
                  <tr key={run.id} style={{ background: rowBg }}>
                    <td style={{ padding: '0.65rem 0.35rem', borderBottom: '1px solid #f3f4f6', color: '#111827', maxWidth: 280 }}>{run.scenario}</td>
                    <td style={{ padding: '0.65rem 0.35rem', borderBottom: '1px solid #f3f4f6', color: '#374151', whiteSpace: 'nowrap' }}>{formatUtcTime(run.timestamp)}</td>
                    <td style={{ padding: '0.65rem 0.35rem', borderBottom: '1px solid #f3f4f6', fontWeight: 700, color: run.success ? GREEN : RED }}>
                      {run.success ? '✅ PASS' : '❌ FAIL'}
                    </td>
                    <td style={{ padding: '0.65rem 0.35rem', borderBottom: '1px solid #f3f4f6', color: run.qualityScore != null ? '#15803d' : '#9ca3af' }}>
                      {run.qualityScore != null ? run.qualityScore.toFixed(2) : '—'}
                    </td>
                    <td style={{ padding: '0.65rem 0.35rem', borderBottom: '1px solid #f3f4f6' }}>
                      {g && gs ? (
                        <span
                          style={{
                            display: 'inline-block',
                            minWidth: '1.5rem',
                            textAlign: 'center',
                            padding: '0.15rem 0.35rem',
                            borderRadius: 6,
                            fontWeight: 800,
                            fontSize: '0.72rem',
                            background: gs.bg,
                            color: gs.color,
                          }}
                        >
                          {g.toUpperCase().charAt(0)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={{ padding: '0.65rem 0.35rem', borderBottom: '1px solid #f3f4f6', color: '#374151' }}>{Number(run.durationMinutes).toFixed(1)}m</td>
                    <td style={{ padding: '0.65rem 0.35rem', borderBottom: '1px solid #f3f4f6', color: '#374151' }}>{run.totalTokens.toLocaleString('en-US')}</td>
                    <td style={{ padding: '0.65rem 0.35rem', borderBottom: '1px solid #f3f4f6', color: '#374151' }}>${Number(run.costEstimateUSD).toFixed(4)}</td>
                    <td style={{ padding: '0.65rem 0.35rem', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>
                      {run.runUrl ? (
                        <a href={run.runUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>
                          → Run
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
