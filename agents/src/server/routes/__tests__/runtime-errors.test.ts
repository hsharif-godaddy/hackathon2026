import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const routeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  Logger: {
    // Return the same logger instance every time so tests can assert on
    // `route.runtime-errors.*` log events emitted from the route module.
    create: () => routeLogger
  }
}));

vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: vi.fn((req: any, res: any, next: any) => {
    if (!req.agentContext?.siteId) {
      return res.status(401).json({ error: 'auth' });
    }
    if (req.agentContext.siteId !== req.params.id) {
      return res.status(403).json({ error: 'denied' });
    }
    next();
  })
}));

import { runtimeErrorBuffer } from '../../../services/runtime-error-buffer.js';
const { default: runtimeErrorsRouter } = await import('../runtime-errors.js');

const APP_ID = 'app-runtime-route';

function createApp(siteId: string | null = APP_ID) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use((req: any, _res: any, next: any) => {
    if (siteId) req.agentContext = { siteId };
    next();
  });
  app.use('/apps', runtimeErrorsRouter);
  return app;
}

describe('POST /apps/:id/runtime-errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeErrorBuffer._resetForTests();
  });

  it('returns 204 and pushes a valid payload to the buffer', async () => {
    const before = Date.now();
    const payload = {
      message: 'x is undefined',
      name: 'TypeError',
      stack: 'TypeError: x is undefined\n  at foo',
      componentStack: '  at Component',
      url: 'http://localhost:5173/foo',
      timestamp: 123,
      cycleId: 100
    };
    const res = await request(createApp()).post(`/apps/${APP_ID}/runtime-errors`).send(payload);
    expect(res.status).toBe(204);
    expect(runtimeErrorBuffer.size(APP_ID)).toBe(1);
    const drained = runtimeErrorBuffer.drainForTurn(APP_ID, { seenSignatures: new Set() });
    expect(drained[0]).toMatchObject({
      message: 'x is undefined',
      name: 'TypeError',
      stack: expect.stringContaining('TypeError'),
      componentStack: '  at Component',
      url: 'http://localhost:5173/foo'
    });
    // Server-side stamp: client-supplied `timestamp: 123` is ignored on purpose.
    expect(drained[0]!.timestamp).toBeGreaterThanOrEqual(before);
    expect(drained[0]!.timestamp).not.toBe(123);
  });

  it('returns 204 and drops payloads missing required fields', async () => {
    const res = await request(createApp())
      .post(`/apps/${APP_ID}/runtime-errors`)
      .send({ stack: 'only', cycleId: 100 });
    expect(res.status).toBe(204);
    expect(runtimeErrorBuffer.size(APP_ID)).toBe(0);
  });

  it('returns 204 and drops payloads missing cycleId', async () => {
    // cycleId is required — the cycle-aware preview always has one.
    const res = await request(createApp())
      .post(`/apps/${APP_ID}/runtime-errors`)
      .send({ message: 'm', name: 'TypeError' });
    expect(res.status).toBe(204);
    expect(runtimeErrorBuffer.size(APP_ID)).toBe(0);
    // Operators need `hasCycleId: false` in the log to distinguish a
    // missing-field drop from a truly malformed payload — without it,
    // both paths log identically and silent drops are hard to diagnose.
    expect(routeLogger.warn).toHaveBeenCalledWith(
      'route.runtime-errors.invalid-payload',
      expect.objectContaining({ hasMessage: true, hasName: true, hasCycleId: false })
    );
  });

  it('returns 204 and drops payloads with a non-finite cycleId', async () => {
    const res = await request(createApp())
      .post(`/apps/${APP_ID}/runtime-errors`)
      .send({ message: 'm', name: 'TypeError', cycleId: 'nope' });
    expect(res.status).toBe(204);
    expect(runtimeErrorBuffer.size(APP_ID)).toBe(0);
    expect(routeLogger.warn).toHaveBeenCalledWith(
      'route.runtime-errors.invalid-payload',
      expect.objectContaining({ hasMessage: true, hasName: true, hasCycleId: false })
    );
  });

  it('clamps oversized string fields before buffering', async () => {
    const huge = 'x'.repeat(50_000);
    const res = await request(createApp()).post(`/apps/${APP_ID}/runtime-errors`).send({
      message: huge,
      name: 'TypeError',
      stack: huge,
      componentStack: huge,
      url: huge,
      cycleId: 100
    });
    expect(res.status).toBe(204);
    const [e] = runtimeErrorBuffer.drainForTurn(APP_ID, { seenSignatures: new Set() });
    expect(e!.message.length).toBeLessThanOrEqual(4_000);
    expect((e!.stack ?? '').length).toBeLessThanOrEqual(16_000);
    expect((e!.componentStack ?? '').length).toBeLessThanOrEqual(16_000);
    expect((e!.url ?? '').length).toBeLessThanOrEqual(2_000);
  });

  it('always stamps a server timestamp (and ignores any client-supplied one)', async () => {
    const before = Date.now();
    const res = await request(createApp())
      .post(`/apps/${APP_ID}/runtime-errors`)
      .send({ message: 'm', name: 'n', cycleId: 100 });
    expect(res.status).toBe(204);
    const [e] = runtimeErrorBuffer.drainForTurn(APP_ID, { seenSignatures: new Set() });
    expect(e!.timestamp).toBeGreaterThanOrEqual(before);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(createApp(null))
      .post(`/apps/${APP_ID}/runtime-errors`)
      .send({ message: 'm', name: 'n', cycleId: 100 });
    expect(res.status).toBe(401);
    expect(runtimeErrorBuffer.size(APP_ID)).toBe(0);
  });

  it('rejects cross-tenant requests with 403', async () => {
    const res = await request(createApp('different-site'))
      .post(`/apps/${APP_ID}/runtime-errors`)
      .send({ message: 'm', name: 'n', cycleId: 100 });
    expect(res.status).toBe(403);
    expect(runtimeErrorBuffer.size(APP_ID)).toBe(0);
  });

  it('dedups rapid duplicate pushes', async () => {
    const app = createApp();
    const payload = { message: 'dup', name: 'TypeError', stack: 'at a', cycleId: 100 };
    await request(app).post(`/apps/${APP_ID}/runtime-errors`).send(payload);
    await request(app).post(`/apps/${APP_ID}/runtime-errors`).send(payload);
    await request(app).post(`/apps/${APP_ID}/runtime-errors`).send(payload);
    expect(runtimeErrorBuffer.size(APP_ID)).toBe(1);
  });

  it('auto-rotates the app cycle on first push', async () => {
    // No prior /cycle POST — the first error push establishes the app's
    // cycle. Covers the race where the browser reports an error before
    // the dev-tools cycle beacon lands at the server.
    const res = await request(createApp())
      .post(`/apps/${APP_ID}/runtime-errors`)
      .send({ message: 'm', name: 'TypeError', cycleId: 100 });
    expect(res.status).toBe(204);
    expect(runtimeErrorBuffer.getCurrentCycleId(APP_ID)).toBe(100);
    expect(runtimeErrorBuffer.size(APP_ID)).toBe(1);
  });

  it('drops stale cycleId pushes without buffering them', async () => {
    const app = createApp();
    await request(app).post(`/apps/${APP_ID}/runtime-errors/cycle`).send({ cycleId: 200 });

    const res = await request(app)
      .post(`/apps/${APP_ID}/runtime-errors`)
      .send({ message: 'stale', name: 'TypeError', cycleId: 100 });
    // Route always returns 204 regardless of buffer verdict (no-leak policy).
    expect(res.status).toBe(204);
    expect(runtimeErrorBuffer.size(APP_ID)).toBe(0);
  });
});

