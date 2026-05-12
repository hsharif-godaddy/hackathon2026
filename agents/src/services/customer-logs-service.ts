import type { AppRepository } from '../database/repositories/AppRepository.js';
import { DevSupervisorClient, type LogOptions, type LogEntry } from './DevSupervisorClient.js';
import { LogSanitizer, type SanitizedLogEntry } from './log-sanitizer.js';
import { Logger } from '../logging/index.js';
import { getErrorMessage } from '../utils/error.js';

/**
 * Request parameters for fetching customer logs
 */
export interface CustomerLogsRequest {
  /** App ID to fetch logs for (required) */
  appId: string;
  /** Target environment: preview or publish (required) */
  target: 'preview' | 'publish';
  /** Fetch logs since this ISO 8601 timestamp (optional - if not provided, returns latest logs) */
  since?: string;
  /** Number of log lines to fetch (optional, default: 100, max: configurable) */
  lines?: number;
  /** Filter by output sources - supports multiple values. If not provided, returns all sources */
  /**
   * Restrict upstream log fetch to specific sources. `stdout`/`stderr` are
   * the managed dev-server's streams; `exec` is output from one-shot
   * /exec commands (install/build during zip-upload). Customer-facing
   * callers typically omit this or pass `['stdout', 'stderr']`. Diagnose
   * passes `['stdout', 'stderr', 'exec']` when triaging the preview
   * container to catch build failures.
   */
  sources?: Array<'stdout' | 'stderr' | 'exec'>;
}

/**
 * Response containing sanitized logs
 */
export interface CustomerLogsResponse {
  /** Whether the request succeeded */
  success: boolean;
  /** Sanitized log entries */
  logs: SanitizedLogEntry[];
  /** Total number of logs returned */
  total: number;
  /** Error message if request failed */
  error?: string;
  /** Error code for programmatic handling */
  code?: string;
}

/** Options for getPreviewLogs/getPublishLogs convenience methods */
export interface LogFetchOptions {
  /** Fetch logs since this ISO 8601 timestamp (optional - if not provided, returns latest logs) */
  since?: string;
  /** Filter by output sources - supports multiple values. If not provided, returns all sources */
  /**
   * Restrict upstream log fetch to specific sources. `stdout`/`stderr` are
   * the managed dev-server's streams; `exec` is output from one-shot
   * /exec commands (install/build during zip-upload). Customer-facing
   * callers typically omit this or pass `['stdout', 'stderr']`. Diagnose
   * passes `['stdout', 'stderr', 'exec']` when triaging the preview
   * container to catch build failures.
   */
  sources?: Array<'stdout' | 'stderr' | 'exec'>;
  /** Number of log lines to fetch (optional) */
  lines?: number;
}

// Configurable via ENV var, default 500 - exported for route layer to use
export const DEFAULT_MAX_LINES = 500;
export const MAX_LINES = parseInt(process.env.CUSTOMER_LOGS_MAX_LINES || '', 10) || DEFAULT_MAX_LINES;
const DEFAULT_LINES = 100;
const VALID_TARGETS = ['preview', 'publish'] as const;
const VALID_SOURCES = ['stdout', 'stderr', 'exec'] as const;
/**
 * Default `sources` for getLogs when the caller does not specify one.
 * Restricts the upstream request to the managed-process streams so
 * /exec orchestration output (dev-supervisor Source="exec") stays out
 * of customer-facing surfaces and agent LLM tool context. Callers that
 * need exec/system entries (e.g. diagnose triaging a failed build) must
 * opt in by passing `sources` explicitly.
 */
const DEFAULT_CUSTOMER_SOURCES: Array<'stdout' | 'stderr'> = ['stdout', 'stderr'];

/** Factory function type for creating DevSupervisorClient instances */
type DevSupervisorClientFactory = (socketPath: string) => DevSupervisorClient;

/**
 * Service for fetching and sanitizing customer-facing deployment logs
 *
 * This service provides logs from preview and publish containers
 * with proper sanitization to remove sensitive information.
 */
export class CustomerLogsService {
  private logger = Logger.create({ component: 'customer-logs-service' });

  constructor(
    private appRepository: AppRepository,
    private logSanitizer: LogSanitizer,
    private clientFactory?: DevSupervisorClientFactory
  ) {}

