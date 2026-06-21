import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted mocks — declared before vi.mock factories that reference them.
const { setMock, publishMock, getConversationsByAppMock, syncBrandTokensCssMock, createForWorkspaceMock } = vi.hoisted(() => ({
  setMock: vi.fn(async () => ({ success: true })),
  publishMock: vi.fn(),
  getConversationsByAppMock: vi.fn(() => ['conv-1']),
  syncBrandTokensCssMock: vi.fn(async () => undefined),
  createForWorkspaceMock: vi.fn(() => ({ files: { write: vi.fn() } })),
}))

// The tool builds its memory store at module load via a module-level
// `const memoryStore = getKvMemoryStore()`, so this mock must be in place
// before the tool is imported (vi.mock is hoisted above the import below).
vi.mock('../../../memory/adapters/index.js', () => ({
  getKvMemoryStore: () => ({ set: setMock }),
}))

// The tool emits via the SSE seam (registry + event channel). Mock both so the
// build_phase publish can be asserted without pulling in heavy server/DB side
// effects in this unit test.
vi.mock('../../../server/sse/registry-singleton.js', () => ({
  getSSERegistry: () => ({ getConversationsByApp: getConversationsByAppMock }),
}))
vi.mock('../../../server/agent-runtime.js', () => ({
  getEventChannel: () => ({ publish: publishMock }),
}))

// Step 4 syncs public/brand-tokens.css for the showcase via the workspace.
vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: createForWorkspaceMock,
}))
vi.mock('../../../services/design-system/brand-tokens-css.js', () => ({
  syncBrandTokensCss: syncBrandTokensCssMock,
}))

// Mock Logger so the module-level Logger.create() call is inert.
vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: vi.fn(function () {
      return {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }
    }),
  },
}))

// Import after mocks.
import { setWizardStepAITool, StepSchema } from '../set-wizard-step.js'

// createTool remaps the AI SDK invocation `{ experimental_context: { metadata } }`
// into the `context.metadata` the execute fn reads. Mirror brand-identity.test.ts.
// customerId is supplied so workspaceScopeFromAppId resolves to a `resolved` scope.
const createContext = (appId: string) => ({
  experimental_context: { metadata: { appId, customerId: 'cust1' } },
})

describe('setWizardStepAITool execution', () => {
  beforeEach(() => {
    setMock.mockClear()
    publishMock.mockClear()
    getConversationsByAppMock.mockClear()
    getConversationsByAppMock.mockReturnValue(['conv-1'])
    syncBrandTokensCssMock.mockClear()
    createForWorkspaceMock.mockClear()
    setMock.mockResolvedValue({ success: true })
  })

  it('syncs public/brand-tokens.css when advancing to step 4 (showcase reveal)', async function syncsTokensOnStep4() {
    await setWizardStepAITool.execute({ step: 4 }, createContext('app1234567') as never)

    expect(syncBrandTokensCssMock).toHaveBeenCalledTimes(1)
    expect(syncBrandTokensCssMock).toHaveBeenCalledWith('app1234567', 'cust1', expect.anything())
  })

  it('does not sync brand-tokens.css for non-showcase steps', async function noSyncOffStep4() {
    await setWizardStepAITool.execute({ step: 3 }, createContext('app1234567') as never)

    expect(syncBrandTokensCssMock).not.toHaveBeenCalled()
  })

  it('persists brand.wizard.step under the workspace scope and emits a build_phase event', async () => {
    const result = await setWizardStepAITool.execute(
      { step: 3 },
      createContext('app1234567') as never,
    )

    // Scope is built via workspaceScopeFromAppId(appId, customerId) → resolved scope.
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'app1234567', customerId: 'cust1' }),
      'brand.wizard.step',
      { step: 3 },
    )

    expect(publishMock).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        conversationId: 'conv-1',
        type: 'build_phase',
        data: expect.objectContaining({ step: 3, appId: 'app1234567' }),
      }),
    )

    expect(typeof result).toBe('string')
    expect(result).toContain('3')
  })

  it('returns an error and does not persist or emit when appId is missing', async () => {
    const result = await setWizardStepAITool.execute(
      { step: 2 },
      { experimental_context: { metadata: {} } } as never,
    )

    expect(result).toContain('Error')
    expect(result).toContain('No app ID')
    expect(setMock).not.toHaveBeenCalled()
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('returns an error and skips the emit when the memory write fails', async () => {
    setMock.mockResolvedValueOnce({ success: false, error: 'Write failed' })

    const result = await setWizardStepAITool.execute(
      { step: 4 },
      createContext('app1234567') as never,
    )

    expect(result).toContain('Error')
    expect(result).toContain('Failed to save wizard step')
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('still returns success when the SSE publish throws (emit failure is swallowed)', async () => {
    publishMock.mockImplementationOnce(() => {
      throw new Error('stream gone')
    })

    const result = await setWizardStepAITool.execute(
      { step: 5 },
      createContext('app1234567') as never,
    )

    expect(setMock).toHaveBeenCalled()
    expect(typeof result).toBe('string')
    expect(result).not.toContain('Error')
    expect(result).toContain('5')
  })
})

describe('StepSchema bounds', () => {
  it('accepts integer steps within 1-5', () => {
    expect(StepSchema.safeParse({ step: 1 }).success).toBe(true)
    expect(StepSchema.safeParse({ step: 3 }).success).toBe(true)
    expect(StepSchema.safeParse({ step: 5 }).success).toBe(true)
  })

  it('rejects a step below the minimum of 1', () => {
    expect(StepSchema.safeParse({ step: 0 }).success).toBe(false)
  })

  it('rejects a step above the maximum of 5', () => {
    expect(StepSchema.safeParse({ step: 6 }).success).toBe(false)
    expect(StepSchema.safeParse({ step: 9 }).success).toBe(false)
  })

  it('rejects a non-integer step', () => {
    expect(StepSchema.safeParse({ step: 2.5 }).success).toBe(false)
  })
})
