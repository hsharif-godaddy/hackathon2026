import { DevSupervisorClient, createDevSupervisorClient, LogOptions, LogEntry } from '../services/DevSupervisorClient.js';
import { Logger } from '../logging/index.js';
import { getErrorMessage } from '../utils/error.js';
import { toolLogReaderEvents } from '../logging/events/index.js';

export interface LogReaderOptions {
  /** Source filter (stdout, stderr) */
  source?: 'stdout' | 'stderr';
  /** Number of lines to retrieve (default: 100) */
  lines?: number;
  /** Since timestamp (ISO 8601 format) */
  since?: string;
  /** Format output for display (default: true) */
  format?: boolean;
}

export interface LogReaderResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Log entries retrieved */
  logs: LogEntry[];
  /** Total number of log entries found */
  totalEntries: number;
  /** Error message if operation failed */
  error?: string;
  /** Formatted log output (if format=true) */
  formatted?: string;
  /** Source that was filtered on */
  source?: string;
  /** Number of lines requested */
  linesRequested?: number;
  /** Timestamp filter that was applied */
  sinceFilter?: string;
}

/**
 * Tool for reading logs from dev-supervisor service
 */
export class LogReaderTool {
  private devSupervisor?: DevSupervisorClient | null;
  private logger: Logger;

  constructor(socketPath?: string) {
    this.logger = Logger.create({ service: 'log-reader-tool' });
    
    // Only create dev-supervisor client if explicit socket path is provided
    if (socketPath) {
      this.devSupervisor = createDevSupervisorClient(socketPath);
    } else {
      this.devSupervisor = null;
    }
  }

  /**
   * Check if dev-supervisor is available for log reading
   */
  isAvailable(): boolean {
    return this.devSupervisor?.isAvailable() ?? false;
  }

  /**
   * Read logs from dev-supervisor
   */
  async readLogs(options: LogReaderOptions = {}): Promise<LogReaderResult> {
    const startTime = Date.now();
    
    const beginData: { toolName: string; appId?: string; source?: 'stdout' | 'stderr'; lines?: number; since?: string; format?: boolean } = {
      toolName: 'log-reader',
    };
    
    if (options.source) beginData.source = options.source;
    if (options.lines) beginData.lines = options.lines;
    if (options.since) beginData.since = options.since;
    if (options.format !== undefined) beginData.format = options.format;
    
    toolLogReaderEvents.readBegin(this.logger, beginData);

    try {
      // Check if dev-supervisor is available
      if (!this.devSupervisor) {
        return {
          success: false,
          logs: [],
          totalEntries: 0,
          error: 'Dev-supervisor client not initialized. Socket path required.',
        };
      }

      if (!this.isAvailable()) {
        return {
          success: false,
          logs: [],
          totalEntries: 0,
          error: 'Dev-supervisor is not available or not running.',
        };
      }

      // Prepare log options for dev-supervisor
      const logOptions: LogOptions = {};
      
      if (options.source) {
        logOptions.source = options.source;
      }
      
      if (options.lines && options.lines > 0) {
        logOptions.lines = Math.min(options.lines, 1000); // Cap at 1k lines for safety
      }
      
      if (options.since) {
        // Validate ISO 8601 format
        const date = new Date(options.since);
        if (isNaN(date.getTime())) {
          return {
            success: false,
            logs: [],
            totalEntries: 0,
            error: 'Invalid since timestamp format. Use ISO 8601 format (e.g., 2024-01-01T00:00:00Z)',
          };
        }
        logOptions.since = options.since;
      }

      // Get logs from dev-supervisor
      const logs = await this.devSupervisor.getLogs(logOptions);

      const result: LogReaderResult = {
        success: true,
        logs,
        totalEntries: logs.length,
        ...(options.source && { source: options.source }),
        ...(options.lines && { linesRequested: options.lines }),
        ...(options.since && { sinceFilter: options.since }),
      };

      // Format logs if requested (default: true)
      if (options.format !== false) {
        result.formatted = this.formatLogs(logs, options);
      }

      const executionTime = Date.now() - startTime;
      
      const successData: any = {
        toolName: 'log-reader',
        operation: 'read',
        logOptions: {},
        resultStats: {
          success: true,
          totalEntries: logs.length,
          executionTime
        }
      };
      
      // Only add defined values to logOptions
      if (options.source) successData.logOptions.source = options.source;
      if (options.lines) successData.logOptions.lines = options.lines;
      if (options.since) successData.logOptions.since = options.since;
      if (options.format !== undefined) successData.logOptions.format = options.format;
      
      // Only add defined values to resultStats
      if (options.lines) successData.resultStats.linesRequested = options.lines;
      if (options.source) successData.resultStats.sourceFilter = options.source;
      if (options.since) successData.resultStats.sinceFilter = options.since;
      
      toolLogReaderEvents.readSuccess(this.logger, successData);

      return result;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      
      toolLogReaderEvents.readFailure(this.logger, error instanceof Error ? error : new Error(errorMessage), {
        toolName: 'log-reader',
        operation: 'read'
      });

      return {
        success: false,
        logs: [],
        totalEntries: 0,
        error: errorMessage,
      };
    }
  }

  /**
   * Read recent logs (convenience method)
   */
  async readRecentLogs(lines = 50, source?: 'stdout' | 'stderr'): Promise<LogReaderResult> {
    const options: LogReaderOptions = {
      lines,
      format: true,
    };
    
    if (source) {
      options.source = source;
    }
    
    return this.readLogs(options);
  }

