import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const fakeConversation = {
  id: 'conv-1',
  appId: 'test-app',
  agentId: 'develop',
  title: 'Test',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const fakeMessage = {
  id: 'msg-1',
  conversationId: 'conv-1',
  sender: 'agent' as const,
  content: 'Hello',
  createdAt: new Date(),
};

const { messagesMock } = vi.hoisted(() => ({
  messagesMock: {
    getMessageById: vi.fn(),
    updateMessageMetadata: vi.fn(),
  },
}));

vi.mock('../../../memory/adapters/index.js', () => ({
  getConversationLifecycleStore: vi.fn(),
  getMessageStore: vi.fn(function () {
    return messagesMock;
  }),
}));

vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnershipFromBody: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  validateAppOwnershipFromQuery: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  validateConversationOwnership: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { conversation: typeof fakeConversation }).conversation = fakeConversation;
    next();
  },
}));

import { conversationsRouter } from '../conversations.js';

describe('conversations-routes', function packageTests() {
  describe('PATCH /api/conversations/:id/messages/:messageId', function patchMessageMetadata() {
    let app: express.Express;

    beforeEach(function setup() {
      messagesMock.getMessageById.mockReset().mockResolvedValue(fakeMessage);
      messagesMock.updateMessageMetadata.mockReset().mockResolvedValue(undefined);
      app = express();
      app.use(express.json());
      app.use(conversationsRouter);
    });

    it('merges feedback into message metadata', async function positive() {
      const res = await request(app)
        .patch('/api/conversations/conv-1/messages/msg-1')
        .send({ metadata: { feedback: 'positive' } })
        .expect(200);

      expect(res.body).toEqual({
        success: true,
        messageId: 'msg-1',
        metadata: { feedback: 'positive' },
      });
      expect(messagesMock.updateMessageMetadata).toHaveBeenCalledWith('msg-1', {
        feedback: 'positive',
      });
    });

    it('clears feedback when null is sent', async function clearFeedback() {
      await request(app)
        .patch('/api/conversations/conv-1/messages/msg-1')
        .send({ metadata: { feedback: null } })
        .expect(200);

      expect(messagesMock.updateMessageMetadata).toHaveBeenCalledWith('msg-1', {
        feedback: null,
      });
    });

    it('returns 404 when the message is not in the conversation', async function notFound() {
      messagesMock.getMessageById.mockResolvedValue({
        ...fakeMessage,
        conversationId: 'other-conv',
      });

      await request(app)
        .patch('/api/conversations/conv-1/messages/msg-1')
        .send({ metadata: { feedback: 'negative' } })
        .expect(404);

      expect(messagesMock.updateMessageMetadata).not.toHaveBeenCalled();
    });

    it('returns 404 when the message does not exist', async function missingMessage() {
      messagesMock.getMessageById.mockResolvedValue(null);

      await request(app)
        .patch('/api/conversations/conv-1/messages/msg-1')
        .send({ metadata: { feedback: 'negative' } })
        .expect(404);
    });

    it('rejects invalid feedback values', async function invalidBody() {
      await request(app)
        .patch('/api/conversations/conv-1/messages/msg-1')
        .send({ metadata: { feedback: 'meh' } })
        .expect(400);

      expect(messagesMock.updateMessageMetadata).not.toHaveBeenCalled();
    });
  });
});
