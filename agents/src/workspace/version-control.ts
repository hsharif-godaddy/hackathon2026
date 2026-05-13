export interface VersionControlStatus {
  branch: string;
  revision: string;
  dirty: boolean;
  aheadOfRemote?: number;
  behindRemote?: number;
  lastCheckpointAt?: Date;
}

export interface CheckpointOptions {
  message: string;
  paths?: string[];
}

export interface CheckpointResult {
  revision: string;
  summary: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
}

export interface HistoryOptions {
  limit?: number;
  since?: Date;
  paths?: string[];
}

export interface Commit {
  revision: string;
  message: string;
  author: string;
  timestamp: Date;
}

export interface DiffOptions {
  from?: string;
  to?: string;
  paths?: string[];
}

export interface DiffPatch {
  path: string;
  diff: string;
}

export interface PreparePublishOptions {
  message?: string;
}

export interface WorkspaceVersionControl {
  status(): Promise<VersionControlStatus>;
  checkpoint(options: CheckpointOptions): Promise<CheckpointResult>;
  history(options?: HistoryOptions): Promise<Commit[]>;
  diff(options?: DiffOptions): Promise<DiffPatch[]>;
  preparePublish(options?: PreparePublishOptions): Promise<{ revision: string }>;
}
