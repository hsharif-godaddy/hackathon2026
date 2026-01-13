import type { DevSupervisorClient } from '../services/DevSupervisorClient.js';
import { logger } from '../logging/index.js';
import { toolCodeSearchEvents } from '../logging/events/index.js';

export interface RipgrepMatch {
  path: string
  line: number
  column: number
  text: string
  matchStart: number
  matchEnd: number
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
  contextLines?: number
  filePattern?: string
}

/**
 * Utility for executing ripgrep searches via dev-supervisor
 * Provides shared functionality for code search operations
 */
export class RipgrepUtil {
  private static readonly MAX_MATCHES_PER_FILE = 10
  private static readonly DEFAULT_MAX_RESULTS = 100

  /**
   * Execute ripgrep search via dev-supervisor
   */
  static async search(
    supervisor: DevSupervisorClient,
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
      const result = await supervisor.exec({
        command,
        working_dir: directory,
        timeout: 30,
        capture_output: true
      })

      if (result.exit_code === 2) {
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
        fileBlockChecker
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
  private static buildCommand(
    query: string,
    directory: string,
    options: RipgrepOptions
  ): string {
    const args: string[] = ['rg', '--json']

    args.push('--max-count', String(this.MAX_MATCHES_PER_FILE))
    args.push('--max-filesize', '1M')
    args.push('--no-heading')

    if (options.contextLines && options.contextLines > 0) {
      args.push('--context', String(options.contextLines))
    }

    if (!options.caseSensitive) {
      args.push('--ignore-case')
    }

    if (!options.regex) {
      args.push('--fixed-strings')
    }

    if (options.filePattern) {
      args.push('--glob', this.escapeShellArg(options.filePattern))
    }

    args.push('--', this.escapeShellArg(query), directory)

    return args.join(' ')
  }

  /**
   * Parse ripgrep JSON output
   */
  private static parseOutput(
    stdout: string,
    directory: string,
    query: string,
    maxResults: number,
    fileBlockChecker?: (path: string) => boolean
  ): RipgrepResult {
    const matches: RipgrepMatch[] = []
    const lines = stdout.split('\n').filter(Boolean)

    for (const line of lines) {
      if (matches.length >= maxResults) {
        break
      }

      try {
        const result = JSON.parse(line)

        if (result.type === 'match') {
          const data = result.data
          const submatch = data.submatches[0]
          const filePath = data.path.text.replace(directory + '/', '')

          if (fileBlockChecker && !fileBlockChecker(filePath)) {
            continue
          }

          matches.push({
            path: filePath,
            line: data.line_number,
            column: submatch.start + 1,
            text: data.lines.text.trimEnd(),
            matchStart: submatch.start,
            matchEnd: submatch.end
          })
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
      truncated: matches.length >= maxResults
    }
  }

  /**
   * Escape shell argument for safe command execution
   */
  private static escapeShellArg(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}'`
  }

  /**
   * Check if ripgrep is available via dev-supervisor
   */
  static async isAvailable(supervisor: DevSupervisorClient): Promise<boolean> {
    try {
      const result = await supervisor.exec({
        command: 'which rg',
        timeout: 5,
        capture_output: true
      })
      return result.exit_code === 0
    } catch {
      return false
    }
  }
}

