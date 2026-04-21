'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import ChevronDownIcon from '@ux/icon/chevron-down'
import ChevronRightIcon from '@ux/icon/chevron-right'
import PageIcon from '@ux/icon/page'
import Spinner from '@ux/spinner'

import { FileItem } from '@/app/[market]/develop/components/FileTree'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { appService } from '@/services/AppService'

export interface SearchMatch {
  path: string
  line: number
  column: number
  text: string
  matchStart: number
  matchEnd: number
}

export interface FileMatch {
  path: string
  name: string
}

export interface SearchState {
  query: string
  fileResults: FileMatch[]
  codeResults: SearchMatch[]
  totalCodeMatches: number
  truncated: boolean
}

interface UnifiedSearchProps {
  appId: string
  files: FileItem[]
  onResultClick: (path: string, line?: number) => void
  initialState?: SearchState
  onStateChange?: (state: SearchState) => void
}

export default function UnifiedSearch({ appId, files, onResultClick, initialState, onStateChange }: UnifiedSearchProps) {
  const t = useTranslations()
  const inputRef = useRef<HTMLInputElement>(null)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const [query, setQuery] = useState(initialState?.query ?? '')
  const [fileResults, setFileResults] = useState<FileMatch[]>(initialState?.fileResults ?? [])
  const [codeResults, setCodeResults] = useState<SearchMatch[]>(initialState?.codeResults ?? [])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [totalCodeMatches, setTotalCodeMatches] = useState(initialState?.totalCodeMatches ?? 0)
  const [truncated, setTruncated] = useState(initialState?.truncated ?? false)
  const [filesExpanded, setFilesExpanded] = useState(true)
  const [codeExpanded, setCodeExpanded] = useState(true)

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])


  // Cleanup debounce timeout and abort in-flight requests on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
      abortControllerRef.current?.abort()
    }
  }, [])

  // Notify parent of state changes for persistence
  useEffect(() => {
    onStateChange?.({
      query,
      fileResults,
      codeResults,
      totalCodeMatches,
      truncated
    })
  }, [query, fileResults, codeResults, totalCodeMatches, truncated, onStateChange])



  const debouncedSearch = useCallback((searchQuery: string) => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
      searchTimeoutRef.current = null
    }

    if (!searchQuery || searchQuery.trim().length === 0) {
      setFileResults([])
      setCodeResults([])
      setTotalCodeMatches(0)
      setTruncated(false)
      setError(null)
      return
    }

    searchTimeoutRef.current = setTimeout(async () => {
        setIsSearching(true)
        setError(null)

        let wasAborted = false
        try {
          // Search files locally
          const fileMatches: FileMatch[] = []
          const searchLower = searchQuery.toLowerCase()

          const searchFiles = (items: FileItem[]) => {
            for (const item of items) {
              if (item.type === 'file' &&
                  (item.name.toLowerCase().includes(searchLower) ||
                   item.path.toLowerCase().includes(searchLower))) {
                fileMatches.push({
                  path: item.path,
                  name: item.name
                })
              }
              if (item.children) {
                searchFiles(item.children)
              }
            }
          }
          searchFiles(files)
          setFileResults(fileMatches)

          // Abort any in-flight request before starting a new one
          abortControllerRef.current?.abort()
          abortControllerRef.current = new AbortController()

          // Search code via API
          const searchResults = await appService.searchCode(appId, searchQuery, {
            caseSensitive: false,
            regex: false,
            maxResults: 50,
            signal: abortControllerRef.current.signal
          })

          if (searchResults.error) {
            setError(searchResults.error)
            setCodeResults([])
          } else {
            setCodeResults(searchResults.matches)
            setTotalCodeMatches(searchResults.totalMatches)
            setTruncated(searchResults.truncated)
          }
        } catch (err) {
          // Ignore abort errors - they're expected when a new search supersedes an old one
          if (err instanceof Error && err.name === 'AbortError') {
            wasAborted = true
            return
          }
          logger.error('unified-search.ui.error', {
            message: 'Search failed',
            error: err instanceof Error ? err.message : String(err)
          })
          setError(t('builder_code_search_error', undefined, 'Search failed'))
          setCodeResults([])
        } finally {
          if (!wasAborted) {
            setIsSearching(false)
          }
        }
    }, 300)
  }, [appId, files, t])

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    debouncedSearch(value)
  }, [debouncedSearch])

  // Sync query from external source (left nav input) and trigger search
  const prevExternalQuery = useRef(initialState?.query)
  useEffect(() => {
    const externalQuery = initialState?.query ?? ''
    if (externalQuery !== prevExternalQuery.current) {
      prevExternalQuery.current = externalQuery
      setQuery(externalQuery)
      debouncedSearch(externalQuery)
    }
  }, [initialState?.query, debouncedSearch])

  const handleClearSearch = useCallback(() => {
    setQuery('')
    setIsSearching(false)
    // Abort any in-flight request
    abortControllerRef.current?.abort()
    // Also call debouncedSearch with empty string to cancel any pending search
    debouncedSearch('')
    inputRef.current?.focus()
  }, [debouncedSearch])

  const highlightMatch = (text: string, matchStart: number, matchEnd: number) => {
    if (!text || matchStart === undefined || matchEnd === undefined) {
      return text ?? ''
    }
    const before = text.substring(0, matchStart)
    const match = text.substring(matchStart, matchEnd)
    const after = text.substring(matchEnd)

    return (
      <>
        {before}
        <span className="bg-intents-ux-feedbackHighContrastWarning-feedbackColor bg-opacity-30 font-semibold">
          {match}
        </span>
        {after}
      </>
    )
  }

  const hasResults = fileResults.length > 0 || codeResults.length > 0
  const hasQuery = query.trim().length > 0

  return (
    <div
      data-testid="search-panel"
      className="h-full flex flex-col bg-intents-ux-box-backgroundColor"
    >
      {/* Search Input */}
      <div className="flex items-center gap-2 p-2 border-b">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder={t('builder_code_search_placeholder_code', undefined, 'Search files and code by name or content...')}
          className="flex-1 bg-transparent text-sm focus:outline-none"
          data-testid="search-input"
          aria-label={t('builder_code_search_placeholder_code', undefined, 'Search files and code by name or content...')}
        />
        {query && (
          <button
            type="button"
            onClick={handleClearSearch}
            className="text-xs underline opacity-60 hover:opacity-100"
            aria-label={t('builder_common_clear', undefined, 'Clear')}
          >
            {t('builder_common_clear', undefined, 'Clear')}
          </button>
        )}
      </div>

      {/* Loading */}
      {isSearching && (
        <div className="p-3 flex items-center justify-center gap-2 text-sm">
          <Spinner className="!w-2.5 !h-2.5" />
          <span>{t('builder_code_search_searching', undefined, 'Searching...')}</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 text-sm text-intents-ux-feedbackHighContrastCritical-foregroundColor">
          {error}
        </div>
      )}

      {/* Results */}
      {!isSearching && hasResults && (
        <div className="flex-1 overflow-y-auto">
          {/* Files Section */}
          {fileResults.length > 0 && (
            <div data-testid="search-results-files" role="region" aria-label={t('builder_code_search_files', undefined, 'Files')}>
              <button
                onClick={() => setFilesExpanded(!filesExpanded)}
                className="w-full flex items-center gap-1 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide opacity-75 hover:opacity-100 transition-opacity"
                aria-expanded={filesExpanded}
              >
                {filesExpanded ? <ChevronDownIcon className="w-2 h-2" /> : <ChevronRightIcon className="w-2 h-2" />}
                {t('builder_code_search_files', undefined, 'Files')} ({fileResults.length})
              </button>
              {filesExpanded && (
                <div className="flex flex-col px-2 py-1">
                  {fileResults.map((result) => (
                    <button
                      type="button"
                      key={`file-${result.path}`}
                      onClick={() => onResultClick(result.path)}
                      className="w-full text-left p-1.5 border-b border-intents-ux-box-borderColor/50 hover:bg-intents-ux-boxLowContrast-backgroundColor transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2 text-sm">
                        <PageIcon className="w-2 h-2 opacity-50 flex-shrink-0" />
                        <span className="truncate">{result.path}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Code Section */}
          {codeResults.length > 0 && (
            <div data-testid="search-results-code" role="region" aria-label={t('builder_code_search_code', undefined, 'Code')}>
              <button
                onClick={() => setCodeExpanded(!codeExpanded)}
                className="w-full flex items-center gap-1 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide opacity-75 hover:opacity-100 transition-opacity"
                aria-expanded={codeExpanded}
              >
                {codeExpanded ? <ChevronDownIcon className="w-2 h-2" /> : <ChevronRightIcon className="w-2 h-2" />}
                {t('builder_code_search_code', undefined, 'Code')} ({totalCodeMatches})
              </button>
              {codeExpanded && (
                <div className="flex flex-col px-2 py-1">
                  {codeResults.map((result) => (
                    <button
                      type="button"
                      key={`code-${result.path}-${result.line}-${result.column}-${result.matchStart}`}
                      onClick={() => onResultClick(result.path, result.line)}
                      className="w-full text-left p-1.5 border-b border-intents-ux-box-borderColor/50 hover:bg-intents-ux-boxLowContrast-backgroundColor transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2 text-sm">
                        <PageIcon className="w-2 h-2 opacity-50 flex-shrink-0" />
                        <span className="truncate font-medium">{result.path}</span>
                        <span className="text-xs opacity-60">:{result.line}</span>
                      </div>
                      <code className="block text-xs font-mono truncate opacity-75 pl-4 mt-0.5">
                        {highlightMatch(result.text, result.matchStart, result.matchEnd)}
                      </code>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* No results */}
      {!isSearching && hasQuery && !hasResults && !error && (
        <div className="p-4 text-sm text-center opacity-75">
          {t('builder_code_search_no_results', undefined, 'No results found')}
        </div>
      )}

      {/* Empty state - no query entered */}
      {!isSearching && !hasQuery && !error && (
        <div className="p-4 text-sm text-center opacity-75">
          {t('builder_code_search_placeholder_code', undefined, 'Start typing to search files and code')}
        </div>
      )}

    </div>
  )
}
