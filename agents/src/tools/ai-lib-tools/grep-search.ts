import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import * as path from 'node:path'
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { createDevSupervisorClientForApp } from '../../utils/dev-supervisor-client-factory.js'
import { RipgrepUtil, type RipgrepMatch } from '../../utils/ripgrep-util.js'
import { isPathSafe } from '../../utils/path-helper.js'
import { logger } from '../../logging/index.js'

const appRepo = new AppRepository()

/**
 * Format ripgrep results based on output_mode
 */
function formatResult(
  matches: RipgrepMatch[],
  outputMode: 'content' | 'files_with_matches' | 'count',
  truncated: boolean,
  headLimit: number,
  showLineNumbers: boolean
): string {
  if (matches.length === 0) {
    return 'No matches found.'
  }

  if (outputMode === 'count') {
    const counts = new Map<string, number>()
    for (const m of matches) {
      counts.set(m.path, (counts.get(m.path) || 0) + 1)
    }
    const entries = Array.from(counts.entries())
    const limited = headLimit > 0 ? entries.slice(0, headLimit) : entries
    return limited.map(([file, count]) => `${file}:${count}`).join('\n')
  }

  if (outputMode === 'files_with_matches') {
    const files = [...new Set(matches.map(m => m.path))]
    const limited = headLimit > 0 ? files.slice(0, headLimit) : files
    return limited.join('\n')
  }

  // content mode — include context lines when available
  const lines: string[] = []
  let currentFile = ''
  let count = 0
  for (const m of matches) {
    if (headLimit > 0 && count >= headLimit) {break}
    if (m.path !== currentFile) {
      currentFile = m.path
      lines.push(`\n${m.path}`)
    }

    for (const ctx of m.contextBefore) {
      const prefix = showLineNumbers ? `${ctx.line}-` : ''
      lines.push(`${prefix}${ctx.text}`)
    }

    const matchPrefix = showLineNumbers ? `${m.line}:` : ''
    lines.push(`${matchPrefix}${m.text}`)

    for (const ctx of m.contextAfter) {
      const prefix = showLineNumbers ? `${ctx.line}-` : ''
      lines.push(`${prefix}${ctx.text}`)
    }

    count++
  }

  if (truncated) {
    lines.push('\n[Results truncated]')
  }

  return lines.join('\n').trimStart()
}

/**
 * Schema matching Claude Code's internal Grep tool for near-zero-shot correct tool calls.
 */
export const grepSearchSchema = z.object({
    pattern: z.string()
      .describe('The regular expression pattern to search for in file contents'),
    path: z.string().optional()
      .describe('File or directory to search in. Defaults to project root'),
    glob: z.string().optional()
      .describe('Glob pattern to filter files (e.g. "*.js", "**/*.tsx")'),
    type: z.string().optional()
      .describe('File type to search (e.g., "js", "py", "ts")'),
    output_mode: z.enum(['content', 'files_with_matches', 'count'])
      .default('files_with_matches')
      .describe('Output mode'),
    '-i': z.boolean().optional()
      .describe('Case insensitive search'),
    '-n': z.boolean().optional().default(true)
      .describe('Show line numbers in output'),
    '-A': z.number().optional()
      .describe('Lines to show after each match'),
    '-B': z.number().optional()
      .describe('Lines to show before each match'),
    '-C': z.number().optional()
      .describe('Context lines before and after each match'),
    context: z.number().optional()
      .describe('Alias for -C'),
    head_limit: z.number().optional().default(0)
      .describe('Limit results (0=unlimited)'),
    offset: z.number().optional().default(0)
      .describe('Skip first N results'),
    multiline: z.boolean().optional().default(false)
      .describe('Multiline matching where . matches newlines'),
  })

export const grepSearchAITool: Tool = createTool(
  'Search for text or patterns across files in the project. Supports full regex syntax, file filtering with glob/type parameters, and multiple output modes.',
  grepSearchSchema,
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for grep search')
    }

    const app = appRepo.findById(appId)
    if (!app) {
      throw new Error(`App '${appId}' not found`)
    }

    const supervisor = createDevSupervisorClientForApp(appId)
    if (!supervisor) {
      throw new Error('Dev-supervisor not available for grep search')
    }

    // Resolve and validate the search target locally (host paths), then
    // convert to a relative path for the ripgrep command which executes
    // inside the preview container via dev-supervisor. The container's
    // default working directory is the app root, so '.' searches the
    // whole project and 'src/pages/index.tsx' searches a specific file.
    let searchTarget = '.'
    if (input.path) {
      const resolved = path.isAbsolute(input.path)
        ? input.path
        : path.resolve(app.path, input.path)
      if (!isPathSafe(resolved, app.path)) {
        throw new Error(`Path '${input.path}' is outside the project directory`)
      }
      searchTarget = path.relative(app.path, resolved)
    }

    // Resolve context: -C and context are aliases, -A/-B take precedence
    const contextLines = input['-C'] ?? input.context

    const ripgrepResult = await RipgrepUtil.search(
      supervisor,
      searchTarget,
      input.pattern,
      {
        caseSensitive: !input['-i'],
        regex: true,
        // head_limit=0 (default) means unlimited, falls back to RipgrepUtil.DEFAULT_MAX_RESULTS (100)
        maxResults: input.head_limit > 0 ? input.head_limit : undefined,
        contextLines,
        afterContext: input['-A'],
        beforeContext: input['-B'],
        filePattern: input.glob,
        fileType: input.type,
        multiline: input.multiline,
        offset: input.offset,
      },
      (filePath: string) => isPathSafe(path.join(app.path, filePath), app.path)
    )

    if (ripgrepResult.error) {
      throw new Error(`Grep search failed: ${ripgrepResult.error}`)
    }

    logger.info('grep.search.complete', {
      appId,
      pattern: input.pattern,
      matchCount: ripgrepResult.totalMatches,
      truncated: ripgrepResult.truncated,
    })

    return formatResult(
      ripgrepResult.matches,
      input.output_mode,
      ripgrepResult.truncated,
      input.head_limit,
      input['-n'] !== false
    )
  }
)
