/**
 * Git remote configuration and types
 */

export const SYNC_STRATEGIES = ['on_commit', 'on_publish', 'manual'] as const;
export type SyncStrategy = typeof SYNC_STRATEGIES[number];

/**
 * Git remote configuration stored in database
 */
export interface GitRemoteConfig {
  id: string;
  appId: string;
  remoteName: string;
  provider: string;
  repoUrl: string;
  defaultBranch: string;
  lastSyncAt: number | null;
  syncEnabled: boolean;
  syncStrategy: SyncStrategy;
  createdAt: string;
  updatedAt: string;
}

/**
 * Parameters for creating a new git remote configuration
 */
export interface CreateGitRemoteConfigParams {
  appId: string;
  remoteName: string;
  provider: string;
  repoUrl: string;
  defaultBranch: string;
  syncEnabled?: boolean;
  syncStrategy?: SyncStrategy;
}

/**
 * Parameters for updating an existing git remote configuration
 */
export interface UpdateGitRemoteConfigParams {
  repoUrl?: string;
  defaultBranch?: string;
  lastSyncAt?: number;
  syncEnabled?: boolean;
  syncStrategy?: SyncStrategy;
}
