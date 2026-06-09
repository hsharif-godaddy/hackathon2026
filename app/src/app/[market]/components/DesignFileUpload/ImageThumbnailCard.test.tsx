/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { afterEach,beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import { ImageThumbnailCard } from './ImageThumbnailCard'
import type { UploadedDesignFile } from '../types'

function makeImageFile(overrides: Partial<UploadedDesignFile> = {}): UploadedDesignFile {
  return { name: 'photo.png', content: '', isDesignMd: false, isImage: true, ...overrides }
}

describe('ImageThumbnailCard', () => {
  const mockObjectUrl = 'blob:http://localhost/mock-url'

  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => mockObjectUrl),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders a placeholder when zipRaw is absent', () => {
    renderWithProviders(<ImageThumbnailCard uploadedFile={makeImageFile()} onRemove={vi.fn()} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders an img with the blob URL when zipRaw is present', () => {
    const zipRaw = new ArrayBuffer(8)
    renderWithProviders(
      <ImageThumbnailCard uploadedFile={makeImageFile({ name: 'photo.png', zipRaw })} onRemove={vi.fn()} />,
    )
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', mockObjectUrl)
    expect(img).toHaveAttribute('alt', 'photo.png')
  })

  it('revokes the blob URL on unmount', () => {
    const zipRaw = new ArrayBuffer(8)
    const { unmount } = renderWithProviders(
      <ImageThumbnailCard uploadedFile={makeImageFile({ zipRaw })} onRemove={vi.fn()} />,
    )
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(mockObjectUrl)
  })

  it('calls onRemove when the remove button is clicked', async () => {
    const onRemove = vi.fn()
    const { user } = renderWithProviders(
      <ImageThumbnailCard uploadedFile={makeImageFile()} onRemove={onRemove} />,
    )
    await user.click(screen.getByRole('button'))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('disables the remove button when disabled=true', () => {
    renderWithProviders(
      <ImageThumbnailCard uploadedFile={makeImageFile()} onRemove={vi.fn()} disabled />,
    )
    expect(screen.getByRole('button')).toBeDisabled()
  })
})
