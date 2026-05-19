import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

import diagnoseRouter, { _resetDependencies, _setDependencies } from '../diagnose.js';
import type { DiagnoseService } from '../../../services/diagnose/index.js';
import type { AuthenticatedRequest } from '../../middleware/jwt-auth.js';

const APP_ID = 'abc1234567';

function buildApp(
  service: Pick<DiagnoseService, 'diagnose'>,
  siteId: string = APP_ID,
  product: string = 'PaaSNodeJS',
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
  _setDependencies(service as DiagnoseService);
  app.use('/apps', diagnoseRouter);
  return app;
}

function healthyAnalysis() {
  return {
    status: 'healthy' as const,
    issues: [],
    summary: { totalIssues: 0, errors: 0, warnings: 0, primaryRecommendation: 'x' },
    metadata: { logsAnalyzed: 5, tierUsed: 'llm' as const, analysisTimeMs: 10 },
  };
}

describe('diagnose route', () => {
  beforeEach(() => {
    _resetDependencies();
  });

  afterEach(() => {
    _resetDependencies();
  });

  describe('success', () => {
    it('200 on successful analysis', async () => {
      const service = { diagnose: vi.fn().mockResolvedValue({ success: true, analysis: healthyAnalysis() }) };

      const app = buildApp(service);
      const res = await request(app)
        .post(`/apps/${APP_ID}/diagnose`)
        .send({ target: 'publish' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(service.diagnose).toHaveBeenCalledWith({
        appId: APP_ID,
        target: 'publish',
        tier: undefined,
      });
    });

    it('200 on successful preview analysis', async () => {
      const service = { diagnose: vi.fn().mockResolvedValue({ success: true, analysis: healthyAnalysis() }) };

      const app = buildApp(service);
      const res = await request(app)
        .post(`/apps/${APP_ID}/diagnose`)
        .send({ target: 'preview' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(service.diagnose).toHaveBeenCalledWith({
        appId: APP_ID,
        target: 'preview',
        tier: undefined,
      });
    });

    it('forwards tier when provided', async () => {
      const service = { diagnose: vi.fn().mockResolvedValue({ success: true, analysis: healthyAnalysis() }) };
      const app = buildApp(service);

      await request(app)
        .post(`/apps/${APP_ID}/diagnose`)
        .send({ target: 'publish', tier: 'llm' });

      expect(service.diagnose).toHaveBeenCalledWith({
        appId: APP_ID,
        target: 'publish',
        tier: 'llm',
      });
    });
  });

  describe('validation', () => {
    it('400 when target is missing', async () => {
      const service = { diagnose: vi.fn() };
      const app = buildApp(service);

      const res = await request(app)
        .post(`/apps/${APP_ID}/diagnose`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
      expect(service.diagnose).not.toHaveBeenCalled();
    });

    it('400 when target is not "preview" or "publish"', async () => {
      const service = { diagnose: vi.fn() };
      const app = buildApp(service);

      const res = await request(app)
        .post(`/apps/${APP_ID}/diagnose`)
        .send({ target: 'staging' });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
      expect(service.diagnose).not.toHaveBeenCalled();
    });

    it('400 when tier is not a valid enum value', async () => {
      const service = { diagnose: vi.fn() };
      const app = buildApp(service);

      const res = await request(app)
        .post(`/apps/${APP_ID}/diagnose`)
        .send({ target: 'publish', tier: 'made-up' });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
      expect(service.diagnose).not.toHaveBeenCalled();
    });

    it('400 when tier is "embedding" (reserved but not exposed via HTTP)', async () => {
      const service = { diagnose: vi.fn() };
      const app = buildApp(service);

      const res = await request(app)
        .post(`/apps/${APP_ID}/diagnose`)
        .send({ target: 'publish', tier: 'embedding' });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
      expect(service.diagnose).not.toHaveBeenCalled();
    });

    it('400 when tier is legacy "pattern"', async () => {
      const service = { diagnose: vi.fn() };
      const app = buildApp(service);

      const res = await request(app)
        .post(`/apps/${APP_ID}/diagnose`)
        .send({ target: 'publish', tier: 'pattern' });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
      expect(service.diagnose).not.toHaveBeenCalled();
    });
  });

  describe('product gating', () => {
    it('403 when product is AiroAppBuilder', async () => {
      const service = { diagnose: vi.fn() };
      const app = buildApp(service, APP_ID, 'AiroAppBuilder');

      const res = await request(app)
        .post(`/apps/${APP_ID}/diagnose`)
        .send({ target: 'publish' });

      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('PRODUCT_NOT_ALLOWED');
      expect(service.diagnose).not.toHaveBeenCalled();
    });

    it('403 when product is absent', async () => {
      const service = { diagnose: vi.fn() };
      const app = buildApp(service, APP_ID, '');

      const res = await request(app)
        .post(`/apps/${APP_ID}/diagnose`)
        .send({ target: 'publish' });

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
    ] as const)('maps errorCode=%s to HTTP %i', async (errorCode, expectedStatus) => {
      const service = { diagnose: vi.fn().mockResolvedValue({
        success: false,
        error: 'oh no',
        errorCode,
        analysis: {
          status: 'unknown',
          issues: [],
          summary: { totalIssues: 0, errors: 0, warnings: 0, primaryRecommendation: 'x' },
          metadata: { logsAnalyzed: 0, tierUsed: 'llm', analysisTimeMs: 1 },
        },
      }) };

      const app = buildApp(service);
      const res = await request(app)
        .post(`/apps/${APP_ID}/diagnose`)
        .send({ target: 'publish' });

      expect(res.status).toBe(expectedStatus);
      expect(res.body.errorCode).toBe(errorCode);
    });

    it('500 when service throws', async () => {
      const service = { diagnose: vi.fn().mockRejectedValue(new Error('kaboom')) };
      const app = buildApp(service);

      const res = await request(app)
        .post(`/apps/${APP_ID}/diagnose`)
        .send({ target: 'publish' });

      expect(res.status).toBe(500);
      expect(res.body.errorCode).toBe('UNKNOWN');
    });
  });

  describe('tenant isolation', () => {
    it('403 when appId does not match the JWT siteId', async () => {
      const service = { diagnose: vi.fn() };
      const app = buildApp(service, 'different-site');

      const res = await request(app)
        .post(`/apps/${APP_ID}/diagnose`)
        .send({ target: 'publish' });

      expect(res.status).toBe(403);
      expect(service.diagnose).not.toHaveBeenCalled();
    });

    it('401 when agentContext is missing', async () => {
      const service = { diagnose: vi.fn() };
      const app = express();
      app.use(express.json());
      _setDependencies(service as DiagnoseService);
      app.use('/apps', diagnoseRouter);

      const res = await request(app)
        .post(`/apps/${APP_ID}/diagnose`)
        .send({ target: 'publish' });

      expect(res.status).toBe(401);
      expect(service.diagnose).not.toHaveBeenCalled();
    });
  });
});
