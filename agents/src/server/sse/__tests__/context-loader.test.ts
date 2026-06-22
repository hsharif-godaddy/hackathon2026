import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createSSEContextLoader, type SSEContextLoaderDeps } from '../context-loader.js'
import { skillToolManager } from '../../../tools/skill-tool-manager.js'
import { persistAppFqdn } from '../../../lib/app-fqdn.js'

vi.mock('../../../lib/app-fqdn.js', () => ({
  persistAppFqdn: vi.fn(),
}))

function makeDeps(overrides: Partial<SSEContextLoaderDeps> = {}): SSEContextLoaderDeps {
  return {
    agentFactory: {
      stateManager: { tag: 'stateManager' },
      agents: {
        get: vi.fn().mockReturnValue(undefined),
      },
    },
    contextMgr: {
      convertToEnhancedContext: vi.fn(function (ctx: unknown) { return { enhanced: ctx }; }),
      buildContextMessages: vi.fn().mockResolvedValue({
        contextMessages: [{ role: 'system', content: 'ctx' }],
        formattedContexts: [{ type: 'fmt' }],
      }),
    },
    hasUnbuiltRebuildPages: vi.fn().mockResolvedValue(false),
    ...overrides,
  }
}

describe('createSSEContextLoader', () => {
  it('injects stateManager onto context.metadata so tools can trigger handoffs', async () => {
    const stateManager = { switchAgent: vi.fn() }
    const deps = makeDeps({
      agentFactory: {
        stateManager,
        agents: { get: vi.fn().mockReturnValue(undefined) },
      },
    })
    const loader = createSSEContextLoader(deps)
    const context: Record<string, unknown> = { metadata: { appId: 'app-1' } }

    await loader(context)

    expect((context.metadata as Record<string, unknown>).stateManager).toBe(stateManager)
  })

  it('creates metadata in place when caller passed none', async () => {
    const deps = makeDeps()
    const loader = createSSEContextLoader(deps)
    const context: Record<string, unknown> = {}

    await loader(context)

    expect(context.metadata).toBeDefined()
    expect((context.metadata as Record<string, unknown>).stateManager).toBeDefined()
  })

  it('persists the server-authoritative fqdn from metadata once per turn', async () => {
    const deps = makeDeps()
    const loader = createSSEContextLoader(deps)
    const context: Record<string, unknown> = { metadata: { appId: 'app-1', fqdn: 'studiosketch.com' } }

    await loader(context)

    expect(persistAppFqdn).toHaveBeenCalledWith('app-1', context.metadata)
  })

  it('sets hasUnbuiltRebuildPages on metadata when appId is present', async () => {
    const hasUnbuiltRebuildPages = vi.fn().mockResolvedValue(true)
    const deps = makeDeps({ hasUnbuiltRebuildPages })
    const loader = createSSEContextLoader(deps)
    const context: Record<string, unknown> = { metadata: { appId: 'app-1' } }

    await loader(context)

    expect(hasUnbuiltRebuildPages).toHaveBeenCalledWith('app-1')
    expect((context.metadata as Record<string, unknown>).hasUnbuiltRebuildPages).toBe(true)
  })

  it('enriches metadata with app DB customer and subscription for regular sessions', async () => {
    const deps = makeDeps({
      getAppContextFields: vi.fn().mockReturnValue({ customerId: 'cust-db', subscriptionId: 'sub-db' }),
    })
    const loader = createSSEContextLoader(deps)
    const context: Record<string, unknown> = { metadata: { appId: 'app-1' } }

    await loader(context)

    expect(deps.getAppContextFields).toHaveBeenCalledWith('app-1')
    expect(context.metadata).toEqual(expect.objectContaining({
      customerId: 'cust-db',
      subscriptionId: 'sub-db',
    }))
  })

  it('uses BMS override subscription metadata for employee and test sessions', async () => {
    const deps = makeDeps({
      getAppContextFields: vi.fn().mockReturnValue({ customerId: 'cust-db', subscriptionId: 'sub-db' }),
    })
    const loader = createSSEContextLoader(deps)
    const employeeContext: Record<string, unknown> = { metadata: { appId: 'app-1', authType: 'e2s' } }
    const testBudgetContext: Record<string, unknown> = { metadata: { appId: 'app-1', useTestBudget: true } }

    await loader(employeeContext)
    await loader(testBudgetContext)

    expect((employeeContext.metadata as Record<string, unknown>).subscriptionId).toBe('airo-builder:care-agent')
    expect((testBudgetContext.metadata as Record<string, unknown>).subscriptionId).toBe('airo-builder:test-accounts')
  })

  it('continues context loading when getApp throws', async () => {
    const deps = makeDeps({
      getAppContextFields: vi.fn(function () { throw new Error('SQLITE_BUSY') }),
    })
    const loader = createSSEContextLoader(deps)
    const context: Record<string, unknown> = { metadata: { appId: 'app-1' } }

    const result = await loader(context)

    expect(result.contextMessages).toEqual([{ role: 'system', content: 'ctx' }])
    expect(deps.contextMgr.buildContextMessages).toHaveBeenCalled()
    expect((context.metadata as Record<string, unknown>).customerId).toBeUndefined()
    expect((context.metadata as Record<string, unknown>).subscriptionId).toBeUndefined()
  })

  it('defaults hasUnbuiltRebuildPages to false when appId is absent', async () => {
    const hasUnbuiltRebuildPages = vi.fn().mockResolvedValue(true)
    const deps = makeDeps({ hasUnbuiltRebuildPages })
    const loader = createSSEContextLoader(deps)
    const context: Record<string, unknown> = { metadata: {} }

    await loader(context)

    expect(hasUnbuiltRebuildPages).not.toHaveBeenCalled()
    expect((context.metadata as Record<string, unknown>).hasUnbuiltRebuildPages).toBe(false)
  })

  it('resolves per-agent contextPreferences from agentFactory and passes to buildContextMessages', async () => {
    const prefs = { includeVisualContext: true, includeTemplateDescription: false }
    const get = vi.fn().mockReturnValue({
      getConfig: () => ({ metadata: { contextPreferences: prefs } }),
    })
    const deps = makeDeps({
      agentFactory: {
        stateManager: { tag: 'sm' },
        agents: { get },
      },
    })
    const loader = createSSEContextLoader(deps)
    const context: Record<string, unknown> = { metadata: { appId: 'app-1', agentId: 'develop' } }

    await loader(context)

    expect(get).toHaveBeenCalledWith('develop')
    expect(deps.contextMgr.buildContextMessages).toHaveBeenCalledWith('', expect.anything(), prefs)
  })

  it('passes undefined preferences when agentId is missing', async () => {
    const deps = makeDeps()
    const loader = createSSEContextLoader(deps)
    const context: Record<string, unknown> = { metadata: { appId: 'app-1' } }

    await loader(context)

    expect(deps.agentFactory.agents.get).not.toHaveBeenCalled()
    expect(deps.contextMgr.buildContextMessages).toHaveBeenCalledWith('', expect.anything(), undefined)
  })

  it('passes undefined preferences when the agent is not registered', async () => {
    const deps = makeDeps({
      agentFactory: {
        stateManager: { tag: 'sm' },
        agents: { get: vi.fn().mockReturnValue(undefined) },
      },
    })
    const loader = createSSEContextLoader(deps)
    const context: Record<string, unknown> = { metadata: { appId: 'app-1', agentId: 'unknown' } }

    await loader(context)

    expect(deps.contextMgr.buildContextMessages).toHaveBeenCalledWith('', expect.anything(), undefined)
  })

  it('preserves existing contextAttachments and appends selectedAssets', async () => {
    const deps = makeDeps()
    const loader = createSSEContextLoader(deps)
    const existing = { type: 'ai_edit_context', data: { selector: '#x' } }
    const context: Record<string, unknown> = {
      metadata: { appId: 'app-1' },
      contextAttachments: [existing],
      selectedAssets: [{ id: 'asset-1' }],
    }

    await loader(context)

    const enhancedArg = (deps.contextMgr.convertToEnhancedContext as any).mock.calls[0][0] as any
    expect(enhancedArg.contextAttachments).toHaveLength(2)
    expect(enhancedArg.contextAttachments[0]).toEqual(existing)
    expect(enhancedArg.contextAttachments[1]).toMatchObject({
      type: 'selected_assets',
      data: [{ id: 'asset-1' }],
    })
  })

  it('omits contextAttachments when caller provides none', async () => {
    const deps = makeDeps()
    const loader = createSSEContextLoader(deps)
    const context: Record<string, unknown> = { metadata: { appId: 'app-1' } }

    await loader(context)

    const enhancedArg = (deps.contextMgr.convertToEnhancedContext as any).mock.calls[0][0] as any
    expect(enhancedArg.contextAttachments).toBeUndefined()
  })

  it('runs hasUnbuiltRebuildPages in parallel with buildContextMessages', async () => {
    const order: string[] = []
    const hasUnbuiltRebuildPages = vi.fn(async function () {
      order.push('rebuild-start')
      await new Promise(r => setTimeout(r, 10))
      order.push('rebuild-end')
      return true
    })
    const buildContextMessages = vi.fn(async function () {
      order.push('build-start')
      await new Promise(r => setTimeout(r, 10))
      order.push('build-end')
      return { contextMessages: [], formattedContexts: [] }
    })
    const deps = makeDeps({
      hasUnbuiltRebuildPages,
      contextMgr: {
        convertToEnhancedContext: vi.fn(function (ctx) { return ctx; }),
        buildContextMessages,
      },
    })
    const loader = createSSEContextLoader(deps)
    await loader({ metadata: { appId: 'app-1' } })

    // Both start before either finishes.
    expect(order.indexOf('rebuild-start')).toBeLessThan(order.indexOf('build-end'))
    expect(order.indexOf('build-start')).toBeLessThan(order.indexOf('rebuild-end'))
  })

  it('returns contextMessages and formattedContexts from the context manager', async () => {
    const messages = [{ role: 'user', content: 'hi' }]
    const formatted = [{ type: 'f1' }]
    const deps = makeDeps({
      contextMgr: {
        convertToEnhancedContext: vi.fn(function (c) { return c; }),
        buildContextMessages: vi.fn().mockResolvedValue({
          contextMessages: messages,
          formattedContexts: formatted,
        }),
      },
    })
    const loader = createSSEContextLoader(deps)

    const result = await loader({ metadata: { appId: 'app-1' } })

    expect(result.contextMessages).toStrictEqual(messages)
    expect(result.formattedContexts).toBe(formatted)
  })

  describe('appBaseUrl resolution', () => {
    it('writes previewUrl from getApp to metadata.appBaseUrl when unset', async () => {
      const deps = makeDeps({ getAppContextFields: vi.fn().mockReturnValue({ previewUrl: 'http://localhost:3001' }) })
      const loader = createSSEContextLoader(deps)
      const context: Record<string, unknown> = { metadata: { appId: 'app-1' } }

      await loader(context)

      expect(deps.getAppContextFields).toHaveBeenCalledWith('app-1')
      expect((context.metadata as Record<string, unknown>).appBaseUrl).toBe('http://localhost:3001')
    })

    it('does not overwrite metadata.appBaseUrl when already set', async () => {
      const deps = makeDeps({ getAppContextFields: vi.fn().mockReturnValue({ previewUrl: 'http://localhost:9999' }) })
      const loader = createSSEContextLoader(deps)
      const context: Record<string, unknown> = {
        metadata: { appId: 'app-1', appBaseUrl: 'http://localhost:3001' },
      }

      await loader(context)

      expect((context.metadata as Record<string, unknown>).appBaseUrl).toBe('http://localhost:3001')
    })

    it('leaves metadata.appBaseUrl unset when getApp returns no previewUrl', async () => {
      const deps = makeDeps({ getAppContextFields: vi.fn().mockReturnValue({ customerId: 'c1' }) })
      const loader = createSSEContextLoader(deps)
      const context: Record<string, unknown> = { metadata: { appId: 'app-1' } }

      await loader(context)

      expect((context.metadata as Record<string, unknown>).appBaseUrl).toBeUndefined()
    })
  })

  describe('pinned-skill injection (SSE parity with WS)', () => {
    const conv = 'sse-conv-pin-1'

    beforeEach(() => {
      for (const s of skillToolManager.getPinnedSkills(conv)) {
        skillToolManager.unpinSkill(conv, s)
      }
    })

    it('appends pinned-skill context messages when conversationId is on metadata', async () => {
      skillToolManager.pinSkill(conv, 'seo')
      const deps = makeDeps()
      const loader = createSSEContextLoader(deps)

      const result = await loader({ metadata: { appId: 'app-1', conversationId: conv } })

      const pinnedMsg = result.contextMessages.find(
        (m: any) => typeof m.content === 'string' && m.content.includes('Pinned skill: seo'),
      )
      expect(pinnedMsg).toBeDefined()
      expect((pinnedMsg as any).insertionOrder).toBe('before_history')
    })

    it('does not inject pinned context when conversationId is missing', async () => {
      skillToolManager.pinSkill(conv, 'seo')
      const deps = makeDeps()
      const loader = createSSEContextLoader(deps)

      const result = await loader({ metadata: { appId: 'app-1' } })

      const pinnedMsg = result.contextMessages.find(
        (m: any) => typeof m.content === 'string' && m.content.includes('Pinned skill:'),
      )
      expect(pinnedMsg).toBeUndefined()
    })
  })
})
