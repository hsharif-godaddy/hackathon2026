/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { _resetCatalogCacheForTest } from '@/hooks/home/useDesignKitCatalog'
import DesignKitGallery, { DesignKitChip } from './DesignKitGallery'

const sb = vi.hoisted(() => ({ enabled: true }))
vi.mock('@/hooks/useSwitchboard', () => ({ useSwitchboard: () => sb.enabled }))
vi.mock('@/hooks/useTranslations', () => ({ useTranslations: () => (_k: string, _v: unknown, d?: string) => d ?? _k }))
vi.mock('@/hooks/useBreakpoints', () => ({ useBreakpoints: () => ({ isBelowSmBreakpoint: false }) }))
vi.mock('@/utils/instrumentation', () => ({ generateClickEID: () => 'eid', logImpressionEvent: () => () => {} }))
vi.mock('@/lib/request-context', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

vi.mock('@ux/button', () => ({
  default: ({ onClick, disabled, children, icon, 'aria-label': ariaLabel, ...props }: React.ComponentProps<'button'> & { icon?: React.ReactNode }) => (
    <button onClick={onClick} disabled={disabled} aria-label={ariaLabel} {...props}>
      {icon}
      {children}
    </button>
  ),
}))

vi.mock('@ux/spinner', () => ({
  default: ({ size }: { size?: string }) => <div role="status" data-size={size}>Loading...</div>,
}))

vi.mock('@ux/text', () => ({
  text: {
    p: ({ children, ...props }: React.ComponentProps<'p'>) => <p {...props}>{children}</p>,
  },
}))

vi.mock('@ux/icon/x', () => ({
  default: (props: React.ComponentProps<'svg'>) => <svg data-testid="x-icon" {...props} />,
}))

const CATALOG = { version: 1, kits: [
  { slug: 'golden-hour', thumbnail: 'thumbnails/gh.png', tags: ['skincare', 'luxury', 'editorial'] },
  { slug: 'swiss-noir', thumbnail: 'thumbnails/sn.png', tags: ['minimal'] },
] }

function openGallery(): void {
  fireEvent.click(screen.getByTestId('design-kit-gallery-button'))
}

describe('DesignKitGallery', () => {
  beforeEach(() => {
    sb.enabled = true
    _resetCatalogCacheForTest()
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(CATALOG), { status: 200 }))
  })
  afterEach(() => vi.restoreAllMocks())

  it('is a two-step flow: clicking a tile picks it, "Attach kit" commits and closes', async () => {
    const onAttach = vi.fn()
    render(<DesignKitGallery attachedSlug={null} onAttach={onAttach} />)
    openGallery()
    await waitFor(() => expect(screen.getByTestId('design-kit-tile-golden-hour')).toBeInTheDocument())

    // Picking a tile does NOT attach yet.
    fireEvent.click(screen.getByTestId('design-kit-tile-golden-hour'))
    expect(onAttach).not.toHaveBeenCalled()
    expect(screen.getByTestId('design-kit-tile-golden-hour')).toHaveAttribute('aria-pressed', 'true')

    // The footer button commits and closes the modal.
    fireEvent.click(screen.getByTestId('design-kit-attach'))
    expect(onAttach).toHaveBeenCalledWith(expect.objectContaining({ slug: 'golden-hour', displayName: 'Golden Hour' }))
    await waitFor(() => expect(screen.queryByTestId('design-kit-tile-golden-hour')).not.toBeInTheDocument())
  })

  it('disables "Attach kit" until something is picked', async () => {
    render(<DesignKitGallery attachedSlug={null} onAttach={vi.fn()} />)
    openGallery()
    await waitFor(() => expect(screen.getByTestId('design-kit-tile-golden-hour')).toBeInTheDocument())
    expect(screen.getByTestId('design-kit-attach')).toBeDisabled()
    fireEvent.click(screen.getByTestId('design-kit-tile-golden-hour'))
    expect(screen.getByTestId('design-kit-attach')).toBeEnabled()
  })

  it('renders the vibe line from the kit tags', async () => {
    render(<DesignKitGallery attachedSlug={null} onAttach={vi.fn()} />)
    openGallery()
    await waitFor(() => expect(screen.getByText('Skincare · Luxury · Editorial')).toBeInTheDocument())
  })

  it('renders nothing when the flag is off', () => {
    sb.enabled = false
    const { container } = render(<DesignKitGallery attachedSlug={null} onAttach={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the error state when the catalog fails to load', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }))
    render(<DesignKitGallery attachedSlug={null} onAttach={vi.fn()} />)
    openGallery()
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })

  it('shows the empty state when the catalog has no kits', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ version: 1, kits: [] }), { status: 200 }))
    render(<DesignKitGallery attachedSlug={null} onAttach={vi.fn()} />)
    openGallery()
    await waitFor(() => expect(screen.getByText('No design kits available.')).toBeInTheDocument())
  })

  it('shows the loading state while the catalog is fetching', async () => {
    vi.spyOn(global, 'fetch').mockReturnValue(new Promise(() => {}) as Promise<Response>)
    render(<DesignKitGallery attachedSlug={null} onAttach={vi.fn()} />)
    openGallery()
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    expect(screen.queryByTestId('design-kit-tile-golden-hour')).not.toBeInTheDocument()
  })

  it('pre-selects the attached kit and marks it Attached', async () => {
    render(<DesignKitGallery attachedSlug="golden-hour" onAttach={vi.fn()} />)
    openGallery()
    await waitFor(() => expect(screen.getByTestId('design-kit-tile-golden-hour')).toBeInTheDocument())
    expect(screen.getByTestId('design-kit-tile-golden-hour')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('design-kit-tile-swiss-noir')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Attached')).toBeInTheDocument()
  })

  it('detaches via the footer and closes', async () => {
    const onAttach = vi.fn()
    render(<DesignKitGallery attachedSlug="golden-hour" onAttach={onAttach} />)
    openGallery()
    await waitFor(() => expect(screen.getByTestId('design-kit-detach')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('design-kit-detach'))
    expect(onAttach).toHaveBeenCalledWith(null)
    await waitFor(() => expect(screen.queryByTestId('design-kit-tile-golden-hour')).not.toBeInTheDocument())
  })

  it('closes on Escape without attaching', async () => {
    const onAttach = vi.fn()
    render(<DesignKitGallery attachedSlug={null} onAttach={onAttach} />)
    openGallery()
    await waitFor(() => expect(screen.getByTestId('design-kit-tile-golden-hour')).toBeInTheDocument())
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('design-kit-tile-golden-hour')).not.toBeInTheDocument())
    expect(onAttach).not.toHaveBeenCalled()
  })
})

describe('DesignKitChip', () => {
  it('renders name and fires remove', () => {
    const onRemove = vi.fn()
    render(<DesignKitChip kit={{ slug: 'golden-hour', displayName: 'Golden Hour', whenToUse: '', tags: [], thumbnailUrl: 'x' }} onRemove={onRemove} />)
    expect(screen.getByText('Golden Hour')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('design-kit-chip-remove'))
    expect(onRemove).toHaveBeenCalled()
  })

  it('binds the thumbnailUrl to the img src', () => {
    const { container } = render(
      <DesignKitChip kit={{ slug: 'golden-hour', displayName: 'Golden Hour', whenToUse: '', tags: [], thumbnailUrl: 'https://cdn/x.png' }} onRemove={vi.fn()} />,
    )
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', 'https://cdn/x.png')
  })
})
