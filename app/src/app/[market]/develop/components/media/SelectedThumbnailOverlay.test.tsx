/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { SelectedThumbnailOverlay } from './SelectedThumbnailOverlay'

describe('SelectedThumbnailOverlay', () => {
  it('renders the shimmering border treatment with a tinted fill', () => {
    render(<SelectedThumbnailOverlay />)
    const overlay: HTMLElement = screen.getByTestId('selected-thumbnail-overlay')
    // The 4px purple ring + shimmer live in the CSS class (pseudo-element);
    // here we assert the class is applied and the tint fill is present.
    expect(overlay.className).toContain('selected-thumbnail-shimmer-border')
    expect(overlay.getAttribute('style')).toContain('rgba(128, 90, 213, 0.2)')
  })

  it('no longer renders a checkmark badge', () => {
    const { container } = render(<SelectedThumbnailOverlay />)
    expect(container.querySelector('svg')).toBeNull()
  })
})
