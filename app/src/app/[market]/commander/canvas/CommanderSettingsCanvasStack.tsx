'use client'

import clsx from 'clsx'
import dynamic from 'next/dynamic'
import { type ComponentType, useMemo } from 'react'

import PanelSkeleton from '@/app/[market]/develop/components/PanelSkeleton'
import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState'
import { ChatTab, SettingsSection } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import ErrorBoundary from '@/components/ErrorBoundary'
import { CANVAS_REGISTRY, CanvasId } from './registry'

const DatabasePanel = dynamic(
  () => import('@/app/[market]/develop/components/settings/Database/DatabasePanel').then((m) => ({ default: m.DatabasePanel })),
  { loading: () => <PanelSkeleton panelType={ChatTab.SETTINGS} settingsSection={SettingsSection.DATABASE} /> },
)
const DomainPanel = dynamic(() => import('@/app/[market]/develop/components/settings/DomainPanel'), {
  loading: () => <PanelSkeleton panelType={ChatTab.SETTINGS} settingsSection={SettingsSection.DOMAIN} />,
})
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
const MarketingPanel = dynamic(() => import('@/app/[market]/develop/components/settings/MarketingPanel'), {
  loading: () => <SettingsLoadingState fullPage />,
})
const CampaignsPanel = dynamic(() => import('@/app/[market]/develop/components/settings/CampaignsPanel'), {
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

interface SettingsCanvasEntry {
  canvasId: CanvasId
  section: SettingsSection
  Component: ComponentType<{ appId: string | null }>
}

const SETTINGS_CANVAS_TO_SECTION: Partial<Record<CanvasId, SettingsSection>> = {
  [CanvasId.SettingsProject]: SettingsSection.PROJECT,
  [CanvasId.SettingsDomain]: SettingsSection.DOMAIN,
  [CanvasId.SettingsBackups]: SettingsSection.BACKUPS,
  [CanvasId.SettingsSecurity]: SettingsSection.SECURITY,
  [CanvasId.SettingsDatabase]: SettingsSection.DATABASE,
  [CanvasId.SettingsSecrets]: SettingsSection.SECRETS,
  [CanvasId.SettingsSocial]: SettingsSection.SOCIAL,
  [CanvasId.SettingsVisualScan]: SettingsSection.VISUAL_SCAN,
  [CanvasId.SettingsAnalytics]: SettingsSection.ANALYTICS,
  [CanvasId.SettingsMarketing]: SettingsSection.MARKETING,
  [CanvasId.SettingsCampaigns]: SettingsSection.CAMPAIGNS,
  [CanvasId.SettingsGitHub]: SettingsSection.GITHUB,
}

const SECTION_TO_COMPONENT: Partial<Record<SettingsSection, ComponentType<{ appId: string | null }>>> = {
  [SettingsSection.PROJECT]: () => <ProjectPanel />,
  [SettingsSection.DOMAIN]: () => <DomainPanel />,
  [SettingsSection.BACKUPS]: () => <BackupsPanel />,
  [SettingsSection.SECURITY]: () => <SecurityPanel />,
  [SettingsSection.DATABASE]: ({ appId }) => <DatabasePanel appId={appId} />,
  [SettingsSection.SECRETS]: ({ appId }) => <SecretsPanel appId={appId} variant="preview" />,
  [SettingsSection.SOCIAL]: ({ appId }) => <SocialPanel siteId={appId} />,
  [SettingsSection.VISUAL_SCAN]: () => <VisualScanPanel />,
  [SettingsSection.ANALYTICS]: () => <AnalyticsPanel />,
  [SettingsSection.MARKETING]: () => <MarketingPanel />,
  [SettingsSection.CAMPAIGNS]: () => <CampaignsPanel />,
  [SettingsSection.GITHUB]: () => <GitHubPanel />,
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

  if (entries.length === 0) return null

  return (
    <div className="relative h-full w-full">
      {entries.map(({ canvasId, Component }) => {
        const isActive = canvasId === activeCanvasId
        return (
          <div
            key={canvasId}
            aria-hidden={!isActive}
            inert={!isActive || undefined}
            className={clsx(
              'absolute inset-0 h-full overflow-y-auto w-full px-1.5 pb-2 md:px-0.5 md:max-w-7xl mx-auto',
              'transition-opacity duration-150 ease-out',
              isActive ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
            )}
          >
            <ErrorBoundary>
              <Component appId={appId} />
            </ErrorBoundary>
          </div>
        )
      })}
    </div>
  )
}
