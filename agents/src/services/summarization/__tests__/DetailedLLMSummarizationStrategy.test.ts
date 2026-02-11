import { describe, it, expect } from 'vitest'
import { DetailedLLMSummarizationStrategy } from '../DetailedLLMSummarizationStrategy.js'
import type { LLMMessage } from '../../ConversationHistoryLoader.js'

// Test subclass to access protected methods for testing
class TestDetailedLLMSummarizationStrategy extends DetailedLLMSummarizationStrategy {
  public buildUserPromptForTest(messages: LLMMessage[], operationLog?: string) {
    return this.buildUserPrompt(messages, operationLog)
  }
}

describe('DetailedLLMSummarizationStrategy', () => {
  it('skips system messages when building user prompt', () => {
    const strategy = new TestDetailedLLMSummarizationStrategy()
    const messages: LLMMessage[] = [
      { role: 'system', content: 'System instructions' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' }
    ]

    const prompt = strategy.buildUserPromptForTest(messages)

    expect(prompt).not.toContain('System instructions')
    expect(prompt).toContain('User: Hello')
    expect(prompt).toContain('Assistant: Hi there')
  })
})
