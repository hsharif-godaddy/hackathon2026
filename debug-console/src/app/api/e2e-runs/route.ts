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

function isProdRunTitle(title: string): boolean {
  return /E2E Tests\s*-\s*prod\b/i.test(title);
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

const PROD_RUNS_KPI_LIMIT = 10;

function summarizeLastProdRuns(runs: GhWorkflowRun[]) {
  const prodOnly = runs.filter((run) => isProdRunTitle(runTitle(run))).slice(0, PROD_RUNS_KPI_LIMIT);
  let passed = 0;
  let failed = 0;
  let running = 0;
  for (const run of prodOnly) {
    const st = (run.status ?? '').toLowerCase();
    if (st !== 'completed') {
      running++;
      continue;
    }
    if (run.conclusion === 'success') passed++;
    else failed++;
  }
  return { passed, failed, total: prodOnly.length, running };
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
    if (action === 'summary') {
      const data = await routeCached('github_e2e_runs_summary_v3', 45_000, async () => {
        const qs = new URLSearchParams({ per_page: '100' });
        const body = (await ghGetJson(`${wfPath}?${qs}`, token)) as GhListResponse;
        const runs = Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
        return summarizeLastProdRuns(runs);
      });
      return NextResponse.json(data);
    }

    if (action === 'list') {
      const data = await routeCached('github_e2e_runs_list_prod', 45_000, async () => {
        const qs = new URLSearchParams({ per_page: '100' });
        const body = (await ghGetJson(`${wfPath}?${qs}`, token)) as GhListResponse;
        const runs = Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
        const prodOnly = runs.filter((run) => isProdRunTitle(runTitle(run)));
        return { runs: prodOnly.slice(0, 10).map(mapRun) };
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
