/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import PreviewSkeleton from './PreviewSkeleton'

describe('PreviewSkeleton', () => {
  it('renders with custom testId', () => {
    render(<PreviewSkeleton testId="custom-skeleton" />)
    expect(screen.getByTestId('custom-skeleton')).toBeInTheDocument()
  })
})
