'use client'

import './commander-mobile-scroll.css'

import { motion } from 'framer-motion'
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'

import { CommanderCanvasActionProvider } from '@/app/[market]/commander/canvas/CommanderCanvasActionContext'
import { CANVAS_REGISTRY, CanvasId } from '@/app/[market]/commander/canvas/registry'
import { useCanvasSync } from '@/app/[market]/commander/canvas/useCanvasSync'
import CanvasActionsDock from '@/app/[market]/commander/components/chat/CanvasActionsDock'
import { CommanderPosition } from '@/app/[market]/commander/types'
import AutomationsPanel from '@/app/[market]/develop/components/automations/AutomationsPanel'
import ShareAccess from '@/app/[market]/develop/components/layout/ShareAccess'
import BrandBookView from '@/app/[market]/develop/components/preview/brand-book'
import { DesignKitPanels } from '@/app/[market]/develop/components/preview/design-kit-wizard/DesignKitPanels'
import { useIsDesignKitWizardProfile } from '@/app/[market]/develop/components/preview/design-kit-wizard/isDesignKitWizardProfile'
import { ViewMode } from '@/app/[market]/develop/components/types'
import { useTranslations } from '@/hooks/useTranslations'
import { useCommanderActionsBarEnabled,
  useCommanderCanvasEnabled,
  useCommanderCanvasTabsEnabled,
  useCommanderStore,
  useEffectiveCommanderPosition,
} from '@/stores/useCommanderStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { Commander, COMMANDER_LAYOUT_METRICS } from './Commander'
import { CommanderCanvasSettingsOverlay } from './CommanderCanvasSettingsOverlay'
import CommanderHeader from './CommanderHeader'
import CommanderHeaderMobile from './CommanderHeaderMobile'
import { CommanderMobileBar } from './CommanderMobileBar'
import {
  COMMANDER_MOBILE_BAR_RESERVE_VAR,
  COMMANDER_MOBILE_CANVAS_ATTR,
  commanderMobileScrollRootProps,
} from './commanderMobileScroll'

interface CommanderShellProps {
  appId: string | null
  isMobile: boolean
  chatPaneNode: ReactNode
  previewPaneNode: ReactNode
  onPreviewRefresh?: () => void
  isCanvasLoading?: boolean
}

const RIGHT_SIDE_TRANSITION = { duration: 0.3, ease: [0.4, 0, 0.2, 1] as const }

