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
 * Returns `null` for either failure mode (callers that need to distinguish
 * them should retry and surface their own error):
 *   1. Unknown workspace — `DevSupervisorClientFactory.createForApp` throws
 *      (`App with ID ... not found`) when the app record is absent.
 *   2. Unreachable supervisor — `createForApp` returns a client whenever the
 *      app record has a `socketPath`, without probing reachability.
 *      Unreachability surfaces as a typed error on the first method call,
 *      not at bind time.
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
