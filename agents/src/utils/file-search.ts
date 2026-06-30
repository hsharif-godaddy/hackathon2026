import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

export interface FileSearchMatch {
  path: string
  line: number
  column: number
  text: string
  matchStart: number
  matchEnd: number
}

export interface FileSearchResult {
  matches: FileSearchMatch[]
  totalMatches: number
  truncated: boolean
}

export interface FileSearchOptions {
  caseSensitive?: boolean
  regex?: boolean
  maxResults?: number
  maxMatchesPerFile?: number
  fileBlockChecker?: (path: string) => boolean
  skipDirectory?: (relativePath: string) => boolean
}

/**
 * Pure Node.js file search utility (no external dependencies)
 * Used as fallback when ripgrep is not available
 */
export class FileSearch {
  private static readonly DEFAULT_MAX_RESULTS = 100
  private static readonly DEFAULT_MAX_MATCHES_PER_FILE = 10

  /**
   * Search files using Node.js fs operations
   */
  static async search(
    directory: string,
    query: string,
    options: FileSearchOptions = {}
  ): Promise<FileSearchResult> {
    const matches: FileSearchMatch[] = []
    const maxResults = options.maxResults || this.DEFAULT_MAX_RESULTS
    const maxMatchesPerFile = options.maxMatchesPerFile || this.DEFAULT_MAX_MATCHES_PER_FILE
    const searchQuery = options.caseSensitive ? query : query.toLowerCase()
    const searchPattern = options.regex ? new RegExp(query, options.caseSensitive ? 'g' : 'gi') : null

    async function searchDirectory(dir: string): Promise<void> {
      if (matches.length >= maxResults) return

      try {
        const entries = await readdir(dir, { withFileTypes: true })

        for (const entry of entries) {
          if (matches.length >= maxResults) break

          const fullPath = join(dir, entry.name)

          if (entry.name === 'node_modules' ||
              entry.name === '.git' ||
              entry.name === 'dist' ||
              entry.name === 'build' ||
              entry.name === '.next' ||
              entry.name.startsWith('.')) {
            continue
          }

          const relativePath = toRelativeSearchPath(directory, fullPath)

          if (entry.isDirectory()) {
            if (options.skipDirectory?.(relativePath)) {
              continue
            }
            await searchDirectory(fullPath)
          } else if (entry.isFile()) {
            if (!FileSearch.isTextFile(entry.name)) continue

            if (options.fileBlockChecker && !options.fileBlockChecker(relativePath)) {
              continue
            }

            try {
              const stats = await stat(fullPath)
              if (stats.size > 1024 * 1024) continue

              const content = await readFile(fullPath, 'utf-8')
              const lines = content.split('\n')

              let matchesInFile = 0
              for (let i = 0; i < lines.length && matchesInFile < maxMatchesPerFile; i++) {
                if (matches.length >= maxResults) break

                const line = lines[i]
                if (!line) continue

                if (searchPattern) {
                  searchPattern.lastIndex = 0
                  const match = searchPattern.exec(line)
                  if (match) {
                    matchesInFile++
                    matches.push({
                      path: relativePath,
                      line: i + 1,
                      column: match.index + 1,
                      text: line.trimEnd(),
                      matchStart: match.index,
                      matchEnd: match.index + match[0].length
                    })
                  }
                } else {
                  const searchLine = options.caseSensitive ? line : line.toLowerCase()
                  const index = searchLine.indexOf(searchQuery)

                  if (index !== -1) {
                    matchesInFile++
                    matches.push({
                      path: relativePath,
                      line: i + 1,
                      column: index + 1,
                      text: line.trimEnd(),
                      matchStart: index,
                      matchEnd: index + query.length
                    })
                  }
                }
              }
            } catch {
              continue
            }
          }
        }
      } catch {
        return
      }
    }

    await searchDirectory(directory)

    return {
      matches,
      totalMatches: matches.length,
      truncated: matches.length >= maxResults
    }
  }

  /**
   * Check if a file is a text file based on extension
   */
  private static isTextFile(filename: string): boolean {
    const textExtensions = [
      '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt',
      '.css', '.scss', '.sass', '.less', '.html', '.xml',
      '.yml', '.yaml', '.toml', '.env', '.sh', '.py', '.rb',
      '.java', '.c', '.cpp', '.h', '.go', '.rs', '.php'
    ]

    return textExtensions.some(ext => filename.endsWith(ext))
  }
}

export function toRelativeSearchPath(searchRoot: string, fullPath: string): string {
  const prefix = searchRoot.endsWith('/') ? searchRoot : `${searchRoot}/`
  if (fullPath.startsWith(prefix)) {
    return fullPath.slice(prefix.length)
  }
  return fullPath
}
