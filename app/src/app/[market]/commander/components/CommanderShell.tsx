'use client'

import { motion } from 'framer-motion'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { CommanderCanvasActionProvider } from '@/app/[market]/commander/canvas/CommanderCanvasActionContext'
import { CanvasId } from '@/app/[market]/commander/canvas/registry'
import { useCanvasSync } from '@/app/[market]/commander/canvas/useCanvasSync'
import CanvasActionsDock from '@/app/[market]/commander/components/chat/CanvasActionsDock'
import { CommanderPosition } from '@/app/[market]/commander/types'
import BrandBookView from '@/app/[market]/develop/components/preview/brand-book'
import { ViewMode } from '@/app/[market]/develop/components/types'
import {
  useCommanderActionsBarEnabled,
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
  useCanvasSync()

  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const [canvasWidth, setCanvasWidth] = useState(0)
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

  // The design-kit wizard runs in its own Immersive BuilderLayout (AIROBUILD-3095);
  // once the builder takes over, the Brand canvas shows the Brand Book like any app.
  const brandOverlayContent = appId && <BrandBookView appId={appId} />

  if (isMobile) {
    return (
      <CommanderCanvasActionProvider onPreviewRefresh={onPreviewRefresh}>
        <CommanderHeaderMobile onBack={isMobileChatOpen ? closeMobileChat : undefined} />
        <div className="relative flex-1 min-h-0">
          <div
            className="absolute inset-0 flex flex-col transition-opacity duration-150 isolate"
            style={{
              opacity: isMobileChatOpen ? 0 : 1,
              pointerEvents: isMobileChatOpen ? 'none' : 'auto',
              willChange: 'opacity',
            }}
          >
            {previewPaneNode}
            {isBrandActive && brandOverlayContent && (
              <div className="absolute inset-0 z-20 overflow-hidden" data-testid="brand-book-overlay">
                {brandOverlayContent}
              </div>
            )}
            <CommanderCanvasSettingsOverlay edgeToEdge />
          </div>
          <div
            className="absolute inset-0 flex flex-col transition-opacity duration-150"
            style={{
              opacity: isMobileChatOpen ? 1 : 0,
              pointerEvents: isMobileChatOpen ? 'auto' : 'none',
              willChange: 'opacity',
            }}
          >
            {chatPaneNode}
          </div>
          {!isMobileChatOpen && <CommanderMobileBar />}
        </div>
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
    </CommanderCanvasActionProvider>
  )
}
