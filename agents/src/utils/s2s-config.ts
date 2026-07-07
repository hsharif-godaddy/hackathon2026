import { type S2SAuthV2Config } from '@airo/ai-lib';

/**
 * Single source of truth for the v2 S2S identity — which AWS profile and SSO
 * host agents-service fetches its s2s token with. Reads env at call time so
 * per-env deploys and test stubbing work. All v2 consumers (base-driver-v2,
 * Care auth, …) resolve config through this rather than re-deriving the
 * defaults, so "the s2s identity" is defined in exactly one place.
 *
 * Lives in agents (not @airo/ai-lib) on purpose: the `gocode` default is
 * GoCode-deployment-specific, and s2s-auth-v2 is deliberately GoCode-decoupled.
 * Keeping it here also avoids forcing every `vi.mock('@airo/ai-lib')` partial
 * factory to add this export just to construct a BaseDriverV2 subclass.
 */
export function getDefaultS2SConfigV2(): S2SAuthV2Config {
  return {
    awsProfile: process.env.S2S_AWS_PROFILE || 'gocode',
    ssoHost: process.env.SSO_HOST || 'sso.test-godaddy.com',
  };
}