export function CommanderShell({
  appId,
  isMobile,
  chatPaneNode,
  previewPaneNode,
  onPreviewRefresh,
  isCanvasLoading,
}: CommanderShellProps) {
  const position = useEffectiveCommanderPosition()
  const isLeftDock = position === CommanderPosition.LeftDock
  const isActionsBarEnabled = useCommanderActionsBarEnabled()
  const isPreviewReady = useServerPollingStore((state) =>
    appId ? state.getServerState(appId)?.isReady === true : false,
  )
  const isCanvasEnabled = useCommanderCanvasEnabled()
  const isCanvasTabsEnabled = useCommanderCanvasTabsEnabled()
  const viewMode = useDevelopPageStore((state) => state.viewMode)
  const activeCanvasId = useCommanderStore((state) => state.activeCanvasId)
  const isCanvasSettingsOpen = useCommanderStore((state) => state.isCanvasSettingsOpen)
  const isMobileChatOpen = useCommanderStore((state) => state.isMobileChatOpen)
  const closeMobileChat = useCommanderStore((state) => state.closeMobileChat)
  const t = useTranslations()
  const activeCanvasDescriptor = CANVAS_REGISTRY[activeCanvasId]
  const backLabel: string = t(activeCanvasDescriptor.labelKey) || activeCanvasDescriptor.fallbackLabel
  useCanvasSync()

  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const [canvasWidth, setCanvasWidth] = useState(0)
  const [mobileChatAutoOpenedQuestion, setMobileChatAutoOpenedQuestion] = useState<string | null>(null)
  useEffect(() => {
    const el = canvasAreaRef.current
    if (!el) return
    const measure = (): void => setCanvasWidth(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [isMobile])

  // In canvas-tabs mode the active canvas drives what's visible in the right pane,
  // so Brand only paints when it IS the active tab — closing Brand or moving focus to a
  // settings canvas drops it. Legacy (no canvas tabs) still keys off viewMode and yields
  // to the legacy canvas-settings sheet.
  const isBrandActive = isCanvasTabsEnabled
    ? activeCanvasId === CanvasId.Brand
    : viewMode === ViewMode.BRAND && !isCanvasSettingsOpen

  const isAutomationsActive = isCanvasTabsEnabled
    ? activeCanvasId === CanvasId.Automations
    : viewMode === ViewMode.AUTOMATIONS

  // The design-kit wizard runs in its own Immersive BuilderLayout (AIROBUILD-3095);
  // once the builder takes over, the Brand canvas content is gated by flow
  // (AIROBUILD-2075): the design-kit flow gets the editable Brand Design Kit (the
  // customer's surface to manually adjust their kit); every other app keeps the
  // read-only Brand Book.
  const isDesignKitProfile = useIsDesignKitWizardProfile()
  const brandOverlayContent = appId && (isDesignKitProfile ? <DesignKitPanels appId={appId} /> : <BrandBookView appId={appId} />)

  if (isMobile) {
    return (
      <CommanderCanvasActionProvider onPreviewRefresh={onPreviewRefresh}>
        <CommanderHeaderMobile onBack={isMobileChatOpen ? closeMobileChat : undefined} backLabel={backLabel} />
        <div className="relative flex-1 min-h-0">
          <div
            className="absolute inset-0 flex flex-col isolate"
            {...(!isMobileChatOpen
              ? {
                  [COMMANDER_MOBILE_CANVAS_ATTR]: '',
                  style: {
                    [COMMANDER_MOBILE_BAR_RESERVE_VAR]: `${COMMANDER_LAYOUT_METRICS.MOBILE_BAR_RESERVE}px`,
                  } as CSSProperties,
                }
              : undefined)}
          >
            {previewPaneNode}
            {isBrandActive && brandOverlayContent && (
              <div className="absolute inset-0 z-20 overflow-hidden" data-testid="brand-book-overlay">
                {brandOverlayContent}
              </div>
            )}
            {isAutomationsActive && (
              <div className="absolute inset-0 z-20 overflow-hidden" data-testid="automations-overlay">
                <div className="h-full flex flex-col pr-1 pl-1">
                  <div
                    className="relative h-full overflow-auto rounded-lg border bg-intents-ux-box-backgroundColor"
                    {...commanderMobileScrollRootProps}
                  >
                    <AutomationsPanel />
                  </div>
                </div>
              </div>
            )}
            <CommanderCanvasSettingsOverlay edgeToEdge />
          </div>
          {isMobileChatOpen && <Commander appId={appId} chatPane={chatPaneNode} isMobile />}
          {!isMobileChatOpen && (
            <CommanderMobileBar
              mobileChatAutoOpenedQuestion={mobileChatAutoOpenedQuestion}
              onMobileChatAutoOpened={setMobileChatAutoOpenedQuestion}
            />
          )}
        </div>
        <ShareAccess />
      </CommanderCanvasActionProvider>
    )
  }

  const rightSideLeftEdge = isLeftDock ? COMMANDER_LAYOUT_METRICS.LEFT_DOCK_WIDTH + 8 : 0

  return (
    <CommanderCanvasActionProvider onPreviewRefresh={onPreviewRefresh}>
      <motion.div
        className="absolute top-0 end-0 bottom-0 flex flex-col"
        initial={false}
        animate={{ insetInlineStart: rightSideLeftEdge }}
        transition={RIGHT_SIDE_TRANSITION}
      >
        <CommanderHeader />
        <div ref={canvasAreaRef} className="relative flex-1 min-h-0 overflow-hidden">
          <div id="preview-pane-container" className="absolute inset-0 flex flex-col isolate [&>div]:pe-1!">
            {previewPaneNode}
          </div>
          {isBrandActive && brandOverlayContent && (
            <div
              className={
                isCanvasTabsEnabled
                  ? 'absolute top-0 bottom-0 right-1 left-1 rounded-t-lg overflow-hidden shadow-lg'
                  : 'absolute inset-0 z-20 overflow-hidden rounded-lg md:rounded-b-none'
              }
              data-testid="brand-book-overlay"
            >
              {brandOverlayContent}
            </div>
          )}
          {isAutomationsActive && (
            <div
              className={
                isCanvasTabsEnabled
                  ? 'absolute top-0 bottom-0 right-1 left-1 rounded-t-lg overflow-hidden shadow-lg'
                  : 'absolute inset-0 z-20 overflow-hidden rounded-lg md:rounded-b-none'
              }
              data-testid="automations-overlay"
            >
              <div className="h-full flex flex-col pr-1 pl-1">
                <div className="relative h-full overflow-auto rounded-lg border bg-intents-ux-box-backgroundColor">
                  <AutomationsPanel />
                </div>
              </div>
            </div>
          )}
          {isCanvasEnabled && <CommanderCanvasSettingsOverlay />}
          {isActionsBarEnabled && (
            <CanvasActionsDock
              canvasWidth={canvasWidth}
              isReady={isPreviewReady}
              isLoading={isCanvasLoading === true}
            />
          )}
        </div>
      </motion.div>

      {/* Commander needs to be after content to ensure it's on top of the content while breaking z-index rules */}
      <Commander appId={appId} chatPane={chatPaneNode} />
      <ShareAccess />
    </CommanderCanvasActionProvider>
  )
}
