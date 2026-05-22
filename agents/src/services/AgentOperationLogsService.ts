import { ImportJobRepository } from '../database/repositories/ImportJobRepository.js';
import { Logger } from '../logging/index.js';
import type { ImportJob, ValidationError } from '../types/import.js';
import type { LogSanitizer, SanitizedLogEntry } from './log-sanitizer.js';

export interface AgentOperationLogsRequest {
  appId: string;
  /** ISO 8601 timestamp — align with diagnose log-fetch window */
  since: string;
  /** Maximum log lines to return (default 500) */
  lines?: number;
}

export interface AgentOperationLogsResponse {
  logs: SanitizedLogEntry[];
  total: number;
  source: 'import_job' | 'none';
  /** Stage from the latest failed import attempt (when source is import_job) */
  errorStage?: string;
  /** Host path to preserved project files for diagnose (failed imports) */
  diagnoseSnapshotPath?: string;
  detectedPackageManager?: 'npm' | 'yarn' | 'pnpm';
}

/**
 * Import pipeline stages whose failures are recorded on the agent (validation,
 * install, build, git commit, etc.). Diagnose should read import_jobs for these.
 */
const IMPORT_PIPELINE_FAILURE_STAGES = new Set([
  'pending',
  'creating_container',
  'extracting',
  'validating',
  'copying',
  'installing',
  'building',
  'committing',
  'pushing',
  'pulling',
]);

/**
 * Use agent-persisted import logs for validation/build (and other pipeline) failures.
 * Use customer container logs for runtime failures (e.g. restart / serving).
 */
export function shouldUseAgentImportLogs(agentLogs: AgentOperationLogsResponse): boolean {
  if (agentLogs.logs.length === 0 || agentLogs.source !== 'import_job') {
    return false;
  }
  if (!agentLogs.errorStage) {
    return false;
  }
  return IMPORT_PIPELINE_FAILURE_STAGES.has(agentLogs.errorStage);
}

const DEFAULT_MAX_LINES = 500;

const logger = Logger.create({ component: 'agent-operation-logs-service' });

/**
 * Surfaces agent-persisted failure output from the latest failed import attempt.
 * PaaSDiagnoseService uses this for validation/build failures; runtime failures
 * use dev-supervisor customer logs instead.
 */
export class AgentOperationLogsService {
  private readonly importJobRepo: ImportJobRepository;
  private readonly logSanitizer: LogSanitizer;
  private readonly defaultMaxLines: number;

  constructor(
    importJobRepo: ImportJobRepository,
    logSanitizer: LogSanitizer,
    options?: { defaultMaxLines?: number }
  ) {
    this.importJobRepo = importJobRepo;
    this.logSanitizer = logSanitizer;
    this.defaultMaxLines = options?.defaultMaxLines ?? DEFAULT_MAX_LINES;
  }

  async getFailureLogs(request: AgentOperationLogsRequest): Promise<AgentOperationLogsResponse> {
    const maxLines = request.lines ?? this.defaultMaxLines;
    const since = new Date(request.since);

    if (Number.isNaN(since.getTime())) {
      logger.warn('agent_operation_logs.invalid_since', {
        appId: request.appId,
        since: request.since,
      });
      return { logs: [], total: 0, source: 'none' };
    }

    const job = await this.importJobRepo.findRecentFailedByAppId(request.appId, since);
    if (!job) {
      return { logs: [], total: 0, source: 'none' };
    }

    const timestamp = (job.completedAt ?? job.updatedAt).toISOString();
    const rawLines = this.buildRawLines(job);
    const logs = this.toSanitizedEntries(rawLines, timestamp, maxLines);

    logger.info('agent_operation_logs.fetched', {
      appId: request.appId,
      jobId: job.id,
      lineCount: logs.length,
    });

    return {
      logs,
      total: logs.length,
      source: 'import_job',
      errorStage: job.errorStage,
      diagnoseSnapshotPath: job.diagnoseSnapshotPath,
      detectedPackageManager: job.detectedPackageManager,
    };
  }

  private buildRawLines(job: ImportJob): Array<{ message: string; level: 'info' | 'warn' | 'error' }> {
    const lines: Array<{ message: string; level: 'info' | 'warn' | 'error' }> = [];

    if (job.errorStage) {
      lines.push({
        message: `[agent/import] failed at stage: ${job.errorStage}`,
        level: 'error',
      });
    }

    if (job.errorMessage) {
      lines.push({
        message: `[agent/import] ${job.errorMessage}`,
        level: 'error',
      });
    }

    if (job.validationErrors) {
      const errors = this.parseValidationErrors(job.validationErrors);
      for (const err of errors) {
        lines.push({
          message: `[agent/import:validation] ${err.key}: ${err.message}`,
          level: 'error',
        });
      }
    }

    if (job.installOutput) {
      for (const line of job.installOutput.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        lines.push({
          message: `[agent/import:install] ${trimmed}`,
          level: this.inferLevel(trimmed),
        });
      }
    }

    if (job.buildOutput) {
      for (const line of job.buildOutput.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        lines.push({
          message: `[agent/import:build] ${trimmed}`,
          level: this.inferLevel(trimmed),
        });
      }
    }

    return lines;
  }

  private parseValidationErrors(raw: string): ValidationError[] {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item): item is ValidationError =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as ValidationError).key === 'string' &&
          typeof (item as ValidationError).message === 'string'
      );
    } catch {
      return [];
    }
  }

  private inferLevel(message: string): 'info' | 'warn' | 'error' {
    const lower = message.toLowerCase();
    if (/\b(error|fatal|failed|failure)\b/.test(lower) || /\w+Error\b/.test(message) || /ERR_/.test(message)) {
      return 'error';
    }
    if (/\bwarn(?:ing)?\b/.test(lower)) {
      return 'warn';
    }
    return 'info';
  }

  private toSanitizedEntries(
    rawLines: Array<{ message: string; level: 'info' | 'warn' | 'error' }>,
    timestamp: string,
    maxLines: number
  ): SanitizedLogEntry[] {
    const entries: SanitizedLogEntry[] = [];

    for (const raw of rawLines) {
      const sanitizedMessage = this.logSanitizer.sanitizeErrorMessages(
        this.logSanitizer.redactSecrets(raw.message)
      );
      if (!sanitizedMessage.trim()) continue;

      entries.push({
        timestamp,
        source: 'stderr',
        message: sanitizedMessage,
        level: raw.level,
      });
    }

    if (entries.length <= maxLines) {
      return entries;
    }

    return entries.slice(-maxLines);
  }
}
