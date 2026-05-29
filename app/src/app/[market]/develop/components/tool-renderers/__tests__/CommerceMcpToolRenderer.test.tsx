/**
 * @vitest-environment jsdom
 *
 * CommerceMcpToolRenderer Tests
 *
 * Focuses on the dynamic label derivation \u2014 that's the reason this
 * renderer exists instead of falling back to DefaultToolRenderer.
 * The modal body is a straightforward copy of DefaultToolRenderer and
 * is covered by the snapshot tests of its subcomponents.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import CommerceMcpToolRenderer from '../CommerceMcpToolRenderer'

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, _opts?: unknown, fallback?: string) =>
    fallback ?? key,
}))

vi.mock('@/app/[market]/develop/components/MarkdownRenderer', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => <div>{content}</div>,
}))

function renderRenderer(props: Partial<React.ComponentProps<typeof CommerceMcpToolRenderer>>) {
  return render(
    <CommerceMcpToolRenderer
      toolName={props.toolName ?? 'commerce__search_tools'}
      toolStatus={props.toolStatus ?? 'completed'}
      {...props}
    />,
  )
}

describe('CommerceMcpToolRenderer label', () => {
  it('renders a generic label when search_tools has no query', () => {
    renderRenderer({ toolName: 'commerce__search_tools' })
    expect(screen.getByText('Finding commerce tools')).toBeInTheDocument()
  })

  it('includes the query in the label for search_tools', () => {
    renderRenderer({
      toolName: 'commerceSearchTools',
      input: { query: 'get store info' },
    })
    expect(
      screen.getByText('Finding commerce tools: get store info'),
    ).toBeInTheDocument()
  })

  it('truncates very long queries', () => {
    const longQuery = 'a'.repeat(200)
    renderRenderer({
      toolName: 'commerce_search_tools',
      input: { query: longQuery },
    })
    // Prefix + truncated body + ellipsis.
    const label = screen.getByText(/Finding commerce tools: a+\u2026$/)
    expect(label.textContent!.length).toBeLessThan(100)
  })

  it('shows the inner MCP tool name for execute_tool via `name`', () => {
    renderRenderer({
      toolName: 'commerce__execute_tool',
      input: { name: 'get_store_info' },
    })
    expect(screen.getByText('Commerce: get_store_info')).toBeInTheDocument()
  })

  it('shows the inner MCP tool name for execute_tool via `tool` (server shape)', () => {
    renderRenderer({
      toolName: 'commerceExecuteTool',
      input: { tool: 'commerce_list_products' },
    })
    expect(
      screen.getByText('Commerce: commerce_list_products'),
    ).toBeInTheDocument()
  })

  it('falls back to generic execute label without a tool name', () => {
    renderRenderer({ toolName: 'commerce_execute_tool', input: {} })
    expect(screen.getByText('Running commerce tool')).toBeInTheDocument()
  })

  it('labels core store tools', () => {
    renderRenderer({ toolName: 'commerce__commerce_store_setup', input: { storeName: 'Shop' } })
    expect(screen.getByText('Commerce: commerce store setup')).toBeInTheDocument()
  })
})
