import { NextResponse } from 'next/server';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';

import { withAuth } from '@/lib/api-auth';
import { getGoCaasBaseUrl, isGoCodeConfigured } from '@/lib/gocode-client';
import { getJiraApiBase, isJiraConfigured, jiraFetch } from '@/lib/jira-client';
import { getS2SToken, isS2SAuthEnabled } from '@airo/ai-lib';
import { logger } from '@/lib/logger';
import { SP_MASK, spLog } from '@/lib/supportplane/sp-logger';
import { getSpEnv } from '@/lib/supportplane/store/config';

export const dynamic = 'force-dynamic';

export interface ServiceHealth {
    name: string;
    ok: boolean;        // true=green, false=red — no more amber
    detail: string;
}

const TIMEOUT_MS = 6000;

function abortAfter(ms: number): AbortSignal {
    return AbortSignal.timeout(ms);
}

// ── GoCaaS (AI) — hit /v1/models; fast, no token consumed ────────────

async function checkGoCaaS(): Promise<ServiceHealth> {
    if (!isGoCodeConfigured()) {
        return { name: 'GoCaaS (AI)', ok: false, detail: 'No API key — set OPENAI_API_KEY in .env.local' };
    }

    const base = getGoCaasBaseUrl();

    try {
        let authHeader: string;
        if (isS2SAuthEnabled()) {
            authHeader = `sso-jwt ${await getS2SToken()}`;
        } else {
            const key = process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN ?? '';
            authHeader = `Bearer ${key}`;
        }

        const res = await fetch(`${base.replace(/\/$/, '')}/v1/models`, {
            headers: { Authorization: authHeader },
            signal: abortAfter(TIMEOUT_MS),
        });
        if (res.ok || res.status === 404) {
            return { name: 'GoCaaS (AI)', ok: true, detail: `Connected · ${new URL(base).hostname}` };
        }
        return { name: 'GoCaaS (AI)', ok: false, detail: `HTTP ${res.status} from ${new URL(base).hostname}` };
    } catch (err) {
        return { name: 'GoCaaS (AI)', ok: false, detail: `Unreachable: ${(err as Error).message.slice(0, 100)}` };
    }
}

// ── Jira — /project?maxResults=1 probe via shared jira-client ────────

async function checkJira(): Promise<ServiceHealth> {
    if (!isJiraConfigured()) {
        return { name: 'Jira', ok: false, detail: 'No credentials — set JIRA_CLIENT_ID/SECRET + JIRA_CLOUD_ID (dev) or JIRA_OAUTH_SECRET_ARN (prod)' };
    }

    try {
        const probeUrl = `${getJiraApiBase()}/rest/api/3/project?maxResults=1`;
        const probeRes = await jiraFetch(probeUrl);

        if (probeRes.ok) {
            return { name: 'Jira', ok: true, detail: `Connected · ${process.env.JIRA_CLOUD_ID ?? process.env.JIRA_BASE_URL ?? 'godaddy-corp.atlassian.net'}` };
        }
        return { name: 'Jira', ok: false, detail: `HTTP ${probeRes.status} — check credentials` };
    } catch (err) {
        return { name: 'Jira', ok: false, detail: `Unreachable: ${(err as Error).message.slice(0, 100)}` };
    }
}

// ── ServiceNow — /api/now/table/sys_user?limit=1 (read-only ping) ────

async function checkServiceNow(): Promise<ServiceHealth> {
    const user = process.env.SERVICENOW_USER ?? '';
    const pass = process.env.SERVICENOW_PASSWORD ?? '';
    const inst = process.env.SERVICENOW_INSTANCE ?? '';

    if (!user || !pass || !inst) {
        return { name: 'ServiceNow', ok: false, detail: 'SERVICENOW_USER, PASSWORD, INSTANCE not all set' };
    }

    try {
        const url = `https://${inst}/api/now/table/sys_user?sysparm_limit=1&sysparm_fields=sys_id`;
        const res = await fetch(url, {
            headers: {
                Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
                Accept: 'application/json',
            },
            signal: abortAfter(TIMEOUT_MS),
        });

        if (res.ok) {
            return { name: 'ServiceNow', ok: true, detail: `Connected · ${inst}` };
        }
        if (res.status === 401) {
            return { name: 'ServiceNow', ok: false, detail: `Auth failed (401) · ${inst} — check credentials` };
        }
        return { name: 'ServiceNow', ok: false, detail: `HTTP ${res.status} · ${inst}` };
    } catch (err) {
        return { name: 'ServiceNow', ok: false, detail: `Unreachable: ${(err as Error).message.slice(0, 100)}` };
    }
}

