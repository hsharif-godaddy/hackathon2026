/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { logActionEvent } from '@/utils/instrumentation'
import { ToolStartHandler } from '../ToolStartHandler'
import type { MessageContext, WebSocketMessage } from '../types'

vi.mock('@/utils/instrumentation', () => ({
  logActionEvent: vi.fn(function () { return vi.fn(); }),
}))

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: {
    getState: vi.fn(),
  },
}))

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

  describe('websiteRebuild EID', () => {
    const buildRebuildMessage = (url = 'https://example.com'): WebSocketMessage => ({
      type: 'tool_start',
      content: '',
      data: {
        tool: { id: 'rebuild-1', name: 'websiteRebuild', input: { url } },
      },
    })

    beforeEach(() => {
      vi.clearAllMocks()
      vi.mocked(useDevelopPageStore.getState).mockReturnValue({
        app: { initialBuildComplete: false },
      } as any)
    })

    it('tags rebuild as initial when the app has not finished its first build', async () => {
      vi.mocked(useDevelopPageStore.getState).mockReturnValue({
        app: { initialBuildComplete: false },
      } as any)

      await handler.handle(buildRebuildMessage('https://acme.example.com'), mockContext)

      expect(logActionEvent).toHaveBeenCalledWith({
        eid: 'develop.rebuild.start',
        action: 'load',
        customProperties: {
          phase: 'initial',
          sourceUrl: 'https://acme.example.com',
        },
      })
    })

    it('tags rebuild as follow_up when the app has already completed its first build', async () => {
      vi.mocked(useDevelopPageStore.getState).mockReturnValue({
        app: { initialBuildComplete: true },
      } as any)

      await handler.handle(buildRebuildMessage(), mockContext)

      expect(logActionEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          customProperties: expect.objectContaining({ phase: 'follow_up' }),
        }),
      )
    })

    it('treats undefined app (pre-hydration window) as initial', async () => {
      // During the homepage→develop navigation the develop store has not yet
      // hydrated, so .app is undefined. The optional chain must not throw and
      // should fall through to 'initial'.
      vi.mocked(useDevelopPageStore.getState).mockReturnValue({ app: undefined } as any)

      await handler.handle(buildRebuildMessage(), mockContext)

      expect(logActionEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          customProperties: expect.objectContaining({ phase: 'initial' }),
        }),
      )
    })

    it('does not fire the rebuild EID for non-rebuild tools', async () => {
      const data: WebSocketMessage = {
        type: 'tool_start',
        content: '',
        data: { tool: { id: 't1', name: 'file-edit', input: {} } },
      }

      await handler.handle(data, mockContext)

      expect(logActionEvent).not.toHaveBeenCalled()
    })
  })
})
