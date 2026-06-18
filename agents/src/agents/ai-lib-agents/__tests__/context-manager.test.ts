import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AILibContextManager } from '../context-manager.js'

const { latestSummary, getMessageById, summaryStore, pinnedSummaryId } = vi.hoisted(() => ({
  latestSummary: { value: null as any },
  getMessageById: vi.fn().mockResolvedValue({ id: 'm1' }),
  summaryStore: new Map<string, any>(),
  pinnedSummaryId: { value: null as string | null },
}))

vi.mock('../../../memory/adapters/index.js', () => ({
  getMessageStore: () => ({ getMessageById }),
  getKvMemoryStore: () => ({}),
  getSummaryStore: () => ({
    findLatestForApp: vi.fn().mockImplementation(async function (_scope: any) { return latestSummary.value; }),
    findById: vi.fn().mockImplementation(async function (id: string) { return summaryStore.get(id) ?? null; }),
  }),
}))

vi.mock('../../../services/ContextAttachmentRegistry.js', () => ({
  contextAttachmentRegistry: {
    render: vi.fn()
  }
}))

vi.mock('../../../services/ConversationContextManager.js', () => ({
  ConversationContextManager: class {
    getHistoryLoader() {
      return {
        getPinnedSummaryId: () => pinnedSummaryId.value
      }
    }
  }
}))

import { contextAttachmentRegistry } from '../../../services/ContextAttachmentRegistry.js'
const mockedRegistryRender = vi.mocked(contextAttachmentRegistry.render)

const { appContextResult } = vi.hoisted(() => ({
  appContextResult: {
    value: null as { stableContext?: string; secretsContext?: string; mediaSlotsContext?: string; gitStatusContext?: string; publishStateContext?: string } | null
  }
}))

vi.mock('../../../services/AppContextManager.js', () => ({
  AppContextManager: class {
    generateContextMessage = vi.fn().mockImplementation(async function () { return appContextResult.value ?? {}; })
  }
}))

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: class {
    findById = vi.fn().mockReturnValue({ id: 'app-123', path: '/tmp/test-app' })
  }
}))

const { workspaceFilesMock, MockDevSupervisorError, mockLogger } = vi.hoisted(() => {
  class _Err extends Error {
    code: string
    statusCode = 404
    constructor(code: string, msg: string) { super(msg); this.code = code; this.name = 'DevSupervisorError' }
  }
  const _logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  return {
    workspaceFilesMock: {
      view: vi.fn(),
      tree: vi.fn(),
      stat: vi.fn(),
    },
    MockDevSupervisorError: _Err,
    mockLogger: _logger,
  }
})

vi.mock('../../../logging/index.js', () => ({
  logger: mockLogger,
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), forApp: vi.fn(() => mockLogger) },
  Logger: { create: vi.fn(() => mockLogger) },
}))

vi.mock('../../../services/DevSupervisorClient.js', () => ({
  DevSupervisorError: MockDevSupervisorError,
  isDevSupervisorNotFound: (err: unknown): boolean =>
    err instanceof MockDevSupervisorError && err.code === 'not_found',
}))

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(() => ({ files: workspaceFilesMock })),
}))

