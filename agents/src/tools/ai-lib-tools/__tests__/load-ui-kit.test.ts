import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Tool } from '@airo/ai-lib'
import { UI_KIT_COPY_GUARDRAIL } from '../../../prompts/ui-kit-guardrail.js'

const { workspaceFilesMock, workspaceMockState, MockDevSupervisorError, mockLogger } = vi.hoisted(() => {
  class _Err extends Error {
    code: string
    statusCode: number
    constructor(code: string, statusCode: number, msg: string) {
      super(msg)
      this.code = code
      this.statusCode = statusCode
      this.name = 'DevSupervisorError'
    }
  }
  const filesMock = {
    stat: vi.fn(),
    tree: vi.fn(),
    view: vi.fn(),
    readText: vi.fn().mockResolvedValue(''),
  }
  return {
    workspaceFilesMock: filesMock,
    // Toggled per-test: null simulates an app whose workspace cannot be bound
    // (createForWorkspace returns null); the populated object simulates the
    // happy path.
    workspaceMockState: { value: null as { files: typeof filesMock } | null },
    MockDevSupervisorError: _Err,
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }
})

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(() => workspaceMockState.value),
}))

vi.mock('../../../services/DevSupervisorClient.js', () => ({
  DevSupervisorError: MockDevSupervisorError,
  isDevSupervisorNotFound: (err: unknown): boolean =>
    err instanceof MockDevSupervisorError && err.code === 'not_found',
}))

vi.mock('../../../logging/index.js', () => ({
  logger: mockLogger,
  Logger: { create: vi.fn(() => mockLogger) },
}))

import { loadUiKitAITool } from '../load-ui-kit.js'

type StatEntry =
  | { path: string; kind: 'file' | 'directory'; size: number; modifiedAt: string }
  | { path: string; error: 'not_found' | 'permission_denied' | 'invalid_path' }

type TreeEntry = { path: string; kind: 'file' | 'directory'; size: number; modifiedAt: string }
type TreeResult = { entries: TreeEntry[]; truncated: boolean }
type ViewResult = { path: string; content: string; encoding: 'utf-8'; lines: number; size: number; truncated: boolean }

function fileEntry(path: string, size = 100): StatEntry {
  return { path, kind: 'file', size, modifiedAt: '2026-06-01T00:00:00Z' }
}
function dirEntry(path: string): StatEntry {
  return { path, kind: 'directory', size: 0, modifiedAt: '2026-06-01T00:00:00Z' }
}
function notFound(path: string): StatEntry {
  return { path, error: 'not_found' as const }
}

interface ToolContext {
  experimental_context: { metadata: { appId: string | undefined } }
}
function ctx(appId: string | undefined): ToolContext {
  return { experimental_context: { metadata: { appId } } }
}
function runTool(input: { include?: string[] }, context: ToolContext): Promise<string> {
  return loadUiKitAITool.execute(
    input,
    context as unknown as Parameters<Tool['execute']>[1],
  ) as Promise<string>
}

