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
import { CustomerLogsService, MAX_LINES } from '../../services/customer-logs-service.js';
import { LogSanitizer } from '../../services/log-sanitizer.js';
import {
  DiagnoseService,
  PatternClassifier,
  LlmClassifier,
  DiagnoseLlmClient,
  ALL_PATTERNS,
  buildUnknownAnalysis,
} from '../../services/diagnose/index.js';
import type {
  DiagnoseErrorCode,
  DiagnoseRequest,
} from '../../services/diagnose/index.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';

const logger = Logger.create({ component: 'diagnose-routes' });

let _diagnoseService: DiagnoseService | null = null;

function getDiagnoseService(): DiagnoseService {
  if (!_diagnoseService) {
    const appRepo = new AppRepository();
    const customerLogsService = new CustomerLogsService(appRepo, new LogSanitizer());
    const patternClassifier = new PatternClassifier(ALL_PATTERNS);
    const llmClient = new DiagnoseLlmClient();
    const llmClassifier = new LlmClassifier(llmClient);
    _diagnoseService = new DiagnoseService({
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
      analysis: buildUnknownAnalysis(Date.now, startedAt),
    });
  }

  const parsed = parseResult.data;
  const request: DiagnoseRequest = {
    appId,
    target: parsed.target,
    since: parsed.since,
    lines: parsed.lines,
    options: parsed.options,
  };

  logger.info('route.diagnose.request', {
    appId,
    target: request.target,
    lines: request.lines,
    forceFullAnalysis: request.options?.forceFullAnalysis === true,
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
      analysis: buildUnknownAnalysis(Date.now, startedAt),
    });
  }
});

const DiagnoseRequestBodySchema = z.object({
  target: z.enum(['preview', 'publish']),
  since: z.string().datetime().optional(),
  lines: z.number().int().min(1).max(MAX_LINES).optional(),
  options: z
    .object({
      forceFullAnalysis: z.boolean().optional(),
    })
    .optional(),
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
    case 'CAP_EXCEEDED':
      return 429;
    case 'LLM_FAILURE':
    case 'UNKNOWN':
    default:
      return 500;
  }
}

export default router;
