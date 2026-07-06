/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { hasAnyCanvasBadge } from './badgeProviders'
import { CanvasId } from './registry'
import { useInboxCanvasBadge } from './useInboxCanvasBadge'

const mockUseSwitchboard = vi.fn()
const mockUseInboxUnresolvedCount = vi.fn()
let mockInboxBrandId: string | null = null

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (flag: string) => mockUseSwitchboard(flag),
}))

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (state: { inboxBrandId: string | null }) => unknown) =>
    selector({ inboxBrandId: mockInboxBrandId }),
}))

vi.mock('@/app/[market]/develop/hooks/useInbox', () => ({
  useInboxUnresolvedCount: (brandId: string | undefined) => mockUseInboxUnresolvedCount(brandId),
}))

function BadgeHarness() {
  return <>{useInboxCanvasBadge()}</>
}

describe('useInboxCanvasBadge', () => {
  beforeEach(() => {
    mockUseSwitchboard.mockReset()
    mockUseInboxUnresolvedCount.mockReset()
    mockInboxBrandId = null
  })

  it('renders the unresolved-count badge when enabled, branded, and count > 0', () => {
    mockUseSwitchboard.mockReturnValue(true)
    mockInboxBrandId = 'brand-1'
    mockUseInboxUnresolvedCount.mockReturnValue({ data: 5 })

    render(<BadgeHarness />)

    const badge = screen.getByTestId('inbox-unresolved-badge')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('5')
    expect(mockUseInboxUnresolvedCount).toHaveBeenCalledWith('brand-1')
  })

  it('renders nothing when the count is 0', () => {
    mockUseSwitchboard.mockReturnValue(true)
    mockInboxBrandId = 'brand-1'
    mockUseInboxUnresolvedCount.mockReturnValue({ data: 0 })

    const { container } = render(<BadgeHarness />)
    expect(container).toBeEmptyDOMElement()
  })

  it('passes undefined brand id (disabling the query) when the flag is off', () => {
    mockUseSwitchboard.mockReturnValue(false)
    mockInboxBrandId = 'brand-1'
    // Mirror react-query: a disabled query (undefined brand id) yields no data,
    // even though a count exists for the brand.
    mockUseInboxUnresolvedCount.mockImplementation((brandId: string | undefined) => ({
      data: brandId ? 5 : undefined,
    }))

    render(<BadgeHarness />)

    expect(mockUseInboxUnresolvedCount).toHaveBeenCalledWith(undefined)
    expect(screen.queryByTestId('inbox-unresolved-badge')).not.toBeInTheDocument()
  })

  it('passes undefined brand id when no brand is bound', () => {
    mockUseSwitchboard.mockReturnValue(true)
    mockInboxBrandId = null
    mockUseInboxUnresolvedCount.mockReturnValue({ data: 0 })

    render(<BadgeHarness />)
    expect(mockUseInboxUnresolvedCount).toHaveBeenCalledWith(undefined)
  })
})

describe('hasAnyCanvasBadge', () => {
  it('is true when a listed canvas has a non-null badge', () => {
    const badges = { [CanvasId.Inbox]: <span /> }
    expect(hasAnyCanvasBadge(badges, [CanvasId.Inbox, CanvasId.Code])).toBe(true)
  })

  it('is false when listed canvases have null badges', () => {
    const badges = { [CanvasId.Inbox]: null }
    expect(hasAnyCanvasBadge(badges, [CanvasId.Inbox])).toBe(false)
  })

  it('is false when the badged canvas is not in the queried set', () => {
    const badges = { [CanvasId.Inbox]: <span /> }
    expect(hasAnyCanvasBadge(badges, [CanvasId.Code])).toBe(false)
  })
})
