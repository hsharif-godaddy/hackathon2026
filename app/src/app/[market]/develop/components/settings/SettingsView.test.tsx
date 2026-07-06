/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SettingsSection } from '@/app/[market]/develop/components/types'

const mockSetActiveSettingsSection = vi.fn()

vi.mock('@/hooks/useChatTabs', () => ({
  useChatTabs: () => ({
    activeSettingsSection: mockActiveSection,
    setActiveSettingsSection: mockSetActiveSettingsSection,
  }),
}))

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: () => 'test-app-id',
}))

vi.mock('@/hooks/useSeoSettingsEnabled', () => ({
  useSeoSettingsEnabled: () => false,
}))

const mockSwitchboardResults: Record<string, boolean | undefined> = {}

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (feature: string) => {
    if (feature in mockSwitchboardResults) return mockSwitchboardResults[feature]
    return false
  },
}))

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, _values?: unknown, fallback?: string) => fallback || key,
}))

vi.mock('@/app/[market]/develop/components/settings/TeamPanel', () => ({
  default: () => <div data-testid="team-panel-mock">TeamPanel</div>,
}))

vi.mock('@/app/[market]/develop/components/PanelSkeleton', () => ({
  default: () => <div data-testid="panel-skeleton">Loading...</div>,
}))

vi.mock('@/app/[market]/develop/components/settings/components/SettingsLoadingState', () => ({
  SettingsLoadingState: () => <div data-testid="settings-loading">Loading...</div>,
}))

vi.mock('@/app/[market]/develop/components/settings/GitHubPanel/GitHubSyncSettingsSavedSnackbar', () => ({
  default: () => null,
}))

let mockActiveSection: SettingsSection = SettingsSection.TEAM

describe('SettingsView — TEAM section', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActiveSection = SettingsSection.TEAM
    for (const key of Object.keys(mockSwitchboardResults)) {
      delete mockSwitchboardResults[key]
    }
    document.body.classList.remove('share-access-open')
  })

  it('renders TeamPanel when aab-multi-user is enabled and section is TEAM', async () => {
    mockSwitchboardResults['aab-multi-user'] = true

    const { default: SettingsView } = await import('./SettingsView')
    render(<SettingsView />)

    expect(await screen.findByTestId('team-panel-mock')).toBeInTheDocument()
  })

  it('renders skeleton when aab-multi-user is undefined (loading)', async () => {
    mockSwitchboardResults['aab-multi-user'] = undefined

    const { default: SettingsView } = await import('./SettingsView')
    render(<SettingsView />)

    expect(screen.getByTestId('panel-skeleton')).toBeInTheDocument()
    expect(screen.queryByTestId('team-panel-mock')).not.toBeInTheDocument()
  })

  it('renders nothing when aab-multi-user is false', async () => {
    mockSwitchboardResults['aab-multi-user'] = false

    const { default: SettingsView } = await import('./SettingsView')
    render(<SettingsView />)

    expect(screen.queryByTestId('team-panel-mock')).not.toBeInTheDocument()
    expect(screen.queryByTestId('panel-skeleton')).not.toBeInTheDocument()
  })

  it('portals a back button to document.body when TEAM is active', async () => {
    mockSwitchboardResults['aab-multi-user'] = true

    const { default: SettingsView } = await import('./SettingsView')
    render(<SettingsView />)

    const backButton = screen.getByTestId('team-panel-back')
    expect(backButton).toBeInTheDocument()
    expect(backButton.parentElement).toBe(document.body)
  })

  it('back button navigates to PROJECT section', async () => {
    mockSwitchboardResults['aab-multi-user'] = true

    const { default: SettingsView } = await import('./SettingsView')
    render(<SettingsView />)

    const backButton = screen.getByTestId('team-panel-back')
    await act(async () => {
      await userEvent.click(backButton)
    })

    expect(mockSetActiveSettingsSection).toHaveBeenCalledWith(SettingsSection.PROJECT)
  })

  it('adds share-access-open class to body on mount', async () => {
    mockSwitchboardResults['aab-multi-user'] = true

    const { default: SettingsView } = await import('./SettingsView')
    const { unmount } = render(<SettingsView />)

    expect(document.body.classList.contains('share-access-open')).toBe(true)

    unmount()

    expect(document.body.classList.contains('share-access-open')).toBe(false)
  })
})