// ── SharePoint — fetch Graph token then hit /sites endpoint ──────────

async function checkSharePoint(): Promise<ServiceHealth> {
    const tenant = process.env.SHAREPOINT_TENANT_ID ?? '';
    const client = process.env.SHAREPOINT_CLIENT_ID ?? '';
    const secret = process.env.SHAREPOINT_CLIENT_SECRET ?? '';
    const user   = process.env.SHAREPOINT_USERNAME ?? '';
    const pass   = process.env.SHAREPOINT_PASSWORD ?? '';

    const hasAppAuth  = !!(tenant && client && secret);
    const hasROPC     = !!(tenant && client && user && pass);

    if (!hasAppAuth && !hasROPC) {
        return { name: 'SharePoint', ok: false, detail: 'SHAREPOINT_TENANT_ID / CLIENT_ID / SECRET not configured' };
    }

    try {
        const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
        const params = new URLSearchParams({ client_id: client, scope: 'https://graph.microsoft.com/.default' });

        if (hasAppAuth) {
            params.set('grant_type', 'client_credentials');
            params.set('client_secret', secret);
        } else {
            params.set('grant_type', 'password');
            params.set('username', user);
            params.set('password', pass);
        }

        const tokenRes = await fetch(tokenUrl, {
            method: 'POST',
            body: params,
            signal: abortAfter(TIMEOUT_MS),
        });

        if (!tokenRes.ok) {
            const txt = await tokenRes.text().catch(() => '');
            const isAuth = /AADSTS|invalid_client|unauthorized_client/i.test(txt);
            return {
                name: 'SharePoint',
                ok: false,
                detail: isAuth
                    ? `Auth error (${tokenRes.status}) — check CLIENT_ID/SECRET`
                    : `Token fetch failed (${tokenRes.status})`,
            };
        }

        const { access_token } = await tokenRes.json() as { access_token: string };
        const hostname = process.env.SHAREPOINT_SITE_HOSTNAME ?? 'secureservernet.sharepoint.com';
        const siteName = process.env.SHAREPOINT_SITE_NAME ?? 'CareServices';

        const siteRes = await fetch(
            `https://graph.microsoft.com/v1.0/sites/${hostname}:/sites/${siteName}?$select=id,displayName`,
            { headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' }, signal: abortAfter(TIMEOUT_MS) },
        );

        if (siteRes.ok) {
            const site = await siteRes.json() as { displayName?: string };
            return { name: 'SharePoint', ok: true, detail: `Connected · ${site.displayName ?? siteName}` };
        }
        return { name: 'SharePoint', ok: false, detail: `Site fetch HTTP ${siteRes.status} · ${siteName}` };
    } catch (err) {
        return { name: 'SharePoint', ok: false, detail: `Unreachable: ${(err as Error).message.slice(0, 100)}` };
    }
}

// ── DynamoDB · Transcripts — fast connectivity check ─────────────────
// Uses hasTranscripts() (1-item scan, ~1-3s) instead of a full scan so the
// health bar is accurate on cold start. Full scan takes 18-90s over VPN;
// a 10s timeout always fired red even when DynamoDB was perfectly healthy.
// If the full-scan cache is warm we also show the cached row count for free.

async function checkTranscriptsDynamo(): Promise<ServiceHealth> {
    try {
        const [{ getStore }, { getCachedTranscriptCount }] = await Promise.all([
            import('@/lib/supportplane/store'),
            import('@/lib/supportplane/db/transcript-cache'),
        ]);

        const hasRows: boolean = await Promise.race([
            getStore().hasTranscripts(),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('connectivity timeout')), 10_000)
            ),
        ]);

        const cachedCount: number | null = getCachedTranscriptCount();
        const detail: string = cachedCount !== null
            ? `${cachedCount.toLocaleString()} transcripts · DynamoDB`
            : hasRows
                ? 'Connected · data present'
                : 'No transcripts — sync from SharePoint';

        return { name: 'DynamoDB · Transcripts', ok: hasRows, detail };
    } catch (err) {
        const msg = (err as Error).message ?? '';
        const isTimeout = msg.includes('connectivity timeout');
        return {
            name: 'DynamoDB · Transcripts',
            ok: false,
            detail: isTimeout
                ? 'DynamoDB unreachable — VPN or credentials issue'
                : `DynamoDB error: ${msg.slice(0, 100)}`,
        };
    }
}

