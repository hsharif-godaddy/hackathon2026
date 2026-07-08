'use client'

import dynamic from 'next/dynamic'
import { type ComponentType, useMemo } from 'react'

import PanelSkeleton from '@/app/[market]/develop/components/PanelSkeleton'
import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState'
import { ChatTab, SettingsSection } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import ErrorBoundary from '@/components/ErrorBoundary'
import { CANVAS_REGISTRY, CanvasId } from './registry'

const CommercePanel = dynamic(
  () => import('@/app/[market]/develop/components/settings/Commerce/CommercePanel').then((m) => ({ default: m.CommercePanel })),
  { loading: () => <PanelSkeleton panelType={ChatTab.SETTINGS} settingsSection={SettingsSection.COMMERCE} /> },
)
const DatabasePanel = dynamic(
  () => import('@/app/[market]/develop/components/settings/Database/DatabasePanel').then((m) => ({ default: m.DatabasePanel })),
  { loading: () => <PanelSkeleton panelType={ChatTab.SETTINGS} settingsSection={SettingsSection.DATABASE} /> },
)
const ProjectPanel = dynamic(() => import('@/app/[market]/develop/components/settings/ProjectPanel'), {
  loading: () => <PanelSkeleton panelType={ChatTab.SETTINGS} settingsSection={SettingsSection.PROJECT} />,
})
const SecretsPanel = dynamic(
  () => import('@/app/[market]/develop/components/settings/SecretsPanel').then((m) => ({ default: m.SecretsPanel })),
  { loading: () => <PanelSkeleton panelType={ChatTab.SETTINGS} settingsSection={SettingsSection.SECRETS} /> },
)
const BackupsPanel = dynamic(() => import('@/app/[market]/develop/components/settings/BackupsPanel'), {
  loading: () => <SettingsLoadingState fullPage />,
})
const SecurityPanel = dynamic(() => import('@/app/[market]/develop/components/settings/SecurityPanel'), {
  loading: () => <PanelSkeleton />,
})
const SocialPanel = dynamic(() => import('@/app/[market]/develop/components/settings/social/SocialPanel'), {
  loading: () => <PanelSkeleton />,
})
const GitHubPanel = dynamic(() => import('@/app/[market]/develop/components/settings/GitHubPanel'), {
  loading: () => <PanelSkeleton />,
})
const VisualScanPanel = dynamic(() => import('@/app/[market]/develop/components/settings/VisualScanPanel'), {
  loading: () => <PanelSkeleton />,
})
const AnalyticsPanel = dynamic(() => import('@/app/[market]/develop/components/settings/Analytics/AnalyticsPanel'), {
  loading: () => <SettingsLoadingState fullPage />,
})
const SsoPanel = dynamic(() => import('@/app/[market]/develop/components/settings/SsoPanel'), {
  loading: () => <PanelSkeleton />,
})

interface SettingsCanvasEntry {
  canvasId: CanvasId
  section: SettingsSection
  Component: ComponentType<{ appId: string | null }>
}

const SETTINGS_CANVAS_TO_SECTION: Partial<Record<CanvasId, SettingsSection>> = {
  [CanvasId.SettingsProject]: SettingsSection.PROJECT,
  [CanvasId.SettingsAnalytics]: SettingsSection.ANALYTICS,
  [CanvasId.SettingsBackups]: SettingsSection.BACKUPS,
  [CanvasId.SettingsDatabase]: SettingsSection.DATABASE,
  [CanvasId.SettingsSecurity]: SettingsSection.SECURITY,
  [CanvasId.SettingsSecrets]: SettingsSection.SECRETS,
  [CanvasId.SettingsSocial]: SettingsSection.SOCIAL,
  [CanvasId.SettingsSso]: SettingsSection.SSO,
  [CanvasId.SettingsVisualScan]: SettingsSection.VISUAL_SCAN,
  [CanvasId.SettingsGitHub]: SettingsSection.GITHUB,
  [CanvasId.SettingsCommerce]: SettingsSection.COMMERCE,
}

const SECTION_TO_COMPONENT: Partial<Record<SettingsSection, ComponentType<{ appId: string | null }>>> = {
  [SettingsSection.PROJECT]: () => <ProjectPanel />,
  [SettingsSection.BACKUPS]: () => <BackupsPanel />,
  [SettingsSection.SECURITY]: () => <SecurityPanel />,
  [SettingsSection.DATABASE]: ({ appId }) => <DatabasePanel appId={appId} />,
  [SettingsSection.SECRETS]: ({ appId }) => <SecretsPanel appId={appId} variant="preview" />,
  [SettingsSection.SOCIAL]: ({ appId }) => <SocialPanel siteId={appId} />,
  [SettingsSection.VISUAL_SCAN]: () => <VisualScanPanel />,
  [SettingsSection.ANALYTICS]: () => <AnalyticsPanel />,
  [SettingsSection.GITHUB]: () => <GitHubPanel />,
  [SettingsSection.SSO]: () => <SsoPanel />,
  [SettingsSection.COMMERCE]: ({appId}) => <CommercePanel appId={appId}/>,

}

interface CommanderSettingsCanvasStackProps {
  /** Canvas ids currently open (filtered to settings canvases inside). */
  openCanvasIds: readonly CanvasId[]
  /** The active canvas id; used to decide which panel is visible. */
  activeCanvasId: CanvasId
}

export function CommanderSettingsCanvasStack({
  openCanvasIds,
  activeCanvasId,
}: CommanderSettingsCanvasStackProps) {
  const appId = useAppIdFromParams()

  const entries = useMemo<SettingsCanvasEntry[]>(() => {
    return openCanvasIds
      .map((canvasId) => {
        const section = SETTINGS_CANVAS_TO_SECTION[canvasId]
        if (!section) return null
        const Component = SECTION_TO_COMPONENT[section]
        if (!Component) return null
        if (!CANVAS_REGISTRY[canvasId]) return null
        return { canvasId, section, Component }
      })
      .filter((e): e is SettingsCanvasEntry => Boolean(e))
  }, [openCanvasIds])

  const activeEntry = entries.find(({ canvasId }) => canvasId === activeCanvasId)
  if (!activeEntry) return null

  const { canvasId, Component } = activeEntry
  return (
    <div key={canvasId} className="h-full overflow-y-auto w-full px-1.5 pb-2 md:px-0.5 md:max-w-7xl mx-auto">
      <ErrorBoundary>
        <Component appId={appId} />
      </ErrorBoundary>
    </div>
  )
}
