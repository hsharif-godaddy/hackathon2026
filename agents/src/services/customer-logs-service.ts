import type { AppRepository } from '../database/repositories/AppRepository.js';
import { createForWorkspace, type WorkspaceClient, type CreateForWorkspace } from '../workspace/index.js';
import type { LogEntry as WorkspaceLogEntry } from '../workspace/diagnostics.js';
import type { LogEntry as WireLogEntry } from './DevSupervisorClient.js';
import { LogSanitizer, type SanitizedLogEntry } from './log-sanitizer.js';
import { Logger } from '../logging/index.js';
import { getErrorMessage } from '../utils/error.js';

/**
 * Request parameters for fetching customer logs
 */
export interface CustomerLogsRequest {
  appId: string;
  target: 'preview' | 'publish';
  since?: string;
  lines?: number;
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
  success: boolean;
  logs: SanitizedLogEntry[];
  total: number;
  error?: string;
  code?: string;
}

/** Options for getPreviewLogs/getPublishLogs convenience methods */
export interface LogFetchOptions {
  since?: string;
  /**
   * Restrict upstream log fetch to specific sources. `stdout`/`stderr` are
   * the managed dev-server's streams; `exec` is output from one-shot
   * /exec commands (install/build during zip-upload). Customer-facing
   * callers typically omit this or pass `['stdout', 'stderr']`. Diagnose
   * passes `['stdout', 'stderr', 'exec']` when triaging the preview
   * container to catch build failures.
   */
  sources?: Array<'stdout' | 'stderr' | 'exec'>;
  lines?: number;
}

export const DEFAULT_MAX_LINES = 500;
export const MAX_LINES = parseInt(process.env.CUSTOMER_LOGS_MAX_LINES || '', 10) || DEFAULT_MAX_LINES;
const DEFAULT_LINES = 100;
const VALID_TARGETS = ['preview', 'publish'] as const;
const VALID_SOURCES = ['stdout', 'stderr', 'exec'] as const;
/**
 * Default `sources` for getLogs when the caller does not specify one.
 * Restricts the upstream request to the managed-process streams so
 * /exec orchestration output (dev-supervisor Source="exec") stays out
 * of customer-facing surfaces and agent LLM tool context.
 */
const DEFAULT_CUSTOMER_SOURCES: Array<'stdout' | 'stderr'> = ['stdout', 'stderr'];

export class CustomerLogsService {
  private logger = Logger.create({ component: 'customer-logs-service' });
  private createWorkspace: CreateForWorkspace;

  constructor(
    private appRepository: AppRepository,
    private logSanitizer: LogSanitizer,
    workspaceFactory?: CreateForWorkspace
  ) {
    this.createWorkspace = workspaceFactory ?? createForWorkspace;
  }

  async getLogs(request: CustomerLogsRequest): Promise<CustomerLogsResponse> {
    const startTime = Date.now();

    const validationError = this.validateRequest(request);
    if (validationError) {
      return validationError;
    }

    const { appId, target, lines = DEFAULT_LINES, sources, since } = request;

    this.logger.info('customer_logs.fetch.begin', { appId, target, lines, sources });

    try {
      const app = this.appRepository.findById(appId);
      if (!app) {
        return this.errorResponse('App not found', 'APP_NOT_FOUND');
      }

      const workspace: WorkspaceClient | null = this.createWorkspace(appId, target);
      if (!workspace) {
        return this.errorResponse(
          `${target === 'publish' ? 'Publish' : 'Preview'} supervisor not configured for this app`,
          'SUPERVISOR_NOT_CONFIGURED'
        );
      }

      const { rawCount, sanitizedLogs } = await this.getSanitizedLogs(
        workspace,
        lines,
        since,
        sources
      );

      const executionTime = Date.now() - startTime;
      this.logger.info('customer_logs.fetch.success', {
        appId,
        target,
        rawCount,
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

      if (isConnectionError(error)) {
        return this.errorResponse(
          `${target === 'publish' ? 'Publish' : 'Preview'} supervisor unavailable`,
          'SUPERVISOR_UNAVAILABLE'
        );
      }
      return this.errorResponse('Failed to fetch logs', 'FETCH_ERROR');
    }
  }

  /**
   * Fan out log fetches across an explicit source list, merge, sort,
   * tail-keep the requested line count, then sanitize.
   *
   * Trims with slice(-lines), not slice(0, lines): failure signals
   * cluster at the end of long runs, so preserving the newest entries
   * after merging across sources is what callers actually need.
   */
  private async getSanitizedLogs(
    workspace: WorkspaceClient,
    lines: number,
    since?: string,
    sources?: Array<'stdout' | 'stderr' | 'exec'>
  ): Promise<{ rawCount: number; sanitizedLogs: SanitizedLogEntry[] }> {
    const effectiveSources = sources && sources.length > 0 ? sources : DEFAULT_CUSTOMER_SOURCES;
    const cappedLines: number = Math.min(lines, MAX_LINES);
    const sinceDate: Date | undefined = since ? new Date(since) : undefined;

    const logPromises = effectiveSources.map(src =>
      workspace.diagnostics.logs({ source: src, lines: cappedLines, since: sinceDate })
    );
    const logsArrays = await Promise.all(logPromises);
    const rawLogs: WorkspaceLogEntry[] = logsArrays.flat();
    rawLogs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const trimmed: WorkspaceLogEntry[] = rawLogs.slice(-cappedLines);
    const wireEntries: WireLogEntry[] = trimmed.map(entry => ({
      timestamp: entry.timestamp.toISOString(),
      source: entry.source,
      level: entry.level,
      message: entry.message,
    }));
    const sanitizedLogs: SanitizedLogEntry[] = this.logSanitizer.sanitizeLogs(wireEntries);

    return { rawCount: rawLogs.length, sanitizedLogs };
  }

  async getPreviewLogs(appId: string, options: LogFetchOptions = {}): Promise<CustomerLogsResponse> {
    return this.getLogs({
      appId,
      target: 'preview',
      since: options.since,
      sources: options.sources,
      lines: options.lines
    });
  }

  async getPublishLogs(appId: string, options: LogFetchOptions = {}): Promise<CustomerLogsResponse> {
    return this.getLogs({
      appId,
      target: 'publish',
      since: options.since,
      sources: options.sources,
      lines: options.lines
    });
  }

  private validateRequest(request: CustomerLogsRequest): CustomerLogsResponse | null {
    const { appId, target, sources, since, lines } = request;

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

const CONNECTION_CODES: ReadonlySet<string> = new Set(['ECONNREFUSED', 'ENOENT', 'ECONNRESET', 'ETIMEDOUT']);

function isConnectionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code: unknown = (err as Record<string, unknown>).code;
  if (typeof code === 'string' && CONNECTION_CODES.has(code)) return true;
  const msg: string = err instanceof Error ? err.message : '';
  return msg.includes('not available at') || msg.includes('connection refused');
}
