import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { createForWorkspace } from '../../workspace/index.js'
import { isDevSupervisorNotFound } from '../../services/DevSupervisorClient.js'
import { logger } from '../../logging/index.js'
import type { WorkspaceFiles } from '../../workspace/files.js'
import { UI_KIT_COPY_GUARDRAIL } from '../../prompts/ui-kit-guardrail.js'

const AUTO_LOAD_DIRS = ['primitives', 'components']
const LIST_ONLY_DIRS = ['layouts', 'showcase']
const KIT_PATH = 'docs/ui-kit'

// dev-supervisor caps `stat({ paths })` at wsFilesMaxStatPaths = 100. The
// schema's `.describe()` advertises a soft limit so the LLM doesn't request
// hundreds of includes in one call; we still chunk defensively below so a
// large include never hard-fails the request.
const STAT_CHUNK_SIZE = 100

const KIT_DOC_EXTS = ['.md', '.json'] as const
function isKitDoc(path: string): boolean {
  const lower = path.toLowerCase()
  return KIT_DOC_EXTS.some((ext) => lower.endsWith(ext))
}

function stripKitPrefix(p: string): string {
  return p.startsWith(`${KIT_PATH}/`) ? p.slice(KIT_PATH.length + 1) : p
}

/**
 * List workspace-rooted file paths under a kit subdirectory. Logs once on
 * truncation, matching the pattern in `routes/download.ts`.
 */
async function listKitFiles(files: WorkspaceFiles, dir: string): Promise<string[]> {
  let result
  try {
    result = await files.tree({ path: dir, recursive: true })
  } catch (err) {
    if (isDevSupervisorNotFound(err)) return []
    throw err
  }
  if (result.truncated) {
    logger.warn('tool.load_ui_kit.tree_truncated', {
      dir,
      entryCount: result.entries.length,
    })
  }
  return result.entries
    .filter((e) => e.kind === 'file')
    .map((e) => e.path)
}

async function readKitFile(
  files: WorkspaceFiles,
  path: string,
): Promise<string | null> {
  try {
    return await files.readText({ path })
  } catch (err) {
    if (isDevSupervisorNotFound(err)) return null
    throw err
  }
}

async function statChunked(
  files: WorkspaceFiles,
  paths: string[],
): Promise<Map<string, 'file' | 'directory' | undefined>> {
  const out = new Map<string, 'file' | 'directory' | undefined>()
  for (let i = 0; i < paths.length; i += STAT_CHUNK_SIZE) {
    const chunk = paths.slice(i, i + STAT_CHUNK_SIZE)
    const stats = await files.stat({ paths: chunk })
    for (const entry of stats.entries) {
      out.set(entry.path, entry.error === undefined ? entry.kind : undefined)
    }
  }
  return out
}

