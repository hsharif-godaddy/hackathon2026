import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { summaryStoreMock, lifecycleMock, messageStoreMock } = vi.hoisted(() => ({
  summaryStoreMock: {
    create: vi.fn(),
    deleteByAppId: vi.fn(),
  },
  lifecycleMock: {
    getByAppId: vi.fn(),
    delete: vi.fn(),
    create: vi.fn(),
  },
  messageStoreMock: {
    addMessage: vi.fn(),
  },
}));

vi.mock('../../../memory/adapters/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../memory/adapters/index.js')>()),
  getSummaryStore: vi.fn(() => summaryStoreMock),
  getConversationLifecycleStore: vi.fn(() => lifecycleMock),
  getMessageStore: vi.fn(() => messageStoreMock),
}));

// countTokens is the only other adapter the seed handler touches; stub it to a
// deterministic value so the test doesn't depend on a real tokenizer.
vi.mock('../../../utils/token-counter.js', () => ({
  countTokens: vi.fn(async () => 42),
}));

// The seed handler runs under validateAppIdParam (validateAppOwnership). Stub it
// to a pass-through that records the appId the way the real middleware leaves it.
vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: (req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

// isSeedSummaryEnabled gates on auth.isMock() (the resolved auth type, not raw
// env). features memoizes getFeatures() and defaults to MOCK under NODE_ENV=test,
// so env toggling can't deterministically drive it — mock the resolver instead.
const { authMock } = vi.hoisted(() => ({
  authMock: { isMock: vi.fn(() => true) },
}));
vi.mock('../../../services/features.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/features.js')>()),
  auth: authMock,
}));

import debugRouter from '../debug.js';

function makeApp(customerId?: string): express.Express {
  const app = express();
  app.use(express.json());
  if (customerId) {
    app.use((req, _res, next) => {
      (req as express.Request & { agentContext?: { customerId: string } }).agentContext = { customerId };
      next();
    });
  }
  app.use('/debug', debugRouter);
  return app;
}

