import type OpenAI from 'openai';

import {
  containsBudgetExceededPattern,
  createLogger,
  llmMetadataContext,
  type LitellmMetadata,
} from '@airo/ai-common';
import { grantSessionManager } from '@airo/ai-grants';

import { getS2SToken, isS2SAuthEnabled, refreshS2SToken } from './s2s-auth.js';

const logger = createLogger('video-api-fetch');

export interface VideoApiBilling {
  budgetUserId?: string;
  budgetSessionId?: string;
}

export async function getVideoAuthToken(openaiClient: OpenAI): Promise<string> {
  if (isS2SAuthEnabled()) {
    return getS2SToken();
  }
  if (!openaiClient.apiKey) {
    throw new Error('OpenAI apiKey is not set and S2S auth is disabled');
  }
  return openaiClient.apiKey;
}

/** GoCode (authz-gdjwt-all) requires `sso-jwt`; Bearer is rejected by the API gateway. */
function buildVideoAuthorizationHeader(token: string): string {
  if (isS2SAuthEnabled()) {
    return `sso-jwt ${token}`;
  }
  return `Bearer ${token}`;
}

function resolveVideoBudgetUserId(metadata: LitellmMetadata): string | undefined {
  if (metadata._internal?.socketId) {
    const grantUserId = grantSessionManager.getCurrentUserId(metadata._internal.socketId);
    if (!grantUserId && metadata.user) {
      logger.warn('video-api-fetch.grants.resolve_user.fallback_to_metadata', {
        socketId: metadata._internal.socketId,
        metadataUser: metadata.user,
      });
    }
    return grantUserId ?? metadata.user;
  }
  return metadata.user;
}

function resolveVideoApiBilling(explicit?: VideoApiBilling): VideoApiBilling | undefined {
  if (explicit?.budgetSessionId || explicit?.budgetUserId) {
    return explicit;
  }

  const metadata = llmMetadataContext.getStore();
  if (!metadata) {
    return undefined;
  }

  if (metadata.budgetSessionId) {
    return { budgetSessionId: metadata.budgetSessionId };
  }

  const budgetUserId = resolveVideoBudgetUserId(metadata);
  if (budgetUserId) {
    logger.info('video-api-fetch.billing.grant_user', {
      user: budgetUserId,
      tags: metadata.tags,
    });
    return { budgetUserId };
  }

  return undefined;
}

function applyVideoBillingHeaders(
  headers: Record<string, string>,
  billing?: VideoApiBilling
): void {
  if (!billing) {
    return;
  }
  if (billing.budgetSessionId) {
    headers['x-gocode-budget-service-name'] = 'airo-app-builder';
    headers['x-gocode-budget-id'] = billing.budgetSessionId;
    return;
  }
  if (billing.budgetUserId) {
    headers['x-budget-user-id'] = billing.budgetUserId;
  }
}

function isVideoBudgetExceededResponse(status: number, bodyText: string): boolean {
  if (status === 402) {
    return true;
  }
  return (status === 400 || status === 401) && containsBudgetExceededPattern(bodyText);
}

