import { clearCertSsoCache, getCertSsoToken } from '../auth/cert-sso.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { HttpError } from './http-error.js';

interface MgmtDomain {
  fqdn: string;
  domainType: string;
  status: string;
}

export interface AppDetails {
  id: string;
  name: string;
  customDomain: string | null;
}

interface MgmtAppResponse {
  id: string;
  variables?: {
    title?: string;
  };
  domains?: MgmtDomain[];
}

export interface TargetCandidateShopper {
  shopperId: string;
  customerId: string;
}

export interface Transfer {
  id: string;
  appId: string;
  transferToken: string;
  status: string;
  sourceCustomerId: string;
  targetCustomerId: string | null;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  targetCandidateShoppers?: TargetCandidateShopper[];
}

async function fetch_(path: string, retried = false): Promise<Response> {
  logger.info('mgmt.request.start', { path, baseUrl: config.MGMT_AIRO_BASE_URL, ...(retried && { retried }) });

  const token = await getCertSsoToken();
  const url = `${config.MGMT_AIRO_BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `sso-jwt ${token}`,
    },
    signal: AbortSignal.timeout(10_000),
  });

  logger.info('mgmt.request.response', { path, status: res.status, retried });

  if (res.status === 401 && !retried) {
    logger.info('mgmt.request.unauthorized', { path, action: 'clearing_cache_and_retrying' });
    clearCertSsoCache();
    return fetch_(path, true);
  }

  if (!res.ok) {
    const body = await res.text();
    logger.error('mgmt.request.error', { path, status: res.status, body: body.slice(0, 500) });
    throw new HttpError(res.status, body, url);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const body = await res.text();
    logger.error('mgmt.request.unexpected_content_type', { path, status: res.status, contentType, body: body.slice(0, 500) });
    throw new HttpError(res.status, `Expected JSON but got ${contentType || 'unknown content-type'}: ${body.slice(0, 200)}`, url);
  }

  return res;
}

export async function getApp(appId: string): Promise<AppDetails> {
  logger.info('mgmt.getApp.start', { appId });
  const res = await fetch_(`/api/airo/v1/apps/${encodeURIComponent(appId)}?includeResources=true`);
  const data = await res.json() as MgmtAppResponse;
  const customDomain = data.domains?.find(d => d.domainType === 'custom' && d.status === 'active')?.fqdn ?? null;
  const result = { id: data.id, name: data.variables?.title ?? '', customDomain };
  logger.info('mgmt.getApp.done', { appId, name: result.name, hasCustomDomain: Boolean(customDomain) });
  return result;
}

export async function getTransferMetadata(appId: string, customerId: string): Promise<Transfer> {
  logger.info('mgmt.getTransferMetadata.start', { appId, customerId });
  const params = new URLSearchParams({ customerId });
  const res = await fetch_(`/api/airo/v1/apps/${encodeURIComponent(appId)}/transfer/metadata?${params.toString()}`);
  const data = await res.json() as Transfer;
  logger.info('mgmt.getTransferMetadata.done', {
    appId,
    customerId,
    transferId: data.id,
    status: data.status,
    sourceCustomerId: data.sourceCustomerId,
    targetCustomerId: data.targetCustomerId,
  });
  return data;
}

interface CustomerTreeApp {
  id: string;
  published: boolean;
}

interface CustomerTreeSystem {
  apps: CustomerTreeApp[];
}

interface CustomerTreeSubscription {
  systems: CustomerTreeSystem[];
}

interface CustomerTreeResponse {
  subscriptions: CustomerTreeSubscription[];
}

async function fetchCustomerTree(customerId: string): Promise<CustomerTreeResponse> {
  const res = await fetch_(`/api/airo/v1/customers/${encodeURIComponent(customerId)}/tree?ownerProduct=AiroAppBuilder`);
  return res.json() as Promise<CustomerTreeResponse>;
}

/**
 * Returns the number of published apps for the given customer by querying the
 * customer tree endpoint. Used to determine whether a publish event is the
 * customer's first ever published app.
 */
export async function getPublishedAppCount(customerId: string): Promise<number> {
  logger.info('mgmt.getPublishedAppCount.start', { customerId });
  const tree = await fetchCustomerTree(customerId);
  let count = 0;
  for (const sub of tree.subscriptions ?? []) {
    for (const sys of sub.systems ?? []) {
      for (const app of sys.apps ?? []) {
        if (app.published) count++;
      }
    }
  }
  logger.info('mgmt.getPublishedAppCount.done', { customerId, publishedAppCount: count });
  return count;
}

/**
 * Returns the total number of apps (published or not) for the given customer.
 * Used to determine whether the customer is a new user with their first app.
 */
export async function getAppCount(customerId: string): Promise<number> {
  logger.info('mgmt.getAppCount.start', { customerId });
  const tree = await fetchCustomerTree(customerId);
  let count = 0;
  for (const sub of tree.subscriptions ?? []) {
    for (const sys of sub.systems ?? []) {
      count += sys.apps?.length ?? 0;
    }
  }
  logger.info('mgmt.getAppCount.done', { customerId, appCount: count });
  return count;
}
