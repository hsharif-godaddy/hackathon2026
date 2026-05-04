import { Logger } from '../../logging/index.js';
import type { CustomerLogsService, CustomerLogsResponse } from '../customer-logs-service.js';
import type {
  Analysis,
  AppContext,
  Classifier,
  ClassifierResult,
  DiagnoseErrorCode,
  DiagnoseRequest,
  DiagnoseResponse,
  DiagnoseTier,
  Issue,
} from './types.js';

export interface DiagnoseServiceDeps {
  customerLogsService: Pick<CustomerLogsService, 'getLogs'>;
  patternClassifier: Classifier;
  llmClassifier: Classifier;
  /** Injectable clock for deterministic timing in tests. */
  clock?: () => number;
  /** Default log line limit when the request doesn't specify one. */
  defaultLines?: number;
}

const DEFAULT_LINES = 200;

const logger = Logger.create({ component: 'diagnose.service' });

/**
 * Orchestrates the diagnose pipeline:
 *   fetch logs → Tier 1 (pattern) → Tier 3 (LLM) → assemble response.
 *
 * In-flight dedupe prevents duplicate work when the same app's client double-fires.
 * All dependencies are injected so this class can be unit-tested without touching the
 * filesystem, dev-supervisor, or an LLM.
 */
export class DiagnoseService {
  private readonly customerLogsService: DiagnoseServiceDeps['customerLogsService'];
  private readonly patternClassifier: Classifier;
  private readonly llmClassifier: Classifier;
  private readonly clock: () => number;
  private readonly defaultLines: number;
  private readonly inFlight = new Map<string, Promise<DiagnoseResponse>>();

  constructor(deps: DiagnoseServiceDeps) {
    this.customerLogsService = deps.customerLogsService;
    this.patternClassifier = deps.patternClassifier;
    this.llmClassifier = deps.llmClassifier;
    this.clock = deps.clock ?? Date.now;
    this.defaultLines = deps.defaultLines ?? DEFAULT_LINES;
  }

  async diagnose(request: DiagnoseRequest): Promise<DiagnoseResponse> {
    const key = `${request.appId}:${request.target}`;
    const existing = this.inFlight.get(key);
    if (existing) {
      logger.info('diagnose.invocation.deduped', { appId: request.appId, target: request.target });
      return existing;
    }
    const pending = this.runAnalysis(request).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, pending);
    return pending;
  }

  private async runAnalysis(request: DiagnoseRequest): Promise<DiagnoseResponse> {
    const startedAt = this.clock();
    logger.info('diagnose.invocation.start', {
      appId: request.appId,
      target: request.target,
      forceFullAnalysis: request.options?.forceFullAnalysis === true,
    });

    const logsResponse = await this.customerLogsService.getLogs({
      appId: request.appId,
      target: request.target,
      since: request.since,
      lines: request.lines ?? this.defaultLines,
    });

    if (!logsResponse.success) {
      return this.buildErrorResponse(request, logsResponse, startedAt);
    }

    const appContext: AppContext = { appId: request.appId, target: request.target };
    const forceLlm = request.options?.forceFullAnalysis === true;
    let tierUsed: DiagnoseTier = 'llm';
    let winning: ClassifierResult | null = null;

    if (!forceLlm) {
      try {
        const patternResult = await this.patternClassifier.classify(logsResponse.logs, appContext);
        if (patternResult.handled && patternResult.issues.length > 0) {
          logger.info('diagnose.tier.pattern.hit', {
            appId: request.appId,
            issueCount: patternResult.issues.length,
          });
          tierUsed = 'pattern';
          winning = patternResult;
        }
      } catch (error) {
        logger.warn('diagnose.tier.pattern.failure', {
          appId: request.appId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Fall through to LLM tier.
      }
    }

    if (!winning) {
      const llmResult = await this.llmClassifier.classify(logsResponse.logs, appContext);
      const llmFailure =
        llmResult.issues.length === 1 && llmResult.issues[0]!.id === 'llm-failure';
      logger.info('diagnose.tier.llm.hit', {
        appId: request.appId,
        issueCount: llmResult.issues.length,
        llmFailure,
      });
      tierUsed = 'llm';
      winning = llmResult;
    }

    const analysis = this.assembleAnalysis({
      result: winning,
      tierUsed,
      logsAnalyzed: logsResponse.total,
      startedAt,
    });

    return { success: true, analysis };
  }

  private buildErrorResponse(
    request: DiagnoseRequest,
    logsResponse: CustomerLogsResponse,
    startedAt: number
  ): DiagnoseResponse {
    const errorCode = mapLogsErrorCode(logsResponse.code);
    logger.warn('diagnose.logs.fetch_failed', {
      appId: request.appId,
      target: request.target,
      errorCode,
      rawCode: logsResponse.code,
    });
    return {
      success: false,
      error: logsResponse.error ?? 'Unable to fetch logs',
      errorCode,
      analysis: buildUnknownAnalysis(this.clock, startedAt),
    };
  }

  private assembleAnalysis(args: {
    result: ClassifierResult;
    tierUsed: DiagnoseTier;
    logsAnalyzed: number;
    startedAt: number;
  }): Analysis {
    const issues = args.result.issues;
    const errors = issues.filter((i) => i.severity === 'error').length;
    const warnings = issues.filter((i) => i.severity === 'warning').length;
    const primary = issues.find((i) => i.severity === 'error') ?? issues[0];
    const primaryRecommendation =
      args.result.primaryRecommendation ??
      primary?.recommendation ??
      'No actionable issues detected.';

    return {
      status: args.result.status ?? deriveStatus(issues),
      issues,
      summary: {
        totalIssues: issues.length,
        errors,
        warnings,
        primaryRecommendation,
      },
      metadata: {
        logsAnalyzed: args.logsAnalyzed,
        tierUsed: args.tierUsed,
        analysisTimeMs: Math.max(0, this.clock() - args.startedAt),
      },
    };
  }
}

function deriveStatus(issues: Issue[]): Analysis['status'] {
  if (issues.length === 0) return 'healthy';
  if (issues.some((i) => i.severity === 'error')) return 'failing';
  return 'degraded';
}

export function buildUnknownAnalysis(clock: () => number, startedAt: number): Analysis {
  return {
    status: 'unknown',
    issues: [],
    summary: {
      totalIssues: 0,
      errors: 0,
      warnings: 0,
      primaryRecommendation: 'Retry diagnosis once the underlying issue is resolved.',
    },
    metadata: {
      logsAnalyzed: 0,
      tierUsed: 'pattern',
      analysisTimeMs: Math.max(0, clock() - startedAt),
    },
  };
}

function mapLogsErrorCode(code: string | undefined): DiagnoseErrorCode {
  switch (code) {
    case 'APP_NOT_FOUND':
      return 'APP_NOT_FOUND';
    case 'SUPERVISOR_UNAVAILABLE':
      return 'SUPERVISOR_UNAVAILABLE';
    case 'SUPERVISOR_NOT_CONFIGURED':
    case 'FETCH_ERROR':
      return 'UPSTREAM_UNAVAILABLE';
    case 'MISSING_TARGET':
    case 'INVALID_TARGET':
    case 'INVALID_LINES':
    case 'INVALID_TIMESTAMP':
      return 'VALIDATION_ERROR';
    default:
      return 'UNKNOWN';
  }
}
