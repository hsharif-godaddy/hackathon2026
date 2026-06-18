import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAgentFetch = vi.fn();
const mockBuildDynamicAgentUrl = vi.fn();
const mockGetConversationIdFromCookie = vi.fn();

vi.mock('@/config/dynamic-api', () => ({
  buildDynamicAgentUrl: (...args: unknown[]) => mockBuildDynamicAgentUrl(...args),
}));

vi.mock('@/hooks/chat/useChatHelpers', () => ({
  getConversationIdFromCookie: (...args: unknown[]) => mockGetConversationIdFromCookie(...args),
}));

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: (...args: unknown[]) => mockAgentFetch(...args),
}));

describe('message-metadata-client', function packageTests() {
  beforeEach(function reset() {
    vi.clearAllMocks();
    mockGetConversationIdFromCookie.mockReturnValue('conv-1');
    mockBuildDynamicAgentUrl.mockResolvedValue('http://agents.test/api/conversations/conv-1/messages/msg-1');
    mockAgentFetch.mockResolvedValue({ ok: true });
  });

  describe('#parseMessageFeedbackMetadata', function parse() {
    it('returns persisted positive and negative votes', async function votes() {
      const { parseMessageFeedbackMetadata } = await import('./message-metadata-client');

      expect(parseMessageFeedbackMetadata({ feedback: 'positive' })).toBe('positive');
      expect(parseMessageFeedbackMetadata({ feedback: 'negative' })).toBe('negative');
      expect(parseMessageFeedbackMetadata({ feedback: null })).toBe(null);
      expect(parseMessageFeedbackMetadata({ feedback: 'invalid' })).toBe(null);
      expect(parseMessageFeedbackMetadata(undefined)).toBe(null);
    });
  });

  describe('#patchMessageFeedbackMetadata', function patch() {
    it('PATCHes agents with feedback metadata', async function success() {
      const { patchMessageFeedbackMetadata } = await import('./message-metadata-client');

      const result = await patchMessageFeedbackMetadata({
        appId: 'app-1',
        messageId: 'msg-1',
        feedback: 'positive',
      });

      expect(result).toEqual({ ok: true });
      expect(mockBuildDynamicAgentUrl).toHaveBeenCalledWith(
        'api/conversations/conv-1/messages/msg-1',
        'app-1'
      );
      expect(mockAgentFetch).toHaveBeenCalledWith(
        'http://agents.test/api/conversations/conv-1/messages/msg-1',
        expect.objectContaining({
          method: 'PATCH',
          siteId: 'app-1',
          body: JSON.stringify({ metadata: { feedback: 'positive' } }),
        })
      );
    });

    it('fails closed without conversation id', async function noConversation() {
      mockGetConversationIdFromCookie.mockReturnValue(null);
      const { patchMessageFeedbackMetadata } = await import('./message-metadata-client');

      const result = await patchMessageFeedbackMetadata({
        appId: 'app-1',
        messageId: 'msg-1',
        feedback: 'negative',
      });

      expect(result).toEqual({ ok: false, reason: 'missing_conversation_id' });
      expect(mockAgentFetch).not.toHaveBeenCalled();
    });

    it('fails closed without app id', async function noAppId() {
      const { patchMessageFeedbackMetadata } = await import('./message-metadata-client');

      const result = await patchMessageFeedbackMetadata({
        appId: '',
        messageId: 'msg-1',
        feedback: 'positive',
      });

      expect(result).toEqual({ ok: false, reason: 'missing_app_id' });
      expect(mockAgentFetch).not.toHaveBeenCalled();
    });

    it('returns http_error when agents rejects the request', async function httpError() {
      mockAgentFetch.mockResolvedValue({ ok: false, status: 500 });
      const { patchMessageFeedbackMetadata } = await import('./message-metadata-client');

      const result = await patchMessageFeedbackMetadata({
        appId: 'app-1',
        messageId: 'msg-1',
        feedback: null,
      });

      expect(result).toEqual({ ok: false, reason: 'http_error' });
    });
  });
});
