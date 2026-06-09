import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

import type { AuthenticatedRequest } from '../../middleware/jwt-auth.js';

const APP_ID = 'abc1234567';
const mockFindById = vi.hoisted(() => vi.fn());
const mockGetStatus = vi.hoisted(() => vi.fn());
const mockSubmitIntake = vi.hoisted(() => vi.fn());

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () {
    return { findById: mockFindById };
  }),
}));

vi.mock('../../../services/RebuildOrchestrationService.js', () => ({
  RebuildOrchestrationService: vi.fn().mockImplementation(function () {
    return {
      getStatus: mockGetStatus,
      submitIntake: mockSubmitIntake,
    };
  }),
}));

vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as AuthenticatedRequest).agentContext = {
      siteId: APP_ID,
      customerId: 'cust-1',
      sessionId: 'sess-1',
      authType: 'basic',
      product: 'AiroAppBuilder',
    } as unknown as AuthenticatedRequest['agentContext'];
    next();
  });
  return app;
}

const validIntakeBody = {
  scope: 'homepage_only',
  stylePreferences: { designDirection: 'keep-similar' },
};

describe('rebuild routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById.mockResolvedValue({ id: APP_ID, path: '/tmp/test-app' });
  });

  it('GET scope-estimates returns all tiers', async function scopeEstimates() {
    const { default: rebuildRouter } = await import('../rebuild.js');
    const app = buildApp();
    app.use('/apps', rebuildRouter);

    const res = await request(app).get(`/apps/${APP_ID}/rebuild/scope-estimates`);

    expect(res.status).toBe(200);
    expect(res.body.estimates).toHaveLength(3);
    expect(res.body.estimates.map((e: { scope: string }) => e.scope)).toEqual([
      'homepage_only',
      'small',
      'large',
    ]);
  });

  it('GET status returns 404 when app not found', async function statusAppMissing() {
    mockFindById.mockResolvedValue(null);
    const { default: rebuildRouter } = await import('../rebuild.js');
    const app = buildApp();
    app.use('/apps', rebuildRouter);

    const res = await request(app).get(`/apps/${APP_ID}/rebuild/status`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('App not found');
  });

  it('GET status returns 404 when workflow missing', async function statusWorkflowMissing() {
    mockGetStatus.mockRejectedValue(new Error('missing'));
    const { default: rebuildRouter } = await import('../rebuild.js');
    const app = buildApp();
    app.use('/apps', rebuildRouter);

    const res = await request(app).get(`/apps/${APP_ID}/rebuild/status`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('No rebuild workflow found');
  });

  it('GET status returns 500 on unexpected failure', async function statusServerError() {
    mockFindById.mockRejectedValue(new Error('db down'));
    const { default: rebuildRouter } = await import('../rebuild.js');
    const app = buildApp();
    app.use('/apps', rebuildRouter);

    const res = await request(app).get(`/apps/${APP_ID}/rebuild/status`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to load rebuild status');
  });

  it('POST intake returns 400 for invalid payload', async function intakeBadRequest() {
    const { default: rebuildRouter } = await import('../rebuild.js');
    const app = buildApp();
    app.use('/apps', rebuildRouter);

    const res = await request(app)
      .post(`/apps/${APP_ID}/rebuild/intake`)
      .send({ scope: 'invalid' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid intake payload');
  });

  it('POST intake returns 404 when app not found', async function intakeAppMissing() {
    mockFindById.mockResolvedValue(null);
    const { default: rebuildRouter } = await import('../rebuild.js');
    const app = buildApp();
    app.use('/apps', rebuildRouter);

    const res = await request(app)
      .post(`/apps/${APP_ID}/rebuild/intake`)
      .send(validIntakeBody);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('App not found');
  });

  it('POST intake returns 404 when workflow state is missing', async function intakeWorkflowMissing() {
    mockSubmitIntake.mockRejectedValue(new Error('Workflow state not found'));
    const { default: rebuildRouter } = await import('../rebuild.js');
    const app = buildApp();
    app.use('/apps', rebuildRouter);

    const res = await request(app)
      .post(`/apps/${APP_ID}/rebuild/intake`)
      .send(validIntakeBody);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Workflow state not found');
  });

  it('POST intake returns 409 when workflow rejects intake', async function intakeConflict() {
    mockSubmitIntake.mockRejectedValue(new Error('Cannot submit intake: not awaiting_intake'));
    const { default: rebuildRouter } = await import('../rebuild.js');
    const app = buildApp();
    app.use('/apps', rebuildRouter);

    const res = await request(app)
      .post(`/apps/${APP_ID}/rebuild/intake`)
      .send(validIntakeBody);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Cannot submit intake');
  });

  it('POST intake returns 500 on unexpected failure', async function intakeServerError() {
    mockSubmitIntake.mockRejectedValue(new Error('disk full'));
    const { default: rebuildRouter } = await import('../rebuild.js');
    const app = buildApp();
    app.use('/apps', rebuildRouter);

    const res = await request(app)
      .post(`/apps/${APP_ID}/rebuild/intake`)
      .send(validIntakeBody);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to submit rebuild intake');
  });

  it('POST intake succeeds with valid payload', async function intakeSuccess() {
    mockSubmitIntake.mockResolvedValue({
      status: 'scraping',
      rebuildScope: 'homepage_only',
      intakeCompleted: true,
    });
    const { default: rebuildRouter } = await import('../rebuild.js');
    const app = buildApp();
    app.use('/apps', rebuildRouter);

    const res = await request(app)
      .post(`/apps/${APP_ID}/rebuild/intake`)
      .send(validIntakeBody);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('scraping');
    expect(res.body.intakeCompleted).toBe(true);
  });
});
