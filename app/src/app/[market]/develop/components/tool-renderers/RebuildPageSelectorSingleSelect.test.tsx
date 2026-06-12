/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'

import type { PageInfo } from '@/app/[market]/develop/hooks/useRebuildPages'
import { renderWithProviders } from '@/tests/test-utils'
import RebuildPageSelectorSingleSelect from './RebuildPageSelectorSingleSelect'

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (id: string) => id,
}))
vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: () => false,
  useIsLoading: () => false,
}))

// Capture the send call while keeping the rest of ChatContext (the Provider
// renderWithProviders mounts) intact.
const sendMock = vi.fn()
vi.mock('@/app/[market]/develop/components/chat/ChatContext', async (importActual) => ({
  ...(await importActual<typeof import('@/app/[market]/develop/components/chat/ChatContext')>()),
  useSendUserMessage: () => sendMock,
}))

const PAGES: PageInfo[] = [
  { slug: 'about', title: 'About', url: '/about', isBuilt: false },
  { slug: 'contact', title: 'Contact', url: '/contact', isBuilt: false },
]

function render() {
  return renderWithProviders(
    <RebuildPageSelectorSingleSelect
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

describe('RebuildPageSelectorSingleSelect', () => {
  beforeEach(() => sendMock.mockClear())

  // This is the contract the multipage-flag revert rests on: with the flag OFF the
  // single-select must send plain text and NOT the rebuildBuildPageSlug metadata, so
  // the agent-side deterministic build path (gated on that field) stays inert.
  it('sends plain "Build the {slug} page" with no rebuildBuildPageSlug metadata', () => {
    render()
    fireEvent.click(screen.getByText('builder_rebuild_build_page'))

    expect(sendMock).toHaveBeenCalledTimes(1)
    const [content, options] = sendMock.mock.calls[0]
    expect(content).toBe('Build the about page')
    expect(options).toEqual({ isActionRequest: true })
    expect(options).not.toHaveProperty('rebuildBuildPageSlug')
  })
})
