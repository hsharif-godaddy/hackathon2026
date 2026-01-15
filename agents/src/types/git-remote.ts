/**
 * Git remote configuration and types
 */

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
}

/**
 * Parameters for updating an existing git remote configuration
 */
export interface UpdateGitRemoteConfigParams {
  repoUrl?: string;
  defaultBranch?: string;
  lastSyncAt?: number;
  syncEnabled?: boolean;
}
