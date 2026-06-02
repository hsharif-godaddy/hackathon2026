import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

import type { AuthenticatedRequest } from '../../middleware/jwt-auth.js';

// Mock the SDKs at module boundary; we assert on the emit call shape, not
// against a real Event Bus client. Mirrors the pattern used for cost
// attribution at packages/ai-lib/src/budget/cost-attribution/__tests__/emit-cost-attribution-result.test.ts.
vi.mock('@godaddy/agent-otel-sdk', () => ({
  emitUserFeedback: vi.fn(),
  createAgentContext: vi.fn(function () { return { __marker: 'agent-ctx' }; }),
}));
vi.mock('@godaddy/agent-observability-events', () => ({
  // Return an EventObject-shaped value so the route-level `eventData` arg to
  // emitUserFeedback is recognizable; internals of the helper are exercised
  // by the package's own tests.
  createUserFeedback: vi.fn(function (opts: Record<string, unknown>) { return {
    schemaId: 'urn:shared:ai:event:/agent/user-feedback/v1',
    data: opts,
  }; }),
}));
vi.mock('@signals/otel-sdk', () => ({
  createTraceContext: vi.fn(function () { return { __marker: 'trace-ctx' }; }),
}));

// Partially mock @opentelemetry/api so we can observe whether the route seeds
// a span context. Other exports (context, etc.) keep their real behavior.
vi.mock('@opentelemetry/api', async () => {
  const actual = await vi.importActual<typeof import('@opentelemetry/api')>('@opentelemetry/api');
  return {
    ...actual,
    trace: {
      ...actual.trace,
      setSpanContext: vi.fn(function (ctx, _spanCtx) { return ctx; }),
    },
  };
});

import { emitUserFeedback, createAgentContext } from '@godaddy/agent-otel-sdk';
import { createUserFeedback } from '@godaddy/agent-observability-events';
import { createTraceContext } from '@signals/otel-sdk';
import { trace as otelTrace } from '@opentelemetry/api';

const APP_ID = 'abc1234567'; // matches /^[a-z0-9]{10}$/ so ownership middleware accepts it
const OTHER_APP_ID = 'zyx9876543';
const SITE_ID = APP_ID; // single-tenant agent: siteId == appId
const BYPASS_SITE_ID = 'local-dev-site'; // from BYPASS_SITE_IDS

function buildApp(router: express.Router, siteId: string = SITE_ID): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as AuthenticatedRequest).agentContext = {
      siteId,
      customerId: 'cust-1',
      sessionId: 'sess-1',
      authType: 'basic',
      product: 'AiroAppBuilder',
    } as unknown as AuthenticatedRequest['agentContext'];
    next();
  });
  app.use('/', router);
  return app;
}

const validBody = {
  feedback: 'positive' as const,
  targetLevel: 'artifact' as const,
  targetId: APP_ID,
  traceId: '0123456789abcdef0123456789abcdef',
  observationId: '0123456789abcdef',
  appId: APP_ID,
  conversationId: 'conv-xyz-789',
};

