import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// ── Types ──────────────────────────────────────────────────────────────────

export interface TranscriptFile {
  id: string;
  name: string;
  size: number;
  createdDateTime: string;
  lastModifiedDateTime: string;
  webUrl: string;
  downloadUrl: string | null;
}

interface GraphDriveItem {
  id: string;
  name: string;
  size: number;
  createdDateTime: string;
  lastModifiedDateTime: string;
  webUrl: string;
  '@microsoft.graph.downloadUrl'?: string;
}

interface GraphListResponse {
  value: GraphDriveItem[];
  '@odata.nextLink'?: string;
}

// ── Config ────────────────────────────────────────────────────────────────

const SHAREPOINT_TENANT_ID     = process.env.SHAREPOINT_TENANT_ID ?? '';
const SHAREPOINT_CLIENT_ID     = process.env.SHAREPOINT_CLIENT_ID ?? '';
const SHAREPOINT_CLIENT_SECRET = process.env.SHAREPOINT_CLIENT_SECRET ?? '';
const SHAREPOINT_USERNAME      = process.env.SHAREPOINT_USERNAME ?? '';
const SHAREPOINT_PASSWORD      = process.env.SHAREPOINT_PASSWORD ?? '';
const SHAREPOINT_SITE_HOSTNAME = process.env.SHAREPOINT_SITE_HOSTNAME ?? 'secureservernet.sharepoint.com';
const SHAREPOINT_SITE_NAME     = process.env.SHAREPOINT_SITE_NAME ?? 'CareServices';
const SHAREPOINT_TRANSCRIPTS_PATH = process.env.SHAREPOINT_TRANSCRIPTS_PATH ?? 'Shared Documents/Contact Drivers/Daily Transcripts';

// ── Microsoft Graph token — two auth strategies ───────────────────────────
//
// Strategy A — App client_credentials (preferred for prod):
//   Requires SHAREPOINT_TENANT_ID + SHAREPOINT_CLIENT_ID + SHAREPOINT_CLIENT_SECRET.
//   Azure AD app must have Sites.Read.All (application permission) with admin consent.
//
// Strategy B — ROPC username/password (interim / personal use):
//   Requires SHAREPOINT_TENANT_ID + SHAREPOINT_CLIENT_ID + SHAREPOINT_USERNAME + SHAREPOINT_PASSWORD.
//   The Azure AD app must allow ROPC (no MFA on the account, public-client flow enabled).
//   Use the same SHAREPOINT_CLIENT_ID; SHAREPOINT_CLIENT_SECRET is not required for ROPC.
//   This lets you use your own GoDaddy credentials while waiting for a service account.

async function getGraphToken(): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${SHAREPOINT_TENANT_ID}/oauth2/v2.0/token`;
  const scope = 'https://graph.microsoft.com/.default';

  let params: URLSearchParams;

  if (SHAREPOINT_CLIENT_SECRET) {
    // Strategy A: app-only client_credentials
    params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: SHAREPOINT_CLIENT_ID,
      client_secret: SHAREPOINT_CLIENT_SECRET,
      scope,
    });
  } else if (SHAREPOINT_USERNAME && SHAREPOINT_PASSWORD) {
    // Strategy B: ROPC with personal credentials
    params = new URLSearchParams({
      grant_type: 'password',
      client_id: SHAREPOINT_CLIENT_ID,
      username: SHAREPOINT_USERNAME,
      password: SHAREPOINT_PASSWORD,
      scope,
    });
  } else {
    throw new Error('No SharePoint auth configured. Set SHAREPOINT_CLIENT_SECRET (app auth) or SHAREPOINT_USERNAME + SHAREPOINT_PASSWORD (ROPC).');
  }

  const res = await fetch(tokenUrl, { method: 'POST', body: params });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph token ${res.status}: ${text.slice(0, 200)}`);
  }

  const body = await res.json() as { access_token: string };
  return body.access_token;
}

async function listTranscriptFiles(token: string): Promise<TranscriptFile[]> {
  const encodedPath = SHAREPOINT_TRANSCRIPTS_PATH.split('/').map(encodeURIComponent).join('/');
  const url =
    `https://graph.microsoft.com/v1.0/sites/${SHAREPOINT_SITE_HOSTNAME}:/sites/${SHAREPOINT_SITE_NAME}:/drive/root:/${encodedPath}:/children` +
    `?$orderby=lastModifiedDateTime desc&$top=100` +
    `&$select=id,name,size,createdDateTime,lastModifiedDateTime,webUrl,@microsoft.graph.downloadUrl`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph list ${res.status}: ${text.slice(0, 200)}`);
  }

  const body = await res.json() as GraphListResponse;
  return body.value
    .filter(function isFile(item: GraphDriveItem) { return !item.name.startsWith('.'); })
    .map(function toFile(item: GraphDriveItem): TranscriptFile {
      return {
        id: item.id,
        name: item.name,
        size: item.size,
        createdDateTime: item.createdDateTime,
        lastModifiedDateTime: item.lastModifiedDateTime,
        webUrl: item.webUrl,
        downloadUrl: item['@microsoft.graph.downloadUrl'] ?? null,
      };
    });
}

// ── Route ──────────────────────────────────────────────────────────────────

export const GET = withAuth(async function listTranscripts(_request: NextRequest) {
  const hasAppAuth = !!(SHAREPOINT_TENANT_ID && SHAREPOINT_CLIENT_ID && SHAREPOINT_CLIENT_SECRET);
  const hasRopcAuth = !!(SHAREPOINT_TENANT_ID && SHAREPOINT_CLIENT_ID && SHAREPOINT_USERNAME && SHAREPOINT_PASSWORD);

  if (!hasAppAuth && !hasRopcAuth) {
    return NextResponse.json(
      {
        files: [],
        configured: false,
        message:
          'SharePoint not configured. Set SHAREPOINT_TENANT_ID + SHAREPOINT_CLIENT_ID + SHAREPOINT_CLIENT_SECRET (app auth) ' +
          'or SHAREPOINT_TENANT_ID + SHAREPOINT_CLIENT_ID + SHAREPOINT_USERNAME + SHAREPOINT_PASSWORD (personal credentials).',
        sharePointUrl: `https://${SHAREPOINT_SITE_HOSTNAME}/sites/${SHAREPOINT_SITE_NAME}`,
      },
      { status: 200 }
    );
  }

  try {
    const token = await getGraphToken();
    const files = await listTranscriptFiles(token);

    logger.info('supportplane.transcripts.list', {
      count: files.length,
      authMethod: SHAREPOINT_CLIENT_SECRET ? 'client_credentials' : 'ropc',
    });
    return NextResponse.json({ files, configured: true });
  } catch (err) {
    logger.error('supportplane.transcripts.list.error', {}, { error: err as Error });
    return NextResponse.json(
      { error: (err as Error).message, files: [], configured: true },
      { status: 502 }
    );
  }
});
