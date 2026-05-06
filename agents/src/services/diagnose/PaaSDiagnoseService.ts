import { Logger } from '../../logging/index.js';
import { toIsoDateString } from '../../utils/date-utils.js';
import type { CustomerLogsService, CustomerLogsResponse } from '../customer-logs-service.js';
import type { DiagnoseService } from './DiagnoseService.js';
import type {
  Analysis,
  AppContext,
  Classifier,
  ClassifierResult,
  DiagnoseErrorCode,
  DiagnoseRequest,
  DiagnoseResponse,
  DiagnoseTarget,
  DiagnoseTier,
  Issue,
} from './types.js';

/**
 * Constructor dependencies for PaaSDiagnoseService. All collaborators are
 * injected so the service can be unit-tested without the filesystem,
 * dev-supervisor, or an LLM. AAB's future implementation will have its own
 * deps interface — do not attempt to share this one.
 */
export interface PaaSDiagnoseServiceDeps {
  customerLogsService: Pick<CustomerLogsService, 'getLogs'>;
  patternClassifier: Classifier;
  llmClassifier: Classifier;
  /** Injectable clock for deterministic timing in tests. */
  clock?: () => number;
  /** Default log line limit when the request doesn't specify one. */
  defaultLines?: number;
}

const DEFAULT_LINES = 500;
const DEFAULT_SINCE_HOURS = 3;
// The `\w+Error\b` alternation catches Node.js compound error class names
// (TypeError, ReferenceError, SyntaxError, RangeError, URIError, …) that the
// plain `\berror\b` token misses because the uppercase E is preceded by a
// word character. Without it, an app logging `TypeError: …` at level='info'
// would early-exit to `noerrlog` and the classifiers would never run.
const ERROR_TOKEN_RE =
  /\b(error|fatal|exception|traceback|fail(?:ed|ure|ing|s)?)\b|\w+Error\b|ERR_/i;

const logger = Logger.create({ component: 'diagnose.service' });

/**
 * PaaS (Node.js Hosting) implementation of the DiagnoseService contract.
 *
 * Orchestrates the diagnose pipeline:
 *   fetch logs → Tier 1 (pattern) → Tier 3 (LLM) → assemble response.
 *
 * The orchestration itself (tiered classification, in-flight dedupe, early-exit
 * when no failure signal is present) is product-neutral. What makes this class
 * PaaS-scoped is the dependencies wired into it at the route layer:
 *   - patternClassifier bound to PAAS_ALL_PATTERNS (PaaS-tuned remediation wording)
 *   - llmClassifier whose prompt schema is shaped for Node.js Hosting
 *     ("guideline-compliance checker", symptom mapping, requirement docs)
 *
 * Tenant/product enforcement (PRODUCT_NOT_ALLOWED) happens at the HTTP route,
 * not here.
 *
 * In-flight dedupe prevents duplicate work when the same app's client double-fires.
 * All dependencies are injected so this class can be unit-tested without touching
 * the filesystem, dev-supervisor, or an LLM.
 *
 * When AAB diagnose lands, add a sibling AABDiagnoseService that also implements
 * DiagnoseService — do not extend this class.
 */
export class PaaSDiagnoseService implements DiagnoseService {
  private readonly customerLogsService: PaaSDiagnoseServiceDeps['customerLogsService'];
  private readonly patternClassifier: Classifier;
  private readonly llmClassifier: Classifier;
  private readonly clock: () => number;
  private readonly defaultLines: number;
  // Tracks the in-flight diagnose per app. Only one diagnose may run per appId at a time —
  // a concurrent request (same or different target) is rejected with ANOTHER_DIAGNOSE_IN_FLIGHT.
  // We deliberately do NOT store the Promise here: the intent is reject-not-dedupe, so the
  // second caller never awaits the first. Cleanup hooks on the local promise via .finally().
  private readonly inFlight = new Map<string, { target: DiagnoseTarget }>();

  constructor(deps: PaaSDiagnoseServiceDeps) {
    this.customerLogsService = deps.customerLogsService;
    this.patternClassifier = deps.patternClassifier;
    this.llmClassifier = deps.llmClassifier;
    this.clock = deps.clock ?? Date.now;
    this.defaultLines = deps.defaultLines ?? DEFAULT_LINES;
  }

  async diagnose(request: DiagnoseRequest): Promise<DiagnoseResponse> {
    const existing = this.inFlight.get(request.appId);
    if (existing) {
      logger.info('diagnose.invocation.rejected', {
        appId: request.appId,
        requestedTarget: request.target,
        inFlightTarget: existing.target,
      });
      return {
        success: false,
        error: `Another diagnose is already in progress for this app (target=${existing.target}). Wait for it to finish and retry.`,
        errorCode: 'ANOTHER_DIAGNOSE_IN_FLIGHT',
        analysis: buildUnknownAnalysis(this.clock, this.clock()),
      };
    }
    this.inFlight.set(request.appId, { target: request.target });
    return this.runAnalysis(request).finally(() => {
      this.inFlight.delete(request.appId);
    });
  }

