import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { upsertTickets, getLastSyncTime, setLastSyncTime, type Ticket } from '@/lib/supportplane/db/support-db';

export const dynamic = 'force-dynamic';

// ── Jira OAuth 2.0 (NSA client_credentials) ──────────────────────────────────

const JIRA_TOKEN_URL = process.env.JIRA_OAUTH_TOKEN_URL ?? 'https://auth.atlassian.com/oauth/token';
const JIRA_EXPIRY_MARGIN_MS = 60_000;

let jiraToken: string | null = null;
let jiraTokenExpiresAt = 0;

async function getJiraToken(): Promise<string> {
  if (jiraToken && jiraTokenExpiresAt - Date.now() > JIRA_EXPIRY_MARGIN_MS) {
    return jiraToken;
  }

  const clientId = process.env.JIRA_CLIENT_ID ?? '';
  const clientSecret = process.env.JIRA_CLIENT_SECRET ?? '';

  if (!clientId || !clientSecret) {
    throw new Error('Jira not configured. Set JIRA_CLIENT_ID and JIRA_CLIENT_SECRET.');
  }

  const res = await fetch(JIRA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Jira OAuth ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('Jira OAuth response missing access_token');

  const expiresInMs = (typeof data.expires_in === 'number' ? data.expires_in : 3600) * 1000;
  jiraToken = data.access_token;
  jiraTokenExpiresAt = Date.now() + expiresInMs;
  return jiraToken;
}

function jiraBase(): string {
  const cloudId = process.env.JIRA_CLOUD_ID ?? '';
  if (cloudId) return `https://api.atlassian.com/ex/jira/${cloudId}`;
  return process.env.JIRA_BASE_URL ?? 'https://godaddy-corp.atlassian.net';
}

async function jiraFetch(url: string): Promise<Response> {
  const cloudId = process.env.JIRA_CLOUD_ID ?? '';

  if (cloudId) {
    let token: string;
    try { token = await getJiraToken(); } catch { throw new Error('Jira NSA token fetch failed.'); }
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401) {
      jiraToken = null;
      jiraTokenExpiresAt = 0;
      const fresh = await getJiraToken();
      return fetch(url, {
        headers: { Authorization: `Bearer ${fresh}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });
    }
    return res;
  }

  // Personal API token path
  const email = process.env.JIRA_EMAIL ?? '';
  const apiToken = process.env.JIRA_API_TOKEN ?? '';
  if (!email || !apiToken) throw new Error('Jira not configured.');
  return fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  });
}

// ── Sync Logic ────────────────────────────────────────────────────────────────

async function syncJiraTickets(): Promise<{ total: number; new: number; updated: number }> {
  const lastSync = await getLastSyncTime('jira');
  const jql = lastSync
    ? `project in (CIEC, AABSP) AND updated >= "${lastSync}" ORDER BY updated ASC`
    : 'project in (CIEC, AABSP) ORDER BY updated DESC';

  const fields = 'summary,status,priority,assignee,created,updated,resolutiondate,issuetype,labels,description,project';
  const maxResults = 500;

  logger.info('supportplane.tickets.sync.start', { jql, lastSync });
  const issues: Array<{
    key: string;
    fields: {
      created: string;
      updated: string;
      resolutiondate?: string;
      status?: { name?: string };
      issuetype?: { name?: string };
      priority?: { name?: string };
      assignee?: { displayName?: string };
      summary?: string;
      description?: string;
      labels?: string[];
      project?: { key?: string };
    };
  }> = [];
  let startAt = 0;
  let total = 0;

  while (true) {
    const url = `${jiraBase()}/rest/api/3/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=${maxResults}&fields=${fields}`;
    const res = await jiraFetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Jira API error ${res.status}: ${text.slice(0, 200)}`);
    }

    const body = await res.json() as {
      issues?: Array<{
        key: string;
        fields: {
          created: string;
          updated: string;
          resolutiondate?: string;
          status?: { name?: string };
          issuetype?: { name?: string };
          priority?: { name?: string };
          assignee?: { displayName?: string };
          summary?: string;
          description?: string;
          labels?: string[];
          project?: { key?: string };
        };
      }>;
      total?: number;
      startAt?: number;
      maxResults?: number;
    };

    const pageIssues = body.issues ?? [];
    issues.push(...pageIssues);
    total = body.total ?? total;

    if (pageIssues.length === 0) {
      break;
    }

    startAt += pageIssues.length;
    if (total > 0 && startAt >= total) {
      break;
    }
  }

  const tickets: Ticket[] = issues.map(issue => {
    const createdDate = new Date(issue.fields.created);
    const resolvedDate = issue.fields.resolutiondate ? new Date(issue.fields.resolutiondate) : null;
    const mttrHours = resolvedDate ? (resolvedDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60) : null;

    return {
      ticket_key: issue.key,
      created_utc: issue.fields.created,
      updated_utc: issue.fields.updated,
      resolved_utc: issue.fields.resolutiondate ?? undefined,
      status: issue.fields.status?.name,
      issue_type: issue.fields.issuetype?.name,
      priority: issue.fields.priority?.name,
      assignee: issue.fields.assignee?.displayName,
      summary: issue.fields.summary,
      description: issue.fields.description,
      labels: issue.fields.labels?.join(','),
      project: issue.fields.project?.key,
      mttr_hours: mttrHours ?? undefined,
    };
  });

  if (tickets.length > 0) {
    await upsertTickets(tickets);
    await setLastSyncTime('jira', new Date().toISOString());
  }

  logger.info('supportplane.tickets.sync.complete', { count: tickets.length });

  return {
    total: tickets.length,
    new: tickets.length, // simplified: treat all as new/updated
    updated: 0,
  };
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export const POST = withAuth(async function syncTickets(_request: NextRequest) {
  try {
    const result = await syncJiraTickets();

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err) {
    logger.error('supportplane.tickets.sync.error', {}, { error: err as Error });
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Unknown error',
        success: false,
      },
      { status: 500 }
    );
  }
});
