import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

import autoFixRouter, { _resetDependencies, _setDependencies } from '../auto-fix.js';
import type { AutoFixService } from '../../../services/auto-fix/index.js';
import type { Analysis } from '../../../services/diagnose/index.js';
import type { AuthenticatedRequest } from '../../middleware/jwt-auth.js';

const APP_ID = 'app1234567';

function buildApp(
  service: Pick<AutoFixService, 'autoFix'>,
  siteId: string = APP_ID,
  product: string = 'PaaSNodeJS'
): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as AuthenticatedRequest).agentContext = {
      siteId,
      customerId: 'cust-1',
      sessionId: 'sess-1',
      authType: 'basic',
      product,
    } as AuthenticatedRequest['agentContext'];
    next();
  });
  _setDependencies(service as AutoFixService);
  app.use('/apps', autoFixRouter);
  return app;
}

function healthyAnalysis(): Analysis {
  return {
    status: 'healthy',
    issues: [],
    summary: { totalIssues: 0, errors: 0, warnings: 0, primaryRecommendation: 'x' },
    metadata: { logsAnalyzed: 1, tierUsed: 'llm', analysisTimeMs: 1 },
  };
}

function unknownAnalysis(): Analysis {
  return {
    status: 'unknown',
    issues: [],
    summary: { totalIssues: 0, errors: 0, warnings: 0, primaryRecommendation: 'x' },
    metadata: { logsAnalyzed: 0, tierUsed: 'llm', analysisTimeMs: 1 },
  };
}

