/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import UnifiedSearch, { SearchState } from './UnifiedSearch'

vi.mock('@/services/AppService', () => ({
  appService: {
    searchCode: vi.fn().mockResolvedValue({
      matches: [],
      totalMatches: 0,
      truncated: false
    })
  }
}))

describe('UnifiedSearch', () => {
  const mockFiles = [
    {
      name: 'Button.tsx',
      type: 'file' as const,
      path: 'src/components/Button.tsx',
      extension: 'tsx'
    },
    {
      name: 'utils.ts',
      type: 'file' as const,
      path: 'src/utils.ts',
      extension: 'ts'
    },
    {
      name: 'components',
      type: 'folder' as const,
      path: 'src/components',
      children: [
        {
          name: 'Header.tsx',
          type: 'file' as const,
          path: 'src/components/Header.tsx',
          extension: 'tsx'
        }
      ]
    }
  ]

  const defaultProps = {
    appId: 'test-app-id',
    files: mockFiles,
    onResultClick: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render search panel', () => {
    renderWithProviders(<UnifiedSearch {...defaultProps} />)

    expect(screen.getByTestId('search-panel')).toBeInTheDocument()
  })

  it('should display empty state when no query is provided', () => {
    renderWithProviders(<UnifiedSearch {...defaultProps} />)

    expect(screen.getByText('Start typing to search files and code')).toBeInTheDocument()
  })

  it('should display file results when initialState contains file matches', () => {
    const initialState: SearchState = {
      query: 'Button',
      fileResults: [{ path: 'src/components/Button.tsx', name: 'Button.tsx' }],
      codeResults: [],
      totalCodeMatches: 0,
      truncated: false
    }

    renderWithProviders(<UnifiedSearch {...defaultProps} initialState={initialState} />)

    expect(screen.getByTestId('search-results-files')).toBeInTheDocument()
    expect(screen.getByText('src/components/Button.tsx')).toBeInTheDocument()
  })

  it('should call onResultClick when clicking a file result', async () => {
    const onResultClick = vi.fn()
    const initialState: SearchState = {
      query: 'Button',
      fileResults: [{ path: 'src/components/Button.tsx', name: 'Button.tsx' }],
      codeResults: [],
      totalCodeMatches: 0,
      truncated: false
    }

    const { user } = renderWithProviders(
      <UnifiedSearch {...defaultProps} onResultClick={onResultClick} initialState={initialState} />
    )

    await user.click(screen.getByText('src/components/Button.tsx'))

    expect(onResultClick).toHaveBeenCalledWith('src/components/Button.tsx')
  })

  it('should display code results section when initialState contains code matches', () => {
    const initialState: SearchState = {
      query: 'testFunction',
      fileResults: [],
      codeResults: [
        {
          path: 'src/utils.ts',
          line: 10,
          column: 5,
          text: 'export function testFunction() {',
          matchStart: 16,
          matchEnd: 28
        }
      ],
      totalCodeMatches: 1,
      truncated: false
    }

    renderWithProviders(<UnifiedSearch {...defaultProps} initialState={initialState} />)

    expect(screen.getByTestId('search-results-code')).toBeInTheDocument()
  })

  it('should call onResultClick with line number for code results', async () => {
    const onResultClick = vi.fn()
    const initialState: SearchState = {
      query: 'testFunction',
      fileResults: [],
      codeResults: [
        {
          path: 'src/utils.ts',
          line: 10,
          column: 5,
          text: 'export function testFunction() {',
          matchStart: 16,
          matchEnd: 28
        }
      ],
      totalCodeMatches: 1,
      truncated: false
    }

    const { user } = renderWithProviders(
      <UnifiedSearch {...defaultProps} onResultClick={onResultClick} initialState={initialState} />
    )

    await user.click(screen.getByText('src/utils.ts'))

    expect(onResultClick).toHaveBeenCalledWith('src/utils.ts', 10)
  })

  it('should show no results message when query exists but no matches', () => {
    const initialState: SearchState = {
      query: 'nonexistentfile',
      fileResults: [],
      codeResults: [],
      totalCodeMatches: 0,
      truncated: false
    }

    renderWithProviders(<UnifiedSearch {...defaultProps} initialState={initialState} />)

    expect(screen.getByText('No results found')).toBeInTheDocument()
  })

  it('should trigger search when initialState query changes', async () => {
    const { appService } = await import('@/services/AppService')
    vi.mocked(appService.searchCode).mockResolvedValue({
      matches: [],
      totalMatches: 0,
      truncated: false
    })

    const { rerender } = renderWithProviders(
      <UnifiedSearch {...defaultProps} initialState={{ query: '', fileResults: [], codeResults: [], totalCodeMatches: 0, truncated: false }} />
    )

    // Update initialState with a new query
    rerender(
      <UnifiedSearch {...defaultProps} initialState={{ query: 'Button', fileResults: [], codeResults: [], totalCodeMatches: 0, truncated: false }} />
    )

    // Wait for debounced search to fire
    await waitFor(() => {
      expect(appService.searchCode).toHaveBeenCalledWith(
        'test-app-id',
        'Button',
        expect.any(Object)
      )
    }, { timeout: 500 })
  })

  it('should call onStateChange when search completes', async () => {
    const { appService } = await import('@/services/AppService')
    vi.mocked(appService.searchCode).mockResolvedValue({
      matches: [
        {
          path: 'src/utils.ts',
          line: 10,
          column: 5,
          text: 'export function testFunction() {',
          matchStart: 16,
          matchEnd: 28
        }
      ],
      totalMatches: 1,
      truncated: false
    })

    const onStateChange = vi.fn()

    // Start with empty query, then rerender with search query to trigger sync effect
    const { rerender } = renderWithProviders(
      <UnifiedSearch
        {...defaultProps}
        initialState={{ query: '', fileResults: [], codeResults: [], totalCodeMatches: 0, truncated: false }}
        onStateChange={onStateChange}
      />
    )

    rerender(
      <UnifiedSearch
        {...defaultProps}
        initialState={{ query: 'testFunction', fileResults: [], codeResults: [], totalCodeMatches: 0, truncated: false }}
        onStateChange={onStateChange}
      />
    )

    // Wait for search to complete and state change to be called
    await waitFor(() => {
      const calls = onStateChange.mock.calls
      const hasCodeResults = calls.some(
        (call) => call[0].codeResults.length > 0
      )
      expect(hasCodeResults).toBe(true)
    }, { timeout: 500 })
  })

  it('should preserve results when remounting with same initialState', () => {
    const initialState: SearchState = {
      query: 'Button',
      fileResults: [{ path: 'src/components/Button.tsx', name: 'Button.tsx' }],
      codeResults: [],
      totalCodeMatches: 0,
      truncated: false
    }

    const { rerender } = renderWithProviders(
      <UnifiedSearch {...defaultProps} initialState={initialState} />
    )

    expect(screen.getByTestId('search-results-files')).toBeInTheDocument()
    expect(screen.getByText('src/components/Button.tsx')).toBeInTheDocument()

    // Simulate remount (tab switch)
    rerender(
      <UnifiedSearch {...defaultProps} initialState={initialState} />
    )

    // State should be preserved
    expect(screen.getByTestId('search-results-files')).toBeInTheDocument()
    expect(screen.getByText('src/components/Button.tsx')).toBeInTheDocument()
  })

  it('should show loading state when searching', async () => {
    const { appService } = await import('@/services/AppService')
    // Mock a slow response
    vi.mocked(appService.searchCode).mockImplementation(() =>
      new Promise(resolve => setTimeout(() => resolve({
        matches: [],
        totalMatches: 0,
        truncated: false
      }), 1000))
    )

    const { rerender } = renderWithProviders(
      <UnifiedSearch {...defaultProps} initialState={{ query: '', fileResults: [], codeResults: [], totalCodeMatches: 0, truncated: false }} />
    )

    // Trigger search by changing query
    rerender(
      <UnifiedSearch {...defaultProps} initialState={{ query: 'test', fileResults: [], codeResults: [], totalCodeMatches: 0, truncated: false }} />
    )

    // Check for loading state (after debounce)
    await waitFor(() => {
      expect(screen.getByText('Searching...')).toBeInTheDocument()
    }, { timeout: 500 })
  })

  it('should display error message when search fails', async () => {
    const { appService } = await import('@/services/AppService')
    vi.mocked(appService.searchCode).mockResolvedValue({
      matches: [],
      totalMatches: 0,
      truncated: false,
      error: 'Search failed'
    })

    const { rerender } = renderWithProviders(
      <UnifiedSearch {...defaultProps} initialState={{ query: '', fileResults: [], codeResults: [], totalCodeMatches: 0, truncated: false }} />
    )

    // Trigger search
    rerender(
      <UnifiedSearch {...defaultProps} initialState={{ query: 'test', fileResults: [], codeResults: [], totalCodeMatches: 0, truncated: false }} />
    )

    await waitFor(() => {
      expect(screen.getByText('Search failed')).toBeInTheDocument()
    }, { timeout: 500 })
  })
})
