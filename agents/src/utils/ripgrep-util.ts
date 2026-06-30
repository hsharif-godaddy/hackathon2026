import type { WorkspaceTasks } from '../workspace/tasks.js';
import { logger } from '../logging/index.js';
import { toolCodeSearchEvents } from '../logging/events/index.js';

export interface RipgrepContextLine {
  line: number
  text: string
}

export interface RipgrepMatch {
  path: string
  line: number
  column: number
  text: string
  matchStart: number
  matchEnd: number
  contextBefore: RipgrepContextLine[]
  contextAfter: RipgrepContextLine[]
}

export interface RipgrepResult {
  matches: RipgrepMatch[]
  totalMatches: number
  truncated: boolean
  error?: string
}

export interface RipgrepOptions {
  caseSensitive?: boolean
  regex?: boolean
  maxResults?: number
  contextLines?: number    // -C symmetric
  afterContext?: number     // -A
  beforeContext?: number    // -B
  filePattern?: string      // --glob
  excludeGlobs?: readonly string[]   // --glob (negated patterns)
  fileType?: string         // --type
  wholeWord?: boolean       // --word-regexp
  multiline?: boolean       // --multiline --multiline-dotall
  offset?: number           // skip first N matches in parseOutput
}

/**
 * Utility for executing ripgrep searches via dev-supervisor.
 *
 * The `directory` parameter can be relative to the container's working
 * directory (e.g. '.' for the project root, 'src/pages' for a subdirectory)
 * or an absolute path (e.g. '/alloc/customer-app/ID/preview'). Output
 * paths are always normalized to be relative to the search directory.
 */
export class RipgrepUtil {
  private static readonly MAX_MATCHES_PER_FILE = 10
  private static readonly DEFAULT_MAX_RESULTS = 100

  /**
   * Execute ripgrep search via dev-supervisor
   */
  static async search(
    tasks: WorkspaceTasks,
    directory: string,
    query: string,
    options: RipgrepOptions = {},
    fileBlockChecker?: (path: string) => boolean
  ): Promise<RipgrepResult> {
    if (!query || query.trim().length === 0) {
      return {
        matches: [],
        totalMatches: 0,
        truncated: false,
        error: 'Query cannot be empty'
      }
    }

    const maxResults = options.maxResults || this.DEFAULT_MAX_RESULTS
    const command = this.buildCommand(query, directory, options)

    try {
      const result = await tasks.runCommandSync({
        command,
        timeoutSeconds: 30,
      })

      if (result.timedOut) {
        toolCodeSearchEvents.ripgrepError(logger, {
          toolName: 'ripgrep-service',
          query,
          directory,
          stderr: 'Search timed out after 30s'
        })
        return {
          matches: [],
          totalMatches: 0,
          truncated: false,
          error: 'Search timed out'
        }
      }

      if (result.exitCode === 2) {
        toolCodeSearchEvents.ripgrepError(logger, {
          toolName: 'ripgrep-service',
          query,
          directory,
          stderr: result.stderr
        })
        return {
          matches: [],
          totalMatches: 0,
          truncated: false,
          error: 'Search failed'
        }
      }

      return this.parseOutput(
        result.stdout,
        directory,
        query,
        maxResults,
        fileBlockChecker,
        options.offset
      )
    } catch (error) {
      toolCodeSearchEvents.spawnError(logger, error as Error, {
        toolName: 'ripgrep-service',
        directory
      })
      return {
        matches: [],
        totalMatches: 0,
        truncated: false,
        error: 'Ripgrep execution failed'
      }
    }
  }

  /**
   * Build ripgrep command string
   */
  static buildCommand(
    query: string,
    directory: string,
    options: RipgrepOptions
  ): string {
    const args: string[] = ['rg', '--json']

    args.push('--max-count', String(this.MAX_MATCHES_PER_FILE))
    args.push('--max-filesize', '1M')
    args.push('--no-heading')

    // Asymmetric context (-A/-B) takes precedence over symmetric (-C)
    if (options.afterContext != null || options.beforeContext != null) {
      if (options.afterContext != null && options.afterContext > 0) {
        args.push('-A', String(options.afterContext))
      }
      if (options.beforeContext != null && options.beforeContext > 0) {
        args.push('-B', String(options.beforeContext))
      }
    } else if (options.contextLines != null && options.contextLines > 0) {
      args.push('--context', String(options.contextLines))
    }

    if (!options.caseSensitive) {
      args.push('--ignore-case')
    }

    if (!options.regex) {
      args.push('--fixed-strings')
    }

    if (options.wholeWord) {
      args.push('--word-regexp')
    }

    if (options.multiline) {
      args.push('--multiline', '--multiline-dotall')
    }

    if (options.filePattern) {
      args.push('--glob', this.escapeShellArg(options.filePattern))
    }

    if (options.excludeGlobs) {
      for (const glob of options.excludeGlobs) {
        args.push('--glob', this.escapeShellArg(glob))
      }
    }

    if (options.fileType) {
      args.push('--type', this.escapeShellArg(options.fileType))
    }

    args.push('--', this.escapeShellArg(query), this.escapeShellArg(directory))

    return args.join(' ')
  }

