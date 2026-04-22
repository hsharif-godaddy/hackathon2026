import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  Logger: {
    create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
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
      timestamp: 123
    };
    const res = await request(createApp()).post(`/apps/${APP_ID}/runtime-errors`).send(payload);
    expect(res.status).toBe(204);
    expect(runtimeErrorBuffer.size(APP_ID)).toBe(1);
    const drained = runtimeErrorBuffer.drainForTurn(APP_ID, { since: 0, seenSignatures: new Set() });
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
    const res = await request(createApp()).post(`/apps/${APP_ID}/runtime-errors`).send({ stack: 'only' });
    expect(res.status).toBe(204);
    expect(runtimeErrorBuffer.size(APP_ID)).toBe(0);
  });

  it('clamps oversized string fields before buffering', async () => {
    const huge = 'x'.repeat(50_000);
    const res = await request(createApp()).post(`/apps/${APP_ID}/runtime-errors`).send({
      message: huge,
      name: 'TypeError',
      stack: huge,
      componentStack: huge,
      url: huge
    });
    expect(res.status).toBe(204);
    const [e] = runtimeErrorBuffer.drainForTurn(APP_ID, { since: 0, seenSignatures: new Set() });
    expect(e!.message.length).toBeLessThanOrEqual(4_000);
    expect((e!.stack ?? '').length).toBeLessThanOrEqual(16_000);
    expect((e!.componentStack ?? '').length).toBeLessThanOrEqual(16_000);
    expect((e!.url ?? '').length).toBeLessThanOrEqual(2_000);
  });

  it('always stamps a server timestamp (and ignores any client-supplied one)', async () => {
    const before = Date.now();
    const res = await request(createApp()).post(`/apps/${APP_ID}/runtime-errors`).send({
      message: 'm',
      name: 'n'
    });
    expect(res.status).toBe(204);
    const [e] = runtimeErrorBuffer.drainForTurn(APP_ID, { since: 0, seenSignatures: new Set() });
    expect(e!.timestamp).toBeGreaterThanOrEqual(before);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(createApp(null)).post(`/apps/${APP_ID}/runtime-errors`).send({
      message: 'm',
      name: 'n'
    });
    expect(res.status).toBe(401);
    expect(runtimeErrorBuffer.size(APP_ID)).toBe(0);
  });

  it('rejects cross-tenant requests with 403', async () => {
    const res = await request(createApp('different-site'))
      .post(`/apps/${APP_ID}/runtime-errors`)
      .send({ message: 'm', name: 'n' });
    expect(res.status).toBe(403);
    expect(runtimeErrorBuffer.size(APP_ID)).toBe(0);
  });

  it('dedups rapid duplicate pushes', async () => {
    const app = createApp();
    const payload = { message: 'dup', name: 'TypeError', stack: 'at a' };
    await request(app).post(`/apps/${APP_ID}/runtime-errors`).send(payload);
    await request(app).post(`/apps/${APP_ID}/runtime-errors`).send(payload);
    await request(app).post(`/apps/${APP_ID}/runtime-errors`).send(payload);
    expect(runtimeErrorBuffer.size(APP_ID)).toBe(1);
  });
});
