/**
 * Auth-at-Edge SSO Defense-in-Depth Middleware
 *
 * Refuses publish-mutating requests when the calling app's subscription
 * has `apps.sso_required=true` but the customer hasn't saved both
 * credential pointer rows (e.g. `GD_SSO_OAUTH_CLIENT_ID` /
 * `GD_SSO_OAUTH_CLIENT_SECRET` for the GD bootstrap config; the actual
 * names come per-config from `airo_enterprise_sso_configs`) yet.
 *
 * Parallel UX gate, NOT a mirror of mhp-core's canonical publish gate.
 * Authoritative runtime enforcement lives elsewhere:
 *   - hosting's secrets validator (`secrets_validator.go`) gates the
 *     `auth`-class writes themselves
 *   - dev-supervisor / publish-time fail-closed checks the cache row
 *     (`SSO_OAUTH_CONFIG`) + resolved credentials when a request
 *     actually reaches the published app
 *
 * The agents/ publish surface (POST /apps/:id/publish[/restart],
 * POST /apps/:id/publish-state) talks directly to dev-supervisor over
 * UDS, so any caller with a valid agent JWT could trigger a deploy
 * without going through the BFF. This middleware closes that bypass
 * with an early 403 keyed on the JWT claims rather than re-reading
 * upstream state per request.
 *
 * The two booleans (`ssoRequired`, `ssoConfigured`) are baked into the
 * agent token at mint time by the AAB BFF
 * (`app/src/app/api/auth/agent-token/route.ts`):
 *   - `ssoRequired` is read from the app GET response (admin-controlled
 *     in mhp-core via `apps.sso_required`).
 *   - `ssoConfigured` is the BFF's own UX check: BOTH credential pointer
 *     rows present in airo-go's customer-proxy auth-group GET. Names are
 *     resolved from `SiteInfo.clientIdSecretName` /
 *     `clientSecretSecretName` (mhp-core PR #738) with GD defaults as
 *     backstop. This is NOT a check on the `SSO_OAUTH_CONFIG` cache row
 *     itself — that row is admin/airo-go-owned and not what's missing
 *     during the customer-facing "save your credentials" flow.
 *
 * Staleness is bounded by the agent token TTL (currently up to 12h,
 * often shorter). Saving the SSO config does not retroactively rewrite
 * outstanding tokens — the next BFF agent-token mint picks up the new
 * state.
 */

import { NextFunction, Request, Response } from 'express';

import { log } from '../../logging/index.js';
import type { AuthenticatedRequest } from './jwt-auth.js';

/**
 * Express middleware that returns 403 when SSO is required for the app's
 * subscription but the per-app OAuth config hasn't been saved yet.
 *
 * @example
 * ```ts
 * router.post(
 *   '/apps/:id/publish',
 *   requirePermission('canPublish'),
 *   requireSsoConfigured,            // <-- defense-in-depth
 *   async (req, res) => { ... }
 * );
 * ```
 */
export function requireSsoConfigured(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authReq = req as AuthenticatedRequest;
  const appId = req.params.id;

  if (!authReq.agentContext) {
    const ctxLogger = appId ? log.forApp(appId) : log.forAgent('require-sso-configured');
    ctxLogger.error('middleware.require-sso-configured.no-context', {
      reason: 'missing_agentContext',
      message: 'agentContext not found — ensure jwtAuthMiddleware runs first',
    });
    res.status(401).json({
      error: 'Authentication required',
      details: 'Request must be authenticated before checking SSO requirements',
    });
    return;
  }

  const { ssoRequired, ssoConfigured } = authReq.agentContext;

  // Not an ent-required app → pass through. Includes:
  //   - non-ent users (no apps.sso_required)
  //   - legacy tokens minted before the SSO claims were added
  //   - any state where the BFF couldn't reach the upstream at mint time
  //     (fail-open match with the BFF's own behavior)
  if (!ssoRequired) {
    next();
    return;
  }

  // Required and not configured → block.
  if (!ssoConfigured) {
    const ctxLogger = appId ? log.forApp(appId) : log.forAgent('require-sso-configured');
    ctxLogger.warn('middleware.require-sso-configured.blocked', {
      appId,
      reason: 'sso_required_but_not_configured',
    });
    res.status(403).json({
      error: 'sso_not_configured',
      details:
        'SSO is required for apps in this organization but the OAuth client is not configured. ' +
        'Open Settings → SSO in the builder to register an OIDC application before publishing.',
    });
    return;
  }

  // Required and configured → allow.
  next();
}