  /**
   * Derive a project-relative file path from a ripgrep output path.
   * Ripgrep prefixes matches with the search directory, so we strip that
   * prefix to get clean paths relative to the app root.
   */
  private static toRelativePath(matchPath: string, directory: string): string {
    if (directory === '.') {
      return matchPath.startsWith('./') ? matchPath.slice(2) : matchPath
    }

    // Strip absolute or relative directory prefix from ripgrep output paths.
    // e.g. directory='/alloc/app/preview/' → strip from '/alloc/app/preview/foo.ts'
    const prefix = directory.endsWith('/') ? directory : directory + '/'
    if (matchPath.startsWith(prefix)) {
      return matchPath.slice(prefix.length)
    }

    return matchPath
  }

  /**
   * Parse ripgrep JSON output.
   *
   * Ripgrep with --json emits events in order:
   *   begin → (context | match)* → end   per file
   * Context events before a match become contextBefore; after become contextAfter.
   */
  static parseOutput(
    stdout: string,
    directory: string,
    query: string,
    maxResults: number,
    fileBlockChecker?: (path: string) => boolean,
    offset?: number
  ): RipgrepResult {
    const matches: RipgrepMatch[] = []
    const lines = stdout.split('\n').filter(Boolean)
    let skipped = 0
    const skipCount = offset || 0
    let pendingContext: RipgrepContextLine[] = []
    let truncated = false

    for (const line of lines) {
      if (matches.length >= maxResults) {
        truncated = true
        break
      }

      try {
        const result = JSON.parse(line)

        if (result.type === 'context') {
          const data = result.data
          const ctxLine: RipgrepContextLine = {
            line: data.line_number,
            text: data.lines.text.trimEnd()
          }
          // Context lines after a match (same file, line > match line) → contextAfter.
          // Everything else accumulates in pendingContext → contextBefore of next match.
          const lastMatch = matches[matches.length - 1]
          const ctxFilePath = this.toRelativePath(data.path.text, directory)
          if (lastMatch
            && ctxFilePath === lastMatch.path
            && data.line_number > lastMatch.line) {
            lastMatch.contextAfter.push(ctxLine)
          } else {
            pendingContext.push(ctxLine)
          }
        } else if (result.type === 'match') {
          const data = result.data
          const submatch = data.submatches[0]
          const filePath = this.toRelativePath(data.path.text, directory)

          if (fileBlockChecker && !fileBlockChecker(filePath)) {
            pendingContext = []
            continue
          }

          if (skipped < skipCount) {
            skipped++
            pendingContext = []
            continue
          }

          // When context overlaps between matches, pendingContext is empty
          // and the lines are in the previous match's contextAfter. Move
          // lines closer to this match into contextBefore.
          const lastMatch = matches[matches.length - 1]
          let contextBefore = pendingContext
          if (contextBefore.length === 0 && lastMatch && lastMatch.contextAfter.length > 0
            && lastMatch.path === filePath) {
            const matchLine = data.line_number
            const splitIdx = lastMatch.contextAfter.findIndex(
              c => (matchLine - c.line) <= (c.line - lastMatch.line)
            )
            if (splitIdx >= 0) {
              contextBefore = lastMatch.contextAfter.splice(splitIdx)
            }
          }

          matches.push({
            path: filePath,
            line: data.line_number,
            column: submatch.start + 1,
            text: data.lines.text.trimEnd(),
            matchStart: submatch.start,
            matchEnd: submatch.end,
            contextBefore,
            contextAfter: []
          })
          pendingContext = []
        }
      } catch (error) {
        toolCodeSearchEvents.parseError(logger, {
          toolName: 'ripgrep-service',
          line,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    return {
      matches,
      totalMatches: matches.length,
      truncated
    }
  }

  /**
   * Escape shell argument for safe command execution
   */
  private static escapeShellArg(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}'`
  }

  /**
   * Check if ripgrep is available in the container
   */
  static async isAvailable(tasks: WorkspaceTasks): Promise<boolean> {
    try {
      const result = await tasks.runCommandSync({
        command: 'which rg',
        timeoutSeconds: 5,
      })
      return result.exitCode === 0
    } catch {
      return false
    }
  }
}