describe('POST /debug/:appId/seed-summary', () => {
  const savedGasketEnv: string | undefined = process.env.GASKET_ENV;

  beforeEach(() => {
    // The endpoint is gated to local/eval environments; enable it for the tests
    // via the mocked auth resolver (the real gate keys on auth.isMock()).
    authMock.isMock.mockReset().mockReturnValue(true);
    delete process.env.GASKET_ENV;
    summaryStoreMock.create.mockReset().mockResolvedValue({ id: 'sum-1' });
    summaryStoreMock.deleteByAppId.mockReset().mockResolvedValue(undefined);
    lifecycleMock.getByAppId.mockReset().mockResolvedValue([]);
    lifecycleMock.delete.mockReset().mockResolvedValue(undefined);
    lifecycleMock.create.mockReset().mockResolvedValue({ id: 'conv-seeded' });
    messageStoreMock.addMessage.mockReset().mockResolvedValue({ id: 'm-1' });
  });

  afterEach(() => {
    if (savedGasketEnv === undefined) delete process.env.GASKET_ENV;
    else process.env.GASKET_ENV = savedGasketEnv;
  });

  it('returns 404 and writes nothing when not in a local/eval environment', async () => {
    delete process.env.GASKET_ENV;
    authMock.isMock.mockReturnValue(false);

    await request(makeApp())
      .post('/debug/app-1/seed-summary')
      .send({ summaryText: 'hi' })
      .expect(404);

    expect(lifecycleMock.delete).not.toHaveBeenCalled();
    expect(summaryStoreMock.deleteByAppId).not.toHaveBeenCalled();
    expect(summaryStoreMock.create).not.toHaveBeenCalled();
  });

  it('is enabled when GASKET_ENV starts with local', async () => {
    authMock.isMock.mockReturnValue(false);
    process.env.GASKET_ENV = 'local.dev';

    await request(makeApp())
      .post('/debug/app-1/seed-summary')
      .send({ summaryText: 'hi' })
      .expect(201);
  });

  it('writes a summary via the store and returns its id', async () => {
    const res = await request(makeApp())
      .post('/debug/app-1/seed-summary')
      .send({ summaryText: '## State\nLanding page built.' })
      .expect(201);

    expect(res.body).toEqual({ success: true, summaryId: 'sum-1', summaryTokenCount: 42 });
    expect(summaryStoreMock.create).toHaveBeenCalledOnce();
    const [scope, result] = summaryStoreMock.create.mock.calls[0];
    expect(scope).toEqual({ kind: 'local', appId: 'app-1' });
    expect(result).toMatchObject({
      summaryText: '## State\nLanding page built.',
      summaryTokenCount: 42,
      modelUsed: 'eval-seed',
      messageCount: 0,
      originalTokenCount: 42,
    });
  });

  it('scopes the summary to the authenticated customer when present', async () => {
    await request(makeApp('cust-9'))
      .post('/debug/app-1/seed-summary')
      .send({ summaryText: 'hi' })
      .expect(201);

    const [scope] = summaryStoreMock.create.mock.calls[0];
    expect(scope).toEqual({ kind: 'resolved', appId: 'app-1', customerId: 'cust-9' });
  });

  it('honors provided metadata overrides', async () => {
    await request(makeApp())
      .post('/debug/app-1/seed-summary')
      .send({ summaryText: 'hi', messageCount: 8, originalTokenCount: 5000, modelUsed: 'sonnet' })
      .expect(201);

    const [, result] = summaryStoreMock.create.mock.calls[0];
    expect(result).toMatchObject({ messageCount: 8, originalTokenCount: 5000, modelUsed: 'sonnet' });
  });

  it('rejects an empty summaryText with 400', async () => {
    await request(makeApp())
      .post('/debug/app-1/seed-summary')
      .send({ summaryText: '' })
      .expect(400);

    expect(summaryStoreMock.create).not.toHaveBeenCalled();
  });

  it('returns 500 when the store write fails', async () => {
    summaryStoreMock.create.mockRejectedValue(new Error('db down'));

    await request(makeApp())
      .post('/debug/app-1/seed-summary')
      .send({ summaryText: 'hi' })
      .expect(500);
  });

  it('clears prior conversations and summaries before seeding (identical per-trial state)', async () => {
    lifecycleMock.getByAppId.mockResolvedValue([{ id: 'old-1' }, { id: 'old-2' }]);

    await request(makeApp())
      .post('/debug/app-1/seed-summary')
      .send({ summaryText: 'hi' })
      .expect(201);

    expect(lifecycleMock.delete).toHaveBeenCalledWith('old-1');
    expect(lifecycleMock.delete).toHaveBeenCalledWith('old-2');
    expect(summaryStoreMock.deleteByAppId).toHaveBeenCalledOnce();
  });

  it('summary-only (no priorTurns) does not create a conversation', async () => {
    await request(makeApp())
      .post('/debug/app-1/seed-summary')
      .send({ summaryText: 'hi' })
      .expect(201);

    expect(lifecycleMock.create).not.toHaveBeenCalled();
    expect(messageStoreMock.addMessage).not.toHaveBeenCalled();
  });

  it('seeds raw prior turns into a conversation the trial resolves into', async () => {
    const res = await request(makeApp())
      .post('/debug/app-1/seed-summary')
      .send({
        summaryText: '## State\nLanding page built.',
        priorTurns: [
          { sender: 'user', content: 'add a contact form' },
          { sender: 'agent', content: 'Done — added a contact form.' },
        ],
      })
      .expect(201);

    expect(res.body.conversationId).toBe('conv-seeded');
    expect(lifecycleMock.create).toHaveBeenCalledOnce();
    expect(messageStoreMock.addMessage).toHaveBeenCalledTimes(2);
    expect(messageStoreMock.addMessage).toHaveBeenNthCalledWith(
      1, 'conv-seeded', 'user', 'add a contact form', { origin: 'customer' },
    );
    expect(messageStoreMock.addMessage).toHaveBeenNthCalledWith(
      2, 'conv-seeded', 'agent', 'Done — added a contact form.', { origin: 'customer' },
    );
    // The summary is linked to the seeded conversation.
    expect(summaryStoreMock.create.mock.calls[0][2]).toBe('conv-seeded');
  });

  it('rejects an invalid priorTurns sender with 400', async () => {
    await request(makeApp())
      .post('/debug/app-1/seed-summary')
      .send({ summaryText: 'hi', priorTurns: [{ sender: 'system', content: 'x' }] })
      .expect(400);

    expect(lifecycleMock.create).not.toHaveBeenCalled();
  });
});