describe('AILibContextManager', () => {
  beforeEach(() => {
    latestSummary.value = null
    pinnedSummaryId.value = null
    summaryStore.clear()
    getMessageById.mockClear()
    mockedRegistryRender.mockClear()
    appContextResult.value = null
    workspaceFilesMock.view.mockReset()
    workspaceFilesMock.tree.mockReset()
    workspaceFilesMock.stat.mockReset()
    mockLogger.warn.mockClear()
    // Default: every workspace.files.* call signals "not found" (no UI kit, no classification).
    // stat() returns inline per-path errors; view/tree throw not_found errors.
    workspaceFilesMock.view.mockRejectedValue(new MockDevSupervisorError('not_found', 'no such file'))
    workspaceFilesMock.tree.mockRejectedValue(new MockDevSupervisorError('not_found', 'no such directory'))
    workspaceFilesMock.stat.mockImplementation(async ({ paths }: { paths: string[] }) => ({
      entries: paths.map((path) => ({ path, error: 'not_found' as const })),
    }))
  })

  it('injects summary as cached USER memory message (not system, for security)', async () => {
    latestSummary.value = {
      id: 'sum1',
      summaryText: '# Summary',
      operationLog: 'Edited file A',
      summaryTokenCount: 123,
      originalTokenCount: 456,
      messageRangeEnd: 'm1'
    }

    const contextManager = new AILibContextManager()
    const result = await contextManager.buildContextMessages(
      '',
      { metadata: { appId: 'app-123' } },
      { includeTemplateDescription: false, includeAppContext: false }
    )

    // SECURITY: Memory must be injected as USER message, not system
    // User-derived content should never be elevated to system prompt privilege
    const memoryMessage = result.contextMessages.find(
      (msg) => msg.role === 'user' && msg.content.includes('# Memory')
    )

    expect(memoryMessage).toBeDefined()
    expect(memoryMessage?.cachePoint).toEqual({ type: 'ephemeral' })
    expect(memoryMessage?.content).toContain('# Summary')
    // Operation log is NOT included here — it's injected separately by
    // ConversationHistoryLoader to avoid duplicating content in the prompt
    expect(memoryMessage?.content).not.toContain('## Operation Log')

    // Verify it's NOT a system message
    const systemMemoryMessage = result.contextMessages.find(
      (msg) => msg.role === 'system' && msg.content.includes('# Memory')
    )
    expect(systemMemoryMessage).toBeUndefined()
  })

  describe('vision: assetImages in formattedContexts', () => {
    it('populates formattedContexts with assetImages from a selected_assets attachment', async () => {
      const manager = new AILibContextManager()
      const fakeBase64 = `data:image/jpeg;base64,${Buffer.from('fake').toString('base64')}`

      mockedRegistryRender.mockResolvedValue({
        role: 'user' as const,
        content: 'Asset context text',
        insertionOrder: 'after_history' as const,
        assetImages: [fakeBase64]
      })

      const context = {
        metadata: { appId: 'test-app' },
        contextAttachments: [{
          type: 'selected_assets',
          data: [{
            mediaType: 'IMAGE',
            sourceType: 'upload',
            imageUrl: 'http://localhost:4000/files/uploads/test-app/img.jpg',
            filename: 'img.jpg',
            contentType: 'image/jpeg',
            size: 1024
          }],
          persistence: 'ephemeral' as const,
          renderStrategy: 'before_prompt' as const
        }]
      }

      const result = await manager.buildContextMessages('', context as any)
      expect(result.formattedContexts).toBeDefined()
      const imageContexts = result.formattedContexts!.filter(f => f.assetImages && f.assetImages.length > 0)
      expect(imageContexts).toHaveLength(1)
      expect(imageContexts[0]!.assetImages).toContain(fakeBase64)
    })

    it('threads the current user message (metadata._userMessage) into the attachment renderer', async () => {
      const manager = new AILibContextManager()
      mockedRegistryRender.mockResolvedValue({
        role: 'user' as const,
        content: 'rendered',
        insertionOrder: 'after_history' as const,
      })

      const context = {
        metadata: { appId: 'test-app', _userMessage: 'use this as the hero' },
        contextAttachments: [{
          type: 'file_upload',
          data: { name: 'hero.jpg', isImage: true },
          persistence: 'save' as const,
        }],
      }

      await manager.buildContextMessages('', context as any)

      // The classifier's intent decision depends on this prompt — assert it is passed through.
      expect(mockedRegistryRender).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'file_upload' }),
        'use this as the hero',
        expect.anything(),
      )
    })

    it('falls back to an empty prompt when _userMessage is absent', async () => {
      const manager = new AILibContextManager()
      mockedRegistryRender.mockResolvedValue({
        role: 'user' as const,
        content: 'rendered',
        insertionOrder: 'after_history' as const,
      })

      const context = {
        metadata: { appId: 'test-app' },
        contextAttachments: [{
          type: 'file_upload',
          data: { name: 'hero.jpg', isImage: true },
          persistence: 'save' as const,
        }],
      }

      await manager.buildContextMessages('', context as any)

      expect(mockedRegistryRender).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'file_upload' }),
        '',
        expect.anything(),
      )
    })

    it('does not add to formattedContexts when no assetImages in rendered attachment', async () => {
      const manager = new AILibContextManager()

      mockedRegistryRender.mockResolvedValue({
        role: 'user' as const,
        content: 'Some context',
        insertionOrder: 'after_history' as const
        // no assetImages
      })

      const context = {
        metadata: { appId: 'test-app' },
        contextAttachments: [{
          type: 'selected_assets',
          data: [{ mediaType: 'IMAGE', sourceType: 'stock', imageUrl: 'https://example.com/img.jpg' }],
          persistence: 'ephemeral' as const
        }]
      }

      const result = await manager.buildContextMessages('', context as any)
      const imageContexts = (result.formattedContexts ?? []).filter(f => f.assetImages && f.assetImages.length > 0)
      expect(imageContexts).toHaveLength(0)
    })
  })

  describe('summary pinning in context-manager', () => {
    const makeSummary = (id: string, appId: string, text: string) => ({
      id,
      appId,
      summaryText: text,
      summaryTokenCount: 100,
      originalTokenCount: 500,
      messageRangeEnd: 'm1'
    })

    it('uses pinned summary when pinnedId is set and appId matches', async () => {
      const pinned = makeSummary('pin-1', 'app-123', '# Pinned Summary')
      summaryStore.set('pin-1', pinned)
      pinnedSummaryId.value = 'pin-1'
      // Set a different "latest" to prove pinned is preferred
      latestSummary.value = makeSummary('latest-1', 'app-123', '# Latest Summary')

      const cm = new AILibContextManager()
      const result = await cm.buildContextMessages(
        '',
        { metadata: { appId: 'app-123' } },
        { includeTemplateDescription: false, includeAppContext: false }
      )

      const memoryMsg = result.contextMessages.find(
        (msg) => msg.role === 'user' && msg.content.includes('# Memory')
      )
      expect(memoryMsg?.content).toContain('Pinned Summary')
      expect(memoryMsg?.content).not.toContain('Latest Summary')
    })

    it('falls back to findLatestForApp when pinned summary has mismatched appId', async () => {
      const pinned = makeSummary('pin-1', 'other-app', '# Wrong App Summary')
      summaryStore.set('pin-1', pinned)
      pinnedSummaryId.value = 'pin-1'
      latestSummary.value = makeSummary('latest-1', 'app-123', '# Correct Latest')

      const cm = new AILibContextManager()
      const result = await cm.buildContextMessages(
        '',
        { metadata: { appId: 'app-123' } },
        { includeTemplateDescription: false, includeAppContext: false }
      )

      const memoryMsg = result.contextMessages.find(
        (msg) => msg.role === 'user' && msg.content.includes('# Memory')
      )
      expect(memoryMsg?.content).toContain('Correct Latest')
      expect(memoryMsg?.content).not.toContain('Wrong App Summary')
    })

    it('falls back to findLatestForApp when findById returns null', async () => {
      // pinnedId is set but summary doesn't exist in store
      pinnedSummaryId.value = 'deleted-pin'
      latestSummary.value = makeSummary('latest-1', 'app-123', '# Fallback Summary')

      const cm = new AILibContextManager()
      const result = await cm.buildContextMessages(
        '',
        { metadata: { appId: 'app-123' } },
        { includeTemplateDescription: false, includeAppContext: false }
      )

      const memoryMsg = result.contextMessages.find(
        (msg) => msg.role === 'user' && msg.content.includes('# Memory')
      )
      expect(memoryMsg?.content).toContain('Fallback Summary')
    })
  })

  describe('workspace-backed UI kit + upload classification', () => {
    function viewByPath(byPath: Record<string, string>): void {
      workspaceFilesMock.view.mockImplementation(async ({ path }: { path: string }) => {
        const content = byPath[path]
        if (content === undefined) {
          throw new MockDevSupervisorError('not_found', `no such file: ${path}`)
        }
        return { path, content, encoding: 'utf-8', lines: content.split('\n').length, size: content.length, truncated: false }
      })
    }

    function statHasFile(filePath: string): void {
      workspaceFilesMock.stat.mockImplementation(async ({ paths }: { paths: string[] }) => ({
        entries: paths.map((p) =>
          p === filePath
            ? { path: p, kind: 'file' as const, size: 100, modifiedAt: '2026-06-01T00:00:00Z' }
            : { path: p, error: 'not_found' as const },
        ),
      }))
    }

    it('injects UI-kit anchor when docs/ui-kit/kit-meta.json exists in the workspace', async () => {
      statHasFile('docs/ui-kit/kit-meta.json')

      const cm = new AILibContextManager()
      const result = await cm.buildContextMessages(
        '',
        { metadata: { appId: 'app-123' } },
        { includeTemplateDescription: false, includeAppContext: false }
      )

      const anchor = result.contextMessages.find((m) => m.content.includes('UI kit design system'))
      expect(anchor).toBeDefined()
      expect(workspaceFilesMock.stat).toHaveBeenCalledWith({
        paths: ['docs/ui-kit/kit-meta.json'],
      })
    })

    it('does not inject UI-kit anchor when kit-meta.json is missing (not_found)', async () => {
      // beforeEach already wires every stat → not_found per-path
      const cm = new AILibContextManager()
      const result = await cm.buildContextMessages(
        '',
        { metadata: { appId: 'app-123' } },
        { includeTemplateDescription: false, includeAppContext: false }
      )

      const anchor = result.contextMessages.find((m) => m.content.includes('UI kit design system'))
      expect(anchor).toBeUndefined()
    })

    it('injects upload classification when docs/.upload-classification.json exists', async () => {
      viewByPath({ 'docs/.upload-classification.json': JSON.stringify({ fileName: 'logo.png' }) })

      const cm = new AILibContextManager()
      const result = await cm.buildContextMessages(
        '',
        { metadata: { appId: 'app-123' } },
        { includeTemplateDescription: false, includeAppContext: false }
      )

      const classification = result.contextMessages.find((m) => m.content.includes('Upload Classification'))
      expect(classification).toBeDefined()
      expect(classification?.content).toContain('logo.png')
      expect(classification?.content).toContain('src/assets/logo.png')
      expect(classification?.content).toContain('## Upload handling')
      expect(workspaceFilesMock.view).toHaveBeenCalledWith({ path: 'docs/.upload-classification.json', limit: 65536 })
    })

    it('points at the slot URL (not src/assets) when a persisted image is registered to a slot', async () => {
      viewByPath({
        'docs/.upload-classifications.json': JSON.stringify({
          files: [
            {
              fileName: 'hero.jpg',
              assetRole: 'hero_image',
              placementIntent: 'display_on_site',
              slotUrl: '/airo-assets/images/uploads/hero-hero',
            },
          ],
        }),
      })

      const cm = new AILibContextManager()
      const result = await cm.buildContextMessages(
        '',
        { metadata: { appId: 'app-123' } },
        { includeTemplateDescription: false, includeAppContext: false }
      )

      const classification = result.contextMessages.find((m) => m.content.includes('Upload Classification'))
      expect(classification).toBeDefined()
      // Location line points at the slot URL and explicitly steers away from src/assets.
      expect(classification?.content).toContain('Registered media slot')
      expect(classification?.content).toContain('/airo-assets/images/uploads/hero-hero')
      expect(classification?.content).not.toContain('File location: `src/assets/hero.jpg`')
    })

    it('propagates non-not-found errors from workspace.files.view (no silent fallback)', async () => {
      workspaceFilesMock.view.mockRejectedValue(new MockDevSupervisorError('transport_error', 'connection refused'))

      const cm = new AILibContextManager()
      await expect(cm.buildContextMessages(
        '',
        { metadata: { appId: 'app-123' } },
        { includeTemplateDescription: false, includeAppContext: false }
      )).rejects.toMatchObject({ code: 'transport_error' })
    })

    it('logs context.upload-classification.parse-failed and skips the message when JSON is malformed', async () => {
      // view() returns content, but it is not valid JSON.
      viewByPath({ 'docs/.upload-classification.json': '{ this is { not valid' })

      const cm = new AILibContextManager()
      const result = await cm.buildContextMessages(
        '',
        { metadata: { appId: 'app-123' } },
        { includeTemplateDescription: false, includeAppContext: false }
      )

      // (a) Build did not reject.
      // (b) No "Upload Classification" message was appended.
      const classification = result.contextMessages.find((m) => m.content.includes('Upload Classification'))
      expect(classification).toBeUndefined()
      // (c) The warn fired with the expected event name + appId + error fields.
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'context.upload-classification.parse-failed',
        expect.objectContaining({ appId: 'app-123', error: expect.any(String) }),
      )
    })
  })

  describe('app context forwarding', () => {
    it('forwards app_context_stable as after_history user message', async () => {
      appContextResult.value = {
        stableContext: 'Package: test-app\nColor: blue'
      }

      const cm = new AILibContextManager()
      const result = await cm.buildContextMessages(
        '',
        { metadata: { appId: 'app-123' }, appContext: {} },
        { includeTemplateDescription: false }
      )

      const stableMsg = result.contextMessages.find(
        (msg) => msg.content.includes('Package: test-app')
      )
      expect(stableMsg).toBeDefined()
      expect(stableMsg?.role).toBe('user')
      expect(stableMsg?.insertionOrder).toBe('after_history')
    })

    it('forwards stable, secrets, and media slots context types', async () => {
      appContextResult.value = {
        stableContext: 'stable content',
        secretsContext: 'secrets content',
        mediaSlotsContext: 'media slots content'
      }

      const cm = new AILibContextManager()
      const result = await cm.buildContextMessages(
        '',
        { metadata: { appId: 'app-123' }, appContext: {} },
        { includeTemplateDescription: false }
      )

      const stable = result.contextMessages.find(m => m.content === 'stable content')
      const secrets = result.contextMessages.find(m => m.content === 'secrets content')
      const media = result.contextMessages.find(m => m.content === 'media slots content')

      expect(stable).toBeDefined()
      expect(secrets).toBeDefined()
      expect(media).toBeDefined()

      // All should be after_history to avoid cache invalidation
      expect(stable?.insertionOrder).toBe('after_history')
      expect(secrets?.insertionOrder).toBe('after_history')
      expect(media?.insertionOrder).toBe('after_history')

      // Ordering matters: stable before secrets before media_slots
      // (matches buildAppContextMessage push order)
      const stableIdx = result.contextMessages.indexOf(stable!)
      const secretsIdx = result.contextMessages.indexOf(secrets!)
      const mediaIdx = result.contextMessages.indexOf(media!)
      expect(stableIdx).toBeLessThan(secretsIdx)
      expect(secretsIdx).toBeLessThan(mediaIdx)
    })

    it('forwards gitStatusContext and publishStateContext as after_history user messages', async () => {
      appContextResult.value = {
        stableContext: 'stable content',
        gitStatusContext: '## Git Status\n- Branch: main\n- Uncommitted changes: 2',
        publishStateContext: '## App Status\n- Published: yes\n- URL: https://example.com'
      }

      const cm = new AILibContextManager()
      const result = await cm.buildContextMessages(
        '',
        { metadata: { appId: 'app-123' }, appContext: {} },
        { includeTemplateDescription: false }
      )

      const gitStatus = result.contextMessages.find(m => m.content.includes('Git Status'))
      const publishState = result.contextMessages.find(m => m.content.includes('App Status'))

      expect(gitStatus).toBeDefined()
      expect(gitStatus?.role).toBe('user')
      expect(gitStatus?.insertionOrder).toBe('after_history')

      expect(publishState).toBeDefined()
      expect(publishState?.role).toBe('user')
      expect(publishState?.insertionOrder).toBe('after_history')
    })

    it('omits gitStatusContext and publishStateContext when null', async () => {
      appContextResult.value = {
        stableContext: 'stable content',
        gitStatusContext: null as any,
        publishStateContext: null as any
      }

      const cm = new AILibContextManager()
      const result = await cm.buildContextMessages(
        '',
        { metadata: { appId: 'app-123' }, appContext: {} },
        { includeTemplateDescription: false }
      )

      const gitStatus = result.contextMessages.find(m => m.content?.includes?.('Git Status'))
      const publishState = result.contextMessages.find(m => m.content?.includes?.('App Status'))

      expect(gitStatus).toBeUndefined()
      expect(publishState).toBeUndefined()
    })

    it('does not include app context when includeAppContext is false', async () => {
      appContextResult.value = {
        stableContext: 'should not appear'
      }

      const cm = new AILibContextManager()
      const result = await cm.buildContextMessages(
        '',
        { metadata: { appId: 'app-123' }, appContext: {} },
        { includeTemplateDescription: false, includeAppContext: false }
      )

      const stableMsg = result.contextMessages.find(
        (msg) => msg.content.includes('should not appear')
      )
      expect(stableMsg).toBeUndefined()
    })
  })
})
