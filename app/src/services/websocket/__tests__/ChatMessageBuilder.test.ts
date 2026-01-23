/**
 * ChatMessageBuilder Tests
 *
 * Tests for the pure ChatMessageBuilder service
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type BuildMessageParams,ChatMessageBuilder } from '../ChatMessageBuilder'

describe('ChatMessageBuilder', () => {
  let builder: ChatMessageBuilder

  beforeEach(() => {
    builder = new ChatMessageBuilder()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('build', () => {
    it('should build a basic message with minimal params', () => {
      const params: BuildMessageParams = {
        content: 'Hello world',
        appId: 'app-123',
        sessionId: 'session-456',
      }

      const result = builder.build(params)

      expect(result).toEqual({
        message: 'Hello world',
        timestamp: expect.any(String),
        context: {
          metadata: {
            appId: 'app-123',
            userId: 'current-user',
            sessionId: 'session-456',
            userTimezone: expect.any(String),
          },
          conversation: {
            conversationId: undefined,
            maxMessages: 10,
            includeHistory: true,
          },
          appContext: {
            includeDirectoryListing: true,
            includePackageInfo: true,
            includeDependencyStatus: true,
            maxDirectoryDepth: 3,
          },
        },
      })
    })

    it('should include conversationId when provided', () => {
      const params: BuildMessageParams = {
        content: 'Test',
        appId: 'app-123',
        sessionId: 'session-456',
        conversationId: 'conv-789',
      }

      const result = builder.build(params)

      expect(result.context?.conversation?.conversationId).toBe('conv-789')
    })

    it('should handle null conversationId', () => {
      const params: BuildMessageParams = {
        content: 'Test',
        appId: 'app-123',
        sessionId: 'session-456',
        conversationId: null,
      }

      const result = builder.build(params)

      expect(result.context?.conversation?.conversationId).toBeUndefined()
    })
  })

  describe('asset transformation', () => {
    it('should transform protocol-relative URLs to https', () => {
      const params: BuildMessageParams = {
        content: 'Test',
        appId: 'app-123',
        sessionId: 'session-456',
        selectedAsset: {
          imageUrl: '//example.com/image.jpg',
          thumbnailUrl: '//example.com/thumb.jpg',
          videoUrl: '//example.com/video.mp4',
        },
      }

      const result = builder.build(params)

      const attachment = result.context?.contextAttachments?.[0]
      expect(attachment?.type).toBe('selected_assets')
      expect(attachment?.data).toEqual([
        {
          imageUrl: 'https://example.com/image.jpg',
          thumbnailUrl: 'https://example.com/thumb.jpg',
          videoUrl: 'https://example.com/video.mp4',
        },
      ])
    })

    it('should preserve existing https URLs', () => {
      const params: BuildMessageParams = {
        content: 'Test',
        appId: 'app-123',
        sessionId: 'session-456',
        selectedAsset: {
          imageUrl: 'https://example.com/image.jpg',
        },
      }

      const result = builder.build(params)

      const attachment = result.context?.contextAttachments?.[0]
      expect(attachment?.data).toEqual([
        {
          imageUrl: 'https://example.com/image.jpg',
        },
      ])
    })

    it('should handle assets without optional URLs', () => {
      const params: BuildMessageParams = {
        content: 'Test',
        appId: 'app-123',
        sessionId: 'session-456',
        selectedAsset: {
          imageUrl: 'https://example.com/image.jpg',
        },
      }

      const result = builder.build(params)

      const attachment = result.context?.contextAttachments?.[0]
      expect(attachment?.data).toEqual([
        {
          imageUrl: 'https://example.com/image.jpg',
        },
      ])
    })
  })

  describe('context attachments', () => {
    it('should add aiEditContext attachment', () => {
      const params: BuildMessageParams = {
        content: 'Test',
        appId: 'app-123',
        sessionId: 'session-456',
        aiEditContext: { code: 'const x = 1' },
      }

      const result = builder.build(params)

      const attachment = result.context?.contextAttachments?.[0]
      expect(attachment).toEqual({
        type: 'ai_edit_context',
        data: { code: 'const x = 1' },
        persistence: 'save',
        renderStrategy: 'before_prompt',
        metadata: {
          timestamp: 1704067200000,
          source: 'ai-edit-dialog',
        },
      })
    })

    it('should add visualContext attachment', () => {
      const params: BuildMessageParams = {
        content: 'Test',
        appId: 'app-123',
        sessionId: 'session-456',
        visualContext: {
          page: 'home',
          scroll_position: { x: 0, y: 0 },
          viewport: { width: 1920, height: 1080 },
          timestamp: Date.now()
        },
      }

      const result = builder.build(params)

      const attachment = result.context?.contextAttachments?.[0]
      expect(attachment).toEqual({
        type: 'visual_context',
        data: {
          page: 'home',
          scroll_position: { x: 0, y: 0 },
          viewport: { width: 1920, height: 1080 },
          timestamp: expect.any(Number)
        },
        persistence: 'ephemeral',
        renderStrategy: 'before_prompt',
        metadata: {
          timestamp: 1704067200000,
          source: 'iframe-capture',
        },
      })
    })

    it('should add buildErrorContext attachment', () => {
      const params: BuildMessageParams = {
        content: 'Test',
        appId: 'app-123',
        sessionId: 'session-456',
        buildErrorContext: {
          error: 'Build failed',
          details: 'Syntax error on line 10',
          exitCode: 1,
        },
      }

      const result = builder.build(params)

      const attachment = result.context?.contextAttachments?.[0]
      expect(attachment).toEqual({
        type: 'build_error',
        data: {
          error: 'Build failed',
          details: 'Syntax error on line 10',
          exitCode: 1,
        },
        persistence: 'ephemeral',
        renderStrategy: 'before_prompt',
        metadata: {
          timestamp: 1704067200000,
          source: 'publish-failure',
        },
      })
    })

    it('should add todoListContext attachment', () => {
      const params: BuildMessageParams = {
        content: 'Test',
        appId: 'app-123',
        sessionId: 'session-456',
        todoListContext: { items: ['Task 1', 'Task 2'] },
      }

      const result = builder.build(params)

      const attachment = result.context?.contextAttachments?.[0]
      expect(attachment).toEqual({
        type: 'todo_list_context',
        data: { items: ['Task 1', 'Task 2'] },
        persistence: 'save',
        renderStrategy: 'before_prompt',
        metadata: {
          timestamp: 1704067200000,
          source: 'todo-list-tool',
        },
      })
    })

    it('should add actionRequest attachment', () => {
      const params: BuildMessageParams = {
        content: 'Test',
        appId: 'app-123',
        sessionId: 'session-456',
        isActionRequest: true,
      }

      const result = builder.build(params)

      const attachment = result.context?.contextAttachments?.[0]
      expect(attachment).toEqual({
        type: 'action_request',
        data: {
          instruction: '[Action Request] Execute this request immediately. Do not summarize previous work.',
        },
        persistence: 'ephemeral',
        renderStrategy: 'before_prompt',
        metadata: {
          timestamp: 1704067200000,
          source: 'suggested_response',
        },
      })
    })

    it('should add customContext with single attachment', () => {
      const params: BuildMessageParams = {
        content: 'Test',
        appId: 'app-123',
        sessionId: 'session-456',
        customContext: {
          type: 'custom_type',
          data: { custom: 'data' },
          persistence: 'save',
          source: 'custom-source',
        },
      }

      const result = builder.build(params)

      const attachment = result.context?.contextAttachments?.[0]
      expect(attachment).toEqual({
        type: 'custom_type',
        data: { custom: 'data' },
        persistence: 'save',
        renderStrategy: 'before_prompt',
        metadata: {
          timestamp: 1704067200000,
          source: 'custom-source',
        },
      })
    })

    it('should add customContext with multiple attachments', () => {
      const params: BuildMessageParams = {
        content: 'Test',
        appId: 'app-123',
        sessionId: 'session-456',
        customContext: {
          customAttachments: [
            {
              type: 'type1',
              data: { data1: 'value1' },
              persistence: 'save',
              renderStrategy: 'before_prompt',
              metadata: { source: 'source1' },
            },
            {
              type: 'type2',
              data: { data2: 'value2' },
              persistence: 'ephemeral',
              renderStrategy: 'after_prompt',
              metadata: { source: 'source2' },
            },
          ],
        },
      }

      const result = builder.build(params)

      expect(result.context?.contextAttachments).toHaveLength(2)
      expect(result.context?.contextAttachments?.[0].type).toBe('type1')
      expect(result.context?.contextAttachments?.[1].type).toBe('type2')
    })

    it('should add multiple attachments in correct order', () => {
      const params: BuildMessageParams = {
        content: 'Test',
        appId: 'app-123',
        sessionId: 'session-456',
        aiEditContext: { code: 'test' },
        visualContext: {
          page: 'home',
          scroll_position: { x: 0, y: 0 },
          viewport: { width: 1920, height: 1080 },
          timestamp: Date.now()
        },
        selectedAsset: { imageUrl: 'https://example.com/image.jpg' },
        buildErrorContext: { error: 'Error' },
        todoListContext: { items: [] },
        isActionRequest: true,
      }

      const result = builder.build(params)

      const attachments = result.context?.contextAttachments || []
      expect(attachments).toHaveLength(6)
      expect(attachments[0].type).toBe('ai_edit_context')
      expect(attachments[1].type).toBe('visual_context')
      expect(attachments[2].type).toBe('selected_assets')
      expect(attachments[3].type).toBe('build_error')
      expect(attachments[4].type).toBe('todo_list_context')
      expect(attachments[5].type).toBe('action_request')
    })

    it('should not add contextAttachments key when no attachments', () => {
      const params: BuildMessageParams = {
        content: 'Test',
        appId: 'app-123',
        sessionId: 'session-456',
      }

      const result = builder.build(params)

      expect(result.context?.contextAttachments).toBeUndefined()
    })
  })

  describe('rich context structure', () => {
    it('should include proper metadata structure', () => {
      const params: BuildMessageParams = {
        content: 'Test',
        appId: 'app-123',
        sessionId: 'session-456',
      }

      const result = builder.build(params)

      expect(result.context?.metadata).toEqual({
        appId: 'app-123',
        userId: 'current-user',
        sessionId: 'session-456',
        userTimezone: expect.any(String),
      })
    })

    it('should include conversation context', () => {
      const params: BuildMessageParams = {
        content: 'Test',
        appId: 'app-123',
        sessionId: 'session-456',
        conversationId: 'conv-789',
      }

      const result = builder.build(params)

      expect(result.context?.conversation).toEqual({
        conversationId: 'conv-789',
        maxMessages: 10,
        includeHistory: true,
      })
    })

    it('should include app context with project understanding flags', () => {
      const params: BuildMessageParams = {
        content: 'Test',
        appId: 'app-123',
        sessionId: 'session-456',
      }

      const result = builder.build(params)

      expect(result.context?.appContext).toEqual({
        includeDirectoryListing: true,
        includePackageInfo: true,
        includeDependencyStatus: true,
        maxDirectoryDepth: 3,
      })
    })

    it('should generate ISO timestamp', () => {
      const params: BuildMessageParams = {
        content: 'Test',
        appId: 'app-123',
        sessionId: 'session-456',
      }

      const result = builder.build(params)

      expect(result.timestamp).toBe('2024-01-01T00:00:00.000Z')
    })
  })

  describe('edge cases', () => {
    it('should handle empty content', () => {
      const params: BuildMessageParams = {
        content: '',
        appId: 'app-123',
        sessionId: 'session-456',
      }

      const result = builder.build(params)

      expect(result.message).toBe('')
    })

    it('should handle null visualContext', () => {
      const params: BuildMessageParams = {
        content: 'Test',
        appId: 'app-123',
        sessionId: 'session-456',
        visualContext: null,
      }

      const result = builder.build(params)

      expect(result.context?.contextAttachments).toBeUndefined()
    })

    it('should handle null buildErrorContext', () => {
      const params: BuildMessageParams = {
        content: 'Test',
        appId: 'app-123',
        sessionId: 'session-456',
        buildErrorContext: null,
      }

      const result = builder.build(params)

      expect(result.context?.contextAttachments).toBeUndefined()
    })

    it('should default to ephemeral persistence for customContext', () => {
      const params: BuildMessageParams = {
        content: 'Test',
        appId: 'app-123',
        sessionId: 'session-456',
        customContext: {
          type: 'custom_type',
          data: { custom: 'data' },
        },
      }

      const result = builder.build(params)

      const attachment = result.context?.contextAttachments?.[0]
      expect(attachment?.persistence).toBe('ephemeral')
    })

    it('should default to custom-context source for customContext', () => {
      const params: BuildMessageParams = {
        content: 'Test',
        appId: 'app-123',
        sessionId: 'session-456',
        customContext: {
          type: 'custom_type',
          data: { custom: 'data' },
        },
      }

      const result = builder.build(params)

      const attachment = result.context?.contextAttachments?.[0]
      expect(attachment?.metadata?.source).toBe('custom-context')
    })
  })
})