  /**
   * Fetch logs for a customer app
   */
  async getLogs(request: CustomerLogsRequest): Promise<CustomerLogsResponse> {
    const startTime = Date.now();

    // Validate request
    const validationError = this.validateRequest(request);
    if (validationError) {
      return validationError;
    }

    const { appId, target, lines = DEFAULT_LINES, sources, since } = request;

    this.logger.info('customer_logs.fetch.begin', { appId, target, lines, sources });

    try {
      // Find the app
      const app = this.appRepository.findById(appId);
      if (!app) {
        return this.errorResponse('App not found', 'APP_NOT_FOUND');
      }

      // Get the appropriate supervisor path
      const supervisorPath = target === 'publish' ? app.publishSupervisorPath : app.socketPath;
      if (!supervisorPath) {
        return this.errorResponse(
          `${target === 'publish' ? 'Publish' : 'Preview'} supervisor not configured for this app`,
          'SUPERVISOR_NOT_CONFIGURED'
        );
      }

      // Create DevSupervisor client
      const client = this.createClient(supervisorPath);
      if (!client.isAvailable()) {
        return this.errorResponse(
          `${target === 'publish' ? 'Publish' : 'Preview'} supervisor unavailable`,
          'SUPERVISOR_UNAVAILABLE'
        );
      }

      // Build log options
      const logOptions: LogOptions = {
        lines: Math.min(lines, MAX_LINES),
      };

      if (since) {
        logOptions.since = since;
      }

      const { rawLogs, sanitizedLogs } = await this.getSanitizedLogs(client, logOptions, sources);

      const executionTime = Date.now() - startTime;
      this.logger.info('customer_logs.fetch.success', {
        appId,
        target,
        rawCount: rawLogs.length,
        sanitizedCount: sanitizedLogs.length,
        executionTime
      });

      return {
        success: true,
        logs: sanitizedLogs,
        total: sanitizedLogs.length
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.logger.error('customer_logs.fetch.failure', {
        appId,
        target,
        error: getErrorMessage(error),
        executionTime
      });

      return this.errorResponse('Failed to fetch logs', 'FETCH_ERROR');
    }
  }

  /**
   * Fan out log fetches across an explicit source list, merge, sort,
   * sanitize, and tail-keep the requested line count.
   *
   * Always scope to an explicit source list — never an unfiltered
   * request — so orchestration output (dev-supervisor Source="exec")
   * and health-monitor entries never leak into the customer-facing
   * response. When the caller omits `sources`, fall back to the
   * managed-process defaults; callers that need other sources
   * (diagnose for /exec triage) must opt in explicitly.
   *
   * Trims with slice(-lines), not slice(0, lines): failure signals
   * (build errors, stack traces, exit messages) cluster at the end of
   * long runs, so preserving the newest entries after merging across
   * sources is what callers actually need.
   */
  private async getSanitizedLogs(
    client: DevSupervisorClient,
    logOptions: LogOptions,
    sources?: Array<'stdout' | 'stderr' | 'exec'>
  ): Promise<{ rawLogs: LogEntry[]; sanitizedLogs: SanitizedLogEntry[] }> {
    const effectiveSources = sources && sources.length > 0 ? sources : DEFAULT_CUSTOMER_SOURCES;
    const logPromises = effectiveSources.map(src =>
      client.getLogs({ ...logOptions, source: src })
    );
    const logsArrays = await Promise.all(logPromises);
    const rawLogs: LogEntry[] = logsArrays.flat();
    rawLogs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const sanitized = this.logSanitizer.sanitizeLogs(rawLogs);
    const sanitizedLogs = logOptions.lines ? sanitized.slice(-logOptions.lines) : sanitized;

    return { rawLogs, sanitizedLogs };
  }

  /**
   * Convenience method to fetch preview logs
   */
  async getPreviewLogs(appId: string, options: LogFetchOptions = {}): Promise<CustomerLogsResponse> {
    return this.getLogs({
      appId,
      target: 'preview',
      since: options.since,
      sources: options.sources,
      lines: options.lines
    });
  }

  /**
   * Convenience method to fetch publish logs
   */
  async getPublishLogs(appId: string, options: LogFetchOptions = {}): Promise<CustomerLogsResponse> {
    return this.getLogs({
      appId,
      target: 'publish',
      since: options.since,
      sources: options.sources,
      lines: options.lines
    });
  }

  /**
   * Validate the request parameters
   */
  private validateRequest(request: CustomerLogsRequest): CustomerLogsResponse | null {
    const { appId, target, sources, since, lines } = request;

    // Validate required parameters
    if (!appId || appId.trim() === '') {
      return this.errorResponse('appId is required', 'INVALID_APP_ID');
    }

    if (!target) {
      return this.errorResponse(
        `target is required. Must be one of: ${VALID_TARGETS.join(', ')}`,
        'MISSING_TARGET'
      );
    }

    if (!VALID_TARGETS.includes(target)) {
      return this.errorResponse(
        `Invalid target: must be one of ${VALID_TARGETS.join(', ')}`,
        'INVALID_TARGET'
      );
    }

    // Validate sources array if provided
    if (sources) {
      const invalidSources = sources.filter(s => !VALID_SOURCES.includes(s as typeof VALID_SOURCES[number]));
      if (invalidSources.length > 0) {
        return this.errorResponse(
          `Invalid source value(s): ${invalidSources.join(', ')}. Valid values: ${VALID_SOURCES.join(', ')}`,
          'INVALID_SOURCE'
        );
      }
    }

    if (lines !== undefined && (typeof lines !== 'number' || lines < 1)) {
      return this.errorResponse('lines must be a positive number', 'INVALID_LINES');
    }

    if (lines !== undefined && lines > MAX_LINES) {
      return this.errorResponse(
        `lines exceeds maximum allowed value. Maximum: ${MAX_LINES}`,
        'INVALID_LINES'
      );
    }

    // Validate since timestamp format if provided
    if (since) {
      const date = new Date(since);
      if (isNaN(date.getTime())) {
        return this.errorResponse(
          'Invalid since timestamp: must be ISO 8601 format',
          'INVALID_TIMESTAMP'
        );
      }
    }

    return null;
  }

  /**
   * Create a DevSupervisorClient for the given path
   */
  private createClient(socketPath: string): DevSupervisorClient {
    if (this.clientFactory) {
      return this.clientFactory(socketPath);
    }
    return new DevSupervisorClient(socketPath);
  }

  /**
   * Create an error response
   */
  private errorResponse(error: string, code: string): CustomerLogsResponse {
    return {
      success: false,
      logs: [],
      total: 0,
      error,
      code
    };
  }
}