describe('loadUiKitAITool', () => {
  beforeEach(() => {
    workspaceFilesMock.stat.mockReset()
    workspaceFilesMock.tree.mockReset()
    workspaceFilesMock.view.mockReset()
    workspaceFilesMock.readText.mockReset()
    workspaceFilesMock.readText.mockResolvedValue('')
    mockLogger.info.mockClear()
    mockLogger.warn.mockClear()
    mockLogger.error.mockClear()
    mockLogger.debug.mockClear()
    workspaceMockState.value = { files: workspaceFilesMock }
  })

  it('returns error when context lacks appId', async () => {
    const out = await runTool({}, ctx(undefined))
    expect(out).toMatch(/app id required/i)
  })

  it("returns error when workspace cannot be bound (app doesn't exist)", async () => {
    workspaceMockState.value = null
    const out = await runTool({}, ctx('missing-app'))
    expect(out).toMatch(/App 'missing-app' not found/)
  })

  it("returns 'No UI kit found' when docs/ui-kit is absent", async () => {
    workspaceFilesMock.stat.mockResolvedValue({ entries: [notFound('docs/ui-kit')] })
    const out = await runTool({}, ctx('app-1'))
    expect(out).toContain('No UI kit found')
    expect(workspaceFilesMock.tree).not.toHaveBeenCalled()
    expect(workspaceFilesMock.readText).not.toHaveBeenCalled()
  })

  it("returns 'No UI kit found' when docs/ui-kit is a file (defensive)", async () => {
    workspaceFilesMock.stat.mockResolvedValue({ entries: [fileEntry('docs/ui-kit')] })
    const out = await runTool({}, ctx('app-1'))
    expect(out).toContain('No UI kit found')
  })

  it('propagates non-not-found errors at the kit-existence stat (e.g. permission_denied)', async () => {
    workspaceFilesMock.stat.mockResolvedValue({
      entries: [{ path: 'docs/ui-kit', error: 'permission_denied' as const }],
    })
    await expect(runTool({}, ctx('app-1'))).rejects.toThrow(/permission_denied/)
  })

  describe('default mode', () => {
    // Fixtures encode the dev-supervisor contract: tree() returns
    // workspace-rooted paths (the request `path` is already joined in). See
    // the docstring on TreeEntry.
    const treeByPath: Record<string, TreeResult> = {
      'docs/ui-kit/primitives': {
        entries: [
          { path: 'docs/ui-kit/primitives/button.md', kind: 'file', size: 100, modifiedAt: '' },
          { path: 'docs/ui-kit/primitives/tokens.json', kind: 'file', size: 50, modifiedAt: '' },
          { path: 'docs/ui-kit/primitives/_meta', kind: 'directory', size: 0, modifiedAt: '' },
        ],
        truncated: false,
      },
      'docs/ui-kit/components': {
        entries: [
          { path: 'docs/ui-kit/components/card.md', kind: 'file', size: 80, modifiedAt: '' },
          { path: 'docs/ui-kit/components/_README.txt', kind: 'file', size: 10, modifiedAt: '' },
          { path: 'docs/ui-kit/components/NOTES.MD', kind: 'file', size: 12, modifiedAt: '' }, // upper-case ext, must match
        ],
        truncated: false,
      },
      'docs/ui-kit/layouts': {
        entries: [
          { path: 'docs/ui-kit/layouts/recipe-editorial.md', kind: 'file', size: 120, modifiedAt: '' },
          { path: 'docs/ui-kit/layouts/.DS_Store', kind: 'file', size: 6, modifiedAt: '' }, // must be filtered out
        ],
        truncated: false,
      },
      'docs/ui-kit/showcase': {
        entries: [],
        truncated: false,
      },
    }
    const viewByPath: Record<string, string> = {
      'docs/ui-kit/primitives/button.md': '# Button\nThe button.',
      'docs/ui-kit/primitives/tokens.json': '{"primary":"#000"}',
      'docs/ui-kit/components/card.md': '# Card',
      'docs/ui-kit/components/NOTES.MD': '# Notes',
    }

    function wireDefault(): void {
      workspaceFilesMock.stat.mockResolvedValue({ entries: [dirEntry('docs/ui-kit')] })
      workspaceFilesMock.tree.mockImplementation(async ({ path }: { path: string }): Promise<TreeResult> => {
        const result = treeByPath[path]
        if (!result) throw new MockDevSupervisorError('not_found', 404, `no such dir: ${path}`)
        return result
      })
      workspaceFilesMock.readText.mockImplementation(async ({ path }: { path: string }): Promise<string> => {
        const content = viewByPath[path]
        if (content === undefined) throw new MockDevSupervisorError('not_found', 404, `no such file: ${path}`)
        return content
      })
    }

    it('loads primitives + components, lists layouts + showcase using workspace-rooted tree paths', async () => {
      wireDefault()
      const out = await runTool({}, ctx('app-1'))

      expect(out).toContain('# UI Kit — Design System')
      expect(out).toContain('## primitives/button.md')
      expect(out).toContain('# Button')
      expect(out).toContain('## primitives/tokens.json')
      expect(out).toContain('"primary"')
      expect(out).toContain('## components/card.md')
      expect(out).toContain('## components/NOTES.MD') // case-insensitive ext
      expect(out).not.toContain('_README.txt')
      expect(out).not.toContain('.DS_Store')
      expect(out).toContain('## Additional References')
      expect(out).toContain('- `layouts/recipe-editorial.md`')

      // Copy-reuse guardrail injected verbatim from the single shared source.
      expect(out).toContain(UI_KIT_COPY_GUARDRAIL)

      const readPaths = workspaceFilesMock.readText.mock.calls.map(
        (c) => (c[0] as { path: string }).path,
      )
      expect(readPaths).toContain('docs/ui-kit/primitives/button.md')
      expect(readPaths).toContain('docs/ui-kit/components/card.md')
      expect(readPaths).not.toContain('docs/ui-kit/layouts/recipe-editorial.md')
    })

    it('omits "Additional References" section when no list-only files exist', async () => {
      workspaceFilesMock.stat.mockResolvedValue({ entries: [dirEntry('docs/ui-kit')] })
      workspaceFilesMock.tree.mockImplementation(async ({ path }: { path: string }): Promise<TreeResult> => {
        if (path === 'docs/ui-kit/primitives') {
          return { entries: [{ path: 'docs/ui-kit/primitives/button.md', kind: 'file', size: 1, modifiedAt: '' }], truncated: false }
        }
        throw new MockDevSupervisorError('not_found', 404, `no such dir: ${path}`)
      })
      workspaceFilesMock.readText.mockResolvedValue('# Button')

      const out = await runTool({}, ctx('app-1'))
      expect(out).toContain('## primitives/button.md')
      expect(out).not.toContain('## Additional References')
    })

    it('surfaces a "Failed to load" marker when a listed file disappears mid-call (instead of silently dropping)', async () => {
      workspaceFilesMock.stat.mockResolvedValue({ entries: [dirEntry('docs/ui-kit')] })
      workspaceFilesMock.tree.mockImplementation(async ({ path }: { path: string }): Promise<TreeResult> => {
        if (path === 'docs/ui-kit/primitives') {
          return {
            entries: [
              { path: 'docs/ui-kit/primitives/button.md', kind: 'file', size: 1, modifiedAt: '' },
              { path: 'docs/ui-kit/primitives/gone.md', kind: 'file', size: 1, modifiedAt: '' },
            ],
            truncated: false,
          }
        }
        throw new MockDevSupervisorError('not_found', 404, `no such dir: ${path}`)
      })
      workspaceFilesMock.readText.mockImplementation(async ({ path }: { path: string }): Promise<string> => {
        if (path === 'docs/ui-kit/primitives/gone.md') {
          throw new MockDevSupervisorError('not_found', 404, `vanished mid-call`)
        }
        return '# Button'
      })

      const out = await runTool({}, ctx('app-1'))
      expect(out).toContain('## primitives/button.md')
      expect(out).toContain('# Button')
      expect(out).toContain('## primitives/gone.md')
      expect(out).toContain('**primitives/gone.md**: Failed to load')
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'tool.load_ui_kit.read_error',
        { path: 'primitives/gone.md' },
      )
    })

    it('logs tool.load_ui_kit.tree_truncated when the supervisor caps tree results', async () => {
      workspaceFilesMock.stat.mockResolvedValue({ entries: [dirEntry('docs/ui-kit')] })
      workspaceFilesMock.tree.mockImplementation(async ({ path }: { path: string }): Promise<TreeResult> => {
        if (path === 'docs/ui-kit/primitives') {
          return {
            entries: [{ path: 'docs/ui-kit/primitives/button.md', kind: 'file', size: 1, modifiedAt: '' }],
            truncated: true,
          }
        }
        throw new MockDevSupervisorError('not_found', 404, `no such dir: ${path}`)
      })
      workspaceFilesMock.readText.mockResolvedValue('# Button')

      await runTool({}, ctx('app-1'))
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'tool.load_ui_kit.tree_truncated',
        expect.objectContaining({ dir: 'docs/ui-kit/primitives' }),
      )
    })

    it('returns content from readText for large files (truncation is now handled upstream)', async () => {
      workspaceFilesMock.stat.mockResolvedValue({ entries: [dirEntry('docs/ui-kit')] })
      workspaceFilesMock.tree.mockImplementation(async ({ path }: { path: string }): Promise<TreeResult> => {
        if (path === 'docs/ui-kit/primitives') {
          return { entries: [{ path: 'docs/ui-kit/primitives/huge.md', kind: 'file', size: 9999, modifiedAt: '' }], truncated: false }
        }
        throw new MockDevSupervisorError('not_found', 404, `no such dir: ${path}`)
      })
      workspaceFilesMock.readText.mockResolvedValue('# Huge')

      const out = await runTool({}, ctx('app-1'))
      expect(out).toContain('## primitives/huge.md')
      expect(out).toContain('# Huge')
    })

    it('propagates non-not-found errors from tree()', async () => {
      workspaceFilesMock.stat.mockResolvedValue({ entries: [dirEntry('docs/ui-kit')] })
      workspaceFilesMock.tree.mockRejectedValue(new MockDevSupervisorError('transport_error', 503, 'connection refused'))

      await expect(runTool({}, ctx('app-1'))).rejects.toMatchObject({ code: 'transport_error' })
    })

    it('propagates non-not-found errors from readText()', async () => {
      workspaceFilesMock.stat.mockResolvedValue({ entries: [dirEntry('docs/ui-kit')] })
      workspaceFilesMock.tree.mockImplementation(async ({ path }: { path: string }): Promise<TreeResult> => {
        if (path === 'docs/ui-kit/primitives') {
          return { entries: [{ path: 'docs/ui-kit/primitives/button.md', kind: 'file', size: 1, modifiedAt: '' }], truncated: false }
        }
        throw new MockDevSupervisorError('not_found', 404, `no such dir: ${path}`)
      })
      workspaceFilesMock.readText.mockRejectedValue(new MockDevSupervisorError('permission_denied', 403, 'nope'))

      await expect(runTool({}, ctx('app-1'))).rejects.toMatchObject({ code: 'permission_denied' })
    })

    it('propagates non-not-found errors from stat() (kit existence check)', async () => {
      workspaceFilesMock.stat.mockRejectedValue(new MockDevSupervisorError('transport_error', 503, 'unreachable'))
      await expect(runTool({}, ctx('app-1'))).rejects.toMatchObject({ code: 'transport_error' })
    })
  })

  describe('include mode', () => {
    it('loads requested files using a single stat() call when within the 100-path cap', async () => {
      workspaceFilesMock.stat.mockImplementation(async ({ paths }: { paths: string[] }) => {
        if (paths.length === 1 && paths[0] === 'docs/ui-kit') {
          return { entries: [dirEntry('docs/ui-kit')] }
        }
        return {
          entries: paths.map((p) =>
            p === 'docs/ui-kit/layouts/recipe-editorial.md' || p === 'docs/ui-kit/showcase/example.md'
              ? fileEntry(p)
              : notFound(p),
          ),
        }
      })
      workspaceFilesMock.readText.mockImplementation(async ({ path }: { path: string }): Promise<string> => {
        return path.endsWith('recipe-editorial.md') ? '# Recipe' : '# Showcase'
      })

      const out = await runTool(
        { include: ['layouts/recipe-editorial.md', 'showcase/example.md'] },
        ctx('app-1'),
      )

      expect(out).toContain('# UI Kit — Requested References')
      expect(out).toContain('## layouts/recipe-editorial.md')
      expect(out).toContain('# Recipe')
      expect(out).toContain('## showcase/example.md')
      expect(workspaceFilesMock.tree).not.toHaveBeenCalled()
      expect(workspaceFilesMock.stat).toHaveBeenCalledTimes(2)
      const includeCall = workspaceFilesMock.stat.mock.calls[1]?.[0] as { paths: string[] }
      expect(includeCall.paths).toEqual([
        'docs/ui-kit/layouts/recipe-editorial.md',
        'docs/ui-kit/showcase/example.md',
      ])
    })

    it('chunks include-mode stat() at 100-path boundary (supervisor cap)', async () => {
      const includes = Array.from({ length: 250 }, (_, i) => `layouts/file${i}.md`)
      const statCalls: number[] = []
      workspaceFilesMock.stat.mockImplementation(async ({ paths }: { paths: string[] }) => {
        if (paths.length === 1 && paths[0] === 'docs/ui-kit') {
          return { entries: [dirEntry('docs/ui-kit')] }
        }
        statCalls.push(paths.length)
        return { entries: paths.map((p) => notFound(p)) }
      })

      await runTool({ include: includes }, ctx('app-1'))
      expect(statCalls).toEqual([100, 100, 50])
    })

    it('rejects path-traversal includes without calling stat for them', async () => {
      workspaceFilesMock.stat.mockResolvedValue({ entries: [dirEntry('docs/ui-kit')] })

      const out = await runTool({ include: ['../../etc/passwd', '/etc/shadow'] }, ctx('app-1'))

      expect(out).toContain('**../../etc/passwd**: Skipped (invalid path)')
      expect(out).toContain('**/etc/shadow**: Skipped (invalid path)')
      expect(workspaceFilesMock.stat).toHaveBeenCalledTimes(1)
      expect(workspaceFilesMock.readText).not.toHaveBeenCalled()
    })

    it("returns 'Not found' for a missing include path", async () => {
      workspaceFilesMock.stat.mockImplementation(async ({ paths }: { paths: string[] }) => {
        if (paths[0] === 'docs/ui-kit') return { entries: [dirEntry('docs/ui-kit')] }
        return { entries: paths.map((p) => notFound(p)) }
      })

      const out = await runTool({ include: ['layouts/missing.md'] }, ctx('app-1'))
      expect(out).toContain('**layouts/missing.md**: Not found')
      expect(workspaceFilesMock.readText).not.toHaveBeenCalled()
    })

    it("returns 'Not found' when an include points at a directory", async () => {
      workspaceFilesMock.stat.mockImplementation(async ({ paths }: { paths: string[] }) => {
        if (paths[0] === 'docs/ui-kit') return { entries: [dirEntry('docs/ui-kit')] }
        return { entries: paths.map((p) => dirEntry(p)) }
      })

      const out = await runTool({ include: ['layouts'] }, ctx('app-1'))
      expect(out).toContain('**layouts**: Not found')
      expect(workspaceFilesMock.readText).not.toHaveBeenCalled()
    })

    it('produces only the heading when every include is invalid', async () => {
      workspaceFilesMock.stat.mockResolvedValue({ entries: [dirEntry('docs/ui-kit')] })

      const out = await runTool({ include: ['../foo', '/bar'] }, ctx('app-1'))
      expect(out).toContain('# UI Kit — Requested References')
      expect(workspaceFilesMock.stat).toHaveBeenCalledTimes(1)
      expect(workspaceFilesMock.readText).not.toHaveBeenCalled()
    })

    it('treats include: [] as default mode (no requested-references heading)', async () => {
      workspaceFilesMock.stat.mockResolvedValue({ entries: [dirEntry('docs/ui-kit')] })
      workspaceFilesMock.tree.mockResolvedValue({ entries: [], truncated: false })

      const out = await runTool({ include: [] }, ctx('app-1'))
      expect(out).toContain('# UI Kit — Design System')
      expect(out).not.toContain('# UI Kit — Requested References')
    })

    it('propagates non-not-found errors from include-path stat()', async () => {
      workspaceFilesMock.stat.mockImplementation(async ({ paths }: { paths: string[] }) => {
        if (paths[0] === 'docs/ui-kit') return { entries: [dirEntry('docs/ui-kit')] }
        throw new MockDevSupervisorError('transport_error', 503, 'down')
      })

      await expect(
        runTool({ include: ['layouts/foo.md'] }, ctx('app-1')),
      ).rejects.toMatchObject({ code: 'transport_error' })
    })
  })
})
