import type { WorkspaceVariant } from './variant.js';
import type { WorkspaceFiles } from './files.js';
import type { WorkspaceTasks } from './tasks.js';
import type { WorkspaceRuntime } from './runtime.js';
import type { WorkspaceDiagnostics } from './diagnostics.js';
import type { WorkspaceArtifacts } from './artifacts.js';
import type { WorkspaceImports } from './imports.js';
import type { WorkspaceDeployments } from './deployments.js';
import type { WorkspaceVersionControl } from './version-control.js';
import type { WorkspaceConfig } from './config.js';
import type { WorkspaceSetup } from './setup.js';
import type { WorkspaceSummary, WorkspaceCapabilities } from './summary.js';

export interface WorkspaceClient {
  readonly workspaceId: string;
  readonly variant: WorkspaceVariant;

  summary(): Promise<WorkspaceSummary>;
  capabilities(): Promise<WorkspaceCapabilities>;

  readonly files: WorkspaceFiles;
  readonly tasks: WorkspaceTasks;
  readonly runtime: WorkspaceRuntime;
  readonly diagnostics: WorkspaceDiagnostics;
  readonly artifacts: WorkspaceArtifacts;
  readonly imports: WorkspaceImports;
  readonly deployments: WorkspaceDeployments;
  readonly versionControl: WorkspaceVersionControl;
  readonly config: WorkspaceConfig;
  readonly setup: WorkspaceSetup;
}

export type CreateForWorkspace = (
  workspaceId: string,
  variant: WorkspaceVariant,
) => WorkspaceClient | null;
