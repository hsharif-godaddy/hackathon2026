/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import type { PageInfo } from '@/app/[market]/develop/hooks/useRebuildPages'
import { renderWithProviders } from '@/tests/test-utils'
import RebuildPageSelectorToolRenderer from './RebuildPageSelectorToolRenderer'

// Echo i18n keys so we can assert on which card rendered.
vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (id: string) => id,
}))
vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: () => false,
  useIsLoading: () => false,
  useActiveStream: () => ({ isComplete: true }),
}))

const flags: Record<string, boolean> = {}
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (flag: string) => flags[flag] ?? false,
}))

const PAGES: PageInfo[] = [
  { slug: 'about', title: 'About', url: '/about', isBuilt: false },
  { slug: 'contact', title: 'Contact', url: '/contact', isBuilt: false },
]

function render() {
  return renderWithProviders(
    <RebuildPageSelectorToolRenderer
      toolName="rebuildPageSelector"
      toolStatus="completed"
      result={{ widget: { widgetType: 'rebuild-page-selector', widgetData: {
        appId: 'app1', sourceUrl: 'https://x.com', availablePages: PAGES, totalPages: 2, builtPages: 0,
      } } }}
      isLastAssistantMessage={true}
      size="regular"
    />,
  )
}

describe('RebuildPageSelectorToolRenderer flag wrapper', () => {
  beforeEach(() => { for (const k of Object.keys(flags)) delete flags[k] })

  it('renders the single-select card when the flag is OFF', () => {
    flags['appbuilder-rebuild-multipage'] = false
    render()
    expect(screen.getByText('builder_rebuild_build_page')).toBeInTheDocument()
    expect(screen.queryByText('builder_rebuild_selector_title')).not.toBeInTheDocument()
  })

  it('renders the multi-select card when the flag is ON', () => {
    flags['appbuilder-rebuild-multipage'] = true
    render()
    expect(screen.getByText('builder_rebuild_selector_title')).toBeInTheDocument()
    expect(screen.queryByText('builder_rebuild_build_page')).not.toBeInTheDocument()
  })
})
