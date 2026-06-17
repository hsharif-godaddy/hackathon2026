'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { splitMarkdownBlocks } from '@/lib/investigate/markdown';
import type { InvestigationEvent, InvestigationEventType } from '@/lib/investigate/types';

const CLIENT_AUTO_FETCH_MAX_BYTES = 50 * 1024 * 1024;

const MarkdownBlock = memo(function MarkdownBlock({ source }: { source: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>;
});

type StartResponse = {
  investigationId: string;
  status: string;
  statusUrl: string;
  bucket: string;
};

type ConflictResponse = {
  error: 'investigation_in_progress';
  investigationId: string;
  status: string;
  startedAt: string;
};

type StatusResponse = {
  investigationId: string;
  appId: string;
  customerId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'killed';
  phase: string | null;
  lastEvent: string | null;
  // Why a run ended early: 'timeout' (real budget cap), 'turn-limit' (step cap),
  // 'error' (a model call threw mid-run). Absent on clean completions.
  reason?: 'timeout' | 'turn-limit' | 'error' | null;
  startedAt: string;
  heartbeatAt: string;
  completedAt: string | null;
  durationMs: number | null;
  stale: boolean;
  error: string | null;
  reportAvailable: boolean;
  reportFilename: string | null;
  reportSize: number | null;
  reportEtag: string | null;
  cost: {
    // null for the in-process core path — the GoCode proxy doesn't expose a $
    // figure, only token counts. The UI renders tokens and omits the USD line.
    totalUsd: number | null;
    inputTokens: number;
    outputTokens: number;
  } | null;
  // Verdict + fix sidecar fields (analysis.json). Absent on old runs whose
  // sidecar predates Task 5 — all default to null and render nothing.
  verdict: 'agent-bug' | 'customer-error' | 'platform-bug' | 'external' | 'no-issue' | null;
  relatesTo: string | null;
  verdictConfidence: 'low' | 'medium' | 'high' | null;
  verdictRationale: string | null;
  verifierNote?: string | null;
  fixKind: 'app-prompt' | 'eng-note' | 'none' | null;
  fixPrompt: string | null;
  engNote: string | null;
};

type VerdictKind = NonNullable<StatusResponse['verdict']>;

// Inline color tokens per verdict, matching the file's existing inline-style
// approach. Background is a soft tint; `fg` drives the badge text + border.
const VERDICT_STYLES: Record<VerdictKind, { bg: string; fg: string; label: string }> = {
  'agent-bug': { bg: '#fef3c7', fg: '#92400e', label: 'Agent bug' },
  'platform-bug': { bg: '#fee2e2', fg: '#b91c1c', label: 'Platform bug' },
  'customer-error': { bg: '#dbeafe', fg: '#1d4ed8', label: 'Customer error' },
  external: { bg: '#f3f4f6', fg: '#374151', label: 'External' },
  'no-issue': { bg: '#d1fae5', fg: '#047857', label: 'No issue' },
};

// Legacy sessionStorage key from the pre-S2S GoCode API-key flow. Kept
// here so the one-time cleanup effect can purge stale tokens from users'
// browsers. Safe to remove this constant after a release cycle.
const LEGACY_GOCODE_KEY_STORAGE = 'airo-investigate.gocodeApiKey';

type TimelineEvent = InvestigationEvent;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDurationMs(ms: number | null): string {
  if (ms == null) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

// Phases emitted by the skill (matches `phase-N-name` strings Claude CLI
// prints). Keep this list in sync with the skill's phase files so the UI
// always has a friendly label. Unknown phases fall through to the raw
// string.
// Map Claude skill phase markers to user-facing labels.
// phase-0/1/2 are collapsed into one label so the card doesn't flash through
// setup noise — user sees a single "Analyzing agent conversation" step.
const PHASE_LABELS: Record<string, string> = {
  bootstrap: 'Warming up',
  'claude-analysis': 'Launching Claude analysis',
  // Keys must match the phase markers the skill actually emits
  // (phases/phase-0-gather.md, phase-1-analyze.md, phase-2-synthesis.md).
  'phase-0-gather': 'Gathering logs',
  'phase-1-analyze': 'Analyzing evidence',
  'phase-2-synthesis': 'Writing report',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  'investigation.started': 'Investigation started',
  'evidence.ready': 'Evidence collected',
  'report.ready': 'Report ready',
  'investigation.warning': '⚠ Warning',
  'investigation.completed': '✓ Completed',
  'investigation.failed': '✗ Failed',
  'investigation.killed': '⚠ Ended early',
};

function friendlyPhase(phase: string | null): string {
  if (!phase) return 'Starting…';
  return PHASE_LABELS[phase] ?? phase;
}

// Icon for an activity row, keyed by the raw tool name the Lambda sent.
function activityIcon(tool: string): string {
  if (tool.startsWith('mcp__crg__')) return '🕸';
  switch (tool) {
    case 'Grep': return '🔍';
    case 'Read': return '📄';
    case 'Glob': return '📁';
    case 'Bash': return '📜'; // only log-search Bash is surfaced
    default: return '•';
  }
}

function badgeColor(status: StatusResponse['status'] | 'pending'): string {
  switch (status) {
    case 'completed': return '#10b981';
    case 'failed': return '#ef4444';
    case 'killed': return '#f59e0b';
    case 'running': return '#3b82f6';
    default: return '#6b7280';
  }
}

interface Props {
  // When rendered inside AppDetailsPanel tab, the parent already knows which
  // app is in focus — pass them in so the user doesn't retype. Standalone
  // /investigate route calls this with no props and falls back to the URL
  // query string prefill below.
  appId?: string;
  customerId?: string;
}

export default function InvestigatePanel(props: Props = {}) {
  const searchParams = useSearchParams();
  const embedded = Boolean(props.appId && props.customerId);

  const [appId, setAppId] = useState(props.appId ?? '');
  const [customerId, setCustomerId] = useState(props.customerId ?? '');
  const [feedback, setFeedback] = useState('');
  const [timeWindow, setTimeWindow] = useState('24h');

  // One-time cleanup of the pre-S2S GoCode API key that used to live in
  // sessionStorage. The Lambda now mints its own IAM JWT so users no
  // longer paste a key. Safe to delete this effect after a release cycle.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { window.sessionStorage.removeItem(LEGACY_GOCODE_KEY_STORAGE); } catch { /* ignore */ }
  }, []);

  const [investigationId, setInvestigationId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const esRef = useRef<EventSource | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const timelineRef = useRef<HTMLOListElement | null>(null);

  // Stick-to-bottom: as activity events stream in, keep the newest visible —
  // but only auto-scroll when the user is already near the bottom, so scrolling
  // up to read an earlier step isn't yanked back down.
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [timeline]);

  // Report streaming state. Keyed on etag so a reopened-but-unchanged report
  // reuses the cached text without re-downloading.
  const [reportText, setReportText] = useState<string>('');
  const [reportEtagLoaded, setReportEtagLoaded] = useState<string | null>(null);
  const [reportProgress, setReportProgress] = useState<number>(0); // 0..1
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState<boolean>(false);
  const [reportOversized, setReportOversized] = useState<boolean>(false);
  const [reportDownloading, setReportDownloading] = useState<boolean>(false);
  const reportAbortRef = useRef<AbortController | null>(null);

  // Prefill from query string (standalone /investigate route) or parent
  // props (embedded in AppDetailsPanel tab). Props win because the parent
  // is authoritative for the app currently in focus.
  useEffect(() => {
    if (props.appId) setAppId(props.appId);
    if (props.customerId) setCustomerId(props.customerId);
    if (props.appId || props.customerId) return;
    if (!searchParams) return;
    const a = searchParams.get('appId');
    const c = searchParams.get('customerId');
    if (a && !appId) setAppId(a);
    if (c && !customerId) setCustomerId(c);
  }, [searchParams, appId, customerId, props.appId, props.customerId]);

  const stopStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  const abortReportFetch = useCallback(() => {
    if (reportAbortRef.current) {
      reportAbortRef.current.abort();
      reportAbortRef.current = null;
    }
  }, []);

  const streamReport = useCallback(async (
    invId: string,
    app: string,
    cust: string,
    expectedSize: number,
    expectedEtag: string | null,
  ) => {
    abortReportFetch();
    const ac = new AbortController();
    reportAbortRef.current = ac;
    setReportLoading(true);
    setReportError(null);
    setReportText('');
    setReportProgress(0);
    setReportOversized(false);

    try {
      const metaRes = await fetch(
        `/api/investigate/${encodeURIComponent(invId)}/report?appId=${encodeURIComponent(app)}&customerId=${encodeURIComponent(cust)}`,
        { cache: 'no-store', signal: ac.signal },
      );
      if (!metaRes.ok) {
        setReportError(`Report fetch failed: ${metaRes.status}`);
        setReportLoading(false);
        return;
      }
      const meta = (await metaRes.json()) as { url: string; size: number; etag: string | null };

      if (meta.size > CLIENT_AUTO_FETCH_MAX_BYTES) {
        setReportOversized(true);
        setReportEtagLoaded(meta.etag ?? expectedEtag ?? null);
        setReportLoading(false);
        return;
      }

      const res = await fetch(meta.url, { signal: ac.signal });
      if (!res.ok || !res.body) {
        setReportError(`S3 fetch failed: ${res.status}`);
        setReportLoading(false);
        return;
      }

      const total = Number(res.headers.get('content-length')) || meta.size || expectedSize || 0;
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let received = 0;
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        buffer += decoder.decode(value, { stream: true });
        setReportText(buffer);
        if (total > 0) setReportProgress(Math.min(1, received / total));
      }
      buffer += decoder.decode();
      setReportText(buffer);
      setReportProgress(1);
      setReportEtagLoaded(meta.etag ?? expectedEtag ?? null);
      setReportLoading(false);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.error('investigate.report.fetch.failed', err);
      setReportError('Report fetch failed. Retry or reload.');
      setReportLoading(false);
    }
  }, [abortReportFetch]);

  const handleDownloadOversized = useCallback(async (
    invId: string,
    app: string,
    cust: string,
  ) => {
    const popup = window.open('about:blank', '_blank', 'noopener,noreferrer');
    setReportDownloading(true);
    setReportError(null);
    try {
      const metaRes = await fetch(
        `/api/investigate/${encodeURIComponent(invId)}/report?appId=${encodeURIComponent(app)}&customerId=${encodeURIComponent(cust)}`,
        { cache: 'no-store' },
      );
      if (!metaRes.ok) {
        popup?.close();
        setReportError(`Could not prepare download: ${metaRes.status}`);
        return;
      }
      const meta = (await metaRes.json()) as { url: string };
      if (popup) {
        popup.location.href = meta.url;
      } else {
        window.location.href = meta.url;
      }
    } catch (err) {
      popup?.close();
      console.error('investigate.report.download.failed', err);
      setReportError('Download failed. Try again.');
    } finally {
      setReportDownloading(false);
    }
  }, []);

  // Fetch final /status once after terminal event. Merge (not replace) so
  // fields we maintained from the live event stream (phase, lastEvent)
  // aren't clobbered if the server-side state.json write lags behind the
  // terminal event.
  const fetchFinalStatus = useCallback(async (id: string, app: string, cust: string) => {
    try {
      const res = await fetch(
        `/api/investigate/${encodeURIComponent(id)}/status?appId=${encodeURIComponent(app)}&customerId=${encodeURIComponent(cust)}`,
        { cache: 'no-store' },
      );
      if (res.ok) {
        const next = (await res.json()) as StatusResponse;
        setStatus((prev) => (prev ? { ...prev, ...next } : next));
      }
    } catch (err) {
      console.error('investigate.status.final.fetch.failed', err);
    }
  }, []);

  const openStream = useCallback((id: string, app: string, cust: string) => {
    if (esRef.current) esRef.current.close();
    const url = `/api/investigate/${encodeURIComponent(id)}/stream?appId=${encodeURIComponent(app)}&customerId=${encodeURIComponent(cust)}`;
    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;

    const handleEvent = (evt: MessageEvent): void => {
      try {
        const parsed = JSON.parse(evt.data) as TimelineEvent;
        setTimeline((prev) => (prev.some((e) => e.seq === parsed.seq) ? prev : [...prev, parsed].sort((a, b) => a.seq - b.seq)));

        // Derive status fields from event data for live UI updates.
        if (parsed.type === 'phase.started') {
          setStatus((s) => (s ? { ...s, phase: (parsed.data.phase as string) ?? s.phase } : s));
        } else if (parsed.type === 'heartbeat') {
          setStatus((s) => s ? {
            ...s,
            phase: (parsed.data.phase as string) ?? s.phase,
            lastEvent: (parsed.data.lastEvent as string) ?? s.lastEvent,
            heartbeatAt: parsed.ts,
          } : s);
        } else if (
          parsed.type === 'investigation.completed' ||
          parsed.type === 'investigation.failed' ||
          parsed.type === 'investigation.killed'
        ) {
          es.close();
          esRef.current = null;
          void fetchFinalStatus(id, app, cust);
        }
      } catch {
        /* ignore malformed */
      }
    };

    // Prelude: server sends `hello` with the authoritative state snapshot
    // (status, startedAt) before any events. Use it to seed the card in the
    // reopen / 409-conflict cases where the client has no local snapshot.
    es.addEventListener('hello', (evt: MessageEvent) => {
      try {
        const hello = JSON.parse(evt.data) as {
          investigationId: string;
          status: StatusResponse['status'];
          startedAt: string;
        };
        setStatus((prev) => prev ?? {
          investigationId: hello.investigationId,
          appId: app,
          customerId: cust,
          status: hello.status,
          phase: 'bootstrap',
          lastEvent: null,
          startedAt: hello.startedAt,
          heartbeatAt: hello.startedAt,
          completedAt: null,
          durationMs: null,
          stale: false,
          error: null,
          reportAvailable: false,
          reportFilename: null,
          reportSize: null,
          reportEtag: null,
          cost: null,
          verdict: null,
          relatesTo: null,
          verdictConfidence: null,
          verdictRationale: null,
          verifierNote: null,
          fixKind: null,
          fixPrompt: null,
          engNote: null,
        });
      } catch {
        /* ignore malformed */
      }
    });

    // Generic fallback (server always sets explicit event name, but guard).
    es.onmessage = handleEvent;
    for (const type of [
      'investigation.started',
      'phase.started',
      'log',
      'evidence.ready',
      'heartbeat',
      'report.ready',
      'activity',
      'investigation.warning',
      'investigation.completed',
      'investigation.failed',
      'investigation.killed',
    ] satisfies InvestigationEventType[]) {
      es.addEventListener(type, handleEvent as EventListener);
    }
    es.addEventListener('close', () => {
      // Skip if a terminal event handler already closed + fetched — avoids
      // a duplicate /status hit when the server sends both the terminal
      // event and the explicit close frame.
      if (esRef.current !== es) return;
      esRef.current = null;
      es.close();
      void fetchFinalStatus(id, app, cust);
    });
    es.onerror = () => {
      // Browser auto-reconnects with Last-Event-ID. Leave open unless server
      // explicitly closed (handled above).
    };
  }, [fetchFinalStatus]);

  useEffect(() => () => { stopStream(); }, [stopStream]);
  useEffect(() => () => { abortReportFetch(); }, [abortReportFetch]);

  // Kick off (or reuse cached) report fetch whenever we see a completed
  // investigation with a fresh etag. Etag match = skip re-download.
  useEffect(() => {
    if (!status || status.status !== 'completed' || !status.reportAvailable) return;
    if (!status.investigationId || !status.appId || !status.customerId) return;
    if (status.reportEtag && status.reportEtag === reportEtagLoaded) return;
    void streamReport(
      status.investigationId,
      status.appId,
      status.customerId,
      status.reportSize ?? 0,
      status.reportEtag,
    );
  }, [
    status?.investigationId,
    status?.status,
    status?.reportAvailable,
    status?.reportEtag,
    status?.reportSize,
    status?.appId,
    status?.customerId,
    reportEtagLoaded,
    streamReport,
  ]);

  // Embedded mode: on mount (or when appId changes) fetch the most recent
  // investigation for this (customer, app). Lets users reopen the tab later
  // and see the last report without re-running. If an investigation is
  // still in flight, fall into the polling loop.
  const [autoLoadedOnce, setAutoLoadedOnce] = useState(false);
  const [showForm, setShowForm] = useState(!embedded);
  useEffect(() => {
    if (!embedded) return;
    if (!appId || !customerId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/investigate/latest?appId=${encodeURIComponent(appId)}&customerId=${encodeURIComponent(customerId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok || cancelled) return;
        const data = await res.json() as { exists: boolean } & Partial<StatusResponse>;
        if (cancelled) return;
        if (data.exists && data.investigationId) {
          setStatus(data as StatusResponse);
          setInvestigationId(data.investigationId);
          // If it's still running, resume polling. Otherwise static display.
          if ((data.status === 'pending' || data.status === 'running') && !data.stale) {
            openStream(data.investigationId, appId, customerId);
          }
        }
      } catch (err) {
        // Best-effort load — render the empty state so the tab still
        // works. A breadcrumb in devtools distinguishes a genuine "never
        // ran" from an auth/network failure that happens to look the same
        // to the user.
        console.error('investigate.autoLoad.failed', err);
      } finally {
        if (!cancelled) setAutoLoadedOnce(true);
      }
    })();
    return () => { cancelled = true; };
  }, [embedded, appId, customerId, openStream]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!appId.trim() || !customerId.trim() || !feedback.trim()) {
      setSubmitError('appId, customerId, and feedback are required');
      return;
    }
    setSubmitting(true);
    setStatus(null);
    setInvestigationId(null);
    setTimeline([]);
    stopStream();
    abortReportFetch();
    setReportText('');
    setReportEtagLoaded(null);
    setReportProgress(0);
    setReportError(null);
    setReportOversized(false);

    try {
      const res = await fetch('/api/investigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: appId.trim(),
          customerId: customerId.trim(),
          feedback: feedback.trim(),
          timeWindow: timeWindow.trim() || null,
        }),
      });

      if (res.status === 409) {
        const data = (await res.json()) as ConflictResponse;
        setInvestigationId(data.investigationId);
        setSubmitError(`Another investigation is already running for this app (started ${data.startedAt}). Showing its status.`);
        openStream(data.investigationId, appId.trim(), customerId.trim());
        return;
      }

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        setSubmitError(errBody.error ? `Failed: ${errBody.error}` : `Failed with status ${res.status}`);
        return;
      }

      const data = (await res.json()) as StartResponse;
      setInvestigationId(data.investigationId);
      // Seed a minimal pending card so the UI isn't blank until the first
      // SSE event lands — events update this shell via `setStatus((prev) =>
      // prev ? ... : prev)` so an initial row must exist.
      const nowIso = new Date().toISOString();
      setStatus({
        investigationId: data.investigationId,
        appId: appId.trim(),
        customerId: customerId.trim(),
        status: 'pending',
        phase: 'bootstrap',
        lastEvent: 'awaiting lambda cold start',
        startedAt: nowIso,
        heartbeatAt: nowIso,
        completedAt: null,
        durationMs: null,
        stale: false,
        error: null,
        reportAvailable: false,
        reportFilename: null,
        reportSize: null,
        reportEtag: null,
        cost: null,
        verdict: null,
        relatesTo: null,
        verdictConfidence: null,
        verdictRationale: null,
        verifierNote: null,
        fixKind: null,
        fixPrompt: null,
        engNote: null,
      });
      openStream(data.investigationId, appId.trim(), customerId.trim());
      // Embedded: collapse the form so the user sees the live progress +
      // (eventually) the report without scrolling past their own inputs.
      if (embedded) setShowForm(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setSubmitting(false);
    }
  }

  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const copyLabel = copiedAt ? 'Copied ✓' : 'Copy markdown';

  async function handleCopy() {
    if (!reportText) return;
    try {
      await navigator.clipboard.writeText(reportText);
      setCopiedAt(Date.now());
      setTimeout(() => setCopiedAt(null), 2000);
    } catch {
      /* ignore — older browsers without clipboard access silently skip */
    }
  }

  const [fixCopiedAt, setFixCopiedAt] = useState<number | null>(null);
  const fixCopyLabel = fixCopiedAt ? 'Copied ✓' : 'Copy fix prompt';

  async function handleCopyFix() {
    const prompt = status?.fixPrompt;
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setFixCopiedAt(Date.now());
      setTimeout(() => setFixCopiedAt(null), 2000);
    } catch {
      /* ignore — older browsers without clipboard access silently skip */
    }
  }

  // Operator capture half of the investigator feedback loop: flag this verdict
  // as a false positive. Persists a candidate lesson to the S3 lessons inbox
  // (server-side) for human curation into the agent's aab-behaviors.md.
  const [lessonState, setLessonState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function handleFlagFalsePositive() {
    if (!investigationId || !appId || !customerId) return;
    const note = window.prompt(
      'Why is this a false positive? (e.g. "pages are built on demand — customer never asked for /schedule"). This becomes a candidate knowledge-base entry.',
    );
    if (note === null) return; // cancelled
    const trimmed = note.trim();
    if (!trimmed) return;
    setLessonState('saving');
    try {
      const res = await fetch(`/api/investigate/${encodeURIComponent(investigationId)}/lesson`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, customerId, note: trimmed }),
      });
      setLessonState(res.ok ? 'saved' : 'error');
    } catch {
      setLessonState('error');
    }
  }

  const running = status?.status === 'pending' || status?.status === 'running';
  const activelyPolling = running && !status?.stale;
  const actionDisabled = submitting || activelyPolling;

  const reportBlocks = useMemo(() => splitMarkdownBlocks(reportText), [reportText]);

  const headerBadge = useMemo(() => {
    if (!status) return null;
    const color = badgeColor(status.status);
    return (
      <span style={{
        background: color,
        color: 'white',
        padding: '2px 10px',
        borderRadius: 10,
        fontSize: 12,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}>{status.status}</span>
    );
  }, [status]);

  // Hide embedded form until user asks to run something new — saves scroll
  // and signals "we already loaded the latest". Also skip the page heading
  // in embedded mode since the tab label already names the surface.
  const showHeading = !embedded;
  const hideIdentityFields = embedded;
  const formCollapsed = embedded && status !== null && !showForm;

  return (
    <div style={{
      padding: embedded ? 0 : 24,
      maxWidth: embedded ? 'none' : 1100,
      margin: embedded ? 0 : '0 auto',
      fontFamily: 'system-ui, sans-serif',
    }}>
      {showHeading && <h1 style={{ marginTop: 0, marginBottom: 20 }}>Investigate feedback</h1>}

      <div style={topNoticeRowStyle}>
        <div style={{ ...wipWarningStyle, flex: '1 1 360px' }}>
          <strong>Work in progress:</strong> Treat investigation results as a starting point, not a final answer.
        </div>

        {formCollapsed && (
          <button
            type="button"
            onClick={() => { setShowForm(true); }}
            style={{
              padding: '6px 12px',
              background: '#2563eb',
              color: 'white',
              border: 0,
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              flex: '0 0 auto',
              marginLeft: 'auto',
            }}
          >
            Run new investigation
          </button>
        )}
      </div>

      {!formCollapsed && (
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12, marginTop: embedded ? 0 : 20 }}>
        {!hideIdentityFields && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>App ID *</span>
            <input
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="f4q85qcf0k"
              required
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Customer / Shopper ID *</span>
            <input
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              placeholder="12345678"
              required
              style={inputStyle}
            />
          </label>
        </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 180px', gap: 12, alignItems: 'start' }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Customer feedback *</span>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Agent kept repeating the same fix and wasting my credits..."
              required
              rows={4}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 90 }}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Time window</span>
            <select
              value={timeWindow}
              onChange={(e) => setTimeWindow(e.target.value)}
              style={inputStyle}
            >
              <option value="15m">Last 15 min</option>
              <option value="1h">Last hour</option>
              <option value="3h">Last 3 hours</option>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            type="submit"
            disabled={actionDisabled}
            style={{
              padding: '10px 20px',
              background: actionDisabled ? '#9ca3af' : '#2563eb',
              color: 'white',
              border: 0,
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: actionDisabled ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Starting…' : activelyPolling ? 'Investigating…' : 'Investigate'}
          </button>
          {submitError && <span style={{ color: '#dc2626', fontSize: 13 }}>{submitError}</span>}
          {embedded && status && (
            <button
              type="button"
              onClick={() => setShowForm(false)}
              style={{
                padding: '8px 12px',
                background: 'transparent',
                color: '#6b7280',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      )}

      {embedded && !status && autoLoadedOnce && !showForm && (
        <div style={{ fontSize: 13, color: '#6b7280', padding: 12 }}>
          No prior investigations for this app. Use the form above to run one.
        </div>
      )}

      {status && (
        <section style={{ marginTop: 28, border: '1px solid #e5e7eb', borderRadius: 10, padding: 18 }}>
          <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {headerBadge}
            <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#6b7280' }}>
              {status.investigationId}
            </div>
            {status.durationMs != null && (
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                in {formatDurationMs(status.durationMs)}
              </div>
            )}
            {status.stale && running && (
              <span style={{ color: '#b45309', fontSize: 12 }}>⚠ heartbeat stale</span>
            )}
          </header>

          {activelyPolling && (
            <div style={{ marginTop: 12, fontSize: 13, color: '#374151' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: '#3b82f6',
                  animation: 'pulse 1.2s ease-in-out infinite',
                }} />
                <span><strong>{friendlyPhase(status.phase)}</strong></span>
              </div>
              <div style={{ marginTop: 6, color: '#6b7280', fontSize: 12 }}>
                Typical run: 3–6 minutes. Live updates.
              </div>
              <style>{`@keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: .3 } }`}</style>
            </div>
          )}

          {running && status.stale && (
            <div style={{ marginTop: 12, color: '#b45309', fontSize: 13 }}>
              Investigation appears stuck because the Lambda heartbeat is stale. The live stream has stopped; run a new investigation after the Lambda deploy is healthy.
            </div>
          )}

          {status.status === 'failed' && (
            <div style={{ marginTop: 12, color: '#dc2626', fontSize: 13 }}>
              {status.error || 'Investigation failed. Check CloudWatch for Lambda logs.'}
            </div>
          )}

          {status.status === 'killed' && (
            <div style={{ marginTop: 12, color: '#b45309', fontSize: 13 }}>
              {status.reason === 'turn-limit'
                ? 'Investigation reached the step limit before finishing; a partial verdict was produced.'
                : status.lastEvent
                  ? `Investigation ended early: ${status.lastEvent}.`
                  : 'Investigation ran out of its time budget before finishing; a partial verdict was produced.'}
            </div>
          )}

          {(() => {
            // Hide heartbeats (too chatty) and collapse runs of the same
            // phase label (phase-0/1/2 all map to "Analyzing agent
            // conversation" — we don't want three identical lines). `activity`
            // rows are per-action and never dup-collapsed; each carries the
            // tool input as expandable detail.
            type VisibleStep = {
              key: number;
              label: string;
              ts: string;
              tool?: string;
              detail?: string;
            };
            const visible: VisibleStep[] = [];
            let lastLabel: string | null = null;
            for (const e of timeline) {
              if (e.type === 'heartbeat') continue;
              if (e.type === 'activity') {
                const label = typeof e.data.label === 'string' ? e.data.label : 'Working…';
                const tool = typeof e.data.tool === 'string' ? e.data.tool : undefined;
                const detail = typeof e.data.detail === 'string' ? e.data.detail : undefined;
                lastLabel = null; // activity breaks the phase-collapse run
                visible.push({ key: e.seq, label, ts: e.ts, tool, detail });
                continue;
              }
              let label: string;
              if (e.type === 'phase.started') {
                const phase = typeof e.data.phase === 'string' ? e.data.phase : null;
                label = phase ? (PHASE_LABELS[phase] ?? phase) : 'Phase started';
              } else {
                label = EVENT_TYPE_LABELS[e.type] ?? e.type;
              }
              if (label === lastLabel) continue;
              lastLabel = label;
              visible.push({ key: e.seq, label, ts: e.ts });
            }
            if (visible.length === 0) return null;
            return (
              <details style={{ marginTop: 12 }} open>
                <summary style={{ cursor: 'pointer', fontSize: 13, color: '#6b7280' }}>
                  Timeline ({visible.length} steps)
                </summary>
                <ol ref={timelineRef} style={{ marginTop: 8, paddingLeft: 20, fontSize: 12, color: '#374151', maxHeight: 240, overflowY: 'auto' }}>
                  {visible.map((e) => {
                    const time = new Date(e.ts).toLocaleTimeString();
                    // Activity rows with a tool input are click-to-expand.
                    if (e.detail) {
                      return (
                        <li key={e.key} style={{ marginBottom: 4 }} data-testid="investigate-activity">
                          <details>
                            <summary style={{ cursor: 'pointer' }}>
                              <span style={{ color: '#1f2937' }}>
                                {e.tool ? `${activityIcon(e.tool)} ` : ''}
                                {e.label}
                              </span>
                              {' · '}
                              <span style={{ color: '#9ca3af' }}>{time}</span>
                            </summary>
                            <pre style={{ margin: '4px 0 0 16px', padding: '6px 8px', background: '#f3f4f6', borderRadius: 4, fontSize: 11, color: '#374151', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                              {e.detail}
                            </pre>
                          </details>
                        </li>
                      );
                    }
                    return (
                      <li key={e.key} style={{ marginBottom: 4 }}>
                        <span style={{ color: '#1f2937' }}>{e.label}</span>
                        {' · '}
                        <span style={{ color: '#9ca3af' }}>{time}</span>
                      </li>
                    );
                  })}
                </ol>
              </details>
            );
          })()}

          {status.verdict && (() => {
            const vs = VERDICT_STYLES[status.verdict];
            return (
              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span
                    data-testid="investigate-verdict"
                    style={{
                      background: vs.bg,
                      color: vs.fg,
                      border: `1px solid ${vs.fg}`,
                      padding: '3px 10px',
                      borderRadius: 10,
                      fontSize: 12,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: 0.4,
                    }}
                  >
                    {vs.label}
                  </span>
                  {status.relatesTo && (
                    <span style={{ fontSize: 13, color: '#374151' }}>
                      relates to <strong>{status.relatesTo}</strong>
                    </span>
                  )}
                  {status.verdictConfidence && (
                    <span style={{ fontSize: 12, color: '#6b7280' }}>
                      {status.verdictConfidence} confidence
                    </span>
                  )}
                </div>
                {status.verdictRationale && (
                  <div style={{ marginTop: 6, fontSize: 13, color: '#374151', lineHeight: 1.45 }}>
                    {status.verdictRationale}
                  </div>
                )}
                {status.verifierNote && (
                  <div
                    data-testid="investigate-verifier-note"
                    style={{ marginTop: 6, fontSize: 12, color: '#92400e', lineHeight: 1.4 }}
                  >
                    ⚠ Verifier flagged: {status.verifierNote}
                  </div>
                )}

                {status.fixKind === 'app-prompt' && status.fixPrompt && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Suggested fix prompt</span>
                      <button
                        type="button"
                        data-testid="investigate-copy-fix"
                        onClick={handleCopyFix}
                        style={{
                          padding: '6px 12px',
                          background: '#1f2937',
                          color: 'white',
                          border: 0,
                          borderRadius: 6,
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                        title="Copies the suggested fix prompt to your clipboard"
                      >
                        {fixCopyLabel}
                      </button>
                    </div>
                    <pre style={{
                      marginTop: 8,
                      padding: '12px 14px',
                      background: '#f9fafb',
                      border: '1px solid #e5e7eb',
                      borderRadius: 6,
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: '#111827',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}>{status.fixPrompt}</pre>
                  </div>
                )}

                {status.fixKind === 'eng-note' && status.engNote && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Engineering note</div>
                    <div style={{ marginTop: 6, fontSize: 13, color: '#374151', lineHeight: 1.45 }}>
                      {status.engNote}
                    </div>
                  </div>
                )}

                {(status.fixKind === 'none' || status.fixKind === null) && (
                  <div style={{ marginTop: 10, fontSize: 12, color: '#9ca3af' }}>No action.</div>
                )}

                <div style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    data-testid="investigate-flag-false-positive"
                    onClick={handleFlagFalsePositive}
                    disabled={lessonState === 'saving' || lessonState === 'saved'}
                    style={{
                      padding: '5px 10px',
                      background: 'transparent',
                      color: '#6b7280',
                      border: '1px solid #d1d5db',
                      borderRadius: 6,
                      fontSize: 12,
                      cursor: lessonState === 'saving' || lessonState === 'saved' ? 'default' : 'pointer',
                    }}
                    title="Flag this verdict as a false positive — captures a candidate lesson for the investigator's knowledge base"
                  >
                    {lessonState === 'saved'
                      ? 'Lesson captured ✓'
                      : lessonState === 'saving'
                        ? 'Saving…'
                        : lessonState === 'error'
                          ? 'Failed — retry'
                          : 'Flag false positive'}
                  </button>
                </div>
              </div>
            );
          })()}

          {status.reportAvailable && status.status === 'completed' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
                <h2 style={{ margin: 0, fontSize: 16 }}>
                  Report
                  {status.reportSize != null && (
                    <span style={{ marginLeft: 10, fontSize: 12, color: '#6b7280', fontWeight: 400 }}>
                      {formatBytes(status.reportSize)}
                    </span>
                  )}
                </h2>
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={!reportText || reportLoading}
                  style={{
                    padding: '6px 12px',
                    background: (reportText && !reportLoading) ? '#1f2937' : '#9ca3af',
                    color: 'white',
                    border: 0,
                    borderRadius: 6,
                    fontSize: 12,
                    cursor: (reportText && !reportLoading) ? 'pointer' : 'not-allowed',
                  }}
                  title={reportLoading ? 'Wait for the stream to finish' : 'Copies the raw markdown source to your clipboard'}
                >
                  {copyLabel}
                </button>
              </div>
              <div style={{ ...wipWarningStyle, marginTop: 10 }}>
                <strong>Verify before sharing:</strong> This report is a work-in-progress AI investigation. Confirm cited logs and coverage gaps before using it as a decision record.
              </div>

              {reportLoading && (
                <div style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>
                  Streaming report… {Math.round(reportProgress * 100)}%
                  <div style={{ height: 4, background: '#e5e7eb', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                    <div style={{
                      width: `${Math.round(reportProgress * 100)}%`,
                      height: '100%',
                      background: '#3b82f6',
                      transition: 'width 120ms linear',
                    }} />
                  </div>
                </div>
              )}

              {reportError && (
                <div style={{ marginTop: 10, color: '#dc2626', fontSize: 13 }}>
                  {reportError}
                  <button
                    type="button"
                    onClick={() => {
                      if (status.investigationId && status.appId && status.customerId) {
                        void streamReport(
                          status.investigationId,
                          status.appId,
                          status.customerId,
                          status.reportSize ?? 0,
                          status.reportEtag,
                        );
                      }
                    }}
                    style={{ ...smallBtn, marginLeft: 10 }}
                  >
                    Retry
                  </button>
                </div>
              )}

              {reportOversized && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 6, fontSize: 13, color: '#7c2d12' }}>
                  Report is {formatBytes(status.reportSize ?? 0)} — above the {formatBytes(CLIENT_AUTO_FETCH_MAX_BYTES)} auto-render limit. Download instead:
                  <div style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      disabled={reportDownloading}
                      onClick={() => {
                        if (status.investigationId && status.appId && status.customerId) {
                          void handleDownloadOversized(
                            status.investigationId,
                            status.appId,
                            status.customerId,
                          );
                        }
                      }}
                      style={{
                        padding: '8px 14px',
                        background: reportDownloading ? '#9ca3af' : '#2563eb',
                        color: 'white',
                        border: 0,
                        borderRadius: 6,
                        fontSize: 13,
                        cursor: reportDownloading ? 'wait' : 'pointer',
                      }}
                    >
                      {reportDownloading ? 'Preparing…' : 'Download result.md'}
                    </button>
                  </div>
                </div>
              )}

              {reportText && (
                <div className="investigate-report" style={{
                  marginTop: 8,
                  padding: '16px 20px',
                  background: '#ffffff',
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: '#111827',
                }}>
                  {reportBlocks.map((block, i) => {
                    // Append-only stream: finalized block indices are stable,
                    // so keying by index lets React.memo skip re-rendering
                    // prior blocks while the last (growing) block re-renders
                    // as source changes.
                    const isTail = i === reportBlocks.length - 1;
                    return (
                      <MarkdownBlock
                        key={isTail && reportLoading ? 'tail' : `b${i}`}
                        source={block}
                      />
                    );
                  })}
                </div>
              )}

              {status?.cost && (
                <div style={{
                  marginTop: 16,
                  padding: '12px 14px',
                  background: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  fontSize: 13,
                  color: '#374151',
                  display: 'flex',
                  gap: 24,
                  flexWrap: 'wrap',
                }}>
                  {typeof status.cost.totalUsd === 'number' && (
                    <div><strong>Total cost:</strong> ${status.cost.totalUsd.toFixed(4)}</div>
                  )}
                  <div><strong>Input tokens:</strong> {status.cost.inputTokens.toLocaleString()}</div>
                  <div><strong>Output tokens:</strong> {status.cost.outputTokens.toLocaleString()}</div>
                </div>
              )}

              <style>{`
                .investigate-report h1 { font-size: 22px; margin: 16px 0 10px; }
                .investigate-report h2 { font-size: 18px; margin: 20px 0 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
                .investigate-report h3 { font-size: 15px; margin: 16px 0 6px; }
                .investigate-report p { margin: 8px 0; }
                .investigate-report ul, .investigate-report ol { margin: 8px 0; padding-left: 24px; }
                .investigate-report li { margin: 3px 0; }
                .investigate-report code { background: #f3f4f6; padding: 1px 6px; border-radius: 3px; font-size: 13px; }
                .investigate-report pre { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; overflow-x: auto; }
                .investigate-report pre code { background: transparent; padding: 0; }
                .investigate-report blockquote { border-left: 3px solid #d1d5db; margin: 10px 0; padding: 4px 12px; color: #4b5563; background: #f9fafb; }
                .investigate-report table { border-collapse: collapse; margin: 10px 0; }
                .investigate-report th, .investigate-report td { border: 1px solid #e5e7eb; padding: 6px 10px; text-align: left; }
                .investigate-report th { background: #f3f4f6; }
                .investigate-report a { color: #2563eb; text-decoration: underline; }
                .investigate-report hr { border: 0; border-top: 1px solid #e5e7eb; margin: 16px 0; }
              `}</style>
            </>
          )}
        </section>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 13,
  fontFamily: 'inherit',
};

const smallBtn: React.CSSProperties = {
  padding: '8px 10px',
  background: '#f3f4f6',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
};

const topNoticeRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  flexWrap: 'wrap',
  marginBottom: 12,
};

const wipWarningStyle: React.CSSProperties = {
  padding: '10px 12px',
  background: '#fffbeb',
  border: '1px solid #f59e0b',
  borderRadius: 8,
  color: '#92400e',
  fontSize: 13,
  lineHeight: 1.45,
};
