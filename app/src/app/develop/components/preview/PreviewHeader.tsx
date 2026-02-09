import clsx from 'clsx'
import CodeIcon from '@ux/icon/code'
import EditIcon from '@ux/icon/edit'
import RefreshIcon from '@ux/icon/refresh'
import SidebarCollapseIcon from '@ux/icon/sidebar-collapse'
import SidebarExpandIcon from '@ux/icon/sidebar-expand'
import WebsiteFilledIcon from '@ux/icon/website-filled'
import WindowNewIcon from '@ux/icon/window-new'

import IconButton from '@/app/develop/components/IconButton'
import DeviceSelector from '@/app/develop/components/preview/DeviceSelector'
import { ViewMode } from '@/app/develop/components/types'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { useTranslations } from '@/hooks/useTranslations'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { generateClickEID, logAiroHQEvent } from '@/utils/instrumentation'

export default function PreviewHeader({ onPreviewRefresh, isMobile = false }) {
  const t = useTranslations();
  const appId = useAppIdFromParams()

  const viewMode = useDevelopPageStore((state) => state.viewMode)
  const isRestarting = useDevelopPageStore((state) => state.isRestarting)
  const hasUnsavedChanges = useDevelopPageStore((state) => state.hasUnsavedChanges)
  const isSelectMode = useDevelopPageStore((state) => state.isSelectMode)
  const isChatPaneCollapsed = useDevelopPageStore((state) => state.isChatPaneCollapsed)
  const isVersionHistoryOpen = useDevelopPageStore((state) => state.isVersionHistoryOpen)
  const site = useDevelopPageStore((state) => state.site)
  const handleViewModeChange = useDevelopPageStore((state) => state.handleViewModeChange)
  const setIsSelectMode = useDevelopPageStore((state) => state.setIsSelectMode)
  const toggleSelectMode = useDevelopPageStore((state) => state.toggleSelectMode)
  const toggleChatPaneCollapse = useDevelopPageStore((state) => state.toggleChatPaneCollapse)
  const openFeedbackModal = useDevelopPageStore((state) => state.openFeedbackModal)

  const getServerState = useServerPollingStore((state) => state.getServerState)
  const serverState = getServerState(appId)
  const actualPort = serverState?.port
  const serverUrl = serverState?.url

  const DomainButton = () => {
    return (
      <div
        className="grow mx-3 pl-2 flex justify-between items-center border rounded-xl h-full leading-none text-left bg-intents-ux-box-backgroundColor"
      >
        {site?.name && <span className="truncate max-w-[200px]">{site.name}</span>}
      </div>
    )
  }

  return (
    <header className={clsx(
      "flex items-center w-full gap-0.5", {
        "pb-1.5 pr-1": !isMobile,
        "p-2": isMobile
      }
    )}>
      {!isMobile && (
        <IconButton
          icon={isChatPaneCollapsed ? <SidebarExpandIcon /> : <SidebarCollapseIcon />}
          onClick={toggleChatPaneCollapse}
          separator
          label={isChatPaneCollapsed ? t('builder_preview_button_expand') : t('builder_preview_button_collapse')}
          showLabelWhenActive={false}
          data-eid={ generateClickEID(`develop.preview.chat_pane_${isChatPaneCollapsed ? 'expand' : 'collapse'}`) }
        />
      )}

      <IconButton
        icon={<WebsiteFilledIcon />}
        onClick={() => handleViewModeChange(ViewMode.PREVIEW, hasUnsavedChanges)}
        data-eid={ generateClickEID('develop.preview.iframe') }
        active={viewMode === ViewMode.PREVIEW}
        label={t('builder_preview_button_preview')}
        showLabelWhenActive={false}
      />

      <IconButton
        icon={<CodeIcon />}
        onClick={() => {
          setIsSelectMode(false);
          handleViewModeChange(ViewMode.CODE, hasUnsavedChanges);
        }}
        data-eid={ generateClickEID('develop.preview.code_editor') }
        active={viewMode === ViewMode.CODE}
        disabled={isVersionHistoryOpen}
        label={t('builder_preview_button_code')}
        showLabelWhenActive={false}
        separator={!isMobile}
      />

      {!isMobile && (
        <IconButton
          icon={<EditIcon />}
          disabled={viewMode === ViewMode.CODE || isVersionHistoryOpen}
          onClick={toggleSelectMode}
          data-eid={ generateClickEID('develop.preview.select_mode') }
          active={isSelectMode}
          label={t('builder_preview_button_select')}
          showLabelWhenActive={false}
          id="tour-select-mode-button"
        />
      )}

      {!isMobile && <DomainButton />}
      {isMobile && <div className="grow" />}

      <IconButton
        icon={<RefreshIcon />}
        onClick={onPreviewRefresh}
        dataEid={ generateClickEID('develop.preview.refresh') }
        disabled={viewMode === ViewMode.CODE}
        label={t('builder_preview_button_refresh')}
        showLabelWhenActive={false}
      />

      {!isMobile && (
        <DeviceSelector disabled={viewMode === ViewMode.CODE} separator />
      )}

      <IconButton
        icon={<WindowNewIcon />}
        onClick={() => {
          logAiroHQEvent({
            category: 'click',
            recommendation_task: 'builder_develop_openpreview',
            recommendation_type: 'preview'
          })();
          if (serverUrl) {
            window.open(serverUrl, '_blank')
          } else if (actualPort) {
            window.open(`http://localhost:${actualPort}`, '_blank')
          }
          openFeedbackModal('airo#app-builder')
        }}
        dataEid={ generateClickEID('develop.preview.new_tab') }
        disabled={!actualPort || isRestarting}
        label={t('builder_common_open_new_tab')}
        showLabelWhenActive={false}
        className="flex-shrink-0"
      />
    </header>
  )
}
