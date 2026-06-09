/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import { DesignFileUploadError } from './DesignFileUploadError'

describe('DesignFileUploadError', () => {
  it('renders the error message', () => {
    renderWithProviders(<DesignFileUploadError error="File is too large" />)
    expect(screen.getByText('File is too large')).toBeInTheDocument()
  })

  it('has role="alert" for accessibility', () => {
    renderWithProviders(<DesignFileUploadError error="Something went wrong" />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