  private async runAnalysis(request: DiagnoseRequest): Promise<DiagnoseResponse> {
    const startedAt = this.clock();
    const requestedTier: DiagnoseTier = request.tier ?? 'pattern';
    logger.info('diagnose.invocation.start', {
      appId: request.appId,
      target: request.target,
      tier: requestedTier,
    });

    // Reject embedding tier early — it's declared but not yet implemented.
    if (requestedTier === 'embedding') {
      logger.warn('diagnose.tier.not_implemented', {
        appId: request.appId,
        tier: requestedTier,
      });
      return {
        success: false,
        error: 'The embedding tier is not yet implemented.',
        errorCode: 'TIER_NOT_IMPLEMENTED',
        analysis: buildUnknownAnalysis(this.clock, startedAt),
      };
    }

    // Internal log-fetch window: last 3 hours, up to 500 lines.
    const sinceIso = toIsoDateString(startedAt, DEFAULT_SINCE_HOURS * 60);
    const logsResponse = await this.customerLogsService.getLogs({
      appId: request.appId,
      target: request.target,
      since: sinceIso,
      lines: this.defaultLines,
    });

    if (!logsResponse.success) {
      return this.buildErrorResponse(request, logsResponse, startedAt);
    }

    // Early exit: no failure signal in the fetched window → skip classifiers entirely.
    const hasFailureSignal = logsResponse.logs.some(
      (l) => l.level === 'error' || ERROR_TOKEN_RE.test(l.message),
    );
    if (!hasFailureSignal) {
      logger.info('diagnose.early_exit.no_failure', {
        appId: request.appId,
        target: request.target,
        logCount: logsResponse.logs.length,
      });
      return {
        success: true,
        analysis: buildNoErrorLogAnalysis({
          logsAnalyzed: logsResponse.total,
          startedAt,
          clock: this.clock,
        }),
      };
    }

    const appContext: AppContext = { appId: request.appId, target: request.target };
    let tierUsed: DiagnoseTier = 'llm';
    let winning: ClassifierResult | null = null;

    if (requestedTier === 'pattern') {
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
          stack: error instanceof Error ? error.stack : undefined,
        });
        // Fall through to LLM tier.
      }
    }

    if (!winning) {
      // LlmClassifier's internal contract is never-throw: both prompt-load and
      // LLM-call branches return a ClassifierResult with `degraded: true` on
      // failure. This try/catch enforces the invariant at the callsite so a
      // test double or refactor bug cannot downgrade the response from 500
      // LLM_FAILURE (structured) to 500 UNKNOWN (the route's outer catch).
      let llmResult: ClassifierResult;
      try {
        llmResult = await this.llmClassifier.classify(logsResponse.logs, appContext);
      } catch (error) {
        logger.warn('diagnose.tier.llm.unexpected_throw', {
          appId: request.appId,
          error: error instanceof Error ? error.message : String(error),
        });
        llmResult = {
          handled: true,
          degraded: true,
          issues: [
            {
              id: 'llm-failure',
              category: 'Analyzer Unavailable',
              severity: 'warning',
              message: 'Unable to analyze logs automatically — the LLM tier failed.',
              recommendation:
                'Review the raw logs manually or retry the analysis in a few moments.',
              confidence: 0,
              source: 'llm',
            },
          ],
        };
      }
      const llmFailure = llmResult.degraded === true;
      logger.info('diagnose.tier.llm.hit', {
        appId: request.appId,
        issueCount: llmResult.issues.length,
        llmFailure,
      });
      tierUsed = 'llm';
      winning = llmResult;

      // LLM tier is degraded (ENOENT prompt, upstream failure, etc.). Surface as a
      // failure response so callers get HTTP 500 + errorCode LLM_FAILURE instead of
      // success=true with a confidence-0 sentinel. The assembled analysis is still
      // returned so clients can display the degraded issue for context.
      if (llmFailure) {
        const analysis = this.assembleAnalysis({
          result: winning,
          tierUsed,
          logsAnalyzed: logsResponse.total,
          startedAt,
        });
        return {
          success: false,
          errorCode: 'LLM_FAILURE',
          error: winning.issues[0]?.message ?? 'LLM analyzer is currently unavailable.',
          analysis,
        };
      }
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

export function buildNoErrorLogAnalysis(args: {
  logsAnalyzed: number;
  startedAt: number;
  clock: () => number;
}): Analysis {
  return {
    status: 'noerrlog',
    issues: [
      {
        id: 'no-failure-detected',
        category: 'No Failure Detected',
        severity: 'warning',
        message:
          'No error-level or error-token log entries were found in the last 3 hours. ' +
          'Possible reasons: (a) the deployment succeeded, (b) the failure is older than 3 hours, ' +
          '(c) the container is still starting up.',
        recommendation:
          'Wait a few minutes and retry, or re-trigger the failure to produce fresh logs.',
        confidence: 100,
        source: 'pattern',
      },
    ],
    // Summary counters must match issues[] so consumers that render badges
    // from summary and consumers that iterate issues see the same state.
    summary: {
      totalIssues: 1,
      errors: 0,
      warnings: 1,
      primaryRecommendation:
        'No error signals found in the last 3 hours. Retry in a few minutes or re-trigger the failure.',
    },
    metadata: {
      logsAnalyzed: args.logsAnalyzed,
      tierUsed: 'pattern',
      analysisTimeMs: Math.max(0, args.clock() - args.startedAt),
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
