import { describe, it, expect, vi } from 'vitest';

vi.mock('@airo/ai-lib', () => ({
  logCachingStats: vi.fn(),
}));

import type { LLMMessage } from '../../ConversationHistoryLoader.js';
import { LLMSummarizationStrategy } from '../LLMSummarizationStrategy.js';
import {
  MAX_ASSISTANT_TOOL_MESSAGE_CONTENT_LENGTH,
  MAX_USER_MESSAGE_CONTENT_LENGTH,
} from '../summarization-guards.js';

class TestLLMSummarizationStrategy extends LLMSummarizationStrategy {
  public buildUserPromptForTest(messages: LLMMessage[], existingSummary?: string, operationLog?: string) {
    return this.buildUserPrompt(messages, existingSummary, operationLog);
  }
}

describe('LLMSummarizationStrategy', () => {
  it('truncates oversized user messages in summarization prompt', () => {
    const strategy = new TestLLMSummarizationStrategy();
    const oversized = 'u'.repeat(MAX_USER_MESSAGE_CONTENT_LENGTH + 5000);
    const messages: LLMMessage[] = [
      { role: 'user', content: oversized },
      { role: 'assistant', content: 'ok' },
    ];

    const prompt = strategy.buildUserPromptForTest(messages);

    expect(prompt).toContain('[...truncated]');
    expect(prompt).not.toContain(oversized);
  });

  it('does not apply user cap to assistant message body', () => {
    const strategy = new TestLLMSummarizationStrategy();
    const assistantBody = 'a'.repeat(MAX_USER_MESSAGE_CONTENT_LENGTH + 3000);
    const messages: LLMMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: assistantBody },
    ];

    const prompt = strategy.buildUserPromptForTest(messages);

    expect(prompt).toContain(assistantBody);
    expect(prompt).not.toContain('[...truncated]');
  });

  it('truncates extremely large assistant messages at assistant/tool cap', () => {
    const strategy = new TestLLMSummarizationStrategy();
    const assistantBody = 'b'.repeat(MAX_ASSISTANT_TOOL_MESSAGE_CONTENT_LENGTH + 5000);
    const messages: LLMMessage[] = [{ role: 'assistant', content: assistantBody }];

    const prompt = strategy.buildUserPromptForTest(messages);

    expect(prompt).toContain('[...truncated]');
    expect(prompt).not.toContain(assistantBody);
  });
});
