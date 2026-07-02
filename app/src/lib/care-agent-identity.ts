/**
 * Care-agent JWT identity resolution.
 *
 * Turns an impersonating employee (e2s/e2s2s `del.accountName`) into the
 * non-PII identity baked into the agent JWT so care-agent budget-override
 * spend stays attributable to the employee:
 *
 *   1. Worker GUID from the Workers Service (`resolveCareAgentWorkerId`), or
 *   2. a keyed HMAC-SHA256 of the JOMAX accountName as a fallback when the
 *      lookup fails.
 */

import { createHmac } from 'node:crypto';

import { logger } from '@/lib/request-context';
import { resolveCareAgentWorkerId } from '@/lib/workers-service/client';

/** Mutually exclusive: the GUID on success, or the keyed-HMAC username hash as a fallback. */
export interface CareAgentIdentity {
  careAgentId?: string;
  careAgentUsernameHash?: string;
}

export interface ResolveCareAgentIdentityOptions {
  /** The delegated (e2s/e2s2s) shopper JWT; passed through as `sso-jwt` auth to the Workers Service. */
  jwt: string;
  /** Request headers — the environment root domain is derived from `host`. */
  headers: Headers;
  /** JOMAX accountName from `del.accountName`; used only for keyed hashing + caching, never minted/logged raw. */
  accountName?: string;
}

// Non-prod default so local dev and tests hash deterministically without setup.
// Production must supply CARE_AGENT_HASH_KEY; if it doesn't,
// we emit no hash at all rather than fall back to an unkeyed/weak digest.
const DEV_HASH_KEY = 'airo-dev-care-agent-hash-key-not-for-production';

function getCareAgentHashKey(): string | undefined {
  const key: string | undefined = process.env.CARE_AGENT_HASH_KEY;
  if (key) return key;
  if (process.env.NODE_ENV === 'production') return undefined;
  return DEV_HASH_KEY;
}

function hashUsername(accountName: string): string | undefined {
  const key: string | undefined = getCareAgentHashKey();
  if (!key) return undefined;
  return createHmac('sha256', key).update(accountName).digest('hex');
}

/**
 * Resolve the care agent's identity for minting. Returns the worker GUID when
 * the Workers Service lookup succeeds, otherwise the keyed-HMAC username hash
 * (when an accountName and hash key are available) so spend stays attributable
 * without exposing PII. Never throws — token issuance must not depend on the
 * Workers Service being reachable.
 */
export async function resolveCareAgentIdentity(
  opts: ResolveCareAgentIdentityOptions,
): Promise<CareAgentIdentity> {
  const { jwt, headers, accountName } = opts;

  if (!accountName) {
    return {};
  }

  const workerId: string | undefined = await resolveCareAgentWorkerId({ jwt, headers, accountName });
  if (workerId) {
    return { careAgentId: workerId };
  }

  const usernameHash: string | undefined = hashUsername(accountName);
  if (!usernameHash) {
    logger.warn('care-agent-identity.hash.no-key', {});
    return {};
  }

  return { careAgentUsernameHash: usernameHash };
}
