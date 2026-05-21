/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '@/tests/test-utils'
import LogoActionsToolRenderer from './LogoActionsToolRenderer'

const completedResult = {
  structuredContent: { imageUrl: 'https://example.com/logo.png' },
}

describe('LogoActionsToolRenderer', () => {
  it('renders nothing (UI removed)', () => {
    const { container } = renderWithProviders(
      <LogoActionsToolRenderer
        toolName="media-logo__offer_logo_actions"
        toolStatus="completed"
        result={completedResult}
      />
    )

    expect(container.innerHTML).toBe('')
  })
})
