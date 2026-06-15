// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWizardStore } from '@/stores/useWizardStore'
import { createMockMessageContext } from './testUtils'
import { BuildPhaseHandler } from '../BuildPhaseHandler'
import type { MessageContext, WebSocketMessage } from '../types'

// The shared notification helper (and therefore the handler) logs invalid
// steps through @/lib/request-context. Stub it so the warn path is silent and
// isolated from the real lazy ContextLogger singleton.
vi.mock('@/lib/request-context', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}))

describe('BuildPhaseHandler', () => {
  let handler: BuildPhaseHandler
  let mockContext: MessageContext

  beforeEach(() => {
    useWizardStore.setState({ stepByApp: {} })
    handler = new BuildPhaseHandler()
    // Handler only reads context.currentAppId, but use the realistic
    // DataHandlerContext shape produced by the shared test util.
    mockContext = createMockMessageContext({ currentAppId: 'app1234567' })
  })

  it('declares the build_phase type', () => {
    expect(handler.type).toBe('build_phase')
  })

  it('updates the wizard store for the current app', async () => {
    const data: WebSocketMessage = {
      type: 'build_phase',
      content: '',
      data: { step: 2, appId: 'app1234567' },
    }

    await handler.handle(data, mockContext)

    expect(useWizardStore.getState().getStep('app1234567')).toBe(2)
  })

  it('falls back to the client app id when the event omits appId', async () => {
    const data: WebSocketMessage = {
      type: 'build_phase',
      content: '',
      data: { step: 4 },
    }

    await handler.handle(data, mockContext)

    expect(useWizardStore.getState().getStep('app1234567')).toBe(4)
  })

  it('ignores build_phase events targeting a different app', async () => {
    const data: WebSocketMessage = {
      type: 'build_phase',
      content: '',
      data: { step: 3, appId: 'someOtherApp' },
    }

    await handler.handle(data, mockContext)

    expect(useWizardStore.getState().getStep('app1234567')).toBeUndefined()
    expect(useWizardStore.getState().getStep('someOtherApp')).toBeUndefined()
  })

  it('does not update the store for an out-of-range step', async () => {
    const data: WebSocketMessage = {
      type: 'build_phase',
      content: '',
      data: { step: 9, appId: 'app1234567' },
    }

    await handler.handle(data, mockContext)

    expect(useWizardStore.getState().getStep('app1234567')).toBeUndefined()
  })

  it('tolerates a missing data payload without throwing', async () => {
    const data: WebSocketMessage = {
      type: 'build_phase',
      content: '',
    }

    await expect(handler.handle(data, mockContext)).resolves.toBeUndefined()
    expect(useWizardStore.getState().getStep('app1234567')).toBeUndefined()
  })
})