// ── S3 · Feedback — live ListObjectsV2 against feedback bucket ───────

async function checkFeedbackS3(): Promise<ServiceHealth> {
    const profile = process.env.AWS_PROFILE ?? '';
    const keyId   = process.env.AWS_ACCESS_KEY_ID ?? '';
    const secret  = process.env.AWS_SECRET_ACCESS_KEY ?? '';
    const env     = getSpEnv();
    const bucket  = env === 'prod'
        ? (process.env.S3_FEEDBACK_BUCKET_PROD ?? 'airo-builder-feedback-prod')
        : (process.env.S3_FEEDBACK_BUCKET_DEV  ?? 'airo-builder-feedback-dev');
    const region  = process.env.AWS_DEFAULT_REGION ?? 'us-west-2';

    try {
        // In production with s2s auth / IAM roles, credentials are provided by the platform.
        // Attempt the connection even without explicit env vars — the SDK will use IAM role credentials.
        const credentials = (keyId && secret)
            ? { accessKeyId: keyId, secretAccessKey: secret, ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}) }
            : profile
                ? fromIni({ profile })
                : undefined;  // Let SDK use default credential chain (IAM roles, etc.)

        const s3 = new S3Client({
            region,
            ...(credentials ? { credentials } : {}),
            requestHandler: { requestTimeout: TIMEOUT_MS } as Record<string, unknown>,
        });

        await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
        return { name: 'S3 · Feedback', ok: true, detail: `Connected · ${bucket} (${env})` };
    } catch (err) {
        const msg = (err as Error).message ?? String(err);
        const isExpired = /ExpiredToken|expir.*token|sso.*session/i.test(msg);
        const isNoCredentials = /Could not load credentials|Credential is missing/i.test(msg);
        return {
            name: 'S3 · Feedback',
            ok: false,
            detail: isExpired
                ? `SSO session expired — run: aws sso login --profile ${profile}`
                : isNoCredentials
                    ? `No AWS credentials — set AWS_PROFILE in .env.local`
                    : `S3 error: ${msg.slice(0, 300)}`,
        };
    }
}

// ── Route ─────────────────────────────────────────────────────────────

export const GET = withAuth(async () => {
    try {
        const [goCaaS, jira, serviceNow, sharePoint, feedbackS3, transcriptsDynamo] = await Promise.all([
            checkGoCaaS(),
            checkJira(),
            checkServiceNow(),
            checkSharePoint(),
            checkFeedbackS3(),
            checkTranscriptsDynamo(),
        ]);

        const results: ServiceHealth[] = [
            goCaaS,
            jira,
            serviceNow,
            sharePoint,
            transcriptsDynamo,
            feedbackS3,
        ];

        for (const svc of results) {
            spLog(
                svc.ok ? SP_MASK.INFO : SP_MASK.WARN,
                'health',
                `${svc.name}: ${svc.ok ? '✓' : '✗'} — ${svc.detail}`,
            );
        }

        return NextResponse.json(results);
    } catch (err) {
        spLog(SP_MASK.ERROR, 'health', `Health check failed: ${String(err)}`);
        logger.error('supportplane.services.health.error', { error: String(err) });
        return NextResponse.json([], { status: 500 });
    }
});