describe('auto-fix route', () => {
  beforeEach(() => _resetDependencies());
  afterEach(() => _resetDependencies());

  describe('success', () => {
    it('200 with appliedActions and postFixAnalysis on happy path', async () => {
      const service = {
        autoFix: vi.fn().mockResolvedValue({
          success: true,
          analysis: healthyAnalysis(),
          postFixAnalysis: healthyAnalysis(),
          appliedActions: [
            {
              action: { type: 'command', command: 'npm install lodash' },
              status: 'applied',
              output: 'ok',
            },
          ],
          restarted: true,
        }),
      };

      const app = buildApp(service);
      const res = await request(app)
        .post(`/apps/${APP_ID}/auto-fix`)
        .send({ target: 'preview' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.appliedActions).toHaveLength(1);
      expect(res.body.restarted).toBe(true);
      expect(service.autoFix).toHaveBeenCalledWith({
        appId: APP_ID,
        target: 'preview',
      });
    });

    it('forwards tier and dryRun when provided', async () => {
      const service = {
        autoFix: vi.fn().mockResolvedValue({
          success: true,
          analysis: healthyAnalysis(),
          postFixAnalysis: healthyAnalysis(),
          appliedActions: [],
          restarted: false,
        }),
      };
      const app = buildApp(service);

      await request(app)
        .post(`/apps/${APP_ID}/auto-fix`)
        .send({ target: 'preview', tier: 'llm', dryRun: true });

      expect(service.autoFix).toHaveBeenCalledWith({
        appId: APP_ID,
        target: 'preview',
        tier: 'llm',
        dryRun: true,
      });
    });
  });

  describe('validation', () => {
    it('400 when target is missing', async () => {
      const service = { autoFix: vi.fn() };
      const app = buildApp(service);

      const res = await request(app)
        .post(`/apps/${APP_ID}/auto-fix`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
      expect(service.autoFix).not.toHaveBeenCalled();
    });

    it('400 when target is "publish" (preview-only endpoint)', async () => {
      const service = { autoFix: vi.fn() };
      const app = buildApp(service);

      const res = await request(app)
        .post(`/apps/${APP_ID}/auto-fix`)
        .send({ target: 'publish' });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
      expect(service.autoFix).not.toHaveBeenCalled();
    });

    it('400 when tier is "embedding" or "pattern"', async () => {
      const service = { autoFix: vi.fn() };
      const app = buildApp(service);

      for (const tier of ['embedding', 'pattern']) {
        const res = await request(app)
          .post(`/apps/${APP_ID}/auto-fix`)
          .send({ target: 'preview', tier });
        expect(res.status).toBe(400);
        expect(res.body.errorCode).toBe('VALIDATION_ERROR');
      }
      expect(service.autoFix).not.toHaveBeenCalled();
    });
  });

  describe('product gating', () => {
    it('403 when product is AiroAppBuilder', async () => {
      const service = { autoFix: vi.fn() };
      const app = buildApp(service, APP_ID, 'AiroAppBuilder');

      const res = await request(app)
        .post(`/apps/${APP_ID}/auto-fix`)
        .send({ target: 'preview' });

      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('PRODUCT_NOT_ALLOWED');
      expect(service.autoFix).not.toHaveBeenCalled();
    });

    it('403 when product is absent', async () => {
      const service = { autoFix: vi.fn() };
      const app = buildApp(service, APP_ID, '');

      const res = await request(app)
        .post(`/apps/${APP_ID}/auto-fix`)
        .send({ target: 'preview' });

      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('PRODUCT_NOT_ALLOWED');
    });
  });

  describe('error mapping', () => {
    it.each([
      ['APP_NOT_FOUND', 404],
      ['SUPERVISOR_UNAVAILABLE', 503],
      ['UPSTREAM_UNAVAILABLE', 503],
      ['VALIDATION_ERROR', 400],
      ['ANOTHER_DIAGNOSE_IN_FLIGHT', 409],
      ['CAP_EXCEEDED', 429],
      ['TIER_NOT_IMPLEMENTED', 501],
      ['LLM_FAILURE', 500],
      ['UNKNOWN', 500],
      ['APPLY_FAILED', 500],
      ['NO_ACTIONABLE_FIXES', 200],
      ['VERIFICATION_FAILED', 200],
    ] as const)('maps errorCode=%s to HTTP %i', async (errorCode, expectedStatus) => {
      const service = {
        autoFix: vi.fn().mockResolvedValue({
          success: false,
          error: 'oh no',
          errorCode,
          analysis: unknownAnalysis(),
        }),
      };

      const app = buildApp(service);
      const res = await request(app)
        .post(`/apps/${APP_ID}/auto-fix`)
        .send({ target: 'preview' });

      expect(res.status).toBe(expectedStatus);
      expect(res.body.errorCode).toBe(errorCode);
      expect(res.body.success).toBe(false);
    });

    it('500 when service throws', async () => {
      const service = { autoFix: vi.fn().mockRejectedValue(new Error('kaboom')) };
      const app = buildApp(service);

      const res = await request(app)
        .post(`/apps/${APP_ID}/auto-fix`)
        .send({ target: 'preview' });

      expect(res.status).toBe(500);
      expect(res.body.errorCode).toBe('UNKNOWN');
    });

    it('preserves appliedActions and postFixAnalysis on failure responses', async () => {
      const service = {
        autoFix: vi.fn().mockResolvedValue({
          success: false,
          error: 'still failing',
          errorCode: 'VERIFICATION_FAILED',
          analysis: unknownAnalysis(),
          postFixAnalysis: { ...unknownAnalysis(), status: 'failing' },
          appliedActions: [
            { action: { type: 'command', command: 'npm install' }, status: 'applied' },
          ],
        }),
      };

      const app = buildApp(service);
      const res = await request(app)
        .post(`/apps/${APP_ID}/auto-fix`)
        .send({ target: 'preview' });

      expect(res.status).toBe(200);
      expect(res.body.errorCode).toBe('VERIFICATION_FAILED');
      expect(res.body.postFixAnalysis.status).toBe('failing');
      expect(res.body.appliedActions).toHaveLength(1);
    });
  });

  describe('tenant isolation', () => {
    it('403 when appId does not match the JWT siteId', async () => {
      const service = { autoFix: vi.fn() };
      const app = buildApp(service, 'different-site');

      const res = await request(app)
        .post(`/apps/${APP_ID}/auto-fix`)
        .send({ target: 'preview' });

      expect(res.status).toBe(403);
      expect(service.autoFix).not.toHaveBeenCalled();
    });

    it('401 when agentContext is missing', async () => {
      const service = { autoFix: vi.fn() };
      const app = express();
      app.use(express.json());
      _setDependencies(service as AutoFixService);
      app.use('/apps', autoFixRouter);

      const res = await request(app)
        .post(`/apps/${APP_ID}/auto-fix`)
        .send({ target: 'preview' });

      expect(res.status).toBe(401);
      expect(service.autoFix).not.toHaveBeenCalled();
    });
  });
});
