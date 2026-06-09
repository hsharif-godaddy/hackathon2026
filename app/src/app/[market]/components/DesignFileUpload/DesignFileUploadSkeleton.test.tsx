/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import { DesignFileUploadSkeleton } from './DesignFileUploadSkeleton'

describe('DesignFileUploadSkeleton', () => {
  it('renders nothing when fileNames is empty', () => {
    const { container } = renderWithProviders(<DesignFileUploadSkeleton fileNames={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a compact image skeleton for image files', () => {
    const { container } = renderWithProviders(<DesignFileUploadSkeleton fileNames={['photo.png']} />)
    // Image skeletons are size-7 squares — they do NOT show the filename
    expect(screen.queryByText('photo.png')).not.toBeInTheDocument()
    expect(container.querySelectorAll('[class*="size-7"]')).toHaveLength(1)
  })

  it('renders a named skeleton card for non-image files', () => {
    renderWithProviders(<DesignFileUploadSkeleton fileNames={['spec.md']} />)
    expect(screen.getByText('spec.md')).toBeInTheDocument()
  })

  it('renders skeletons for mixed image and non-image files', () => {
    renderWithProviders(
      <DesignFileUploadSkeleton fileNames={['photo.jpg', 'readme.md', 'design.png']} />,
    )
    expect(screen.getByText('readme.md')).toBeInTheDocument()
    expect(screen.queryByText('photo.jpg')).not.toBeInTheDocument()
    expect(screen.queryByText('design.png')).not.toBeInTheDocument()
  })
})