export const loadUiKitAITool: Tool = createTool(
  'Load the UI kit design system from docs/ui-kit/. By default loads primitives and components in full, and lists layouts/landing-pages/showcase. Use the include parameter to load specific additional files.',
  z.object({
    include: z.array(z.string()).optional().describe('Additional file paths (relative to docs/ui-kit/) to load in full, e.g. ["layouts/recipe-editorial.md"]. Keep the list under 100 entries.'),
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) return 'Error: App ID required'

    const workspace = createForWorkspace(appId, 'preview')
    if (!workspace) return `Error: App '${appId}' not found`
    const files = workspace.files

    // Existence check via a single stat() round trip. Only "not_found" or
    // "kind !== directory" produces the friendly user-facing message; other
    // failure modes (permission_denied, invalid_path, transport errors)
    // propagate so the caller sees the real problem.
    const kitStat = await files.stat({ paths: [KIT_PATH] })
    const kitEntry = kitStat.entries[0]
    if (!kitEntry) {
      return 'No UI kit found. This app does not have a design system at docs/ui-kit/.'
    }
    if (kitEntry.error !== undefined) {
      if (kitEntry.error === 'not_found') {
        return 'No UI kit found. This app does not have a design system at docs/ui-kit/.'
      }
      throw new Error(`workspace.files.stat('${KIT_PATH}') returned error '${kitEntry.error}'`)
    }
    if (kitEntry.kind !== 'directory') {
      return 'No UI kit found. This app does not have a design system at docs/ui-kit/.'
    }

    const sections: string[] = []
    const hasIncludes = input.include && input.include.length > 0

    if (hasIncludes) {
      // Include mode: only load the requested files (primitives/components already in context).
      // No copy guardrail is injected here on purpose: include mode is a follow-up fetch within
      // a turn whose per-turn anchor (context-manager) already carries UI_KIT_COPY_GUARDRAIL.
      sections.push('# UI Kit — Requested References')
      sections.push('')

      const requested = input.include!
      const validRequests: { reqPath: string; relativePath: string }[] = []
      for (const reqPath of requested) {
        const normalized = reqPath.replace(/\\/g, '/')
        if (normalized.includes('..') || normalized.startsWith('/')) {
          sections.push(`**${reqPath}**: Skipped (invalid path)`)
          continue
        }
        validRequests.push({ reqPath, relativePath: `${KIT_PATH}/${normalized}` })
      }

      if (validRequests.length > 0) {
        const kindByPath = await statChunked(files, validRequests.map((r) => r.relativePath))
        const reads = await Promise.all(
          validRequests.map(async ({ reqPath, relativePath }) => {
            if (kindByPath.get(relativePath) !== 'file') {
              return { reqPath, content: null as string | null }
            }
            const content = await readKitFile(files, relativePath)
            return { reqPath, content }
          }),
        )

        for (const { reqPath, content } of reads) {
          if (content === null) {
            sections.push(`**${reqPath}**: Not found`)
            continue
          }
          sections.push('---')
          sections.push(`## ${reqPath}`)
          sections.push('')
          sections.push(content)
          sections.push('')
        }
      }
    } else {
      // Default mode: load primitives + components, list everything else.
      sections.push('# UI Kit — Design System')
      sections.push('')
      sections.push(UI_KIT_COPY_GUARDRAIL)
      sections.push('')

      const autoLoadFiles = (
        await Promise.all(AUTO_LOAD_DIRS.map((dir) => listKitFiles(files, `${KIT_PATH}/${dir}`)))
      )
        .flat()
        .filter(isKitDoc)

      const reads = await Promise.all(
        autoLoadFiles.map(async (fullPath) => {
          const displayPath = stripKitPrefix(fullPath)
          const content = await readKitFile(files, fullPath)
          return { displayPath, content }
        }),
      )

      for (const { displayPath, content } of reads) {
        sections.push('---')
        sections.push(`## ${displayPath}`)
        sections.push('')
        if (content === null) {
          // tree() listed the path moments ago; a not_found here means the
          // file vanished mid-call (rare race). Surface a Failed-to-load
          // marker so the LLM knows the kit is partial — silent drops cause
          // it to confidently produce code against a spec it never read.
          logger.warn('tool.load_ui_kit.read_error', { path: displayPath })
          sections.push(`**${displayPath}**: Failed to load (file vanished or unreadable)`)
        } else {
          sections.push(content)
        }
        sections.push('')
      }

      const available = (
        await Promise.all(
          LIST_ONLY_DIRS.map(async (dir) => {
            const all = await listKitFiles(files, `${KIT_PATH}/${dir}`)
            return all.filter(isKitDoc).map(stripKitPrefix)
          }),
        )
      ).flat()

      if (available.length > 0) {
        sections.push('---')
        sections.push('## Additional References')
        sections.push('')
        sections.push('Call `loadUiKit` with `include` to load specific files:')
        sections.push('')
        for (const f of available) {
          sections.push(`- \`${f}\``)
        }
        sections.push('')
      }
    }

    return sections.join('\n')
  }
)
