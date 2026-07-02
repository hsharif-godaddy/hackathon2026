import { Logger } from '../../logging/index.js';
import { toIsoDateString } from '../../utils/date-utils.js';
import {
  shouldUseAgentImportLogs,
  type AgentOperationLogsService,
} from '../AgentOperationLogsService.js';
import type { CustomerLogsService, CustomerLogsResponse } from '../customer-logs-service.js';
import type { SanitizedLogEntry } from '../log-sanitizer.js';
import type { DiagnoseContextService } from './DiagnoseContextService.js';
import type { DiagnoseService } from './DiagnoseService.js';
import type {
  Analysis,
  AppContext,
  AppContextBase,
  Classifier,
  ClassifierResult,
  DiagnoseErrorCode,
  DiagnoseRequest,
  DiagnoseResponse,
  DiagnoseTarget,
  DiagnoseTier,
  Issue,
} from './types.js';
import { buildAppContext } from './types.js';

/**
 * Constructor dependencies for PaaSDiagnoseService. All collaborators are
 * injected so the service can be unit-tested without the filesystem,
 * dev-supervisor, or an LLM. AAB's future implementation will have its own
 * deps interface — do not attempt to share this one.
 */
export interface PaaSDiagnoseServiceDeps {
  customerLogsService: Pick<CustomerLogsService, 'getLogs'>;
  agentOperationLogsService?: Pick<AgentOperationLogsService, 'getFailureLogs'>;
  patternClassifier?: Classifier;
  llmClassifier: Classifier;
  diagnoseContextService?: Pick<DiagnoseContextService, 'gather'>;
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
 *   fetch logs → LLM classification → assemble response.
 *
 * The orchestration itself (in-flight dedupe, early-exit when no failure signal
 * is present) is product-neutral. What makes this class PaaS-scoped is the
 * llmClassifier wired at the route layer — its prompt schema is shaped for
 * Node.js Hosting ("guideline-compliance checker", symptom mapping, requirement docs).
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
  private readonly agentOperationLogsService: PaaSDiagnoseServiceDeps['agentOperationLogsService'];
  private readonly patternClassifier: Classifier | undefined;
  private readonly llmClassifier: Classifier;
  private readonly diagnoseContextService: PaaSDiagnoseServiceDeps['diagnoseContextService'];
  private readonly clock: () => number;
  private readonly defaultLines: number;
  // Tracks the in-flight diagnose per app. Only one diagnose may run per appId at a time —
  // a concurrent request (same or different target) is rejected with ANOTHER_DIAGNOSE_IN_FLIGHT.
  // We deliberately do NOT store the Promise here: the intent is reject-not-dedupe, so the
  // second caller never awaits the first. Cleanup hooks on the local promise via .finally().
  private readonly inFlight = new Map<string, { target: DiagnoseTarget }>();