describe('POST /apps/:id/runtime-errors/cycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeErrorBuffer._resetForTests();
  });

  it('returns 204 and rotates the app to the announced cycleId', async () => {
    const res = await request(createApp())
      .post(`/apps/${APP_ID}/runtime-errors/cycle`)
      .send({ cycleId: 42 });
    expect(res.status).toBe(204);
    expect(runtimeErrorBuffer.getCurrentCycleId(APP_ID)).toBe(42);
  });

  it('evicts entries from prior cycles on rotation', async () => {
    const app = createApp();
    await request(app).post(`/apps/${APP_ID}/runtime-errors`).send({
      message: 'gen-10',
      name: 'TypeError',
      stack: 'at a',
      cycleId: 10
    });
    expect(runtimeErrorBuffer.size(APP_ID)).toBe(1);

    await request(app).post(`/apps/${APP_ID}/runtime-errors/cycle`).send({ cycleId: 20 });
    expect(runtimeErrorBuffer.size(APP_ID)).toBe(0);
    expect(runtimeErrorBuffer.getCurrentCycleId(APP_ID)).toBe(20);
  });

  it('returns 204 and is a no-op on malformed cycle bodies', async () => {
    const res = await request(createApp())
      .post(`/apps/${APP_ID}/runtime-errors/cycle`)
      .send({ cycleId: 'not-a-number' });
    expect(res.status).toBe(204);
    expect(runtimeErrorBuffer.getCurrentCycleId(APP_ID)).toBeUndefined();
  });

  it('rejects unauthenticated cycle requests', async () => {
    const res = await request(createApp(null))
      .post(`/apps/${APP_ID}/runtime-errors/cycle`)
      .send({ cycleId: 1 });
    expect(res.status).toBe(401);
  });

  it('rejects cross-tenant cycle requests with 403', async () => {
    const res = await request(createApp('different-site'))
      .post(`/apps/${APP_ID}/runtime-errors/cycle`)
      .send({ cycleId: 1 });
    expect(res.status).toBe(403);
  });
});
