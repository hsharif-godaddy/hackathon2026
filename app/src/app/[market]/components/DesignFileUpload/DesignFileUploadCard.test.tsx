/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import { DesignFileUploadCard } from './DesignFileUploadCard'
import type { UploadedDesignFile } from '../types'

function makeFile(overrides: Partial<UploadedDesignFile> = {}): UploadedDesignFile {
  return { name: 'design.md', content: '', isDesignMd: true, ...overrides }
}

describe('DesignFileUploadCard', () => {
  it('renders the file name', () => {
    renderWithProviders(
      <DesignFileUploadCard uploadedFile={makeFile({ name: 'spec.md' })} onRemove={vi.fn()} />,
    )
    expect(screen.getByText('spec.md')).toBeInTheDocument()
  })

  it('calls onRemove when the remove button is clicked', async () => {
    const onRemove = vi.fn()
    const { user } = renderWithProviders(
      <DesignFileUploadCard uploadedFile={makeFile()} onRemove={onRemove} />,
    )
    await user.click(screen.getByRole('button'))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('disables the remove button when disabled=true', () => {
    renderWithProviders(
      <DesignFileUploadCard uploadedFile={makeFile()} onRemove={vi.fn()} disabled />,
    )
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('delegates to ImageThumbnailCard for image files', () => {
    const imageFile = makeFile({ name: 'photo.png', isDesignMd: false, isImage: true })
    renderWithProviders(<DesignFileUploadCard uploadedFile={imageFile} onRemove={vi.fn()} />)
    // ImageThumbnailCard renders an aria-label with the filename on the wrapper div, not a text node
    expect(screen.getByLabelText('photo.png')).toBeInTheDocument()
  })

  it.each([
    { isZip: true, expectedLabel: 'builder_design_file_upload_type_zip' },
    { isUiKit: true, expectedLabel: 'builder_design_file_upload_type_ui_kit' },
    { isDesignMd: true, expectedLabel: 'builder_design_file_upload_type_design_spec' },
  ] as Array<Partial<UploadedDesignFile> & { expectedLabel: string }>)(
    'shows the correct type label for file flags',
    ({ expectedLabel, ...flags }) => {
      renderWithProviders(
        <DesignFileUploadCard uploadedFile={makeFile({ isDesignMd: false, ...flags })} onRemove={vi.fn()} />,
      )
      // useTranslations returns the key as-is in test (IntlProvider with empty messages)
      expect(screen.getByText(expectedLabel)).toBeInTheDocument()
    },
  )
})
