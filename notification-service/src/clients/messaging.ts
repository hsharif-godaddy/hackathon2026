import { clearIamTokenCache, getIamToken } from '../auth/iam.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { HttpError } from './http-error.js';

export interface MessageRequest {
  templateNamespaceKey: string;
  templateTypeKey: string;
  substitutionValues: Record<string, string>;
}

async function post(path: string, body: unknown, retried = false): Promise<Response> {
  logger.info('messaging.request.start', { path, baseUrl: config.MESSAGING_BASE_URL, ...(retried && { retried }) });

  const token = await getIamToken();
  const url = `${config.MESSAGING_BASE_URL}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `sso-jwt ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  logger.info('messaging.request.response', { path, status: res.status, retried });

  if (res.status === 401 && !retried) {
    logger.warn('messaging.request.unauthorized', { path, action: 'clearing_cache_and_retrying' });
    clearIamTokenCache();
    return post(path, body, true);
  }

  if (!res.ok) {
    const responseBody = await res.text();
    logger.error('messaging.request.error', { path, status: res.status, body: responseBody.slice(0, 500) });
    throw new HttpError(res.status, responseBody, url);
  }

  return res;
}

export async function sendMessage(customerId: string, request: MessageRequest): Promise<void> {
  logger.info('messaging.sendMessage.start', {
    customerId,
    templateNamespaceKey: request.templateNamespaceKey,
    templateTypeKey: request.templateTypeKey,
    substitutionKeys: Object.keys(request.substitutionValues),
  });
  await post(`/v1/messaging/customers/${encodeURIComponent(customerId)}/messages`, request);
  logger.info('messaging.sendMessage.done', {
    customerId,
    templateNamespaceKey: request.templateNamespaceKey,
    templateTypeKey: request.templateTypeKey,
  });
}
