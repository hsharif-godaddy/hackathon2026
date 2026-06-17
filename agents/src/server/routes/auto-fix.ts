/**
 * Auto-Fix Routes
 *
 * POST /apps/:id/auto-fix — diagnose the preview container, apply the LLM's
 * suggested actions, restart the dev server, and verify the build is healthy.
 *
 * Sibling to /diagnose: same middleware stack, same product gate, same
 * tenant-isolation guarantees. The route layer stays thin — parsing + status
 * mapping only — and delegates orchestration to PaaSAutoFixService.
 */

import { Router, type Request, type Response } from 'express';

import { Logger } from '../../logging/index.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { ImportJobRepository } from '../../database/repositories/ImportJobRepository.js';
import { AgentOperationLogsService } from '../../services/AgentOperationLogsService.js';
import { CustomerLogsService } from '../../services/customer-logs-service.js';
import { LogSanitizer } from '../../services/log-sanitizer.js';
import {
  PaaSDiagnoseService,
  LlmClassifier,
  PatternClassifier,
  DiagnoseLlmClient,
  DiagnoseContextService,
  buildUnknownAnalysis,
} from '../../services/diagnose/index.js';
import {
  PaaSAutoFixService,
  WorkspaceActionExecutor,
  AutoFixRequestBodySchema,
  DevelopAgentFixer,
} from '../../services/auto-fix/index.js';
import type {
  AgentInvoker,
  AutoFixErrorCode,
  AutoFixRequest,
  AutoFixService,
} from '../../services/auto-fix/index.js';
import { createForWorkspace } from '../../workspace/index.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';
import { getAgentFactory } from '../agent-runtime.js';

const logger = Logger.create({ component: 'auto-fix-routes' });

let _autoFixService: AutoFixService | null = null;

/**
 * Async factory because GitTool is imported lazily — its transitive deps load
 * package-only modules that are inconvenient to pull into route-level test
 * harnesses. Tests always inject via `_setDependencies()` and never call the
 * factory; production hits the dynamic import once per process.
 */
async function getAutoFixService(): Promise<AutoFixService> {
  if (!_autoFixService) {
    const [{ GitTool }, { appRestartService }] = await Promise.all([
      import('../../tools/git-tool.js'),
      import('../../services/AppRestartService.js'),
    ]);
    const appRepo = new AppRepository();
    const logSanitizer = new LogSanitizer();
    const customerLogsService = new CustomerLogsService(appRepo, logSanitizer);
    const agentOperationLogsService = new AgentOperationLogsService(
      new ImportJobRepository(),
      logSanitizer
    );
    const llmClient = new DiagnoseLlmClient();
    const llmClassifier = new LlmClassifier(llmClient);
    const patternClassifier = new PatternClassifier();
    const diagnoseContextService = new DiagnoseContextService();
    const diagnoseService = new PaaSDiagnoseService({
      customerLogsService,
      agentOperationLogsService,
      patternClassifier,
      llmClassifier,
      diagnoseContextService,
    });
    const actionExecutor = new WorkspaceActionExecutor();
    // Agent fallback: defer agent lookup until invocation. The factory is
    // initialized asynchronously at boot, so resolving lazily avoids a
    // construct-time race and lets the fallback degrade to `unavailable`
    // instead of throwing if the factory is missing.
    const agentFixer = new DevelopAgentFixer(() => {
      const factory = getAgentFactory();
      if (!factory) return null;
      const agent = factory.agents.get('develop' as never) as AgentInvoker | undefined;
      return agent ?? null;
    });
    _autoFixService = new PaaSAutoFixService({
      diagnoseService,
      actionExecutor,
      workspaceFactory: (appId) => createForWorkspace(appId, 'preview'),
      gitToolFactory: (workspace) => new GitTool(workspace?.tasks),
      appRestart: appRestartService,
      agentFixer,
    });
  }
  return _autoFixService;
}

export function _resetDependencies(): void {
  _autoFixService = null;
}

export function _setDependencies(service: AutoFixService): void {
  _autoFixService = service;
}

const router: Router = Router();

// Apply tenant isolation to every /:id/* route. Unauthenticated requests
// (no agentContext) get 401 from the middleware; mismatched siteIds get 403.
router.use('/:id', validateAppOwnership);

