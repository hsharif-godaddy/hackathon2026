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

  it('should render search input', () => {
    renderWithProviders(<UnifiedSearch {...defaultProps} />)

    expect(screen.getByTestId('search-panel')).toBeInTheDocument()
    expect(screen.getByTestId('search-input')).toBeInTheDocument()
  })

  it('should focus search input on mount', () => {
    renderWithProviders(<UnifiedSearch {...defaultProps} />)

    expect(screen.getByTestId('search-input')).toHaveFocus()
  })

  it('should display file results when searching for file names', async () => {
    const { user } = renderWithProviders(<UnifiedSearch {...defaultProps} />)

    const input = screen.getByTestId('search-input')
    await user.type(input, 'Button')

    await waitFor(() => {
      expect(screen.getByTestId('search-results-files')).toBeInTheDocument()
    })

    expect(screen.getByText('src/components/Button.tsx')).toBeInTheDocument()
  })

  it('should call onResultClick when clicking a file result', async () => {
    const onResultClick = vi.fn()
    const { user } = renderWithProviders(<UnifiedSearch {...defaultProps} onResultClick={onResultClick} />)

    const input = screen.getByTestId('search-input')
    await user.type(input, 'Button')

    await waitFor(() => {
      expect(screen.getByText('src/components/Button.tsx')).toBeInTheDocument()
    })

    await user.click(screen.getByText('src/components/Button.tsx'))

    expect(onResultClick).toHaveBeenCalledWith('src/components/Button.tsx')
  })

  it('should display code results section when API returns matches', async () => {
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

    const { user } = renderWithProviders(<UnifiedSearch {...defaultProps} />)

    const input = screen.getByTestId('search-input')
    await user.type(input, 'testFunction')

    await waitFor(() => {
      expect(screen.getByTestId('search-results-code')).toBeInTheDocument()
    })
  })

  it('should call onResultClick with line number for code results', async () => {
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

    const onResultClick = vi.fn()
    const { user } = renderWithProviders(<UnifiedSearch {...defaultProps} onResultClick={onResultClick} />)

    const input = screen.getByTestId('search-input')
    await user.type(input, 'testFunction')

    await waitFor(() => {
      expect(screen.getByText('src/utils.ts')).toBeInTheDocument()
    })

    await user.click(screen.getByText('src/utils.ts'))

    expect(onResultClick).toHaveBeenCalledWith('src/utils.ts', 10)
  })

  it('should show no results message when search has no matches', async () => {
    // Ensure searchCode returns no results for this test
    const { appService } = await import('@/services/AppService')
    vi.mocked(appService.searchCode).mockResolvedValue({
      matches: [],
      totalMatches: 0,
      truncated: false
    })

    const { user } = renderWithProviders(<UnifiedSearch {...defaultProps} />)

    const input = screen.getByTestId('search-input')
    await user.type(input, 'nonexistentfile')

    await waitFor(() => {
      expect(screen.getByText('No results found')).toBeInTheDocument()
    })
  })

  it('should clear search when clear link is clicked', async () => {
    const { user } = renderWithProviders(<UnifiedSearch {...defaultProps} />)

    const input = screen.getByTestId('search-input')
    await user.type(input, 'Button')

    await waitFor(() => {
      expect(screen.getByTestId('search-results-files')).toBeInTheDocument()
    })

    // Find and click clear link
    const clearLink = screen.getByLabelText('Clear')
    await user.click(clearLink)

    await waitFor(() => {
      expect(input).toHaveValue('')
      expect(screen.queryByTestId('search-results-files')).not.toBeInTheDocument()
    })
  })

  it('should restore state from initialState prop', () => {
    const initialState: SearchState = {
      query: 'Button',
      fileResults: [{ path: 'src/components/Button.tsx', name: 'Button.tsx' }],
      codeResults: [],
      totalCodeMatches: 0,
      truncated: false
    }

    renderWithProviders(<UnifiedSearch {...defaultProps} initialState={initialState} />)

    const input = screen.getByTestId('search-input')
    expect(input).toHaveValue('Button')
    expect(screen.getByTestId('search-results-files')).toBeInTheDocument()
    expect(screen.getByText('src/components/Button.tsx')).toBeInTheDocument()
  })

  it('should call onStateChange when search state changes', async () => {
    const onStateChange = vi.fn()
    const { user } = renderWithProviders(
      <UnifiedSearch {...defaultProps} onStateChange={onStateChange} />
    )

    const input = screen.getByTestId('search-input')
    await user.type(input, 'Button')

    // Wait for results to appear and state to be called with file results
    await waitFor(() => {
      const calls = onStateChange.mock.calls
      const hasFileResults = calls.some(
        (call) => call[0].query === 'Button' && call[0].fileResults.length > 0
      )
      expect(hasFileResults).toBe(true)
    })
  })

  it('should persist results when switching tabs and back', async () => {
    // This simulates the parent component behavior
    let persistedState: SearchState | undefined

    const { user, rerender } = renderWithProviders(
      <UnifiedSearch
        {...defaultProps}
        initialState={persistedState}
        onStateChange={(state) => { persistedState = state }}
      />
    )

    const input = screen.getByTestId('search-input')
    await user.type(input, 'Button')

    await waitFor(() => {
      expect(screen.getByTestId('search-results-files')).toBeInTheDocument()
    })

    // Simulate unmount/remount (tab switch)
    rerender(
      <UnifiedSearch
        {...defaultProps}
        initialState={persistedState}
        onStateChange={(state) => { persistedState = state }}
      />
    )

    // State should be preserved
    expect(screen.getByTestId('search-input')).toHaveValue('Button')
    expect(screen.getByTestId('search-results-files')).toBeInTheDocument()
  })
})