  /**
   * Read logs since a specific time (convenience method)
   */
  async readLogsSince(since: string, source?: 'stdout' | 'stderr'): Promise<LogReaderResult> {
    const options: LogReaderOptions = {
      since,
      format: true,
    };
    
    if (source) {
      options.source = source;
    }
    
    return this.readLogs(options);
  }

  /**
   * Read error logs only (convenience method)
   */
  async readErrorLogs(lines = 100): Promise<LogReaderResult> {
    return this.readLogs({
      lines,
      source: 'stderr',
      format: true,
    });
  }

  /**
   * Read output logs only (convenience method)
   */
  async readOutputLogs(lines = 100): Promise<LogReaderResult> {
    return this.readLogs({
      lines,
      source: 'stdout',
      format: true,
    });
  }

  /**
   * Format log entries for display
   */
  private formatLogs(logs: LogEntry[], options: LogReaderOptions): string {
    if (logs.length === 0) {
      return 'No logs found.';
    }

    const lines: string[] = [];
    
    // Add header with filter information
    const filters: string[] = [];
    if (options.source) {
      filters.push(`source: ${options.source}`);
    }
    if (options.lines) {
      filters.push(`lines: ${options.lines}`);
    }
    if (options.since) {
      filters.push(`since: ${options.since}`);
    }
    
    if (filters.length > 0) {
      lines.push(`📋 **Log Filters:** ${filters.join(', ')}`);
      lines.push('');
    }

    lines.push(`📊 **Total Entries:** ${logs.length}`);
    lines.push('');
    lines.push('📝 **Log Entries:**');
    lines.push('```');

    // Format each log entry
    for (const entry of logs) {
      const timestamp = new Date(entry.timestamp).toISOString();
      const source = this.formatSource(entry.source);
      const level = entry.level ? ` [${entry.level.toUpperCase()}]` : '';
      const message = entry.message.trim();

      lines.push(`${timestamp}${level} ${source} ${message}`);
    }

    lines.push('```');

    return lines.join('\n');
  }

  /**
   * Format log source with appropriate emoji
   */
  private formatSource(source: string): string {
    switch (source.toLowerCase()) {
      case 'stdout':
        return '📤';
      case 'stderr':
        return '🚨';
      default:
        return '📝';
    }
  }

  /**
   * Get a summary of available logs
   */
  async getLogSummary(): Promise<{
    success: boolean;
    summary?: {
      totalLogs: number;
      sources: { [key: string]: number };
      levels: { [key: string]: number };
      oldestEntry?: string;
      newestEntry?: string;
    };
    error?: string;
  }> {
    const startTime = Date.now();
    
    toolLogReaderEvents.summaryBegin(this.logger, {
      toolName: 'log-reader'
    });
    
    try {
      if (!this.isAvailable()) {
        return {
          success: false,
          error: 'Dev-supervisor is not available or not running.',
        };
      }

      // Get all logs to analyze
      const logs = await this.devSupervisor!.getLogs({});
      
      if (logs.length === 0) {
        return {
          success: true,
          summary: {
            totalLogs: 0,
            sources: {},
            levels: {},
          },
        };
      }

      // Analyze logs
      const sources: { [key: string]: number } = {};
      const levels: { [key: string]: number } = {};
      
      for (const log of logs) {
        // Count sources
        sources[log.source] = (sources[log.source] || 0) + 1;
        
        // Count levels
        if (log.level) {
          levels[log.level] = (levels[log.level] || 0) + 1;
        }
      }

      // Find oldest and newest entries
      const timestamps = logs.map(log => new Date(log.timestamp));
      const oldestEntry = new Date(Math.min(...timestamps.map(d => d.getTime()))).toISOString();
      const newestEntry = new Date(Math.max(...timestamps.map(d => d.getTime()))).toISOString();

      const executionTime = Date.now() - startTime;
      
      toolLogReaderEvents.summarySuccess(this.logger, {
        toolName: 'log-reader',
        operation: 'summary',
        resultStats: {
          success: true,
          totalEntries: logs.length,
          executionTime
        }
      });

      return {
        success: true,
        summary: {
          totalLogs: logs.length,
          sources,
          levels,
          oldestEntry,
          newestEntry,
        },
      };
    } catch (error) {
      toolLogReaderEvents.summaryFailure(this.logger, error instanceof Error ? error : new Error(getErrorMessage(error)), {
        toolName: 'log-reader',
        operation: 'summary'
      });
      
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  /**
   * Format the log summary for display
   */
  formatLogSummary(summary: {
    totalLogs: number;
    sources: { [key: string]: number };
    levels: { [key: string]: number };
    oldestEntry?: string;
    newestEntry?: string;
  }): string {
    const lines: string[] = [];
    
    lines.push('📊 **Log Summary**');
    lines.push('');
    lines.push(`📈 **Total Logs:** ${summary.totalLogs}`);
    
    if (summary.oldestEntry && summary.newestEntry) {
      lines.push(`⏰ **Time Range:** ${summary.oldestEntry} to ${summary.newestEntry}`);
    }
    
    lines.push('');
    
    // Sources breakdown
    if (Object.keys(summary.sources).length > 0) {
      lines.push('📂 **Sources:**');
      for (const [source, count] of Object.entries(summary.sources)) {
        const emoji = this.formatSource(source);
        lines.push(`  ${emoji} ${source}: ${count}`);
      }
      lines.push('');
    }
    
    // Levels breakdown
    if (Object.keys(summary.levels).length > 0) {
      lines.push('🏷️ **Log Levels:**');
      for (const [level, count] of Object.entries(summary.levels)) {
        lines.push(`  • ${level}: ${count}`);
      }
    }
    
    return lines.join('\n');
  }
}