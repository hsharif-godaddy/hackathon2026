import type { DevSupervisorClient, LogOptions } from '../../services/DevSupervisorClient.js';
import type {
  WorkspaceDiagnostics,
  LogEntry,
  LogQuery,
  ErrorQuery,
  RuntimeSummary,
} from '../diagnostics.js';
import { WorkspaceNotImplementedError, WorkspaceValidationError } from '../errors.js';
import { safeDate } from './wire.js';

export class HttpDiagnostics implements WorkspaceDiagnostics {
  constructor(private readonly client: DevSupervisorClient) {}

  async logs(query: LogQuery = {}): Promise<LogEntry[]> {
    if (query.until !== undefined) {
      throw new WorkspaceValidationError(
        'diagnostics.logs: "until" is not supported by this adapter',
        'until',
      );
    }
    if (query.filterPattern !== undefined) {
      throw new WorkspaceValidationError(
        'diagnostics.logs: "filterPattern" is not supported by this adapter',
        'filterPattern',
      );
    }
    const wire: LogOptions = {};
    if (query.source) wire.source = query.source;
    if (query.lines !== undefined) wire.lines = query.lines;
    if (query.since) wire.since = query.since.toISOString();
    const entries = await this.client.getLogs(wire);
    return entries.map((e) => ({
      timestamp: safeDate(e.timestamp) ?? new Date(0),
      source: e.source as LogEntry['source'],
      level: e.level,
      message: e.message,
    }));
  }

  async errors(_query?: ErrorQuery): Promise<{ entries: LogEntry[]; count: number }> {
    throw new WorkspaceNotImplementedError('diagnostics.errors');
  }

  async runtimeSummary(): Promise<RuntimeSummary> {
    throw new WorkspaceNotImplementedError('diagnostics.runtimeSummary');
  }
}