  constructor(deps: PaaSDiagnoseServiceDeps) {
    this.customerLogsService = deps.customerLogsService;
    this.agentOperationLogsService = deps.agentOperationLogsService;
    this.patternClassifier = deps.patternClassifier;
    this.llmClassifier = deps.llmClassifier;
    this.diagnoseContextService = deps.diagnoseContextService;
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
    const requestedTier: DiagnoseTier = request.tier ?? 'llm';
    logger.info('diagnose.invocation.start', {
      appId: request.appId,
      target: request.target,
      tier: requestedTier,
      // Present only for verify runs (auto-fix); aids debugging false "still
      // failing" verdicts that come from an over-wide log window.
      boundedSince: request.since,
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

    // Internal log-fetch window: default to the last 3 hours, up to 500 lines.
    // A caller-supplied `request.since` narrows the window — auto-fix passes the
    // restart timestamp so the post-restart verify only sees logs newer than the
    // restart, and the stale pre-fix errors that are still inside the 3-hour
    // window can't be re-classified as a fresh failure.
    const sinceIso = request.since ?? toIsoDateString(startedAt, DEFAULT_SINCE_HOURS * 60);
    // Include Source="exec" only when diagnosing the preview container —
    // that's where /exec commands (install/build during zip-upload etc.)
    // actually run. The publish container executes `$pm start` and never
    // runs /exec builds, so including exec there would only surface stale
    // entries. Passing sources explicitly (rather than relying on the
    // customer-logs default) makes diagnose's intent clear at the call site
    // and robust to future default changes.
    const sources: Array<'stdout' | 'stderr' | 'exec'> =
      request.target === 'preview' ? ['stdout', 'stderr', 'exec'] : ['stdout', 'stderr'];
    const logsResponse = await this.customerLogsService.getLogs({
      appId: request.appId,
      target: request.target,
      since: sinceIso,
      lines: this.defaultLines,
      sources,
    });

    if (!logsResponse.success) {
      return this.buildErrorResponse(request, logsResponse, startedAt);
    }

    let logs = logsResponse.logs;
    let logsAnalyzed = logsResponse.total;
    let logSource: 'customer' | 'import_job' = 'customer';
    let importSource: AppContext['importSource'];
    let snapshotPath: string | undefined;
    let errorStage: string | undefined;
    let packageManager: AppContext['packageManager'];
    const checkedAgentImportLogs = Boolean(this.agentOperationLogsService);

    if (this.agentOperationLogsService) {
      const agentLogs = await this.agentOperationLogsService.getFailureLogs({
        appId: request.appId,
        since: sinceIso,
        lines: this.defaultLines,
      });
      if (shouldUseAgentImportLogs(agentLogs)) {
        logs = agentLogs.logs;
        logsAnalyzed = agentLogs.total;
        logSource = 'import_job';
        importSource = agentLogs.importSource;
        snapshotPath = agentLogs.diagnoseSnapshotPath;
        errorStage = agentLogs.errorStage;
        packageManager = agentLogs.detectedPackageManager;
        logger.info('diagnose.logs.source', {
          appId: request.appId,
          target: request.target,
          logSource,
          importSource,
          errorStage: agentLogs.errorStage,
          lineCount: agentLogs.total,
          hasSnapshot: Boolean(snapshotPath),
        });
      }
    }

    // Early exit: no failure signal in the fetched window → skip classifiers entirely.
    const hasFailureSignal = hasFailureSignalInLogs(logs);
    if (!hasFailureSignal) {
      logger.info('diagnose.early_exit.no_failure', {
        appId: request.appId,
        target: request.target,
        logCount: logs.length,
        logSource,
        checkedAgentImportLogs,
      });
      return {
        success: true,
        analysis: buildNoErrorLogAnalysis({
          logsAnalyzed,
          startedAt,
          clock: this.clock,
        }),
      };
    }

    const contextBase: AppContextBase & { snapshotPath?: string } = {
      appId: request.appId,
      target: request.target,
      logSource,
      importSource,
      errorStage,
      packageManager,
      snapshotPath,
    };

    const gatherResult = this.diagnoseContextService
      ? await this.diagnoseContextService.gather({
          appId: request.appId,
          target: request.target,
          logs,
          snapshotPath,
          logSource,
        })
      : {
          projectContextText: 'No project files were available for this diagnosis.',
          contextSource: 'none' as const,
          filesIncluded: 0,
        };

    const appContext = buildAppContext(contextBase, gatherResult);

    if (this.patternClassifier) {
      const patternResult = await this.patternClassifier.classify(logs, appContext);
      if (patternResult.handled && patternResult.issues.length > 0 && patternResult.degraded !== true) {
        logger.info('diagnose.tier.pattern.hit', {
          appId: request.appId,
          issueCount: patternResult.issues.length,
        });
        const analysis = this.assembleAnalysis({
          result: patternResult,
          tierUsed: 'pattern',
          logsAnalyzed,
          startedAt,
          contextSource: appContext.contextSource,
          filesIncluded: appContext.filesIncluded,
        });
        return { success: true, analysis };
      }
    }

    // LlmClassifier's internal contract is never-throw: both prompt-load and
    // LLM-call branches return a ClassifierResult with `degraded: true` on
    // failure. This try/catch enforces the invariant at the callsite so a
    // test double or refactor bug cannot downgrade the response from 500
    // LLM_FAILURE (structured) to 500 UNKNOWN (the route's outer catch).
    let llmResult: ClassifierResult;
    try {
      llmResult = await this.llmClassifier.classify(logs, appContext);
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

    // LLM tier is degraded (ENOENT prompt, upstream failure, etc.). Surface as a
    // failure response so callers get HTTP 500 + errorCode LLM_FAILURE instead of
    // success=true with a confidence-0 sentinel. The assembled analysis is still
    // returned so clients can display the degraded issue for context.
    if (llmFailure) {
      const analysis = this.assembleAnalysis({
        result: llmResult,
        tierUsed: 'llm',
        logsAnalyzed,
        startedAt,
        contextSource: appContext.contextSource,
        filesIncluded: appContext.filesIncluded,
      });
      return {
        success: false,
        errorCode: 'LLM_FAILURE',
        error: llmResult.issues[0]?.message ?? 'LLM analyzer is currently unavailable.',
        analysis,
      };
    }

    const analysis = this.assembleAnalysis({
      result: normalizeNoActionableResult(llmResult),
      tierUsed: 'llm',
      logsAnalyzed,
      startedAt,
      contextSource: appContext.contextSource,
      filesIncluded: appContext.filesIncluded,
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
    contextSource?: AppContext['contextSource'];
    filesIncluded?: number;
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
        ...(args.contextSource !== undefined ? { contextSource: args.contextSource } : {}),
        ...(args.filesIncluded !== undefined ? { filesIncluded: args.filesIncluded } : {}),
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
      tierUsed: 'llm',
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
    // No actionable issue to surface: the recent logs contained no failure we
    // can diagnose. Return an empty issues[] so consumers render their single
    // "unable to diagnose" state (issues.length === 0) rather than showing a
    // synthetic finding. Status stays 'noerrlog' — auto-fix keys on it to treat
    // this as "nothing to fix", and it's the one consistent signal for callers.
    issues: [],
    summary: {
      totalIssues: 0,
      errors: 0,
      warnings: 0,
      primaryRecommendation:
        'No errors were found in the recent logs, so there is nothing to fix automatically. ' +
        'Check your app logs manually if the app still is not working as expected.',
    },
    metadata: {
      logsAnalyzed: args.logsAnalyzed,
      tierUsed: 'llm',
      analysisTimeMs: Math.max(0, args.clock() - args.startedAt),
    },
  };
}

function hasFailureSignalInLogs(logs: SanitizedLogEntry[]): boolean {
  return logs.some((l) => l.level === 'error' || ERROR_TOKEN_RE.test(l.message));
}

// Unify the "no actionable result" outcomes into one signal. When the LLM
// reports insufficient evidence (logs were present but nothing could be pinned
// to a specific fix), drop its sentinel issue so the analysis carries the same
// empty issues[] as the no-error-signal path — consumers then render a single
// "unable to diagnose" state (issues.length === 0) for both. The LLM's status
// ('unknown') and primaryRecommendation are preserved: 'unknown' (unlike
// 'noerrlog') is never read as a verified success by auto-fix, which is correct
// because errors WERE present, just not diagnosable.
function normalizeNoActionableResult(result: ClassifierResult): ClassifierResult {
  const isInsufficientEvidence: boolean =
    result.issues.length > 0 &&
    result.issues.every((issue) => issue.id === 'insufficient-log-evidence');
  if (!isInsufficientEvidence) {
    return result;
  }
  return { ...result, issues: [] };
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
