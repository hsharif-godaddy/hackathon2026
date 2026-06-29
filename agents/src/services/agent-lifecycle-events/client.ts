import { createHmac, randomUUID } from 'node:crypto';

import { getS2SToken } from '@airo/ai-lib';

import { Logger } from '../../logging/index.js';
import { getNomadAllocConfigValue } from '../../utils/nomad-config.js';
import type { InitialBuildAsyncEventType } from './event-types.js';

const logger = Logger.create({ component: 'agent-lifecycle-events' });

export const EVENT_SIG_HEADER = 'X-Airo-Event-Sig';
const SIGNING_KEY_CURRENT = '__event_signing_key';

export interface AgentLifecycleEventBody {
  eventType: InitialBuildAsyncEventType;
  occurredAt: string;
  idempotencyKey: string;
}

/** Canonical string signed by the agent and verified by airo-go AgentEventHMAC. */
export function buildEventCanonical(
  appId: string,
  eventType: string,
  occurredAt: string,
  idempotencyKey: string,
): string {
  return `${appId}\n${eventType}\n${occurredAt}\n${idempotencyKey}`;
}

/** base64url(HMAC-SHA256(key, canonical)), unpadded — matches Go RawURLEncoding. */
export function computeEventSignature(key: string, canonical: string): string {
  return createHmac('sha256', key).update(canonical).digest('base64url');
}

function getMgmtAiroBaseUrl(): string {
  const raw = process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
  return raw.replace(/\/$/, '');
}

function readSigningKey(): string {
  return getNomadAllocConfigValue(SIGNING_KEY_CURRENT, '');
}

/**
 * POST a lifecycle event to airo-go's agent ingress:
 * `POST /api/airo/agent/v1/apps/:appId/events` with awsiam (sso-jwt) + per-app HMAC.
 * Fire-and-forget: logs failures and never throws to callers.
 */
export async function postAgentLifecycleEvent(
  appId: string,
  eventType: InitialBuildAsyncEventType,
): Promise<void> {
  if (!appId) return;

  const signingKey = readSigningKey();
  if (!signingKey) {
    logger.warn('agent.lifecycle_event.no_signing_key', { appId, eventType });
    return;
  }

  const occurredAt = new Date().toISOString();
  const idempotencyKey = randomUUID();
  const canonical = buildEventCanonical(appId, eventType, occurredAt, idempotencyKey);
  const signature = computeEventSignature(signingKey, canonical);

  let token: string;
  try {
    token = await getS2SToken();
  } catch (error) {
    logger.warn('agent.lifecycle_event.s2s_token_failed', {
      appId,
      eventType,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const body: AgentLifecycleEventBody = { eventType, occurredAt, idempotencyKey };
  const url = `${getMgmtAiroBaseUrl()}/api/airo/agent/v1/apps/${encodeURIComponent(appId)}/events`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `sso-jwt ${token}`,
        [EVENT_SIG_HEADER]: signature,
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      logger.info('agent.lifecycle_event.posted', {
        appId,
        eventType,
        status: response.status,
      });
      return;
    }

    const responseText = await response.text();
    logger.warn('agent.lifecycle_event.rejected', {
      appId,
      eventType,
      status: response.status,
      responseText: responseText.slice(0, 500),
    });
  } catch (error) {
    logger.warn('agent.lifecycle_event.post_failed', {
      appId,
      eventType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
