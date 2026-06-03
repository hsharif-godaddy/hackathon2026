import { clearCertSsoCache, getCertSsoToken } from '../auth/cert-sso.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { HttpError } from './http-error.js';

export interface CustomerDetails {
  shopperId: string;
  customerId: string;
  privateLabelId: number;
  email: string;
}

async function fetch_(path: string, retried = false): Promise<Response> {
  logger.info('pie.request.start', { path, baseUrl: config.MGMT_AIRO_BASE_URL, ...(retried && { retried }) });

  const token = await getCertSsoToken();
  const url = `${config.MGMT_AIRO_BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `sso-jwt ${token}`,
    },
    signal: AbortSignal.timeout(10_000),
  });

  logger.info('pie.request.response', { path, status: res.status, retried });

  if (res.status === 401 && !retried) {
    logger.info('pie.request.unauthorized', { path, action: 'clearing_cache_and_retrying' });
    clearCertSsoCache();
    return fetch_(path, true);
  }

  if (!res.ok) {
    const body = await res.text();
    logger.error('pie.request.error', { path, status: res.status, body: body.slice(0, 500) });
    throw new HttpError(res.status, body, url);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const body = await res.text();
    logger.error('pie.request.unexpected_content_type', { path, status: res.status, contentType, body });
    throw new HttpError(res.status, `Expected JSON but got ${contentType || 'unknown content-type'}: ${body.slice(0, 200)}`, url);
  }

  return res;
}

export async function getCustomer(customerId: string): Promise<CustomerDetails> {
  logger.info('pie.getCustomer.start', { customerId });
  const res = await fetch_(`/api/pie/v1/proxy/customers/${encodeURIComponent(customerId)}`);
  const rawBody = await res.text();
  logger.info('pie.getCustomer.raw_response', { customerId, status: res.status, body: rawBody });
  const customer = JSON.parse(rawBody) as CustomerDetails;
  logger.info('pie.getCustomer.done', {
    customerId,
    shopperId: customer.shopperId,
    privateLabelId: customer.privateLabelId,
    hasEmail: Boolean(customer.email),
  });
  return customer;
}
