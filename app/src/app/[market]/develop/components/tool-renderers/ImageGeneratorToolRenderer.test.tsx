/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import ImageGeneratorToolRenderer from './ImageGeneratorToolRenderer'

vi.mock('@/lib/request-context', () => ({
  logger: { error: vi.fn() },
}))

const generateImageResult = JSON.stringify({
  structuredContent: {
    sessionId: 'session-123',
    images: [
      { url: 'https://example.com/image1.jpg' },
      { url: 'https://example.com/image2.jpg' },
    ],
  },
})

const editImageResult = JSON.stringify({
  structuredContent: {
    sessionId: 'session-456',
    url: 'https://example.com/edited.jpg',
  },
})

describe('ImageGeneratorToolRenderer', () => {
  describe('generate_image result (structuredContent.images)', () => {
    it('renders image grid when completed', async () => {
      renderWithProviders(
        <ImageGeneratorToolRenderer
          toolName="media-image__generate_image"
          toolStatus="completed"
          result={generateImageResult}
        />
      )

      await waitFor(() => {
        expect(screen.getAllByRole('button')).toHaveLength(2)
      })
    })

    it('shows generating header while running', () => {
      renderWithProviders(
        <ImageGeneratorToolRenderer
          toolName="media-image__generate_image"
          toolStatus="running"
          result={null}
        />
      )

      expect(screen.getByText('Generating images...')).toBeInTheDocument()
    })
  })

  describe('edit_image result (structuredContent.url)', () => {
    it('renders the edited image when completed', async () => {
      renderWithProviders(
        <ImageGeneratorToolRenderer
          toolName="media-image__edit_image"
          toolStatus="completed"
          result={editImageResult}
        />
      )

      await waitFor(() => {
        const img = screen.getByRole('img', { name: /image 1/i })
        expect(img).toHaveAttribute('src', 'https://example.com/edited.jpg')
      })
    })

    it('renders exactly one image button for edit result', async () => {
      renderWithProviders(
        <ImageGeneratorToolRenderer
          toolName="media-image__edit_image"
          toolStatus="completed"
          result={editImageResult}
        />
      )

      await waitFor(() => {
        expect(screen.getAllByRole('button')).toHaveLength(1)
      })
    })

    it('shows empty state when result has no url or images', async () => {
      const emptyResult = JSON.stringify({ structuredContent: { sessionId: 'x' } })

      renderWithProviders(
        <ImageGeneratorToolRenderer
          toolName="media-image__edit_image"
          toolStatus="completed"
          result={emptyResult}
        />
      )

      await waitFor(() => {
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
      })
    })
  })
})
