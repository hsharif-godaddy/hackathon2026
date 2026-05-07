import { logger } from '../../logging/index.js';

/**
 * WorkspaceScope identifies a tenant workspace for store operations.
 *
 * Every store method receives a WorkspaceScope instead of a raw appId.
 * This ensures the scope carries customerId when available so that
 * remote adapters (ASM) can resolve tenancy without caller changes.
 *
 * Two variants:
 *  - `resolved`: has customerId (authenticated context)
 *  - `local`: customerId unavailable (local dev, diagnostics, etc.)
 */

export const WORKSPACE_TAG_PREFIX = 'workspace:';

export type WorkspaceScope =
  | { kind: 'resolved'; appId: string; customerId: string }
  | { kind: 'local'; appId: string };

/**
 * Build a WorkspaceScope from an appId and optional customerId.
 * Produces a `resolved` scope when customerId is present, `local` otherwise.
 */
export function workspaceScopeFromAppId(appId: string, customerId?: string): WorkspaceScope {
  if (customerId) {
    return { kind: 'resolved', appId, customerId };
  }
  return { kind: 'local', appId };
}

/**
 * Encode a WorkspaceScope as a tag string for tagging resources.
 */
export function workspaceTag(scope: WorkspaceScope): string {
  return `${WORKSPACE_TAG_PREFIX}${scope.appId}`;
}

/**
 * Extract the appId from a workspace tag string.
 * Returns undefined if the tag doesn't match the expected prefix.
 */
export function appIdFromTag(tag: string): string | undefined {
  if (tag.startsWith(WORKSPACE_TAG_PREFIX)) {
    return tag.slice(WORKSPACE_TAG_PREFIX.length);
  }
  return undefined;
}

/**
 * Extract customerId from an agent execution context object.
 * Returns undefined if not present or not a string.
 */
export function customerIdFromContext(context?: { metadata?: Record<string, unknown> }): string | undefined {
  const value = context?.metadata?.customerId;
  if (typeof value === 'string') return value;
  // null is a normal absent-value representation (JSON, DB drivers) — skip warning
  if (value !== undefined && value !== null) {
    logger.warn('scope.customerIdFromContext.nonStringValue', { type: typeof value });
  }
  return undefined;
}
