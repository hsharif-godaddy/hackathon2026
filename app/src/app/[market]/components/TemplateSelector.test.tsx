/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'

import TemplateSelector from '@/app/[market]/components/TemplateSelector'
import { LOGO_DESIGNER_TEMPLATE } from '@/app/[market]/components/types'
import { renderWithProviders } from '@/tests/test-utils'

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: (id: string) => id,
  logClickEvent: vi.fn(function () { return vi.fn() }),
}))

const mockLogLogoDesignerEntry = vi.hoisted(() => vi.fn())
vi.mock('@/lib/logo-designer-entry', () => ({
  logLogoDesignerEntry: mockLogLogoDesignerEntry,
}))

// Expose only the modal's open state so the deep-build branch is assertable
// without pulling in the real @ux/modal animation surface.
vi.mock('@/app/[market]/components/DeepBuildIntroModal', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="deep-build-modal" /> : null,
}))

// The @ux/chip data-testid lands on the wrapper; the interactive element is the
// checkbox inside it, so a click on the wrapper does not fire onSelect.
function clickChip(templateId: string): HTMLElement {
  return within(screen.getByTestId(`template-chip-${templateId}`)).getByRole('checkbox')
}

describe('TemplateSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logs a chip entry when transitioning into logo-designer from another template', async () => {
    const onTemplateChange = vi.fn()
    const { user } = renderWithProviders(
      <TemplateSelector selectedTemplate="default" onTemplateChange={onTemplateChange} />,
    )

    await user.click(clickChip(LOGO_DESIGNER_TEMPLATE))

    expect(mockLogLogoDesignerEntry).toHaveBeenCalledTimes(1)
    expect(mockLogLogoDesignerEntry).toHaveBeenCalledWith('chip')
    expect(onTemplateChange).toHaveBeenCalledWith(LOGO_DESIGNER_TEMPLATE)
  })

  it('does not log when the logo-designer chip is already selected (re-selection)', async () => {
    const { user } = renderWithProviders(
      <TemplateSelector selectedTemplate={LOGO_DESIGNER_TEMPLATE} onTemplateChange={vi.fn()} />,
    )

    await user.click(clickChip(LOGO_DESIGNER_TEMPLATE))

    expect(mockLogLogoDesignerEntry).not.toHaveBeenCalled()
  })

  it('does not log when a non-logo chip is clicked', async () => {
    const onTemplateChange = vi.fn()
    const { user } = renderWithProviders(
      <TemplateSelector selectedTemplate="default" onTemplateChange={onTemplateChange} />,
    )

    await user.click(clickChip('business-plan'))

    expect(mockLogLogoDesignerEntry).not.toHaveBeenCalled()
    expect(onTemplateChange).toHaveBeenCalledWith('business-plan')
  })

  it('opens the deep-build modal without logging an entry or changing the template', async () => {
    const onTemplateChange = vi.fn()
    const { user } = renderWithProviders(
      <TemplateSelector selectedTemplate="default" onTemplateChange={onTemplateChange} />,
    )

    await user.click(clickChip('deep-build'))

    expect(screen.getByTestId('deep-build-modal')).toBeInTheDocument()
    expect(mockLogLogoDesignerEntry).not.toHaveBeenCalled()
    expect(onTemplateChange).not.toHaveBeenCalled()
  })
})
