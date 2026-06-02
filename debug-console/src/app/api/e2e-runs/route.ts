import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { routeCached } from '@/lib/route-cache';

export const dynamic = 'force-dynamic';

const REPO = { owner: 'gdcorp-partners', repo: 'airo-app-builder' } as const;
const E2E_WORKFLOW_FILE = 'playwright-e2e.yml';

interface GhWorkflowRun {
  run_number?: number;
  name?: string;
  display_title?: string;
  status?: string;
  conclusion?: string | null;
  head_branch?: string;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  run_started_at?: string | null;
  event?: string;
}

interface GhListResponse {
  workflow_runs?: GhWorkflowRun[];
}

async function ghGetJson(path: string, token: string): Promise<unknown> {
  const url = `https://api.github.com${path}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${res.status}: ${text.slice(0, 240)}`);
  }
  return res.json();
}

function runTitle(run: GhWorkflowRun): string {
  const t = typeof run.display_title === 'string' ? run.display_title.trim() : '';
  if (t) return t;
  return typeof run.name === 'string' ? run.name.trim() : '';
}

// The scheduled-E2E gate: the dashboard only counts the critical-path E2E
// suite that runs on main against prod every 2h (cron '0 */2 * * *'). The GH
// query already constrains event=schedule & branch=main, but scheduled
// regression (cron '0 6 * * *') shares that event/branch, so we additionally
// require the `[e2e]` run-name tag. '[e2e]' is NOT a substring of
// '[e2e-then-regression]', so this also rejects that manual variant.
function isScheduledE2eOnMain(run: GhWorkflowRun): boolean {
  if ((run.event ?? '') !== 'schedule') return false;
  if ((run.head_branch ?? '') !== 'main') return false;
  return /\[e2e\]/i.test(runTitle(run));
}

function parseEnvLabel(title: string): string {
  const m = /E2E Tests\s*-\s*([^(]+)/i.exec(title);
  if (!m?.[1]) return '—';
  return m[1].trim().toUpperCase().slice(0, 24);
}

function durationSeconds(run: GhWorkflowRun): number | undefined {
  const start = run.run_started_at;
  const end = run.updated_at;
  if (!start || !end) return undefined;
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return undefined;
  return Math.round((b - a) / 1000);
}

function mapRun(run: GhWorkflowRun) {
  const title = runTitle(run);
  const conclusion = run.conclusion ?? '';
  const success = conclusion === 'success';
  return {
    success,
    status: typeof run.status === 'string' ? run.status : '',
    conclusion,
    environment: parseEnvLabel(title),
    gitBranch: typeof run.head_branch === 'string' ? run.head_branch : '',
    durationSeconds: durationSeconds(run),
    timestamp: typeof run.created_at === 'string' ? run.created_at : '',
    runUrl: typeof run.html_url === 'string' ? run.html_url : '',
    runNumber: run.run_number != null ? String(run.run_number) : '',
  };
}

const SCHEDULED_E2E_KPI_LIMIT = 10;

function summarizeScheduledE2eRuns(
  runs: GhWorkflowRun[],
  limit: number,
): { passed: number; failed: number; total: number; running: number } {
  const recent = runs.filter(isScheduledE2eOnMain).slice(0, limit);
  let passed = 0;
  let failed = 0;
  let running = 0;
  for (const run of recent) {
    const st = (run.status ?? '').toLowerCase();
    if (st !== 'completed') {
      running++;
      continue;
    }
    if (run.conclusion === 'success') passed++;
    else failed++;
  }
  return { passed, failed, total: recent.length, running };
}

// Time-window mode (dashboard): aggregate every scheduled [e2e] main run created
// within the window rather than a fixed count, paginating the GitHub API.
// WINDOW_MAX_PAGES caps the fan-out — ~13 scheduled runs/day (incl. regression)
// means 30d ≈ 4 pages; 5 is safe headroom. Mode is opt-in via ?window=; callers
// that omit it (e.g. the RISQ KPI) keep the legacy last-10 behavior.
const WINDOW_DAYS: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30 };
const WINDOW_MAX_PAGES = 5;
const LIST_DISPLAY_CAP = 100;

function windowSinceIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function fetchScheduledMainRunsSince(
  wfPath: string,
  token: string,
  sinceIso: string,
): Promise<GhWorkflowRun[]> {
  const all: GhWorkflowRun[] = [];
  for (let page = 1; page <= WINDOW_MAX_PAGES; page++) {
    const qs = new URLSearchParams({
      per_page: '100',
      page: String(page),
      event: 'schedule',
      branch: 'main',
      created: `>=${sinceIso}`,
    });
    const body = (await ghGetJson(`${wfPath}?${qs}`, token)) as GhListResponse;
    const runs = Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
    all.push(...runs);
    if (runs.length < 100) break;
  }
  return all;
}

export const GET = withAuth(async (request, _auth) => {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({ error: 'GitHub not configured (set GITHUB_TOKEN)' }, { status: 503 });
  }

  const { owner, repo } = REPO;
  const wfPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(E2E_WORKFLOW_FILE)}/runs`;
  const action = request.nextUrl.searchParams.get('action') || 'list';

  try {
    // Optional time window (?window=1d|7d|30d). When present, aggregate over the
    // window; when absent, fall back to the legacy last-10 behavior (RISQ KPI).
    const windowParam = request.nextUrl.searchParams.get('window');
    const windowDays =
      windowParam && Object.prototype.hasOwnProperty.call(WINDOW_DAYS, windowParam)
        ? WINDOW_DAYS[windowParam]
        : null;

    if (action === 'summary') {
      if (windowDays != null) {
        const data = await routeCached(`github_e2e_runs_summary_window_${windowDays}d`, 45_000, async () => {
          const runs = await fetchScheduledMainRunsSince(wfPath, token, windowSinceIso(windowDays));
          return summarizeScheduledE2eRuns(runs, Number.POSITIVE_INFINITY);
        });
        return NextResponse.json(data);
      }
      const data = await routeCached('github_e2e_runs_summary_v4', 45_000, async () => {
        const qs = new URLSearchParams({ per_page: '100', event: 'schedule', branch: 'main' });
        const body = (await ghGetJson(`${wfPath}?${qs}`, token)) as GhListResponse;
        const runs = Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
        return summarizeScheduledE2eRuns(runs, SCHEDULED_E2E_KPI_LIMIT);
      });
      return NextResponse.json(data);
    }

    if (action === 'list') {
      if (windowDays != null) {
        const data = await routeCached(`github_e2e_runs_list_window_${windowDays}d`, 45_000, async () => {
          const runs = await fetchScheduledMainRunsSince(wfPath, token, windowSinceIso(windowDays));
          const scheduledE2e = runs.filter(isScheduledE2eOnMain);
          return {
            runs: scheduledE2e.slice(0, LIST_DISPLAY_CAP).map(mapRun),
            totalInWindow: scheduledE2e.length,
          };
        });
        return NextResponse.json(data);
      }
      const data = await routeCached('github_e2e_runs_list_scheduled_main', 45_000, async () => {
        const qs = new URLSearchParams({ per_page: '100', event: 'schedule', branch: 'main' });
        const body = (await ghGetJson(`${wfPath}?${qs}`, token)) as GhListResponse;
        const runs = Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
        const scheduledE2e = runs.filter(isScheduledE2eOnMain);
        return { runs: scheduledE2e.slice(0, SCHEDULED_E2E_KPI_LIMIT).map(mapRun) };
      });
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('api.e2e_runs.github.failed', { action, message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