describe('feedback route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards caller-supplied feedback/targetLevel/targetId and sets businessContext via createTraceContext', async () => {
    const { default: feedbackRouter } = await import('../feedback.js');
    const app = buildApp(feedbackRouter);

    const res = await request(app).post('/feedback').send(validBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    expect(createUserFeedback).toHaveBeenCalledTimes(1);
    const helperArg = vi.mocked(createUserFeedback).mock.calls[0][0];
    expect(helperArg).toMatchObject({
      targetLevel: 'artifact',
      targetId: APP_ID,
      feedback: 'positive',
      hasDetailedFeedback: false,
    });
    expect(helperArg.eventCreationTimestamp).toBeInstanceOf(Date);
    // conversationId is NOT passed to the helper — targetId is explicit now.
    expect(helperArg).not.toHaveProperty('conversationId');

    expect(emitUserFeedback).toHaveBeenCalledTimes(1);
    const emitArg = vi.mocked(emitUserFeedback).mock.calls[0][0];
    expect(emitArg.eventData.schemaId).toBe('urn:shared:ai:event:/agent/user-feedback/v1');
    // businessContext is set upstream via createTraceContext, NOT inline on emit.
    expect(emitArg).not.toHaveProperty('businessContext');
    // Valid OTel IDs must reach trace.setSpanContext so the event stitches
    // onto the existing Langfuse trace. If the validation regex lengths
    // were ever swapped (32 vs 16), this assertion would trip.
    expect(otelTrace.setSpanContext).toHaveBeenCalledTimes(1);
    expect(otelTrace.setSpanContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        traceId: validBody.traceId,
        spanId: validBody.observationId,
        traceFlags: 1,
        isRemote: true,
      }),
    );
    expect(createTraceContext).toHaveBeenCalledWith(
      expect.objectContaining({
        businessContext: {
          schemaId: 'urn:shared:user:business-context:/airo-app-builder/v1',
          data: { appId: APP_ID },
        },
      }),
    );
  });

  it('parses eventCreationTimestamp into a Date for createUserFeedback', async () => {
    const { default: feedbackRouter } = await import('../feedback.js');
    const app = buildApp(feedbackRouter);

    const isoTimestamp = '2026-05-26T12:34:56.789Z';
    await request(app).post('/feedback').send({ ...validBody, eventCreationTimestamp: isoTimestamp });

    const helperArg = vi.mocked(createUserFeedback).mock.calls[0][0];
    expect(helperArg.eventCreationTimestamp).toBeInstanceOf(Date);
    expect((helperArg.eventCreationTimestamp as Date).toISOString()).toBe(isoTimestamp);
  });

  it('returns 400 when eventCreationTimestamp has month 00', async () => {
    const { default: feedbackRouter } = await import('../feedback.js');
    const app = buildApp(feedbackRouter);

    const res = await request(app)
      .post('/feedback')
      .send({ ...validBody, eventCreationTimestamp: '2026-00-15T12:00:00Z' });

    expect(res.status).toBe(400);
    expect(createUserFeedback).not.toHaveBeenCalled();
  });

  it('forwards feedback: "negative" unchanged', async () => {
    const { default: feedbackRouter } = await import('../feedback.js');
    const app = buildApp(feedbackRouter);

    await request(app).post('/feedback').send({ ...validBody, feedback: 'negative' });

    expect(createUserFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ feedback: 'negative' }),
    );
  });

  it('forwards alternate targetLevel + targetId combinations unchanged', async () => {
    const { default: feedbackRouter } = await import('../feedback.js');
    const app = buildApp(feedbackRouter);

    await request(app).post('/feedback').send({
      ...validBody,
      targetLevel: 'invocation',
      targetId: 'invocation-abc-123',
    });

    expect(createUserFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        targetLevel: 'invocation',
        targetId: 'invocation-abc-123',
      }),
    );
  });

  it('canonicalizes agentName to airo-app-builder-{name} when provided', async () => {
    const { default: feedbackRouter } = await import('../feedback.js');
    const app = buildApp(feedbackRouter);

    await request(app).post('/feedback').send({ ...validBody, agentName: 'InitialAgent' });

    expect(createAgentContext).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-xyz-789',
        agentId: 'airo-app-builder-InitialAgent',
      }),
    );
  });

  it('falls back to airo-app-builder-unknown when agentName is omitted', async () => {
    const { default: feedbackRouter } = await import('../feedback.js');
    const app = buildApp(feedbackRouter);

    await request(app).post('/feedback').send(validBody);

    expect(createAgentContext).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'airo-app-builder-unknown',
      }),
    );
  });

  it('returns 400 and does not emit when feedback is missing', async () => {
    const { default: feedbackRouter } = await import('../feedback.js');
    const app = buildApp(feedbackRouter, BYPASS_SITE_ID);

    const { feedback: _drop, ...bodyWithoutFeedback } = validBody;
    const res = await request(app).post('/feedback').send(bodyWithoutFeedback);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid payload');
    expect(emitUserFeedback).not.toHaveBeenCalled();
  });

  it('returns 400 and does not emit when feedback is not in the enum', async () => {
    const { default: feedbackRouter } = await import('../feedback.js');
    const app = buildApp(feedbackRouter, BYPASS_SITE_ID);

    const res = await request(app).post('/feedback').send({ ...validBody, feedback: 'maybe' });

    expect(res.status).toBe(400);
    expect(emitUserFeedback).not.toHaveBeenCalled();
  });

  it('returns 400 and does not emit when targetLevel is missing', async () => {
    const { default: feedbackRouter } = await import('../feedback.js');
    const app = buildApp(feedbackRouter, BYPASS_SITE_ID);

    const { targetLevel: _drop, ...bodyWithoutLevel } = validBody;
    const res = await request(app).post('/feedback').send(bodyWithoutLevel);

    expect(res.status).toBe(400);
    expect(emitUserFeedback).not.toHaveBeenCalled();
  });

  it('returns 400 and does not emit when targetId is missing', async () => {
    const { default: feedbackRouter } = await import('../feedback.js');
    const app = buildApp(feedbackRouter, BYPASS_SITE_ID);

    const { targetId: _drop, ...bodyWithoutTargetId } = validBody;
    const res = await request(app).post('/feedback').send(bodyWithoutTargetId);

    expect(res.status).toBe(400);
    expect(emitUserFeedback).not.toHaveBeenCalled();
  });

  it('returns 400 and does not emit when conversationId is missing', async () => {
    const { default: feedbackRouter } = await import('../feedback.js');
    const app = buildApp(feedbackRouter, BYPASS_SITE_ID);

    const { conversationId: _drop, ...bodyWithoutConvo } = validBody;
    const res = await request(app).post('/feedback').send(bodyWithoutConvo);

    expect(res.status).toBe(400);
    expect(emitUserFeedback).not.toHaveBeenCalled();
  });

  it('accepts missing traceId/observationId and still emits the event', async () => {
    const { default: feedbackRouter } = await import('../feedback.js');
    const app = buildApp(feedbackRouter);

    const { traceId: _t, observationId: _o, ...bodyWithoutTraceIds } = validBody;
    const res = await request(app).post('/feedback').send(bodyWithoutTraceIds);

    expect(res.status).toBe(200);
    expect(emitUserFeedback).toHaveBeenCalledTimes(1);
    expect(createUserFeedback).toHaveBeenCalledTimes(1);
    // Without IDs we must not seed a span context — the event lands on its
    // own trace rather than attaching to one that doesn't exist.
    expect(otelTrace.setSpanContext).not.toHaveBeenCalled();
    // businessContext is still wired up so the event carries appId context
    // even without span seeding.
    expect(createTraceContext).toHaveBeenCalledWith(
      expect.objectContaining({
        businessContext: {
          schemaId: 'urn:shared:user:business-context:/airo-app-builder/v1',
          data: { appId: APP_ID },
        },
      }),
    );
  });

  // Malformed or poisoned trace IDs must be treated as absent — the feedback
  // still emits (we don't want to reject the thumb click), but the span
  // context isn't seeded, so Langfuse correlation is skipped rather than
  // pointing at a broken trace. Guards against regex-length swaps and a
  // missing INVALID-sentinel check.
  describe('trace ID validation', () => {
    it('drops a malformed traceId (wrong length) — event still emits, span is not seeded', async () => {
      const { default: feedbackRouter } = await import('../feedback.js');
      const app = buildApp(feedbackRouter);

      const res = await request(app).post('/feedback').send({
        ...validBody,
        traceId: '0123456789abcdef0123456789abcde', // 31 chars, not 32
      });

      expect(res.status).toBe(200);
      expect(emitUserFeedback).toHaveBeenCalledTimes(1);
      expect(otelTrace.setSpanContext).not.toHaveBeenCalled();
    });

    it('drops a traceId with non-hex characters', async () => {
      const { default: feedbackRouter } = await import('../feedback.js');
      const app = buildApp(feedbackRouter);

      const res = await request(app).post('/feedback').send({
        ...validBody,
        traceId: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
      });

      expect(res.status).toBe(200);
      expect(emitUserFeedback).toHaveBeenCalledTimes(1);
      expect(otelTrace.setSpanContext).not.toHaveBeenCalled();
    });

    it('drops an all-zeros traceId (OTel INVALID sentinel)', async () => {
      const { default: feedbackRouter } = await import('../feedback.js');
      const app = buildApp(feedbackRouter);

      const res = await request(app).post('/feedback').send({
        ...validBody,
        traceId: '0'.repeat(32),
      });

      expect(res.status).toBe(200);
      expect(emitUserFeedback).toHaveBeenCalledTimes(1);
      expect(otelTrace.setSpanContext).not.toHaveBeenCalled();
    });

    it('drops an all-zeros observationId (OTel INVALID sentinel)', async () => {
      const { default: feedbackRouter } = await import('../feedback.js');
      const app = buildApp(feedbackRouter);

      const res = await request(app).post('/feedback').send({
        ...validBody,
        observationId: '0'.repeat(16),
      });

      expect(res.status).toBe(200);
      expect(emitUserFeedback).toHaveBeenCalledTimes(1);
      expect(otelTrace.setSpanContext).not.toHaveBeenCalled();
    });

    it('requires both IDs to seed — valid traceId + malformed observationId drops the seed (AND guard)', async () => {
      const { default: feedbackRouter } = await import('../feedback.js');
      const app = buildApp(feedbackRouter);

      const res = await request(app).post('/feedback').send({
        ...validBody,
        observationId: 'nothex',
      });

      expect(res.status).toBe(200);
      expect(emitUserFeedback).toHaveBeenCalledTimes(1);
      expect(otelTrace.setSpanContext).not.toHaveBeenCalled();
    });

    it('accepts both-malformed — event still returns 200 without span seeding', async () => {
      const { default: feedbackRouter } = await import('../feedback.js');
      const app = buildApp(feedbackRouter);

      const res = await request(app).post('/feedback').send({
        ...validBody,
        traceId: 'bogus',
        observationId: 'also-bogus',
      });

      expect(res.status).toBe(200);
      expect(emitUserFeedback).toHaveBeenCalledTimes(1);
      expect(otelTrace.setSpanContext).not.toHaveBeenCalled();
    });
  });

  it('returns 403 and does not emit when appId does not match the authenticated siteId', async () => {
    const { default: feedbackRouter } = await import('../feedback.js');
    const app = buildApp(feedbackRouter, SITE_ID); // siteId=APP_ID, body has OTHER_APP_ID

    const res = await request(app).post('/feedback').send({ ...validBody, appId: OTHER_APP_ID });

    expect(res.status).toBe(403);
    expect(emitUserFeedback).not.toHaveBeenCalled();
  });
});
