import type { LogEntry } from './diagnostics.js';

export interface ImportStart {
  sourceArtifactId?: string;
  gitUrl?: string;
  gitRef?: string;
  commands?: {
    install?: string;
    build?: string;
    start?: string;
  };
}

export type ImportPhase =
  | 'extract'
  | 'validate'
  | 'install'
  | 'build'
  | 'commit'
  | 'restart'
  | 'done'
  | 'failed';

export interface ImportStatus {
  importId: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  phase: ImportPhase;
  startedAt: Date;
  finishedAt?: Date;
  error?: string;
  logs?: LogEntry[];
}

export interface WorkspaceImports {
  start(options: ImportStart): Promise<{ importId: string; state: 'queued' | 'running' }>;
  get(importId: string): Promise<ImportStatus>;
  cancel(importId: string): Promise<{ state: 'canceled' | 'already_finished' }>;
}
