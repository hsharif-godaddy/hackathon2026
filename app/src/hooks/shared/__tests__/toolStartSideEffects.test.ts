/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { logActionEvent } from '@/utils/instrumentation'
import { handleToolStartSideEffects } from '../toolStartSideEffects'

vi.mock('@/utils/instrumentation', () => ({
  logActionEvent: vi.fn(() => vi.fn()),
}))

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: {
    getState: vi.fn(),
  },
}))

describe('handleToolStartSideEffects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useDevelopPageStore.getState).mockReturnValue({
      app: { initialBuildComplete: false },
    } as any)
  })

  describe('websiteRebuild', () => {
    it('tags rebuild as initial when app has not finished its first build', () => {
      vi.mocked(useDevelopPageStore.getState).mockReturnValue({
        app: { initialBuildComplete: false },
      } as any)

      handleToolStartSideEffects({
        name: 'websiteRebuild',
        input: { url: 'https://acme.example.com' },
      })

      expect(logActionEvent).toHaveBeenCalledWith({
        eid: 'develop.rebuild.start',
        action: 'load',
        customProperties: { phase: 'initial', sourceUrl: 'https://acme.example.com' },
      })
    })

    it('tags rebuild as follow_up when app has completed its first build', () => {
      vi.mocked(useDevelopPageStore.getState).mockReturnValue({
        app: { initialBuildComplete: true },
      } as any)

      handleToolStartSideEffects({
        name: 'websiteRebuild',
        input: { url: 'https://example.com' },
      })

      expect(logActionEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          customProperties: expect.objectContaining({ phase: 'follow_up' }),
        }),
      )
    })

    it('treats undefined app (pre-hydration) as initial', () => {
      vi.mocked(useDevelopPageStore.getState).mockReturnValue({ app: undefined } as any)

      handleToolStartSideEffects({
        name: 'websiteRebuild',
        input: { url: 'https://example.com' },
      })

      expect(logActionEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          customProperties: expect.objectContaining({ phase: 'initial' }),
        }),
      )
    })
  })

  describe('non-rebuild tools', () => {
    it('does not fire any EID for non-rebuild tools (skill analytics live on tool_result)', () => {
      handleToolStartSideEffects({ name: 'skill', input: {} })
      handleToolStartSideEffects({ name: 'blog__createPost', input: {} })
      handleToolStartSideEffects({ name: 'file-edit', input: {} })

      expect(logActionEvent).not.toHaveBeenCalled()
    })
  })
})