router.post('/:id/auto-fix', async (req: Request, res: Response) => {
  const appId = req.params.id ?? '';
  const startedAt = Date.now();

  // PaaS-only gate. Mirror the diagnose route — only Node.js Hosting customers
  // can run auto-fix. AAB has its own (eventual) flow with different semantics.
  const product = (req as AuthenticatedRequest).agentContext?.product;
  if (product !== 'PaaSNodeJS') {
    logger.warn('route.auto-fix.product_not_allowed', { appId, product });
    return res.status(403).json({
      success: false,
      error: 'Auto-fix is only available for PaaS (Node.js Hosting) customers.',
      errorCode: 'PRODUCT_NOT_ALLOWED' satisfies AutoFixErrorCode,
      analysis: buildUnknownAnalysis(() => Date.now(), startedAt),
    });
  }

  const parseResult = AutoFixRequestBodySchema.safeParse(req.body ?? {});
  if (!parseResult.success) {
    const reason = parseResult.error.issues.map((i) => i.message).join('; ');
    logger.warn('route.auto-fix.schema.validation_failed', { appId, reason });
    return res.status(400).json({
      success: false,
      error: reason,
      errorCode: 'VALIDATION_ERROR' satisfies AutoFixErrorCode,
      analysis: buildUnknownAnalysis(() => Date.now(), startedAt),
    });
  }

  const parsed = parseResult.data;
  const request: AutoFixRequest = {
    appId,
    target: parsed.target,
    ...(parsed.tier !== undefined ? { tier: parsed.tier } : {}),
    ...(parsed.dryRun !== undefined ? { dryRun: parsed.dryRun } : {}),
    ...(parsed.enableAgentFallback !== undefined
      ? { enableAgentFallback: parsed.enableAgentFallback }
      : {}),
  };

  logger.info('route.auto-fix.request', {
    appId,
    target: request.target,
    tier: request.tier ?? 'llm',
    dryRun: Boolean(request.dryRun),
    enableAgentFallback: Boolean(request.enableAgentFallback),
  });

  try {
    const service = await getAutoFixService();
    const result = await service.autoFix(request);

    if (!result.success) {
      const status = errorCodeToStatus(result.errorCode);
      logger.warn('route.auto-fix.service_error', {
        appId,
        errorCode: result.errorCode,
        status,
      });
      return res.status(status).json({
        success: false,
        error: result.error,
        errorCode: result.errorCode,
        analysis: result.analysis,
        ...(result.postFixAnalysis !== undefined ? { postFixAnalysis: result.postFixAnalysis } : {}),
        ...(result.appliedActions !== undefined ? { appliedActions: result.appliedActions } : {}),
        ...(result.agentFix !== undefined ? { agentFix: result.agentFix } : {}),
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    logger.error('route.auto-fix.unhandled_error', {
      appId,
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      errorCode: 'UNKNOWN' satisfies AutoFixErrorCode,
      analysis: buildUnknownAnalysis(() => Date.now(), startedAt),
    });
  }
});

/**
 * Map AutoFixErrorCode → HTTP status. Reuses the diagnose mapping for
 * shared codes (the inner diagnose call surfaces those unchanged) and adds
 * three new codes. NO_ACTIONABLE_FIXES and VERIFICATION_FAILED return 200
 * with `success: false` — the request was processed; the outcome is just
 * "couldn't fix it." APPLY_FAILED is 500: actions threw or returned non-zero.
 */
function errorCodeToStatus(code: AutoFixErrorCode): number {
  switch (code) {
    case 'APP_NOT_FOUND':
      return 404;
    case 'SUPERVISOR_UNAVAILABLE':
    case 'UPSTREAM_UNAVAILABLE':
      return 503;
    case 'VALIDATION_ERROR':
      return 400;
    case 'PRODUCT_NOT_ALLOWED':
      return 403;
    case 'ANOTHER_DIAGNOSE_IN_FLIGHT':
      return 409;
    case 'CAP_EXCEEDED':
      return 429;
    case 'TIER_NOT_IMPLEMENTED':
      return 501;
    // 500s: server-side pipeline failures. RESTART_FAILED means fixes were
    // applied/committed but the dev-server restart failed, so the run couldn't
    // verify them — not a "build still broken" outcome (that's VERIFICATION_FAILED).
    case 'LLM_FAILURE':
    case 'UNKNOWN':
    case 'APPLY_FAILED':
    case 'AGENT_FIX_FAILED':
    case 'RESTART_FAILED':
      return 500;
    case 'NO_ACTIONABLE_FIXES':
    case 'VERIFICATION_FAILED':
      return 200;
  }
  // Exhaustiveness guard: a new AutoFixErrorCode added without a case here
  // fails this assignment at compile time. Runtime fallback is still 500.
  const _exhaustive: never = code;
  void _exhaustive;
  return 500;
}

export default router;
