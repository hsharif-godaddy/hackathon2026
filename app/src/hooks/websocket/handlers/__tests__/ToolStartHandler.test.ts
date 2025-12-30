/**
 * ToolStartHandler Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ToolStartHandler } from '../ToolStartHandler'
import type { MessageContext, WebSocketMessage } from '../types'

describe('ToolStartHandler', () => {
  let handler: ToolStartHandler
  let mockContext: MessageContext

  beforeEach(() => {
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
  })
})
