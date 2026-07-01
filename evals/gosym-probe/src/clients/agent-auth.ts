import type { AgentContext } from './aab-client.js';
import type { Claims } from '../scenarios/types.js';

export interface ResolvedAgentAuth {
  /**
   * True when the AABClient must attach a mock token: a profile arm or at least
   * one switchboard claim is present. With neither, the client runs
   * unauthenticated (matching the prior no-agentProfile behavior).
   */
  needsAuth: boolean;
  /**
   * Merged JWT claims: the profile agentContext (or a bypass-site default when
   * a scenario carries only switchboard claims and no profile) plus any
   * per-scenario contextClaims. The single source so the structured
   * agentContext and the minted token can't drift apart.
   */
  claims: Record<string, unknown>;
}

export function resolveAgentAuth(
  agentContext: AgentContext | undefined,
  contextClaims: Claims | undefined,
): ResolvedAgentAuth {
  const hasClaims: boolean =
    contextClaims !== undefined && Object.keys(contextClaims).length > 0;
  const needsAuth: boolean = agentContext !== undefined || hasClaims;
  const claims: Record<string, unknown> = {
    ...(agentContext ?? { siteId: 'bypass-site' }),
    ...(contextClaims ?? {}),
  };
  return { needsAuth, claims };
}
