/**
 * l1-transcript-sharepoint.ts
 * SharePoint Graph API integration for L1 transcript sync
 */

import { logger } from './logger';

interface SharePointConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteHostname: string;
  sitePath: string;
  folderPath: string;
}

interface SharePointFile {
  id: string;
  name: string;
  lastModifiedDateTime: string;
  size: number;
  downloadUrl: string;
}

interface GraphTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

/**
 * Get SharePoint access token using OAuth 2.0 Client Credentials flow
 */
export async function getSharePointAccessToken(config: SharePointConfig): Promise<string> {
  // Return cached token if still valid (with 5 min buffer)
  if (cachedToken && tokenExpiresAt - Date.now() > 300_000) {
    return cachedToken;
  }

  const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;

  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`SharePoint OAuth failed (${response.status}): ${error}`);
  }

  const data = (await response.json()) as GraphTokenResponse;
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;

  logger.info('sharepoint.auth.token_acquired', {
    expires_in: data.expires_in,
  });

  return cachedToken;
}

/**
 * Get SharePoint site ID from hostname and path
 */
export async function getSiteId(
  accessToken: string,
  siteHostname: string,
  sitePath: string
): Promise<string> {
  const url = `https://graph.microsoft.com/v1.0/sites/${siteHostname}:${sitePath}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get site ID (${response.status}): ${error}`);
  }

  const site = (await response.json()) as { id: string };
  return site.id;
}

/**
 * Get drive ID for "Shared Documents" library
 */
export async function getDriveId(accessToken: string, siteId: string): Promise<string> {
  const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/drives`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get drive ID (${response.status}): ${error}`);
  }

  const data = (await response.json()) as { value: Array<{ id: string; name: string }> };

  // Find "Shared Documents" drive
  const sharedDrive = data.value.find(d => d.name === 'Shared Documents');
  if (!sharedDrive) {
    throw new Error('Shared Documents drive not found');
  }

  return sharedDrive.id;
}

/**
 * List files in a SharePoint folder
 */
export async function listFilesInFolder(
  accessToken: string,
  siteId: string,
  driveId: string,
  folderPath: string
): Promise<SharePointFile[]> {
  // URL encode the folder path
  const encodedPath = folderPath.split('/').map(encodeURIComponent).join('/');
  const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/root:${encodedPath}:/children`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to list files (${response.status}): ${error}`);
  }

  const data = (await response.json()) as {
    value: Array<{
      id: string;
      name: string;
      lastModifiedDateTime: string;
      size: number;
      '@microsoft.graph.downloadUrl': string;
      file?: { mimeType: string };
    }>;
  };

  // Filter to only .xlsx files with "transcript" in name (case-insensitive)
  const xlsxFiles = data.value
    .filter(item =>
      item.file &&
      item.name.endsWith('.xlsx') &&
      item.name.toLowerCase().includes('transcript')
    )
    .map(item => ({
      id: item.id,
      name: item.name,
      lastModifiedDateTime: item.lastModifiedDateTime,
      size: item.size,
      downloadUrl: item['@microsoft.graph.downloadUrl'],
    }));

  logger.info('sharepoint.list_files', {
    folder_path: folderPath,
    total_files: data.value.length,
    xlsx_files: xlsxFiles.length,
  });

  return xlsxFiles;
}

/**
 * Download file from SharePoint
 */
export async function downloadFile(downloadUrl: string): Promise<Buffer> {
  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error(`Failed to download file (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Get SharePoint config from environment variables
 */
export function getSharePointConfig(): SharePointConfig | null {
  const tenantId = process.env.SHAREPOINT_TENANT_ID;
  const clientId = process.env.SHAREPOINT_CLIENT_ID;
  const clientSecret = process.env.SHAREPOINT_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    return null;
  }

  return {
    tenantId,
    clientId,
    clientSecret,
    siteHostname: 'secureservernet.sharepoint.com',
    sitePath: '/sites/CareServices',
    folderPath: '/Product/CPO/Products/Airo/Product Insights/Contact Drivers/Daily Transcripts',
  };
}

/**
 * Sync all new files from SharePoint
 */
export async function syncFromSharePoint(): Promise<{
  files_found: number;
  files_processed: number;
  files_skipped: number;
  errors: Array<{ file: string; error: string }>;
}> {
  const config = getSharePointConfig();
  if (!config) {
    throw new Error(
      'SharePoint not configured. Set SHAREPOINT_TENANT_ID, SHAREPOINT_CLIENT_ID, and SHAREPOINT_CLIENT_SECRET.'
    );
  }

  logger.info('sharepoint.sync.started');

  // Get access token
  const accessToken = await getSharePointAccessToken(config);

  // Get site and drive IDs
  const siteId = await getSiteId(accessToken, config.siteHostname, config.sitePath);
  const driveId = await getDriveId(accessToken, siteId);

  // List files in folder
  const files = await listFilesInFolder(accessToken, siteId, driveId, config.folderPath);

  // Sort by lastModifiedDateTime descending (newest first)
  files.sort((a, b) => new Date(b.lastModifiedDateTime).getTime() - new Date(a.lastModifiedDateTime).getTime());

  logger.info('sharepoint.sync.files_found', {
    count: files.length,
  });

  const results = {
    files_found: files.length,
    files_processed: 0,
    files_skipped: 0,
    errors: [] as Array<{ file: string; error: string }>,
  };

  // Return file list for processing by the upload handler
  // The actual processing happens in the API route
  return {
    ...results,
    files_found: files.length,
  };
}
