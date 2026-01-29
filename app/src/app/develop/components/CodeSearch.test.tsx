import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import CodeSearch from './CodeSearch'

vi.mock('@/services/AppService', () => ({
  appService: {
    searchCode: vi.fn().mockResolvedValue({
      matches: [],
      totalMatches: 0,
      truncated: false
    })
  }
}))

describe('CodeSearch', () => {
  const mockFiles = [
    {
      name: 'Button.tsx',
      type: 'file' as const,
      path: 'src/components/Button.tsx',
      extension: 'tsx'
    },
    {
      name: 'components.json',
      type: 'file' as const,
      path: 'components.json',
      extension: 'json'
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

  it('should render search input with mode toggle buttons', async function render() {
    renderWithProviders(<CodeSearch {...defaultProps} />)

    expect(screen.getByRole('button', { name: 'builder_code_search_files' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'builder_code_search_code' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('builder_code_search_placeholder_files')).toBeInTheDocument()
  })

  it('should switch mode and update placeholder when code button is clicked', async function switchMode() {
    const { user } = renderWithProviders(<CodeSearch {...defaultProps} />)

    expect(screen.getByPlaceholderText('builder_code_search_placeholder_files')).toBeInTheDocument()

    const codeButton = screen.getByRole('button', { name: 'builder_code_search_code' })
    await user.click(codeButton)

    expect(screen.getByPlaceholderText('builder_code_search_placeholder_code')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('builder_code_search_placeholder_files')).not.toBeInTheDocument()
  })
})

