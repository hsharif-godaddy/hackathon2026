import { describe, expect, it } from 'vitest';

import { Conversation } from '@/types/inbox/local/conversation';
import { ACTION_REGISTRY } from './config';

const makeConversation = (overrides: Partial<Conversation>): Conversation => ({
  id: '1',
  originalChannel: 'WebChat',
  messageType: 'chat',
  category: { id: 1, name: 'Chat', slug: 'chat', type: 'WebChat' },
  c2: [],
  lastMessage: {} as Conversation['lastMessage'],
  messageCount: 1,
  isArchived: false,
  isSpam: false,
  isStarred: false,
  isImportant: false,
  status: 'unresolved',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  bumpedAt: '2024-01-01T00:00:00Z',
  ...overrides,
});

describe('ACTION_REGISTRY', () => {
  describe('resolve', () => {
    const { resolve } = ACTION_REGISTRY;

    it('canExecute returns true for unresolved conversations', () => {
      const conversation = makeConversation({ status: 'unresolved' });
      expect(resolve.canExecute(conversation)).toBe(true);
    });

    it('canExecute returns false for resolved conversations', () => {
      const conversation = makeConversation({ status: 'resolved' });
      expect(resolve.canExecute(conversation)).toBe(false);
    });

    it.each(['archived', 'spam', 'onHold'] as const)('canExecute returns false for %s conversations', (status) => {
      const conversation = makeConversation({ status });
      expect(resolve.canExecute(conversation)).toBe(false);
    });

    it('optimisticTransform sets status to resolved', () => {
      const conversation = makeConversation({ status: 'unresolved' });
      const result = resolve.optimisticTransform(conversation);
      expect(result.status).toBe('resolved');
    });

    it('optimisticTransform preserves other fields', () => {
      const conversation = makeConversation({ isStarred: true, title: 'Test' });
      const result = resolve.optimisticTransform(conversation);
      expect(result.isStarred).toBe(true);
      expect(result.title).toBe('Test');
    });
  });

  describe('unresolve', () => {
    const { unresolve } = ACTION_REGISTRY;

    it('canExecute returns true for resolved conversations', () => {
      const conversation = makeConversation({ status: 'resolved' });
      expect(unresolve.canExecute(conversation)).toBe(true);
    });

    it('canExecute returns false for unresolved conversations', () => {
      const conversation = makeConversation({ status: 'unresolved' });
      expect(unresolve.canExecute(conversation)).toBe(false);
    });

    it.each(['archived', 'spam', 'onHold'] as const)('canExecute returns false for %s conversations', (status) => {
      const conversation = makeConversation({ status });
      expect(unresolve.canExecute(conversation)).toBe(false);
    });

    it('optimisticTransform sets status to unresolved', () => {
      const conversation = makeConversation({ status: 'resolved' });
      const result = unresolve.optimisticTransform(conversation);
      expect(result.status).toBe('unresolved');
    });
  });
});

