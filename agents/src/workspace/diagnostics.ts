export interface LogEntry {
  timestamp: Date;
  source: 'stdout' | 'stderr' | 'exec' | 'system';
  level?: string;
  message: string;
}

export interface LogQuery {
  source?: 'stdout' | 'stderr' | 'exec';
  lines?: number;
  since?: Date;
  until?: Date;
  filterPattern?: string;
}

export interface ErrorQuery {
  since?: Date;
  lines?: number;
}

export interface RuntimeSummary {
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  recentErrorCount: number;
  lastErrorAt?: Date;
  lastRestartAt?: Date;
  lastCrashReason?: string;
  hints: string[];
}

export interface WorkspaceDiagnostics {
  logs(query?: LogQuery): Promise<LogEntry[]>;
  errors(query?: ErrorQuery): Promise<{ entries: LogEntry[]; count: number }>;
  runtimeSummary(): Promise<RuntimeSummary>;
}
