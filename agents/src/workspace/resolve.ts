import { WorkspaceUnavailableError } from './errors.js';
import type { CreateForWorkspace, WorkspaceClient } from './client.js';
import type { WorkspaceFiles } from './files.js';
import type { WorkspaceVariant } from './variant.js';

export function resolveWorkspace(
  workspaceId: string,
  variant: WorkspaceVariant,
  factory: CreateForWorkspace,
): WorkspaceClient {
  const workspace: WorkspaceClient | null = factory(workspaceId, variant);
  if (!workspace) {
    throw new WorkspaceUnavailableError(workspaceId, variant);
  }
  return workspace;
}

export function resolveWorkspaceFiles(
  workspaceId: string,
  variant: WorkspaceVariant,
  factory: CreateForWorkspace,
): WorkspaceFiles {
  return resolveWorkspace(workspaceId, variant, factory).files;
}
