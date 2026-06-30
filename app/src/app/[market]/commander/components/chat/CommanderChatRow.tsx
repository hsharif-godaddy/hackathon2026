'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import ChevronDownIcon from '@ux/icon/chevron-down'
import DesktopIcon from '@ux/icon/desktop'
import HistoryIcon from '@ux/icon/history'
import MobilePhoneIcon from '@ux/icon/mobile-phone'
import RefreshIcon from '@ux/icon/refresh'
import SidebarExpandIcon from '@ux/icon/sidebar-expand'
import TabletIcon from '@ux/icon/tablet'

import { CommanderPosition } from '@/app/[market]/commander/types'
import { DebugStatsToggleButton } from '@/app/[market]/develop/components/chat/DebugStatsDrawer'
import IconButton from '@/app/[market]/develop/components/IconButton'
import { ChatTab, PreviewViewMode, ViewMode } from '@/app/[market]/develop/components/types'
import AppItem from '@/components/layout/AppItem'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useTranslations } from '@/hooks/useTranslations'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/lib/shadcn/popover'
import {
  useCommanderActionsBarEnabled,
  useCommanderFloatModesEnabled,
  useCommanderStore,
} from '@/stores/useCommanderStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useSites } from '@/stores/useSitesStore'
import { logClickEvent } from '@/utils/instrumentation'

interface CommanderChatRowProps {
  appId: string | null
  onPreviewRefresh?: () => void
}

const VIEWPORT_ITEMS = [
  {
    value: PreviewViewMode.DESKTOP,
    icon: <DesktopIcon className="size-2.5" />,
    labelKey: 'builder_analytics_desktop_laptop',
    instrumentationId: 'desktop',
  },
  {
    value: PreviewViewMode.TABLET,
    icon: <TabletIcon className="size-2.5" />,
    labelKey: 'builder_analytics_tablet',
    instrumentationId: 'tablet',
  },
  {
    value: PreviewViewMode.MOBILE,
    icon: <MobilePhoneIcon className="size-2.5" />,
    labelKey: 'builder_analytics_mobile',
    instrumentationId: 'mobile',
  },
] as const

const PREVIEW_CONTROLS_TRANSITION = { duration: 0.35, ease: [0.4, 0, 0.2, 1] as const }

function getViewportIcon(mode: PreviewViewMode) {
  if (mode === PreviewViewMode.MOBILE) return <MobilePhoneIcon className="size-2.5" />
  if (mode === PreviewViewMode.TABLET) return <TabletIcon className="size-2.5" />
  return <DesktopIcon className="size-2.5" />
}

