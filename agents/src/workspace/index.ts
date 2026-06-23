export * from './variant.js';
export * from './client.js';
export * from './errors.js';
export * from './summary.js';
export * from './files.js';
export * from './tasks.js';
export * from './runtime.js';
export * from './diagnostics.js';
export * from './artifacts.js';
export * from './imports.js';
export * from './deployments.js';
export * from './version-control.js';
export * from './config.js';

import { DevSupervisorClientFactory } from '../utils/dev-supervisor-client-factory.js';
import { Logger } from '../logging/index.js';
import { HttpWorkspaceClient } from './adapters/http-workspace-client.js';
import type { WorkspaceClient } from './client.js';
import type { WorkspaceVariant } from './variant.js';

const createForWorkspaceLogger = Logger.create({ component: 'workspace.createForWorkspace' });

/**
 * Bind a WorkspaceClient to a workspace + variant.
 *
 * Returns `null` for two distinct causes the caller must disambiguate itself
 * if it cares (e.g. by consulting the app record):
 *   1. Unknown workspace — `DevSupervisorClientFactory.createForApp` throws
 *      (`App with ID ... not found`) when the app record is absent; caught here.
 *   2. No bindable supervisor — the app record exists but has no `socketPath`
 *      (e.g. local TCP mode before the supervisor registers), so `createForApp`
 *      returns null directly.
 *
 * A *bound-but-unreachable* supervisor is NOT a null result: `createForApp`
 * returns a client whenever the record has a `socketPath`, without probing
 * reachability, so unreachability surfaces as a typed error on the first method
 * call, not at bind time.
 *
 * Unexpected errors (DB/IO failures) are logged and re-thrown so they are not
 * silently swallowed.
 */
export function createForWorkspace(
  workspaceId: string,
  variant: WorkspaceVariant,
): WorkspaceClient | null {
  try {
    const client =
      variant === 'publish'
        ? DevSupervisorClientFactory.createForPublishSupervisor(workspaceId)
        : DevSupervisorClientFactory.createForApp(workspaceId);
    if (!client) return null;
    return new HttpWorkspaceClient(workspaceId, variant, client);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Anchored to the exact factory message — broader regex would silently
    // collapse unrelated downstream errors that happen to contain "not found".
    if (/^App with ID .* not found$/.test(message)) {
      return null;
    }
    createForWorkspaceLogger.warn('workspace.create.unexpected_error', {
      workspaceId,
      variant,
      error: message,
    });
    throw err;
  }
}
