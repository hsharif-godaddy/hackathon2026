'use client'

import clsx from 'clsx'
import { useCallback, useMemo, useState } from 'react'
import SearchIcon from '@ux/icon/search'
import XIcon from '@ux/icon/x'
import Spinner from '@ux/spinner'

import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { appService } from '@/services/AppService'

interface SearchMatch {
  path: string
  line: number
  column: number
  text: string
  matchStart: number
  matchEnd: number
}

type SearchMode = 'files' | 'code'

interface CodeSearchProps {
  appId: string
  files: FileItem[]
  onResultClick: (path: string, line?: number) => void
}

interface FileItem {
  name: string
  type: 'file' | 'folder'
  path: string
  extension?: string
  children?: FileItem[]
}

export default function CodeSearch({ appId, files, onResultClick }: CodeSearchProps) {
  const t = useTranslations()

  const [searchMode, setSearchMode] = useState<SearchMode>('files')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchMatch[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [totalMatches, setTotalMatches] = useState(0)
  const [truncated, setTruncated] = useState(false)

  const debouncedSearch = useMemo(() => {
    let timeoutId: NodeJS.Timeout | null = null

    return (searchQuery: string) => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      if (!searchQuery || searchQuery.trim().length === 0) {
        setResults([])
        setTotalMatches(0)
        setTruncated(false)
        setError(null)
        return
      }

      timeoutId = setTimeout(async () => {
        setIsSearching(true)
        setError(null)

        try {
          if (searchMode === 'files') {
            // File name search - search locally through file tree
            const fileMatches: SearchMatch[] = []
            const searchLower = searchQuery.toLowerCase()

            const searchFiles = (items: FileItem[]) => {
              for (const item of items) {
                // Search both filename and full path
                if (item.type === 'file' &&
                    (item.name.toLowerCase().includes(searchLower) ||
                     item.path.toLowerCase().includes(searchLower))) {
                  fileMatches.push({
                    path: item.path,
                    line: 1,
                    column: 1,
                    text: item.name,
                    matchStart: 0,
                    matchEnd: item.name.length
                  })
                }
                if (item.children) {
                  searchFiles(item.children)
                }
              }
            }

            searchFiles(files)
            setResults(fileMatches)
            setTotalMatches(fileMatches.length)
            setTruncated(false)
          } else {
            // Code content search - use backend API
            const searchResults = await appService.searchCode(appId, searchQuery, {
              caseSensitive: false,
              regex: false,
              maxResults: 100
            })

            if (searchResults.error) {
              setError(searchResults.error)
              setResults([])
            } else {
              setResults(searchResults.matches)
              setTotalMatches(searchResults.totalMatches)
              setTruncated(searchResults.truncated)
            }
          }
        } catch (err) {
          logger.error('code-search.ui.error', {
            message: 'Search failed',
            error: err instanceof Error ? err.message : String(err)
          })
          setError(t('builder_code_search_error'))
          setResults([])
        } finally {
          setIsSearching(false)
        }
      }, 300)
    }
  }, [appId, searchMode, files, t])

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    debouncedSearch(value)
  }, [debouncedSearch])

  const handleClearSearch = useCallback(() => {
    setQuery('')
    setResults([])
    setTotalMatches(0)
    setTruncated(false)
    setError(null)
  }, [])

  const handleResultClick = useCallback((result: SearchMatch) => {
    onResultClick(result.path, searchMode === 'code' ? result.line : undefined)
  }, [onResultClick, searchMode])

  const highlightMatch = (text: string, matchStart: number, matchEnd: number) => {
    const before = text.substring(0, matchStart)
    const match = text.substring(matchStart, matchEnd)
    const after = text.substring(matchEnd)

    return (
      <>
        {before}
        {/* bg-opacity-3 = 3% opacity - intentionally subtle highlight */}
        <span className="bg-intents-ux-feedbackHighContrastWarning-feedbackColor bg-opacity-3 font-semibold">
          {match}
        </span>
        {after}
      </>
    )
  }

  return (
    <div className="flex flex-col border-b">
      {/* Search Mode Toggle */}
      <div className="flex items-center gap-1 p-1.5 pb-0">
        <button
          onClick={() => {
            setSearchMode('files')
            setQuery('')
            setResults([])
          }}
          className={clsx(
            "flex-1 px-2 py-1 text-xs font-medium rounded-md transition-all",
            searchMode === 'files'
              ? "border-2 !border-intents-ux-boxHighContrast-borderColor !opacity-100 !text-intents-ux-boxHighContrast-textColor"
              : "border border-transparent opacity-60 hover:opacity-80"
          )}
        >
          {t('builder_code_search_files')}
        </button>
        <button
          onClick={() => {
            setSearchMode('code')
            setQuery('')
            setResults([])
          }}
          className={clsx(
            "flex-1 px-2 py-1 text-xs font-medium rounded-md transition-all",
            searchMode === 'code'
              ? "border-2 !border-intents-ux-boxHighContrast-borderColor !opacity-100 !text-intents-ux-boxHighContrast-textColor"
              : "border border-transparent opacity-60 hover:opacity-80"
          )}
        >
          {t('builder_code_search_code')}
        </button>
      </div>

      {/* Search Input */}
      <div className="p-1.5">
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder={searchMode === 'files' ? t('builder_code_search_placeholder_files') : t('builder_code_search_placeholder_code')}
            className="w-full px-2.5 py-1.5 pl-4 pr-3.5 text-sm border border-intents-ux-highContrast-textColor rounded-md focus:outline-none focus:ring-2 focus:ring-intents-ux-highContrast-textColor"
          />
          <SearchIcon className="absolute left-1.5 top-1/2 -translate-y-1/2 w-2 h-2 opacity-50 pointer-events-none" />
          {query && (
            <button
              onClick={handleClearSearch}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded opacity-60 hover:opacity-100 transition-all group"
              title={t('builder_common_clear')}
            >
              <XIcon className="w-1.5 h-1.5 group-hover:stroke-[3]" />
            </button>
          )}
        </div>
      </div>

      {isSearching && (
        <div className="p-2 flex items-center justify-center gap-1 text-sm">
          <Spinner className="!w-2 !h-2" />
          <span>{t('builder_code_search_searching')}</span>
        </div>
      )}

      {error && (
        <div className="p-2 text-sm text-intents-ux-feedbackHighContrastCritical-feedgroundColor">
          {error}
        </div>
      )}

      {!isSearching && results.length > 0 && (
        <>
          <div className="px-1.5 py-0.5 text-xs opacity-75">
            {totalMatches} {totalMatches === 1 ? t('builder_code_search_result') : t('builder_code_search_results')}
            {truncated && ` (${t('builder_code_search_showing_first', { count: 100 })})`}
          </div>

          <div className="max-h-64 overflow-y-auto">
            {results.map((result, idx) => (
              <div
                key={`${result.path}-${result.line}-${idx}`}
                onClick={() => handleResultClick(result)}
                className={clsx(
                  "px-1.5 py-1 cursor-pointer hover:bg-intents-ux-box-backgroundColor border-b",
                  "text-xs"
                )}
              >
                <div className="font-medium truncate">{result.path}</div>
                {searchMode === 'code' && (
                  <div className="flex items-baseline gap-1 opacity-75">
                    <span className="text-xxs">Line {result.line}:</span>
                    <code className="text-xxs font-mono truncate">
                      {highlightMatch(result.text, result.matchStart, result.matchEnd)}
                    </code>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {!isSearching && query && results.length === 0 && !error && (
        <div className="p-2 text-sm text-center opacity-75">
          {t('builder_code_search_no_results')}
        </div>
      )}
    </div>
  )
}

