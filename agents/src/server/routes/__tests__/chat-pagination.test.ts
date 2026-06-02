import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const fakeConversation = {
  id: 'conv-1',
  appId: 'test-app',
  agentId: 'develop',
  title: 'Test',
  createdAt: new Date('2026-03-09T10:00:00Z'),
  updatedAt: new Date('2026-03-09T10:05:00Z'),
};

const fullMessages = [
  { id: 'msg-1', conversationId: 'conv-1', sender: 'user', content: 'Hello', createdAt: new Date('2026-03-09T10:00:00Z') },
  { id: 'msg-2', conversationId: 'conv-1', sender: 'agent', content: 'Hi', createdAt: new Date('2026-03-09T10:01:00Z') },
];

const paginatedResult = {
  messages: [fullMessages[1]],
  hasMore: true,
  nextCursor: 'msg-1',
  total: 2,
};

const { lifecycleMock, messagesMock } = vi.hoisted(() => ({
  lifecycleMock: {
    getById: vi.fn(),
  },
  messagesMock: {
    getMessages: vi.fn(),
    getMessagesPaginated: vi.fn(),
  },
}));

vi.mock('../../../memory/adapters/index.js', () => ({
  getConversationLifecycleStore: vi.fn(function () { return lifecycleMock; }),
  getMessageStore: vi.fn(function () { return messagesMock; }),
}));

vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnershipFromBody: () => (_req: any, _res: any, next: any) => next(),
  validateConversationOwnership: () => (_req: any, _res: any, next: any) => next(),
}));

import { chatRouter } from '../chat.js';

describe('GET /agent/conversations/:appId/:conversationId', () => {
  let app: express.Express;

  beforeEach(() => {
    lifecycleMock.getById.mockReset().mockResolvedValue(fakeConversation);
    messagesMock.getMessages.mockReset().mockResolvedValue(fullMessages);
    messagesMock.getMessagesPaginated.mockReset().mockResolvedValue(paginatedResult);
    app = express();
    // Inject agentContext so validateAppIdParam passes (uses BYPASS_SITE_IDS)
    app.use((req: any, _res: any, next: any) => {
      req.agentContext = { siteId: 'local-dev-site' };
      next();
    });
    app.use('/agent', chatRouter);
  });

  it('returns the legacy full-load shape when no pagination params are provided', async () => {
    const res = await request(app).get('/agent/conversations/test-app/conv-1').expect(200);
    expect(res.body).toEqual({
      conversation: expect.objectContaining({ id: 'conv-1' }),
      messages: expect.any(Array),
    });
    expect(messagesMock.getMessages).toHaveBeenCalledWith('conv-1');
    expect(messagesMock.getMessagesPaginated).not.toHaveBeenCalled();
  });

  it('returns paginated shape when limit is present', async () => {
    const res = await request(app)
      .get('/agent/conversations/test-app/conv-1?limit=50')
      .expect(200);
    expect(res.body).toEqual({
      conversation: expect.objectContaining({ id: 'conv-1' }),
      messages: expect.any(Array),
      pagination: { total: 2, hasMore: true, nextCursor: 'msg-1' },
    });
    expect(messagesMock.getMessagesPaginated).toHaveBeenCalledWith(
      { kind: 'local', appId: 'test-app' },
      'conv-1',
      { limit: 50, before: undefined }
    );
    expect(messagesMock.getMessages).not.toHaveBeenCalled();
  });

  it('forwards before cursor when present', async () => {
    await request(app)
      .get('/agent/conversations/test-app/conv-1?limit=200&before=msg-99')
      .expect(200);
    expect(messagesMock.getMessagesPaginated).toHaveBeenCalledWith(
      { kind: 'local', appId: 'test-app' },
      'conv-1',
      { limit: 200, before: 'msg-99' }
    );
  });

  it('triggers paginated path when only before is present (defaults limit)', async () => {
    await request(app)
      .get('/agent/conversations/test-app/conv-1?before=msg-99')
      .expect(200);
    expect(messagesMock.getMessagesPaginated).toHaveBeenCalledWith(
      { kind: 'local', appId: 'test-app' },
      'conv-1',
      { limit: 50, before: 'msg-99' }
    );
  });
});
