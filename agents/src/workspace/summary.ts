import type { WorkspaceVariant } from './variant.js';

export interface WorkspaceSummary {
  workspaceId: string;
  variant: WorkspaceVariant;
  runtime: {
    state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
    pid?: number;
    uptimeSeconds?: number;
    health: 'healthy' | 'unhealthy' | 'starting' | 'unknown';
  };
  deployment?: {
    version: string | null;
    activatedAt?: Date;
  };
  diagnostics: {
    recentErrorCount: number;
    lastErrorAt?: Date;
  };
  versionControl?: {
    branch: string;
    revision: string;
    dirty: boolean;
    lastCheckpointAt?: Date;
  };
  capabilities: string[];
}

export type MethodAvailability = 'live' | 'stubbed' | 'variant-not-applicable';

/**
 * Closed union of every addressable method on WorkspaceClient. Using a closed
 * key type makes `caps.methods['runtme.status']` a compile error rather than a
 * silent `undefined` at runtime.
 */
export type WorkspaceMethodKey =
  | 'files.tree'
  | 'files.view'
  | 'files.search'
  | 'files.write'
  | 'files.edit'
  | 'files.delete'
  | 'files.move'
  | 'files.upload'
  | 'tasks.runCommand'
  | 'tasks.runCommandSync'
  | 'tasks.runCommandAsync'
  | 'tasks.get'
  | 'tasks.output'
  | 'tasks.cancel'
  | 'runtime.status'
  | 'runtime.start'
  | 'runtime.stop'
  | 'runtime.restart'
  | 'runtime.check'
  | 'runtime.configureHealth'
  | 'diagnostics.logs'
  | 'diagnostics.errors'
  | 'diagnostics.runtimeSummary'
  | 'artifacts.createSourceBundle'
  | 'artifacts.createBuildBundle'
  | 'artifacts.upload'
  | 'artifacts.get'
  | 'artifacts.download'
  | 'imports.start'
  | 'imports.get'
  | 'imports.cancel'
  | 'deployments.prepare'
  | 'deployments.activate'
  | 'deployments.status'
  | 'deployments.unpublish'
  | 'versionControl.status'
  | 'versionControl.checkpoint'
  | 'versionControl.history'
  | 'versionControl.diff'
  | 'versionControl.preparePublish'
  | 'config.listEnv'
  | 'config.upsertEnv'
  | 'config.removeEnv'
  | 'setup.getStatus'
  | 'setup.execute'
  | 'summary'
  | 'capabilities';

export type WorkspaceNamespaceKey =
  | 'files'
  | 'tasks'
  | 'runtime'
  | 'diagnostics'
  | 'artifacts'
  | 'imports'
  | 'deployments'
  | 'versionControl'
  | 'config'
  | 'setup';

export interface WorkspaceCapabilities {
  methods: Record<WorkspaceMethodKey, MethodAvailability>;
  versions: Record<WorkspaceNamespaceKey, string>;
}
