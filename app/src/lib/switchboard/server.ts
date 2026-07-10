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

/**
 * Read a flag from the gasket-plugin tree. Throws on lookup errors so callers
 * can fail closed; returns `undefined` when the tree resolves but the key is
 * absent (distinct states).
 */
export async function getSwitchboardTree(req: SwitchboardRequest): Promise<Record<string, unknown>> {
  // When GASKET_DISABLE_SWITCHBOARD=1 the plugin isn't loaded and the action
  // doesn't exist. Return an empty tree so all flags resolve to their defaults
  // rather than throwing and turning every flag-gated route into a 500.
  if (typeof (gasket.actions as unknown as Record<string, unknown>).getSwitchboardConfig !== 'function') {
    return {};
  }
  try {
    const tree = await gasket.actions.getSwitchboardConfig<Record<string, unknown>>(req);
    if (!tree) {
      throw new Error('gasket-plugin-switchboard returned no tree');
    }
    return tree;
  } catch (error) {
    logger.error('switchboard.server.lookup-error', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function lookup(featureName: string, req: SwitchboardRequest): Promise<unknown> {
  return (await getSwitchboardTree(req))[featureName];
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
  const value = await lookup(featureName, req);
  return typeof value === 'string' ? value : null;
}

/**
 * Fetch a JSON-object-valued feature flag (Switchboard "json" single-value
 * type). The gasket-plugin tree surfaces a json-typed setting as an
 * already-parsed object, so this returns it directly. Returns `null` when the
 * flag is absent or is not a plain object (boolean / string / number / array
 * all yield `null`). Throws when the underlying tree lookup fails — callers
 * that want a soft default should wrap in try/catch.
 */
export async function checkSwitchboardObject(
  featureName: string,
  req: SwitchboardRequest,
): Promise<Record<string, unknown> | null> {
  const value = await lookup(featureName, req);
  if (value != null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  // Present but wrong type (operator created the setting as String / Number /
  // Boolean / JSON-array instead of a JSON object). Without this, a misconfig
  // is indistinguishable from "setting absent" and can persist silently. Absent
  // (undefined / null) is the expected default path and stays quiet.
  if (value != null) {
    logger.warn('switchboard.server.object-type-mismatch', {
      featureName,
      actualType: Array.isArray(value) ? 'array' : typeof value,
    });
  }
  return null;
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
  const value = await lookup(featureName, req);
  return typeof value === 'boolean' ? value : false;
}
