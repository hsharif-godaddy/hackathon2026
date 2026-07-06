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
const bp = vi.hoisted(() => ({ isBelowSmBreakpoint: false }))
vi.mock('@/hooks/useSwitchboard', () => ({ useSwitchboard: () => sb.enabled }))
vi.mock('@/hooks/useBreakpoints', () => ({
  useBreakpoints: () => ({ isBelowSmBreakpoint: bp.isBelowSmBreakpoint }),
}))
vi.mock('@/hooks/useTranslations', () => ({ useTranslations: () => (_k: string, _v: unknown, d?: string) => d ?? _k }))
vi.mock('@/utils/instrumentation', () => ({ generateClickEID: () => 'eid', logImpressionEvent: () => () => {} }))
vi.mock('@/lib/request-context', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

vi.mock('@ux/box', () => ({
  default: ({ children }: React.ComponentProps<'div'>) => <div>{children}</div>,
}))

vi.mock('@ux/button', () => ({
  default: ({ onClick, disabled, text, ...props }: React.ComponentProps<'button'> & { text?: string }) => (
    <button onClick={onClick} disabled={disabled} {...props}>{text}</button>
  ),
}))

vi.mock('@ux/chip', () => ({
  default: ({ label, selected, onSelect, ...props }: React.ComponentProps<'button'> & { label: string; selected?: boolean; onSelect?: () => void }) => (
    <button type="button" aria-pressed={selected} onClick={onSelect} {...props}>{label}</button>
  ),
}))

vi.mock('@ux/modal', () => ({
  default: ({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) => (
    <div role="dialog" aria-label={title}>
      <button type="button" data-testid="design-kit-gallery-close" onClick={onClose} aria-label="Close">Close</button>
      {children}
    </div>
  ),
}))

vi.mock('@ux/spinner', () => ({
  default: () => <div role="status">Loading...</div>,
}))

vi.mock('@ux/text', () => ({
  default: {
    p: ({ children, ...props }: React.ComponentProps<'p'>) => <p {...props}>{children}</p>,
    span: ({ children, ...props }: React.ComponentProps<'span'>) => <span {...props}>{children}</span>,
  },
  text: {
    p: ({ children, ...props }: React.ComponentProps<'p'>) => <p {...props}>{children}</p>,
    span: ({ children, ...props }: React.ComponentProps<'span'>) => <span {...props}>{children}</span>,
  },
}))

const CATALOG = {
  version: 1,
  kits: [
    {
      slug: 'golden-hour',
      thumbnail: 'thumbnails/gh.png',
      tags: ['skincare', 'luxury', 'editorial', 'warm'],
      design: { palette: { background: '#f5e6d3' } },
    },
    {
      slug: 'swiss-noir',
      thumbnail: 'thumbnails/sn.png',
      tags: ['minimal', 'noir'],
      design: { palette: { background: '#1a1a2e' } },
    },
  ],
}

const MOCK_KIT = {
  slug: 'golden-hour',
  displayName: 'Golden Hour',
  whenToUse: '',
  tags: [],
  thumbnailUrl: 'x',
  tone: 'light' as const,
  attributes: ['warm'] as const,
}

function openGallery(): void {
  fireEvent.click(screen.getByTestId('design-kit-gallery-button'))
}

describe('DesignKitGallery', () => {
  beforeEach(() => {
    sb.enabled = true
    bp.isBelowSmBreakpoint = false
    _resetCatalogCacheForTest()
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(CATALOG), { status: 200 }))
  })
  afterEach(() => vi.restoreAllMocks())

  it('is a two-step flow: clicking a tile picks it, "Add Design Style" commits and closes', async () => {
    const onAttach = vi.fn()
    render(<DesignKitGallery attachedSlug={null} onAttach={onAttach} />)
    openGallery()
    await waitFor(() => expect(screen.getByTestId('design-kit-tile-golden-hour')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('design-kit-tile-golden-hour'))
    expect(onAttach).not.toHaveBeenCalled()
    expect(screen.getByTestId('design-kit-tile-golden-hour')).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByTestId('design-kit-attach'))
    expect(onAttach).toHaveBeenCalledWith(expect.objectContaining({ slug: 'golden-hour', displayName: 'Golden Hour' }))
    await waitFor(() => expect(screen.queryByTestId('design-kit-tile-golden-hour')).not.toBeInTheDocument())
  })

  it('disables "Add Design Style" until something is picked', async () => {
    render(<DesignKitGallery attachedSlug={null} onAttach={vi.fn()} />)
    openGallery()
    await waitFor(() => expect(screen.getByTestId('design-kit-tile-golden-hour')).toBeInTheDocument())
    expect(screen.getByTestId('design-kit-attach')).toBeDisabled()
    fireEvent.click(screen.getByTestId('design-kit-tile-golden-hour'))
    expect(screen.getByTestId('design-kit-attach')).toBeEnabled()
  })

  it('renders the attribute line from classified metadata', async () => {
    render(<DesignKitGallery attachedSlug={null} onAttach={vi.fn()} />)
    openGallery()
    await waitFor(() => expect(screen.getByText('Elegant · Warm · Editorial')).toBeInTheDocument())
  })

  it('filters kits by tone chip', async () => {
    render(<DesignKitGallery attachedSlug={null} onAttach={vi.fn()} />)
    openGallery()
    await waitFor(() => expect(screen.getByTestId('design-kit-tile-golden-hour')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('design-kit-chip-dark'))
    expect(screen.queryByTestId('design-kit-tile-golden-hour')).not.toBeInTheDocument()
    expect(screen.getByTestId('design-kit-tile-swiss-noir')).toBeInTheDocument()
  })

  it('filters kits by vibe chip', async () => {
    render(<DesignKitGallery attachedSlug={null} onAttach={vi.fn()} />)
    openGallery()
    await waitFor(() => expect(screen.getByTestId('design-kit-tile-golden-hour')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('design-kit-chip-clean'))
    expect(screen.queryByTestId('design-kit-tile-golden-hour')).not.toBeInTheDocument()
    expect(screen.getByTestId('design-kit-tile-swiss-noir')).toBeInTheDocument()
  })

  it('deselects a tile when clicked again', async () => {
    render(<DesignKitGallery attachedSlug={null} onAttach={vi.fn()} />)
    openGallery()
    await waitFor(() => expect(screen.getByTestId('design-kit-tile-golden-hour')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('design-kit-tile-golden-hour'))
    expect(screen.getByTestId('design-kit-tile-golden-hour')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('design-kit-attach')).toBeEnabled()
    fireEvent.click(screen.getByTestId('design-kit-tile-golden-hour'))
    expect(screen.getByTestId('design-kit-tile-golden-hour')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('design-kit-attach')).toBeDisabled()
  })

  it('deselects a chip when clicked again', async () => {
    render(<DesignKitGallery attachedSlug={null} onAttach={vi.fn()} />)
    openGallery()
    await waitFor(() => expect(screen.getByTestId('design-kit-tile-golden-hour')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('design-kit-chip-clean'))
    expect(screen.getByTestId('design-kit-chip-clean')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('design-kit-chip-clean'))
    expect(screen.getByTestId('design-kit-chip-clean')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('design-kit-tile-golden-hour')).toBeInTheDocument()
  })

  it('shows no tiles when filter has no matches', async () => {
    render(<DesignKitGallery attachedSlug={null} onAttach={vi.fn()} />)
    openGallery()
    await waitFor(() => expect(screen.getByTestId('design-kit-tile-golden-hour')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('design-kit-chip-professional'))
    expect(screen.queryByTestId('design-kit-tile-golden-hour')).not.toBeInTheDocument()
    expect(screen.queryByTestId('design-kit-tile-swiss-noir')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('design-kit-chip-professional'))
    expect(screen.getByTestId('design-kit-tile-golden-hour')).toBeInTheDocument()
    expect(screen.getByTestId('design-kit-tile-swiss-noir')).toBeInTheDocument()
  })

  it('deselects a tone chip when clicked again', async () => {
    render(<DesignKitGallery attachedSlug={null} onAttach={vi.fn()} />)
    openGallery()
    await waitFor(() => expect(screen.getByTestId('design-kit-tile-golden-hour')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('design-kit-chip-dark'))
    expect(screen.getByTestId('design-kit-chip-dark')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('design-kit-chip-dark'))
    expect(screen.getByTestId('design-kit-chip-dark')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('design-kit-tile-golden-hour')).toBeInTheDocument()
  })

  it('selecting a new chip replaces the previous filter', async () => {
    render(<DesignKitGallery attachedSlug={null} onAttach={vi.fn()} />)
    openGallery()
    await waitFor(() => expect(screen.getByTestId('design-kit-tile-golden-hour')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('design-kit-chip-dark'))
    expect(screen.getByTestId('design-kit-chip-dark')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('design-kit-tile-swiss-noir')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('design-kit-chip-clean'))
    expect(screen.getByTestId('design-kit-chip-dark')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('design-kit-chip-clean')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('design-kit-tile-swiss-noir')).toBeInTheDocument()
    expect(screen.queryByTestId('design-kit-tile-golden-hour')).not.toBeInTheDocument()
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

  it('shows Done and re-attaches the current kit when confirming without switching', async () => {
    const onAttach = vi.fn()
    render(<DesignKitGallery attachedSlug="golden-hour" onAttach={onAttach} />)
    openGallery()
    await waitFor(() => expect(screen.getByTestId('design-kit-tile-golden-hour')).toBeInTheDocument())
    expect(screen.getByTestId('design-kit-attach')).toHaveTextContent('Done')
    fireEvent.click(screen.getByTestId('design-kit-attach'))
    expect(onAttach).toHaveBeenCalledWith(expect.objectContaining({ slug: 'golden-hour', displayName: 'Golden Hour' }))
  })

  it('shows Switch kit and attaches the newly picked kit when switching', async () => {
    const onAttach = vi.fn()
    render(<DesignKitGallery attachedSlug="golden-hour" onAttach={onAttach} />)
    openGallery()
    await waitFor(() => expect(screen.getByTestId('design-kit-tile-swiss-noir')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('design-kit-tile-swiss-noir'))
    expect(screen.getByTestId('design-kit-attach')).toHaveTextContent('Switch kit')
    fireEvent.click(screen.getByTestId('design-kit-attach'))
    expect(onAttach).toHaveBeenCalledWith(expect.objectContaining({ slug: 'swiss-noir', displayName: 'Swiss Noir' }))
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

  it('closes via close button without attaching', async () => {
    const onAttach = vi.fn()
    render(<DesignKitGallery attachedSlug={null} onAttach={onAttach} />)
    openGallery()
    await waitFor(() => expect(screen.getByTestId('design-kit-tile-golden-hour')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('design-kit-gallery-close'))
    await waitFor(() => expect(screen.queryByTestId('design-kit-tile-golden-hour')).not.toBeInTheDocument())
    expect(onAttach).not.toHaveBeenCalled()
  })

  describe('mobile trigger peek', () => {
    beforeEach(() => {
      bp.isBelowSmBreakpoint = true
    })

    it('first tap expands the trigger without opening the modal', async () => {
      render(<DesignKitGallery attachedSlug={null} onAttach={vi.fn()} />)
      fireEvent.click(screen.getByTestId('design-kit-gallery-button'))
      expect(screen.getByTestId('design-kit-gallery-button')).toHaveAttribute('data-mobile-peek', 'true')
      expect(screen.getByText('Add a Style')).toBeInTheDocument()
      expect(screen.queryByTestId('design-kit-tile-golden-hour')).not.toBeInTheDocument()
    })

    it('second tap opens the modal', async () => {
      render(<DesignKitGallery attachedSlug={null} onAttach={vi.fn()} />)
      fireEvent.click(screen.getByTestId('design-kit-gallery-button'))
      fireEvent.click(screen.getByTestId('design-kit-gallery-button'))
      await waitFor(() => expect(screen.getByTestId('design-kit-tile-golden-hour')).toBeInTheDocument())
    })

    it('dismisses peek on outside interaction without opening the modal', async () => {
      render(
        <>
          <DesignKitGallery attachedSlug={null} onAttach={vi.fn()} />
          <button type="button" data-testid="outside">Outside</button>
        </>,
      )
      fireEvent.click(screen.getByTestId('design-kit-gallery-button'))
      expect(screen.getByTestId('design-kit-gallery-button')).toHaveAttribute('data-mobile-peek', 'true')
      fireEvent.pointerDown(screen.getByTestId('outside'))
      expect(screen.getByTestId('design-kit-gallery-button')).toHaveAttribute('data-mobile-peek', 'false')
      expect(screen.queryByTestId('design-kit-tile-golden-hour')).not.toBeInTheDocument()
    })
  })
})

describe('DesignKitChip', () => {
  beforeEach(() => {
    bp.isBelowSmBreakpoint = false
  })

  it('renders label and fires remove', () => {
    const onRemove = vi.fn()
    render(<DesignKitChip kit={MOCK_KIT} onRemove={onRemove} />)
    expect(screen.getByText('Design Style: Golden Hour')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('design-kit-chip-remove'))
    expect(onRemove).toHaveBeenCalled()
  })

  it('shows only the kit name on mobile', () => {
    bp.isBelowSmBreakpoint = true
    render(<DesignKitChip kit={MOCK_KIT} onRemove={vi.fn()} />)
    expect(screen.getByText('Golden Hour')).toBeInTheDocument()
    expect(screen.queryByText('Design Style: Golden Hour')).not.toBeInTheDocument()
  })
})
