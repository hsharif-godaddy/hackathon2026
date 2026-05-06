/**
 * Diagnose Routes
 *
 * POST /apps/:id/diagnose — analyze deployment logs and return a structured fix plan.
 *
 * The route is thin: it parses + validates the HTTP envelope and delegates everything
 * else to DiagnoseService. Service results are mapped to HTTP status codes via a small
 * errorCode → status table.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { Logger } from '../../logging/index.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { CustomerLogsService } from '../../services/customer-logs-service.js';
import { LogSanitizer } from '../../services/log-sanitizer.js';
import {
  PaaSDiagnoseService,
  PatternClassifier,
  LlmClassifier,
  DiagnoseLlmClient,
  PAAS_ALL_PATTERNS,
  buildUnknownAnalysis,
} from '../../services/diagnose/index.js';
import type {
  DiagnoseService,
  DiagnoseErrorCode,
  DiagnoseRequest,
} from '../../services/diagnose/index.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';

const logger = Logger.create({ component: 'diagnose-routes' });

let _diagnoseService: DiagnoseService | null = null;

function getDiagnoseService(): DiagnoseService {
  if (!_diagnoseService) {
    const appRepo = new AppRepository();
    const customerLogsService = new CustomerLogsService(appRepo, new LogSanitizer());
    const patternClassifier = new PatternClassifier(PAAS_ALL_PATTERNS);
    const llmClient = new DiagnoseLlmClient();
    const llmClassifier = new LlmClassifier(llmClient);
    _diagnoseService = new PaaSDiagnoseService({
      customerLogsService,
      patternClassifier,
      llmClassifier,
    });
  }
  return _diagnoseService;
}

export function _resetDependencies(): void {
  _diagnoseService = null;
}

export function _setDependencies(service: DiagnoseService): void {
  _diagnoseService = service;
}

const router: Router = Router();

// Apply tenant isolation to every /:id/* route. Unauthenticated requests
// (no agentContext) get 401 from the middleware; mismatched siteIds get 403.
router.use('/:id', validateAppOwnership);

router.post('/:id/diagnose', async (req: Request, res: Response) => {
  const appId = req.params.id ?? '';
  const startedAt = Date.now();

  // PaaS-only gate. The diagnose API is scoped to Node.js Hosting customers —
  // reject any other product (including AAB) with 403.
  const product = (req as AuthenticatedRequest).agentContext?.product;
  if (product !== 'PaaSNodeJS') {
    logger.warn('route.diagnose.product_not_allowed', { appId, product });
    return res.status(403).json({
      success: false,
      error: 'Diagnose is only available for PaaS (Node.js Hosting) customers.',
      errorCode: 'PRODUCT_NOT_ALLOWED',
      analysis: buildUnknownAnalysis(() => Date.now(), startedAt),
    });
  }

  const parseResult = DiagnoseRequestBodySchema.safeParse(req.body ?? {});
  if (!parseResult.success) {
    const reason = parseResult.error.issues.map((i) => i.message).join('; ');
    logger.warn('route.diagnose.schema.validation_failed', {
      appId,
      reason,
    });
    return res.status(400).json({
      success: false,
      error: reason,
      errorCode: 'VALIDATION_ERROR',
      analysis: buildUnknownAnalysis(() => Date.now(), startedAt),
    });
  }

  const parsed = parseResult.data;
  const request: DiagnoseRequest = {
    appId,
    target: parsed.target,
    tier: parsed.tier,
  };

  logger.info('route.diagnose.request', {
    appId,
    target: request.target,
    tier: request.tier ?? 'pattern',
  });

  try {
    const result = await getDiagnoseService().diagnose(request);

    if (!result.success) {
      const status = errorCodeToStatus(result.errorCode);
      logger.warn('route.diagnose.service_error', {
        appId,
        errorCode: result.errorCode,
        status,
      });
      return res.status(status).json({
        success: false,
        error: result.error,
        errorCode: result.errorCode,
        analysis: result.analysis,
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    logger.error('route.diagnose.unhandled_error', {
      appId,
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      errorCode: 'UNKNOWN',
      analysis: buildUnknownAnalysis(() => Date.now(), startedAt),
    });
  }
});

const DiagnoseRequestBodySchema = z.object({
  target: z.enum(['preview', 'publish']),
  // 'embedding' is reserved in DiagnoseTier but not implemented, so it is
  // rejected at the HTTP boundary. The service keeps a runtime guard for
  // non-HTTP callers (defense-in-depth).
  tier: z.enum(['pattern', 'llm']).optional(),
});

function errorCodeToStatus(code: DiagnoseErrorCode): number {
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
    case 'LLM_FAILURE':
    case 'UNKNOWN':
      return 500;
  }
  // Exhaustiveness guard: a new DiagnoseErrorCode added without a case here
  // fails this assignment at compile time. Runtime fallback is still 500.
  const _exhaustive: never = code;
  void _exhaustive;
  return 500;
}

export default router;
