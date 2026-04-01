import { DevSupervisorLogClient } from './dev-supervisor-log-client.js';
import { Logger } from '../logging/index.js';
import { getErrorMessage } from '../utils/error.js';
import { toolLogReaderEvents } from '../logging/events/index.js';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { DevSupervisorClientFactory } from '../utils/dev-supervisor-client-factory.js';

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
 * High-level agent tool for the 'view_logs' command.
 * Provides easy access to development server logs for debugging and monitoring.
 * Integrates with dev-supervisor to read real-time logs from running development processes.
 */
export class ViewLogsTool {
  private logger: Logger;
  private logClient?: DevSupervisorLogClient;
  private appRepository: AppRepository;

  constructor() {
    this.logger = Logger.create({ component: 'view-logs-tool' });
    this.appRepository = new AppRepository();
  }

  /**
   * Initialize the tool with the current app context
   */
  private initializeForApp(appId: string, target: 'preview' | 'publish' = 'preview'): boolean {
    try {
      if (target === 'publish') {
        const app = this.appRepository.findById(appId);
        if (!app?.publishSupervisorPath) {
          this.logger.warn('dev_logs.init.failure', {
            appId,
            target,
            error: 'No publishSupervisorPath configured'
          });
          return false;
        }
        this.logClient = new DevSupervisorLogClient(app.publishSupervisorPath);
        return this.logClient.isAvailable();
      }

      // Preview (default): use the factory to get proper connection path
      const appInfo = DevSupervisorClientFactory.getAppInfo(appId);

      if (!appInfo || !appInfo.socketPath) {
        this.logger.warn('dev_logs.init.failure', {
          appId,
          target,
          error: 'App not found or connection path not configured'
        });
        return false;
      }

      this.logClient = new DevSupervisorLogClient(appInfo.socketPath);
      return this.logClient.isAvailable();
    } catch (error) {
      this.logger.warn('dev_logs.init.failure', {
        appId,
        target,
        error: getErrorMessage(error)
      });
      return false;
    }
  }

  /**
   * Read development logs with intelligent defaults
   */
  async readLogs(appId: string, options: DevLogsOptions = {}): Promise<DevLogsResult> {
    const startTime = Date.now();
    
    const target = options.target || 'preview';

    const beginData: { toolName: string; appId?: string; target?: string; source?: 'stdout' | 'stderr'; lines?: number; since?: string; format?: boolean } = {
      toolName: 'dev-logs',
      appId,
      target,
    };

    if (options.source) beginData.source = options.source;
    if (options.lines) beginData.lines = options.lines;
    if (options.since) beginData.since = options.since;

    toolLogReaderEvents.readBegin(this.logger, beginData);

    try {

      // Initialize log reader for this app
      const initialized = this.initializeForApp(appId, target);

      if (!initialized || !this.logClient) {
        const label = target === 'publish' ? 'Publish' : 'Preview';
        return {
          success: false,
          output: `🚫 **${label} logs not available**\n\nThe ${label.toLowerCase()} server may not be running, or log monitoring is not configured for this app.`,
          error: `${label} supervisor not available for this app`
        };
      }

      // Handle summary request
      if (options.summary) {
        const summaryResult = await this.logClient.getLogSummary();
        
        if (!summaryResult.success) {
          return {
            success: false,
            output: `❌ **Failed to get log summary**: ${summaryResult.error}`,
            error: summaryResult.error || 'Unknown error'
          };
        }

        const output = summaryResult.summary 
          ? this.logClient.formatLogSummary(summaryResult.summary)
          : '📊 **No logs found** - The development server may have just started or logs may have been cleared.';

        const executionTime = Date.now() - startTime;
        
        toolLogReaderEvents.readSuccess(this.logger, {
          toolName: 'dev-logs',
          appId,
          target,
          operation: 'read',
          resultStats: {
            success: true,
            totalEntries: summaryResult.summary?.totalLogs || 0,
            executionTime
          }
        });

        return {
          success: true,
          output,
          totalLogs: summaryResult.summary?.totalLogs || 0
        };
      }

      // Default to recent logs with sensible defaults
      const lines = Math.min(options.lines || 50, 1000); // Default 50, max 1000
      
      const readOptions: any = {
        lines,
        format: true
      };
      
      // Only add optional parameters if they have values
      if (options.source) readOptions.source = options.source;
      if (options.since) readOptions.since = options.since;

      const result = await this.logClient.readLogs(readOptions);

      if (!result.success) {
        return {
          success: false,
          output: `❌ **Failed to read logs**: ${result.error}`,
          error: result.error || 'Unknown error'
        };
      }

      // Use formatted output if available, otherwise create a simple message
      let output = result.formatted || '📝 **No recent logs found**\n\nThe development server may have just started or there may be no recent activity.';
      
      // Add helpful context if no logs found
      if (result.totalEntries === 0) {
        output += '\n\n💡 **Tip**: Try using `source: "stderr"` to see error logs, or increase the `lines` parameter to see more history.';
      }

      const executionTime = Date.now() - startTime;
      
      const successData: any = {
        toolName: 'dev-logs',
        appId,
        target,
        operation: 'read',
        logOptions: readOptions,
        resultStats: {
          success: true,
          totalEntries: result.totalEntries,
          linesRequested: lines,
          executionTime
        }
      };
      
      // Only add defined values to resultStats
      if (options.source) successData.resultStats.sourceFilter = options.source;
      if (options.since) successData.resultStats.sinceFilter = options.since;
      
      toolLogReaderEvents.readSuccess(this.logger, successData);

      return {
        success: true,
        output,
        totalLogs: result.totalEntries
      };

    } catch (error) {
      const errorMessage = getErrorMessage(error);
      
      toolLogReaderEvents.readFailure(this.logger, error instanceof Error ? error : new Error(errorMessage), {
        toolName: 'dev-logs',
        appId,
        target,
        operation: 'read'
      });

      return {
        success: false,
        output: `❌ **Unexpected error reading logs**: ${errorMessage}`,
        error: errorMessage
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
