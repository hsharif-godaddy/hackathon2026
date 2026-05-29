import { createForWorkspace } from '../workspace/index.js'
import type { WorkspaceTasks } from '../workspace/tasks.js'
import { FileSearch } from './file-search.js'
import { isFileBlocked } from '../tools/read-file.js'
import { logger } from '../logging/index.js'
import { RipgrepUtil, type RipgrepOptions, type RipgrepResult } from './ripgrep-util.js'
import { toolCodeSearchEvents } from '../logging/events/index.js'

export interface SearchMatch {
  path: string
  line: number
  column: number
  text: string
  matchStart: number
  matchEnd: number
}

export interface SearchResult {
  matches: SearchMatch[]
  totalMatches: number
  truncated: boolean
  error?: string
}

export interface SearchOptions {
  caseSensitive?: boolean
  regex?: boolean
  maxResults?: number
  contextLines?: number
  filePattern?: string
}

/**
 * Maximum number of matches to return per file.
 */
const MAX_MATCHES_PER_FILE = 10

/**
 * Check if a file should be searchable
 */
function isFileSearchable(filePath: string): boolean {
  return !isFileBlocked(filePath).blocked
}

/**
 * Main search function using ripgrep via dev-supervisor.
 * Falls back to Node.js search if ripgrep unavailable.
 *
 * Note: `directory` is only used by the Node.js fallback (host path).
 * The ripgrep path always searches from '.' (container CWD = app root).
 */
export async function searchCode(
  appId: string,
  directory: string,
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult> {
  const workspace = createForWorkspace(appId, 'preview')

  if (workspace) {
    const hasRipgrep = await RipgrepUtil.isAvailable(workspace.tasks)

    if (hasRipgrep) {
      // RipgrepUtil runs inside the container via workspace tasks, whose CWD
      // is already the app root. Pass '.' so ripgrep searches from there
      // instead of the absolute host path (which doesn't exist in container).
      return searchWithRipgrep(workspace.tasks, '.', query, options)
    }

    toolCodeSearchEvents.fallback(logger, {
      toolName: 'code-search',
      message: 'Ripgrep not available in container, using Node.js fallback'
    })
  } else {
    toolCodeSearchEvents.fallback(logger, {
      toolName: 'code-search',
      message: 'Workspace not available, using Node.js fallback'
    })
  }

  return searchWithNodejs(directory, query, options)
}

/**
 * Search using ripgrep via workspace tasks
 */
async function searchWithRipgrep(
  tasks: WorkspaceTasks,
  directory: string,
  query: string,
  options: SearchOptions
): Promise<SearchResult> {
  const ripgrepOptions: RipgrepOptions = {}
  
  if (options.caseSensitive !== undefined) {
    ripgrepOptions.caseSensitive = options.caseSensitive
  }
  if (options.regex !== undefined) {
    ripgrepOptions.regex = options.regex
  }
  if (options.maxResults !== undefined) {
    ripgrepOptions.maxResults = options.maxResults
  }
  if (options.contextLines !== undefined) {
    ripgrepOptions.contextLines = options.contextLines
  }
  if (options.filePattern !== undefined) {
    ripgrepOptions.filePattern = options.filePattern
  }

  const result: RipgrepResult = await RipgrepUtil.search(
    tasks,
    directory,
    query,
    ripgrepOptions,
    isFileSearchable
  )

  const searchResult: SearchResult = {
    matches: result.matches,
    totalMatches: result.totalMatches,
    truncated: result.truncated
  }

  if (result.error !== undefined) {
    searchResult.error = result.error
  }

  return searchResult
}

/**
 * Fallback search using Node.js (slower but works without ripgrep)
 * Uses shared FileSearchService
 */
async function searchWithNodejs(
  directory: string,
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult> {
  const searchOptions: any = {
    maxMatchesPerFile: MAX_MATCHES_PER_FILE,
    fileBlockChecker: isFileSearchable
  }

  if (options.caseSensitive !== undefined) {
    searchOptions.caseSensitive = options.caseSensitive
  }
  if (options.regex !== undefined) {
    searchOptions.regex = options.regex
  }
  if (options.maxResults !== undefined) {
    searchOptions.maxResults = options.maxResults
  }

  const result = await FileSearch.search(directory, query, searchOptions)

  return {
    matches: result.matches,
    totalMatches: result.totalMatches,
    truncated: result.truncated
  }
}
