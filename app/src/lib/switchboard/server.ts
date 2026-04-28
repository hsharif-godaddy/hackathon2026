/**
 * Server-side switchboard flag utilities
 *
 * Backed by `@godaddy/gasket-plugin-switchboard`'s in-process client. The
 * plugin authenticates to Switchboard via IAM (not user JWT), polls settings
 * into an in-process cache, and exposes a per-request merged tree through
 * `gasket.actions.getSwitchboardConfig(req)` that already applies evaluation
 * criteria (shopperId, customerId, visitor). These helpers are thin wrappers
 * over that tree lookup.
 *
 * Flag flips propagate within `@switchboard/client`'s `cacheRefreshMs`
 * (default ~2 min). Nothing in this codebase requires lower latency.
 *
 * Error contract: the helpers distinguish "flag not in tree / wrong type"
 * (returns default) from a system failure (re-throws). A system failure is
 * either the underlying gasket call throwing or it returning no tree at all
 * (null / undefined) - both indicate the plugin couldn't supply flag state
 * and must not be misread as "all flags are off". Paywall / security gates
 * rely on the re-throw to fail closed; UI callers that want a soft default
 * should wrap in try/catch.
 */

import { logger } from '@/lib/request-context';
import gasket from '../../../gasket';

/** Accepts NextRequest, Request, or a plain `{ headers }` wrapper. */
export type SwitchboardRequest = { headers: Headers | Record<string, string> };

/** Local dev boolean overrides (NEXT_PUBLIC_ENABLE_LOCAL_FEATURES=true). */
const SERVER_LOCAL_FEATURE_OVERRIDES: Record<string, boolean> = {
  'appbuilder-publish-button': true,
  'appbuilder-manage-plan': true,
  'appbuilder-settings-team': true,
  'appbuilder-domain-purchase': true,
  'appbuilder-domain-attach': true,
  'appbuilder-share-links': true,
  'appbuilder-transfer-ownership': true,
  'appbuilder-github-integration': true,
  'app-builder-budget-service': false, // opt-in: requires running Budget Service
  'appbuilder-assessment-agent': true,
  'appbuilder-assessment-override': true,
  'appbuilder-model-selector': true,
  'appbuilder-agent-profile-selector': true,
  'appbuilder-post-publish-feature-selection': true,
  'appbuilder-cost-attribution-dry-run': false,
};

/** Local dev string overrides (NEXT_PUBLIC_ENABLE_LOCAL_FEATURES=true). */
const SERVER_LOCAL_VALUE_OVERRIDES: Record<string, string> = {
  'appbuilder-model-override': 'default',
  'appbuilder-agent-profile': 'experimental',
};

function localOverride<T>(featureName: string, overrides: Record<string, T>): T | undefined {
  if (process.env.NEXT_PUBLIC_ENABLE_LOCAL_FEATURES !== 'true') return undefined;
  if (!(featureName in overrides)) return undefined;
  const value = overrides[featureName];
  logger.info('switchboard.server.local-override', { featureName, value });
  return value;
}

/**
 * Read a flag from the gasket-plugin tree. Throws on lookup errors so callers
 * can fail closed; returns `undefined` when the tree resolves but the key is
 * absent (distinct states).
 */
async function lookup(featureName: string, req: SwitchboardRequest): Promise<unknown> {
  try {
    const tree = await gasket.actions.getSwitchboardConfig<Record<string, unknown>>(req);
    if (!tree) {
      throw new Error('gasket-plugin-switchboard returned no tree');
    }
    return tree[featureName];
  } catch (error) {
    logger.error('switchboard.server.lookup-error', {
      featureName,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Fetch a string-valued feature flag. Returns `null` when absent or of a
 * different type. Throws when the underlying tree lookup fails - callers that
 * want a soft default should wrap in try/catch.
 */
export async function checkSwitchboardValue(
  featureName: string,
  req: SwitchboardRequest,
): Promise<string | null> {
  const override = localOverride(featureName, SERVER_LOCAL_VALUE_OVERRIDES);
  if (override !== undefined) return override;

  const value = await lookup(featureName, req);
  return typeof value === 'string' ? value : null;
}

/**
 * Fetch a boolean feature flag. Returns `false` when absent or of a different
 * type. Throws when the underlying tree lookup fails - callers that want a
 * soft default should wrap in try/catch.
 */
export async function checkSwitchboardFlag(
  featureName: string,
  req: SwitchboardRequest,
): Promise<boolean> {
  const override = localOverride(featureName, SERVER_LOCAL_FEATURE_OVERRIDES);
  if (override !== undefined) return override;

  const value = await lookup(featureName, req);
  return typeof value === 'boolean' ? value : false;
}
