import { Logger } from '../logging/index.js';
import { getErrorMessage } from '../utils/error.js';
import { toolLogReaderEvents } from '../logging/events/index.js';
import { createForWorkspace } from '../workspace/index.js';
import type { LogQuery } from '../workspace/diagnostics.js';
import { formatLogs, formatLogSummary, summarizeLogs } from './log-formatting.js';

export interface DevLogsOptions {
  /** Which app to read logs from: preview (default) or publish */
  target?: 'preview' | 'publish';
  /** Number of recent log lines to retrieve (default: 50, max: 1000) */
  lines?: number;
  /** Filter logs by source: stdout (normal output) or stderr (errors) */
  source?: 'stdout' | 'stderr';
  /** Get logs since specific time (ISO 8601 format, e.g., "2024-01-01T10:00:00Z") */
  since?: string;
  /** Get log summary with statistics instead of raw logs */
  summary?: boolean;
}

export interface DevLogsResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Formatted log output ready for display */
  output: string;
  /** Raw log count for reference */
  totalLogs?: number;
  /** Error message if operation failed */
  error?: string;
}

/**
 * View Logs Tool
 *
 * High-level agent tool for the 'view_logs' command. Reads development/publish
 * server logs through the workspace client's `diagnostics.logs` API
 * (dev-supervisor) — the agent process never touches the host filesystem or a
 * raw supervisor socket. Presentation and summary aggregation live in
 * `log-formatting.ts`, keeping the workspace API a thin data surface.
 */
export class ViewLogsTool {
  private logger: Logger;

  constructor() {
    this.logger = Logger.create({ component: 'view-logs-tool' });
  }

  /**
   * Read development logs with intelligent defaults
   */
  async readLogs(appId: string, options: DevLogsOptions = {}): Promise<DevLogsResult> {
    const startTime = Date.now();

    const target = options.target || 'preview';

    const beginData: { toolName: string; appId?: string; target?: string; source?: 'stdout' | 'stderr'; lines?: number; since?: string } = {
      toolName: 'dev-logs',
      appId,
      target,
    };

    if (options.source) beginData.source = options.source;
    if (options.lines) beginData.lines = options.lines;
    if (options.since) beginData.since = options.since;

    toolLogReaderEvents.readBegin(this.logger, beginData);

    try {
      // `target` maps directly to the workspace variant; a null client means
      // the supervisor isn't bindable (app not running / not configured).
      const workspace = createForWorkspace(appId, target);

      if (!workspace) {
        const label = target === 'publish' ? 'Publish' : 'Preview';
        return {
          success: false,
          output: `**${label} logs not available**\n\nThe ${label.toLowerCase()} server may not be running, or log monitoring is not configured for this app.`,
          error: `${label} supervisor not available for this app`,
        };
      }

      // Summary request: pull all logs and aggregate stats. Re-emit the
      // dedicated `log-reader` summary telemetry (summaryBegin/Success/Failure)
      // the former DevSupervisorLogClient owned, alongside the generic dev-logs
      // read events, so dashboards/alerts keyed on either stream keep working.
      if (options.summary) {
        toolLogReaderEvents.summaryBegin(this.logger, { toolName: 'log-reader', appId });

        try {
          const logs = await workspace.diagnostics.logs({});
          const summary = summarizeLogs(logs);
          const output =
            summary.totalLogs > 0
              ? formatLogSummary(summary)
              : '**No logs found** - The development server may have just started or logs may have been cleared.';

          const executionTime = Date.now() - startTime;
          const resultStats = {
            success: true,
            totalEntries: summary.totalLogs,
            executionTime,
          };
          toolLogReaderEvents.summarySuccess(this.logger, {
            toolName: 'log-reader',
            appId,
            operation: 'summary',
            resultStats,
          });
          toolLogReaderEvents.readSuccess(this.logger, {
            toolName: 'dev-logs',
            appId,
            target,
            operation: 'read',
            resultStats,
          });

          return {
            success: true,
            output,
            totalLogs: summary.totalLogs,
          };
        } catch (error) {
          const errorMessage = getErrorMessage(error);
          toolLogReaderEvents.summaryFailure(
            this.logger,
            error instanceof Error ? error : new Error(errorMessage),
            { toolName: 'log-reader', appId, operation: 'summary' },
          );
          return {
            success: false,
            output: `**Failed to get log summary**: ${errorMessage}`,
            error: errorMessage,
          };
        }
      }

      // Default to recent logs with sensible defaults
      const lines = Math.min(options.lines || 50, 1000); // Default 50, max 1000

      if (options.since && Number.isNaN(new Date(options.since).getTime())) {
        return {
          success: false,
          output: '**Invalid since timestamp** - Use ISO 8601 format (e.g., 2024-01-01T00:00:00Z).',
          error: 'Invalid since timestamp format. Use ISO 8601 format (e.g., 2024-01-01T00:00:00Z)',
        };
      }

      const query: LogQuery = { lines };
      if (options.source) query.source = options.source;
      if (options.since) query.since = new Date(options.since);

      const logs = await workspace.diagnostics.logs(query);

      // Use formatted output if available, otherwise create a simple message
      let output =
        logs.length > 0
          ? formatLogs(logs, {
              ...(options.source && { source: options.source }),
              lines,
              ...(options.since && { since: options.since }),
            })
          : '**No recent logs found**\n\nThe development server may have just started or there may be no recent activity.';

      // Add helpful context if no logs found
      if (logs.length === 0) {
        output += '\n\n**Tip**: Try using `source: "stderr"` to see error logs, or increase the `lines` parameter to see more history.';
      }

      const executionTime = Date.now() - startTime;

      toolLogReaderEvents.readSuccess(this.logger, {
        toolName: 'dev-logs',
        appId,
        target,
        operation: 'read',
        resultStats: {
          success: true,
          totalEntries: logs.length,
          linesRequested: lines,
          executionTime,
          ...(options.source && { sourceFilter: options.source }),
          ...(options.since && { sinceFilter: options.since }),
        },
      });

      return {
        success: true,
        output,
        totalLogs: logs.length,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);

      toolLogReaderEvents.readFailure(this.logger, error instanceof Error ? error : new Error(errorMessage), {
        toolName: 'dev-logs',
        appId,
        target,
        operation: 'read',
      });

      return {
        success: false,
        output: `**Unexpected error reading logs**: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Format the result for agent consumption
   */
  formatForAgent(result: DevLogsResult): string {
    if (!result.success) {
      return `Log reading failed: ${result.error || 'Unknown error'}`;
    }

    let response = result.output;

    // Add metadata for the agent
    if (result.totalLogs !== undefined) {
      response += `\n\n_Total log entries: ${result.totalLogs}_`;
    }

    return response;
  }
}
