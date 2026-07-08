/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { forwardRef, type ReactNode, type Ref } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'

import { SettingsSection } from '@/app/[market]/develop/components/types'
import { renderWithProviders } from '@/tests/test-utils'
import { CommanderCanvasMenu } from './CommanderCanvasMenu'

vi.mock('@/lib/shadcn/popover', () => ({
  Popover: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@ux/button', () => ({
  default: forwardRef(function MockButton(
    {
      icon,
      text,
      onClick,
      ...rest
    }: { icon?: ReactNode; text?: ReactNode; onClick?: () => void; [key: string]: unknown },
    ref: Ref<HTMLButtonElement>,
  ) {
    return (
      <button ref={ref} type="button" onClick={onClick} {...rest}>
        {icon}
        {text}
      </button>
    )
  }),
}))

vi.mock('@ux/icon/graph', () => ({
  default: function GraphIcon(): ReactNode {
    return <svg data-testid="graph-icon" />
  },
}))

vi.mock('@ux/icon/plus', () => ({
  default: function PlusIcon(): ReactNode {
    return <svg data-testid="plus-icon" />
  },
}))

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: () => 'app-123',
}))

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => false,
}))

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: () => () => {},
}))

const mockDevelopStore = {
  setActiveSettingsSection: vi.fn(),
}

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopStore),
}))

const mockCommanderStore = {
  openCanvasSettings: vi.fn(),
}

vi.mock('@/stores/useCommanderStore', () => ({
  useCommanderStore: (selector: any) => selector(mockCommanderStore),
}))

const mockCampaignHook = {
  openList: vi.fn(),
  openDetail: vi.fn(),
  isEnabled: true,
}

vi.mock('@/app/[market]/develop/components/settings/Campaigns/useOpenMarketingCampaign', () => ({
  useOpenMarketingCampaign: () => mockCampaignHook,
}))

describe('CommanderCanvasMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls item.onClick directly and skips settings-canvas activation when item has onClick', () => {
    renderWithProviders(<CommanderCanvasMenu />)

    fireEvent.click(screen.getByTestId(`commander-canvas-menu-${SettingsSection.MARKETING}`))

    expect(mockCampaignHook.openList).toHaveBeenCalled()
    expect(mockDevelopStore.setActiveSettingsSection).not.toHaveBeenCalled()
    expect(mockCommanderStore.openCanvasSettings).not.toHaveBeenCalled()
  })

  it('activates the settings canvas section when item has no onClick', () => {
    renderWithProviders(<CommanderCanvasMenu />)

    fireEvent.click(screen.getByTestId(`commander-canvas-menu-${SettingsSection.DATABASE}`))

    expect(mockDevelopStore.setActiveSettingsSection).toHaveBeenCalledWith(SettingsSection.DATABASE)
    expect(mockCommanderStore.openCanvasSettings).toHaveBeenCalled()
    expect(mockCampaignHook.openList).not.toHaveBeenCalled()
  })
})