async function handleVideoBudgetExceededWithGrantFallback(
  response: Response,
  metadata: LitellmMetadata,
  url: string,
  buildInit: (billing?: VideoApiBilling) => RequestInit,
  failedBudgetUserId: string | undefined
): Promise<Response | null> {
  const bodyText = await response.clone().text();
  if (!isVideoBudgetExceededResponse(response.status, bodyText)) {
    return null;
  }
  if (!metadata._internal?.socketId) {
    return null;
  }

  if (metadata.budgetServiceEnabled) {
    logger.info('video-api-fetch.grants.fallback.bms_mode_skip', {
      socketId: metadata._internal.socketId,
      budgetServiceEnabled: metadata.budgetServiceEnabled,
    });
    return null;
  }

  const { socketId, customerId } = metadata._internal;
  if (!grantSessionManager.hasGrants(socketId)) {
    return null;
  }

  let newUserId: string | undefined;
  const currentUserId = grantSessionManager.getCurrentUserId(socketId, customerId);
  if (currentUserId && currentUserId !== failedBudgetUserId) {
    newUserId = currentUserId;
    logger.info('video-api-fetch.grants.fallback.already_advanced', {
      socketId,
      failedUserId: failedBudgetUserId,
      currentUserId,
    });
  } else {
    let hasUsableGrant = grantSessionManager.advanceToNextGrant(socketId);
    if (!hasUsableGrant) {
      logger.info('video-api-fetch.grants.fallback.requesting_refresh', { socketId });
      const gotNewGrants = await grantSessionManager.requestGrantRefreshAndWait(socketId, 5000);
      if (gotNewGrants) {
        hasUsableGrant = grantSessionManager.getCurrentUserId(socketId, customerId) !== undefined;
      }
    }
    if (!hasUsableGrant) {
      logger.warn('video-api-fetch.grants.fallback.all_exhausted', { socketId });
      return null;
    }
    newUserId = grantSessionManager.getCurrentUserId(socketId, customerId);
  }

  if (!newUserId) {
    return null;
  }

  logger.info('video-api-fetch.grants.fallback.retry', {
    socketId,
    previousUser: failedBudgetUserId,
    newUser: newUserId,
  });

  try {
    return await fetch(url, buildInit({ budgetUserId: newUserId }));
  } catch (retryError) {
    logger.error('video-api-fetch.grants.fallback.retry_failed', {
      socketId,
      error: retryError instanceof Error ? retryError.message : String(retryError),
    });
    return null;
  }
}

export async function videoApiFetch(
  openaiClient: OpenAI,
  endpoint: string,
  options: RequestInit = {},
  billing?: VideoApiBilling
): Promise<Response> {
  const token = await getVideoAuthToken(openaiClient);
  const metadata = llmMetadataContext.getStore();
  const resolvedBilling = resolveVideoApiBilling(billing);
  const url = `${openaiClient.baseURL}${endpoint}`;

  const buildInit = function buildVideoRequestInit(
    authToken: string,
    billingOverride?: VideoApiBilling,
  ): RequestInit {
    const headers: Record<string, string> = {
      Authorization: buildVideoAuthorizationHeader(authToken),
      ...(options.headers as Record<string, string> | undefined),
    };
    if (metadata?.traceId) {
      headers['x-trace-id'] = metadata.traceId;
    }
    headers['x-correlation-id'] = crypto.randomUUID();
    applyVideoBillingHeaders(headers, billingOverride ?? resolvedBilling);
    return { ...options, headers };
  };

  let response: Response = await fetch(url, buildInit(token));
  let activeBilling: VideoApiBilling | undefined = resolvedBilling;

  if (metadata) {
    const failedBudgetUserId = activeBilling?.budgetUserId
      ?? (activeBilling?.budgetSessionId ? undefined : resolveVideoBudgetUserId(metadata));
    const retryResponse = await handleVideoBudgetExceededWithGrantFallback(
      response,
      metadata,
      url,
      (billingOverride?: VideoApiBilling) => buildInit(token, billingOverride),
      failedBudgetUserId
    );
    if (retryResponse) {
      response = retryResponse;
      if (!activeBilling?.budgetSessionId) {
        const rotatedUserId = resolveVideoBudgetUserId(metadata);
        if (rotatedUserId) {
          activeBilling = { budgetUserId: rotatedUserId };
        }
      }
    }
  }

  if (isS2SAuthEnabled() && (response.status === 401 || response.status === 403)) {
    const authFailureBody: string = await response.clone().text();
    if (isVideoBudgetExceededResponse(response.status, authFailureBody)) {
      return response;
    }
    logger.warn('video-api-fetch.s2s.refresh_retry', {
      status: response.status,
      endpoint,
    });
    try {
      await response.arrayBuffer();
    } catch {
      // Ignore errors consuming the failed response body
    }
    const refreshedToken: string = await refreshS2SToken();
    response = await fetch(url, buildInit(refreshedToken, activeBilling));
    logger.info('video-api-fetch.s2s.refresh_retry.result', {
      status: response.status,
      endpoint,
    });
  }

  return response;
}
