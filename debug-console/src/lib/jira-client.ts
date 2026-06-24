/**
 * Atlassian Cloud REST client for SupportPlane.
 *
 * Auth strategy (same OAuth 2.0 client_credentials / 2LO flow as fanout/jira-client.mjs):
 *   1. POST clientId+clientSecret → https://auth.atlassian.com/oauth/token → 60-min Bearer
 *   2. Call https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/...
 *
 * Credential sources (first match wins):
 *   Local dev  — JIRA_CLIENT_ID + JIRA_CLIENT_SECRET env vars in .env.local
 *   Production — JIRA_OAUTH_SECRET_ARN → Secrets Manager → {clientId, clientSecret}
 *
 * The cloud ID is always read from JIRA_CLOUD_ID (Katana env var / .env.local).
 */

import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

import { logger } from '@/lib/logger';

const TIMEOUT_MS = 15_000;
const EXPIRY_MARGIN_MS = 60_000;
const TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const JIRA_API_BASE = 'https://api.atlassian.com/ex/jira';

// ── Types ────────────────────────────────────────────────────────────────────

export interface JiraTicket {
    key: string;
    summary: string;
    status: string;
    priority: string;
    assignee: string | null;
    created: string;
    updated: string;
    url: string;
}

interface JiraCredentials {
    clientId: string;
    clientSecret: string;
}

interface JiraSearchResponse {
    issues: Array<{
        key: string;
        fields: {
            summary: string;
            status: { name: string };
            priority: { name: string };
            assignee: { displayName: string } | null;
            created: string;
            updated: string;
        };
    }>;
    total: number;
}

// ── Token cache (module-level, per process — resets on cold start) ───────────

let cachedToken: string | null = null;
let cachedExpiresAt = 0;
let inflightMint: Promise<string> | null = null;

// ── Secret cache ──────────────────────────────────────────────────────────────

let cachedCreds: JiraCredentials | null = null;
let credsSecretsClient: SecretsManagerClient | null = null;

function getSecretsClient(): SecretsManagerClient {
    if (!credsSecretsClient) {
        credsSecretsClient = new SecretsManagerClient({
            region: process.env.AWS_REGION ?? 'us-west-2',
        });
    }
    return credsSecretsClient;
}

async function getCredentials(): Promise<JiraCredentials> {
    if (cachedCreds) return cachedCreds;

    // Local dev: direct env vars
    const directId = process.env.JIRA_CLIENT_ID ?? '';
    const directSecret = process.env.JIRA_CLIENT_SECRET ?? '';
    if (directId && directSecret) {
        cachedCreds = { clientId: directId, clientSecret: directSecret };
        return cachedCreds;
    }

    // Production: Secrets Manager
    const secretArn = process.env.JIRA_OAUTH_SECRET_ARN ?? '';
    if (!secretArn) {
        throw new Error(
            'Jira not configured: set JIRA_CLIENT_ID + JIRA_CLIENT_SECRET (local) ' +
            'or JIRA_OAUTH_SECRET_ARN (production)',
        );
    }

    const response = await getSecretsClient().send(new GetSecretValueCommand({ SecretId: secretArn }));
    if (!response.SecretString) throw new Error(`Secret ${secretArn} has no SecretString`);

    let parsed: unknown;
    try {
        parsed = JSON.parse(response.SecretString);
    } catch {
        throw new Error('Jira OAuth secret is not valid JSON — expected {clientId, clientSecret}');
    }

    const { clientId, clientSecret } = parsed as Record<string, string>;
    if (!clientId || !clientSecret || clientId === 'REPLACE_ME' || clientSecret === 'REPLACE_ME') {
        throw new Error('Jira OAuth secret has REPLACE_ME placeholder — populate via AWS Console');
    }

    cachedCreds = { clientId, clientSecret };
    return cachedCreds;
}

// ── Token mint / cache ────────────────────────────────────────────────────────

async function mintToken(): Promise<string> {
    const { clientId, clientSecret } = await getCredentials();

    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
        throw new Error(`Jira OAuth ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    const data = await res.json() as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new Error('Jira OAuth response missing access_token');

    const ttlMs = (typeof data.expires_in === 'number' ? data.expires_in : 3600) * 1000;
    cachedToken = data.access_token;
    cachedExpiresAt = Date.now() + ttlMs;
    return cachedToken;
}

async function getToken(): Promise<string> {
    if (cachedToken && cachedExpiresAt - Date.now() > EXPIRY_MARGIN_MS) return cachedToken;
    if (inflightMint) return inflightMint;
    inflightMint = mintToken().finally(() => { inflightMint = null; });
    return inflightMint;
}

// Exported for tests / 401 recovery
export function resetJiraAuthCache(): void {
    cachedToken = null;
    cachedExpiresAt = 0;
    cachedCreds = null;
    inflightMint = null;
}

// ── Public URL helper ─────────────────────────────────────────────────────────

export function getJiraApiBase(): string {
    const cloudId = process.env.JIRA_CLOUD_ID ?? '';
    if (cloudId) return `${JIRA_API_BASE}/${cloudId}`;
    return process.env.JIRA_BASE_URL ?? 'https://godaddy-corp.atlassian.net';
}

// ── Authenticated fetch with 401 re-mint ─────────────────────────────────────

export async function jiraFetch(url: string): Promise<Response> {
    const attempt = async (): Promise<Response> => {
        const token = await getToken();
        return fetch(url, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    };
    const res = await attempt();
    if (res.status !== 401) return res;
    resetJiraAuthCache();
    return attempt();
}

// ── Public API ────────────────────────────────────────────────────────────────

export function isJiraConfigured(): boolean {
    return !!(
        (process.env.JIRA_CLIENT_ID && process.env.JIRA_CLIENT_SECRET) ||
        process.env.JIRA_OAUTH_SECRET_ARN
    );
}

/**
 * Fetch open issues from a Jira project.
 * Returns at most `maxResults` tickets ordered by priority then creation date.
 */
export async function fetchProjectTickets(
    projectKey: string,
    maxResults = 50,
): Promise<JiraTicket[]> {
    const cloudId = process.env.JIRA_CLOUD_ID ?? '';
    if (!cloudId) throw new Error('JIRA_CLOUD_ID not set');

    const jql = encodeURIComponent(
        `project = "${projectKey}" AND statusCategory != Done ORDER BY priority ASC, created DESC`,
    );
    const fields = 'summary,status,priority,assignee,created,updated';
    const url = `${JIRA_API_BASE}/${cloudId}/rest/api/3/search/jql?jql=${jql}&fields=${fields}&maxResults=${maxResults}`;

    const res = await jiraFetch(url);
    if (!res.ok) {
        throw new Error(`Jira search ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    const data = await res.json() as JiraSearchResponse;
    const baseUrl = process.env.JIRA_BASE_URL ?? 'https://godaddy-corp.atlassian.net';

    logger.info('supportplane.jira.fetch', { projectKey, count: data.issues.length });

    return data.issues.map((issue) => ({
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        priority: issue.fields.priority.name,
        assignee: issue.fields.assignee?.displayName ?? null,
        created: issue.fields.created,
        updated: issue.fields.updated,
        url: `${baseUrl}/browse/${issue.key}`,
    }));
}
