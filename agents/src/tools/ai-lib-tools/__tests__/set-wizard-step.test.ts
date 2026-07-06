import { designKitLayoutForPhase } from '@airo/shared'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted mocks — declared before vi.mock factories that reference them.
const { setMock, publishMock, getConversationsByAppMock, syncBrandTokensCssMock, createForWorkspaceMock, persistBuilderLayoutMock, publishLayoutEventMock, callOrder } = vi.hoisted(() => {
  const callOrder: string[] = []
  return {
    callOrder,
    setMock: vi.fn(async () => ({ success: true })),
    publishMock: vi.fn(function build_phase() { callOrder.push('build_phase') }),
    getConversationsByAppMock: vi.fn(() => ['conv-1']),
    syncBrandTokensCssMock: vi.fn(async () => undefined),
    createForWorkspaceMock: vi.fn(),
    persistBuilderLayoutMock: vi.fn(function persist() { callOrder.push('persist') }),
    publishLayoutEventMock: vi.fn(async function publishLayout() { callOrder.push('publish_layout') }),
  }
})

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

// Entering the brand phase syncs public/brand-tokens.css for the showcase via the workspace.
vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: createForWorkspaceMock,
}))
vi.mock('../../../services/design-system/brand-tokens-css.js', () => ({
  syncBrandTokensCss: syncBrandTokensCssMock,
}))

// The tool persists the layout descriptor then publishes it as a separate step; mock both so
// this unit test asserts the persist-before-emit ordering without a DB write.
vi.mock('../../../services/builder-layout/update-builder-layout.js', () => ({
  persistBuilderLayout: persistBuilderLayoutMock,
  publishLayoutEvent: publishLayoutEventMock,
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
import { createStubWorkspaceFiles } from '../../../workspace/__tests__/test-workspace-files.js'
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
    persistBuilderLayoutMock.mockClear()
    publishLayoutEventMock.mockClear()
    callOrder.length = 0
    createForWorkspaceMock.mockReturnValue({ files: createStubWorkspaceFiles({ write: vi.fn(), readText: vi.fn().mockResolvedValue('') }) })
    setMock.mockResolvedValue({ success: true })
  })

  it('syncs public/brand-tokens.css when advancing to the brand phase (showcase reveal)', async () => {
    await setWizardStepAITool.execute({ phase: 'brand' }, createContext('app1234567') as never)

    expect(syncBrandTokensCssMock).toHaveBeenCalledTimes(1)
    expect(syncBrandTokensCssMock).toHaveBeenCalledWith('app1234567', 'cust1', expect.anything())
  })

  it('does not sync brand-tokens.css for the gathering phase', async () => {
    await setWizardStepAITool.execute({ phase: 'gathering' }, createContext('app1234567') as never)

    expect(syncBrandTokensCssMock).not.toHaveBeenCalled()
  })

  it('does not sync brand-tokens.css for the website phase', async () => {
    await setWizardStepAITool.execute({ phase: 'website' }, createContext('app1234567') as never)

    expect(syncBrandTokensCssMock).not.toHaveBeenCalled()
  })

  it('persists brand.wizard.phase under the workspace scope and emits a build_phase event', async () => {
    const result = await setWizardStepAITool.execute(
      { phase: 'brand' },
      createContext('app1234567') as never,
    )

    // Scope is built via workspaceScopeFromAppId(appId, customerId) → resolved scope.
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'app1234567', customerId: 'cust1' }),
      'brand.wizard.phase',
      { phase: 'brand' },
    )

    expect(publishMock).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        conversationId: 'conv-1',
        type: 'build_phase',
        data: expect.objectContaining({ phase: 'brand', appId: 'app1234567' }),
      }),
    )

    expect(typeof result).toBe('string')
    expect(result).toContain('brand')
  })

  it('persists the resolved layout descriptor for the phase then publishes it', async () => {
    await setWizardStepAITool.execute({ phase: 'website' }, createContext('app1234567') as never)

    const expected = designKitLayoutForPhase(true, 'website')
    expect(persistBuilderLayoutMock).toHaveBeenCalledWith('app1234567', expected)
    expect(publishLayoutEventMock).toHaveBeenCalledWith('app1234567', expected)
  })

  it('persists BEFORE build_phase, and publishes the layout event AFTER build_phase', async () => {
    await setWizardStepAITool.execute({ phase: 'brand' }, createContext('app1234567') as never)

    expect(callOrder).toEqual(['persist', 'build_phase', 'publish_layout'])
  })

  it('does NOT publish build_phase (or the layout event) when the layout persist fails', async () => {
    persistBuilderLayoutMock.mockImplementationOnce(function persistThrows() {
      throw new Error('db down')
    })

    const result = await setWizardStepAITool.execute(
      { phase: 'brand' },
      createContext('app1234567') as never,
    )

    expect(result).toContain('Error')
    expect(publishMock).not.toHaveBeenCalled()
    expect(publishLayoutEventMock).not.toHaveBeenCalled()
  })

  it('returns an error and does not persist or emit when appId is missing', async () => {
    const result = await setWizardStepAITool.execute(
      { phase: 'gathering' },
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
      { phase: 'brand' },
      createContext('app1234567') as never,
    )

    expect(result).toContain('Error')
    expect(result).toContain('Failed to save wizard phase')
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('still returns success when the SSE publish throws (emit failure is swallowed)', async () => {
    publishMock.mockImplementationOnce(() => {
      throw new Error('stream gone')
    })

    const result = await setWizardStepAITool.execute(
      { phase: 'gathering' },
      createContext('app1234567') as never,
    )

    expect(setMock).toHaveBeenCalled()
    expect(typeof result).toBe('string')
    expect(result).not.toContain('Error')
    expect(result).toContain('gathering')
  })
})

describe('StepSchema (phase) bounds', () => {
  it('accepts the four valid phases', () => {
    expect(StepSchema.safeParse({ phase: 'gathering' }).success).toBe(true)
    expect(StepSchema.safeParse({ phase: 'brand' }).success).toBe(true)
    expect(StepSchema.safeParse({ phase: 'website' }).success).toBe(true)
    expect(StepSchema.safeParse({ phase: 'ready' }).success).toBe(true)
  })

  it('rejects the renamed legacy "working" phase', () => {
    expect(StepSchema.safeParse({ phase: 'working' }).success).toBe(false)
  })

  it('rejects an unknown phase', () => {
    expect(StepSchema.safeParse({ phase: 'finished' }).success).toBe(false)
  })

  it('rejects a missing phase', () => {
    expect(StepSchema.safeParse({}).success).toBe(false)
  })

  it('rejects a legacy numeric step payload', () => {
    expect(StepSchema.safeParse({ step: 3 }).success).toBe(false)
  })
})
