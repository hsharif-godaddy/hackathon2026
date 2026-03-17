/**
 * Test Helper Utilities retained for ai-lib tests that still need them.
 * The full set of retry/error helpers has moved to @airo/ai-common.
 */

/**
 * Create mock conversation messages for testing
 */
export function createMockConversationMessages() {
  return [
    { role: 'user' as const, content: 'Write a Haiku' },
    { role: 'assistant' as const, content: "Here's a haiku:\nCode flows like water\nBugs dance in the moonlight\nRefactor brings peace" },
    { role: 'user' as const, content: 'Tell me a joke' }
  ]
}

/**
 * Create mock context messages for testing
 */
export function createMockContextMessages() {
  return [
    {
      role: 'system' as const,
      content: 'You are a helpful assistant in an app development environment.',
      cachePoint: { type: 'ephemeral' as const }
    }
  ]
}

/**
 * Create mock files for vision testing
 */
export function createMockFiles() {
  return [
    {
      url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      base64Content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      metadata: {
        mimeType: 'image/png' as const,
        filename: 'test-image.png',
        size: 100
      }
    }
  ]
}
