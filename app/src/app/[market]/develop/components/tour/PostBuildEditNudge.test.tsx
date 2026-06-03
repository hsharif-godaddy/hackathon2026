/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { PostBuildEditNudge } from '@/app/[market]/develop/components/tour/PostBuildEditNudge'

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}))

const coachmarkSpy = vi.fn()

vi.mock('@airo-ux/pattern-library/_vendor/coachmark', () => ({
  Coachmark: function Coachmark(props: Record<string, unknown>) {
    coachmarkSpy(props)
    return <div data-testid="vendored-coachmark">{String(props.show)}</div>
  },
}))

describe('PostBuildEditNudge', function tests() {
  beforeEach(function setup() {
    vi.clearAllMocks()
  })

  it('passes nudge props to the vendored coachmark', function props() {
    const onClose = vi.fn()

    render(<PostBuildEditNudge show onClose={onClose} />)

    expect(screen.getByTestId('vendored-coachmark')).toHaveTextContent('true')
    expect(coachmarkSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        anchorId: 'tour-select-mode-button',
        title: 'builder_edit_nudge_title',
        description: 'builder_edit_nudge_description',
        show: true,
        onClose,
        currentStep: 1,
        totalSteps: 1,
        nextMessage: '',
        prevMessage: '',
        hideNavigation: true,
        disableBackdrop: true,
        compact: true,
      }),
    )
  })

  it('forwards hidden state to the vendored coachmark', function hidden() {
    render(<PostBuildEditNudge show={false} onClose={vi.fn()} />)

    expect(screen.getByTestId('vendored-coachmark')).toHaveTextContent('false')
  })
})
