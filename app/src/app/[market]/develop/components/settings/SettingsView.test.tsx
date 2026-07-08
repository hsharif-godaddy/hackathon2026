/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

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
    return true
  },
}))

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, _values?: unknown, fallback?: string) => fallback || key,
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

vi.mock('@/app/[market]/develop/components/settings/ProjectPanel', () => ({
  default: () => <div data-testid="project-panel-mock">ProjectPanel</div>,
}))

let mockActiveSection: SettingsSection = SettingsSection.PROJECT

describe('SettingsView', () => {
  it('renders ProjectPanel when section is PROJECT', async () => {
    mockActiveSection = SettingsSection.PROJECT
    mockSwitchboardResults['appbuilder-settings-project'] = true

    const { default: SettingsView } = await import('./SettingsView')
    render(<SettingsView />)

    expect(await screen.findByTestId('project-panel-mock')).toBeInTheDocument()
  })

  it('falls through to ProjectPanel (default) when section is TEAM', async () => {
    mockActiveSection = SettingsSection.TEAM
    mockSwitchboardResults['appbuilder-settings-project'] = true

    const { default: SettingsView } = await import('./SettingsView')
    render(<SettingsView />)

    expect(await screen.findByTestId('project-panel-mock')).toBeInTheDocument()
  })
})
