/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleToolStartSideEffects } from '@/hooks/shared/toolStartSideEffects'
import { ToolStartHandler } from '../ToolStartHandler'
import type { MessageContext, WebSocketMessage } from '../types'

vi.mock('@/hooks/shared/toolStartSideEffects', () => ({
  handleToolStartSideEffects: vi.fn(),
}))

describe('ToolStartHandler', () => {
  let handler: ToolStartHandler
  let mockContext: MessageContext

  beforeEach(() => {
    vi.clearAllMocks()
    handler = new ToolStartHandler()

    mockContext = {
      socket: { id: 'socket-123' } as any,
      currentAppId: 'app-1',
      actions: {
        addToolStartSegment: vi.fn(),
      },
      helpers: {},
      refs: {},
    } as any
  })

  it('should have correct type', () => {
    expect(handler.type).toBe('tool_start')
  })

  it('should add tool start segment with provided data', async () => {
    const data: WebSocketMessage = {
      type: 'tool_start',
      content: '',
      data: {
        tool: {
          id: 'tool-123',
          name: 'file-edit',
          input: { path: '/test.ts' },
        },
      },
    }

    await handler.handle(data, mockContext)

    expect(mockContext.actions.addToolStartSegment).toHaveBeenCalledWith({
      id: 'tool-123',
      name: 'file-edit',
      input: { path: '/test.ts' },
      status: 'running',
      startTime: expect.any(Number),
    })
  })

  it('should generate tool ID if not provided', async () => {
    const data: WebSocketMessage = {
      type: 'tool_start',
      content: '',
      data: {
        tool: {
          name: 'grep-tool',
          input: { pattern: 'test' },
        },
      },
    }

    await handler.handle(data, mockContext)

    expect(mockContext.actions.addToolStartSegment).toHaveBeenCalledWith({
      id: expect.stringMatching(/^tool_\d+$/),
      name: 'grep-tool',
      input: { pattern: 'test' },
      status: 'running',
      startTime: expect.any(Number),
    })
  })

  it('should default to empty input if not provided', async () => {
    const data: WebSocketMessage = {
      type: 'tool_start',
      content: '',
      data: {
        tool: {
          id: 'tool-456',
          name: 'terminal',
        },
      },
    }

    await handler.handle(data, mockContext)

    expect(mockContext.actions.addToolStartSegment).toHaveBeenCalledWith({
      id: 'tool-456',
      name: 'terminal',
      input: {},
      status: 'running',
      startTime: expect.any(Number),
    })
  })

  it('should not add segment if tool data is missing', async () => {
    const data: WebSocketMessage = {
      type: 'tool_start',
      content: '',
      data: {},
    }

    await handler.handle(data, mockContext)

    expect(mockContext.actions.addToolStartSegment).not.toHaveBeenCalled()
    expect(handleToolStartSideEffects).not.toHaveBeenCalled()
  })

  it('forwards the tool to the shared side-effect dispatcher', async () => {
    const tool = { id: 't1', name: 'websiteRebuild', input: { url: 'https://example.com' } }
    const data: WebSocketMessage = {
      type: 'tool_start',
      content: '',
      data: { tool },
    }

    await handler.handle(data, mockContext)

    expect(handleToolStartSideEffects).toHaveBeenCalledWith(tool)
  })

  it('forwards skillName when present on per-skill tools', async () => {
    const tool = { id: 't2', name: 'blog__createPost', input: {}, skillName: 'blog' }
    const data: WebSocketMessage = {
      type: 'tool_start',
      content: '',
      data: { tool },
    }

    await handler.handle(data, mockContext)

    expect(handleToolStartSideEffects).toHaveBeenCalledWith(tool)
  })
})