export default function CommanderChatRow({ appId, onPreviewRefresh }: CommanderChatRowProps) {
  const t = useTranslations()
  const clickContext = useMemo(() => (appId ? { appId } : undefined), [appId])

  const { setActiveChatTab } = useChatTabs()
  const viewMode = useDevelopPageStore((state) => state.viewMode)
  const isMobile = useDevelopPageStore((state) => state.isMobile)
  const isVersionHistoryOpen = useDevelopPageStore((state) => state.isVersionHistoryOpen)
  const previewViewMode = useDevelopPageStore((state) => state.previewViewMode)
  const setPreviewViewMode = useDevelopPageStore((state) => state.setPreviewViewMode)
  const currentSite = useDevelopPageStore((state) => state.site)
  const commanderPosition = useCommanderStore((state) => state.position)
  const setCommanderPosition = useCommanderStore((state) => state.setPosition)
  const isCanvasSettingsOpen = useCommanderStore((state) => state.isCanvasSettingsOpen)
  const floatModesEnabled = useCommanderFloatModesEnabled()
  const isActionsBarEnabled = useCommanderActionsBarEnabled()

  const { sites, isLoading: isLoadingSites, error: sitesError, requiresAuth: sitesRequireAuth } = useSites()

  const [projectsOpen, setProjectsOpen] = useState(false)
  const [viewportOpen, setViewportOpen] = useState(false)
  const [positionOpen, setPositionOpen] = useState(false)

  const currentProjectName = currentSite?.name || appId || ''
  const isPreviewMode =
    !isCanvasSettingsOpen && (viewMode === ViewMode.PREVIEW || viewMode === ViewMode.EDIT)

  const handleProjectSelect = (siteId: string) => {
    logClickEvent('commander.chat_row.project_select', {
      ...(clickContext ?? {}),
      targetAppId: siteId,
    })()
    setProjectsOpen(false)
    if (typeof window === 'undefined') return
    window.location.assign(`/commander/${siteId}`)
  }

  const handleViewportSelect = (mode: PreviewViewMode, instrumentationId: string) => {
    setPreviewViewMode(mode)
    setViewportOpen(false)
    logClickEvent(`commander.chat_row.viewport_${instrumentationId}`, clickContext)()
  }

  const handleHistoryClick = () => {
    logClickEvent('commander.chat_row.history', clickContext)()
    setActiveChatTab(ChatTab.HISTORY)
  }

  const handleRefreshClick = () => {
    if (!onPreviewRefresh) return
    onPreviewRefresh()
    logClickEvent('commander.chat_row.refresh', clickContext)()
  }

  const handlePositionSelect = (position: CommanderPosition) => {
    setCommanderPosition(position)
    setPositionOpen(false)
    logClickEvent(`commander.chat_row.position_${position}`, clickContext)()
  }

  const POSITION_ITEMS: ReadonlyArray<{ value: CommanderPosition; labelKey: string }> = [
    { value: CommanderPosition.LeftDock, labelKey: 'builder_commander_position_sidebar' },
    { value: CommanderPosition.Floating, labelKey: 'builder_commander_position_floating' },
  ]

  if (isMobile) return null

  return (
    <Box
      data-testid="commander-chat-row"
      orientation="horizontal"
      gap="sm"
      inlineAlignChildren="center"
      blockAlignChildren="spaceBetween"
      className="px-1.5 sm:px-3 md:px-0 py-0"
    >
      <Box orientation="horizontal" gap="sm" inlineAlignChildren="center">
        <Popover open={projectsOpen} onOpenChange={setProjectsOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="commander-chat-row-projects-trigger"
              data-eid="commander.chat_row.projects"
              aria-label={t('builder_commander_chat_row_projects')}
              onClick={() =>
                logClickEvent('commander.chat_row.projects', clickContext)()
              }
              className="flex items-center gap-0.5 px-1 py-0.5 rounded-md text-sm hover:bg-intents-ux-box-backgroundColor transition-colors"
            >
              <span className="truncate max-w-[120px]">{currentProjectName}</span>
              <ChevronDownIcon className="size-2 shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            className="z-50 w-[300px] max-h-80 overflow-y-auto p-1"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="flex flex-col gap-1">
              {isLoadingSites && sites.length === 0 ? (
                <div className="px-2 py-1 text-sm text-intents-ux-boxLowContrast-foregroundColor">
                  {t('builder_common_loading')}
                </div>
              ) : sitesRequireAuth ? (
                <div className="px-2 py-1 text-sm text-intents-ux-boxLowContrast-foregroundColor">
                  {t('builder_common_signin')}
                </div>
              ) : sitesError && sites.length === 0 ? (
                <div className="px-2 py-1 text-sm text-intents-ux-feedbackCritical-feedbackColor">
                  {sitesError}
                </div>
              ) : sites.length === 0 ? (
                <div className="px-2 py-1 text-sm text-intents-ux-boxLowContrast-foregroundColor">
                  {t('builder_apps_empty_state')}
                </div>
              ) : (
                sites.map((site) => (
                  <AppItem
                    key={site.id}
                    site={site}
                    dataEid="commander.chat_row.project_select"
                    onSelect={handleProjectSelect}
                  />
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        <AnimatePresence initial={false}>
          {isPreviewMode && !isActionsBarEnabled && (
            <motion.div
              key="commander-chat-row-preview-controls"
              className="flex items-center gap-0.5 overflow-hidden"
              initial={{ opacity: 0, x: -8, width: 0 }}
              animate={{ opacity: 1, x: 0, width: 'auto' }}
              exit={{ opacity: 0, x: -8, width: 0 }}
              transition={PREVIEW_CONTROLS_TRANSITION}
            >
              <Popover open={viewportOpen} onOpenChange={setViewportOpen}>
                <PopoverTrigger asChild>
                  <IconButton
                    icon={getViewportIcon(previewViewMode)}
                    label={t('builder_preview_button_device')}
                    showLabelWhenActive={false}
                    size="sm"
                    ghost
                    dataEid="commander.chat_row.viewport"
                    data-testid="commander-chat-row-viewport-trigger"
                    onClick={() =>
                      logClickEvent('commander.chat_row.viewport', clickContext)()
                    }
                  />
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="start"
                  className="z-50 w-max max-w-[320px] p-1"
                  onOpenAutoFocus={(e) => e.preventDefault()}
                >
                  <div className="flex flex-col gap-0.5">
                    {VIEWPORT_ITEMS.map((item) => (
                      <Button
                        key={item.value}
                        design="option"
                        size="sm"
                        active={previewViewMode === item.value}
                        icon={item.icon}
                        text={t(item.labelKey)}
                        className="!justify-start"
                        onClick={() => handleViewportSelect(item.value, item.instrumentationId)}
                      />
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              {onPreviewRefresh && (
                <IconButton
                  icon={<RefreshIcon className="size-2.5" />}
                  label={t('builder_preview_button_refresh')}
                  showLabelWhenActive={false}
                  size="sm"
                  ghost
                  disabled={isVersionHistoryOpen}
                  dataEid="commander.chat_row.refresh"
                  data-testid="commander-chat-row-refresh"
                  onClick={handleRefreshClick}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </Box>

      <Box orientation="horizontal" gap="sm" inlineAlignChildren="center">
        <DebugStatsToggleButton />
        <IconButton
          icon={<HistoryIcon className="size-2.5" />}
          onClick={handleHistoryClick}
          label={t('builder_chat_toolbar_button_history')}
          showLabelWhenActive={false}
          size="sm"
          ghost
          dataEid="commander.chat_row.history"
        />

        {floatModesEnabled && (
          <Popover open={positionOpen} onOpenChange={setPositionOpen}>
            <PopoverTrigger asChild>
              <IconButton
                icon={<SidebarExpandIcon className="size-2.5" />}
                label={t('builder_commander_chat_row_position')}
                showLabelWhenActive={false}
                size="sm"
                ghost
                dataEid="commander.chat_row.position"
                data-testid="commander-chat-row-position-toggle"
                onClick={() =>
                  logClickEvent('commander.chat_row.position', clickContext)()
                }
              />
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="end"
              className="z-50 w-max max-w-[220px] p-1"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <div className="flex flex-col gap-0.5 min-w-[160px]">
                {POSITION_ITEMS.map((item) => (
                  <Button
                    key={item.value}
                    design="option"
                    size="sm"
                    active={commanderPosition === item.value}
                    text={t(item.labelKey)}
                    className="!justify-start"
                    onClick={() => handlePositionSelect(item.value)}
                  />
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </Box>
    </Box>
  )
}
