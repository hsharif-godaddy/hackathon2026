import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock the ConversationRepository
vi.mock('../../../database/repositories/ConversationRepository.js', () => ({
  ConversationRepository: vi.fn().mockImplementation(() => ({
    getByAppId: vi.fn().mockResolvedValue([
      {
        id: 'conv-1',
        appId: 'test-app',
        agentId: 'develop',
        title: 'Test conversation',
        createdAt: new Date('2026-03-09T10:00:00Z'),
        updatedAt: new Date('2026-03-09T10:05:00Z'),
      },
    ]),
    getMessagesBatch: vi.fn().mockResolvedValue([
      {
        id: 'msg-1',
        conversationId: 'conv-1',
        sender: 'user',
        content: 'Hello',
        createdAt: new Date('2026-03-09T10:00:00Z'),
      },
      {
        id: 'msg-2',
        conversationId: 'conv-1',
        sender: 'agent',
        content: 'Hi there!',
        toolCalls: [
          { id: 'tc-1', name: 'readFile', input: { path: '/index.html' }, result: '<html/>', status: 'completed', duration: 100 },
        ],
        createdAt: new Date('2026-03-09T10:01:00Z'),
      },
    ]),
  })),
}));

// Mock app-ownership middleware to pass through
vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnershipFromQuery: () => (_req: any, _res: any, next: any) => next(),
  validateConversationOwnership: () => (_req: any, _res: any, next: any) => next(),
}));

import { conversationsRouter } from '../conversations.js';

describe('GET /api/conversations/export', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(conversationsRouter);
  });

  it('returns markdown with summary detail by default', async () => {
    const res = await request(app)
      .get('/api/conversations/export?appId=test-app')
      .expect(200);

    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.text).toContain('# App Conversations: test-app');
    expect(res.text).toContain('Hello');
    expect(res.text).toContain('Hi there!');
    expect(res.text).toContain('> **readFile**');
    // Summary should NOT show tool details
    expect(res.text).not.toContain('<details>');
  });

  it('returns full detail with tool call expansion', async () => {
    const res = await request(app)
      .get('/api/conversations/export?appId=test-app&detail=full')
      .expect(200);

    expect(res.text).toContain('# App Conversations: test-app');
    expect(res.text).toContain('<details>');
    expect(res.text).toContain('readFile');
    expect(res.text).toContain('/index.html');
  });

  it('returns 400 for invalid detail parameter', async () => {
    const res = await request(app)
      .get('/api/conversations/export?appId=test-app&detail=invalid')
      .expect(400);

    expect(res.body.error).toContain('detail');
  });
});
