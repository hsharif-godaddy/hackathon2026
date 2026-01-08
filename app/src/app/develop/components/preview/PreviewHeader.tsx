import clsx from 'clsx'
import CodeIcon from '@ux/icon/code'
import DesktopIcon from '@ux/icon/desktop'
import EditIcon from '@ux/icon/edit'
import MobilePhoneIcon from '@ux/icon/mobile-phone'
import RefreshIcon from '@ux/icon/refresh'
import SidebarCollapseIcon from '@ux/icon/sidebar-collapse'
import SidebarExpandIcon from '@ux/icon/sidebar-expand'
import WebsiteFilledIcon from '@ux/icon/website-filled'
import WindowNewIcon from '@ux/icon/window-new'

import IconButton from '@/app/develop/components/IconButton'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { useTranslations } from '@/hooks/useTranslations'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { generateClickEID, logAiroHQEvent } from '@/utils/instrumentation'
import { PreviewViewMode,ViewMode } from '../types'

export default function PreviewHeader({ onPreviewRefresh, isMobile = false }) {
  const t = useTranslations();
  const appId = useAppIdFromParams()

  const viewMode = useDevelopPageStore((state) => state.viewMode)
  const isCheckingApp = useDevelopPageStore((state) => state.isCheckingApp)
  const isStartingApp = useDevelopPageStore((state) => state.isStartingApp)
  const isRestarting = useDevelopPageStore((state) => state.isRestarting)
  const previewViewMode = useDevelopPageStore((state) => state.previewViewMode)
  const hasUnsavedChanges = useDevelopPageStore((state) => state.hasUnsavedChanges)
  const isSelectMode = useDevelopPageStore((state) => state.isSelectMode)
  const isChatPaneCollapsed = useDevelopPageStore((state) => state.isChatPaneCollapsed)
  const isVersionHistoryOpen = useDevelopPageStore((state) => state.isVersionHistoryOpen)
  const site = useDevelopPageStore((state) => state.site)
  const handleViewModeChange = useDevelopPageStore((state) => state.handleViewModeChange)
  const setPreviewViewMode = useDevelopPageStore((state) => state.setPreviewViewMode)
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
        "pb-1.5": !isMobile,
        "p-2": isMobile
      }
    )}>
      { !isMobile && (
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
        onClick={() => handleViewModeChange(ViewMode.CODE, hasUnsavedChanges)}
        data-eid={ generateClickEID('develop.preview.code_editor') }
        active={viewMode === ViewMode.CODE}
        disabled={isVersionHistoryOpen}
        label={t('builder_preview_button_code')}
        showLabelWhenActive={false}
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

      { (previewViewMode === PreviewViewMode.DESKTOP || viewMode === ViewMode.CODE) && !isMobile && <DomainButton /> }
      { ((previewViewMode === PreviewViewMode.MOBILE && viewMode === ViewMode.PREVIEW) || isMobile) && <div className="flex-1" /> }

      <IconButton
        icon={<RefreshIcon />}
        onClick={onPreviewRefresh}
        dataEid={ generateClickEID('develop.preview.refresh') }
        disabled={viewMode === ViewMode.CODE}
        label={t('builder_preview_button_refresh')}
        showLabelWhenActive={false}
      />

      {!isMobile && (
        <>
          <IconButton
            icon={<DesktopIcon />}
            onClick={() => setPreviewViewMode(PreviewViewMode.DESKTOP)}
            active={previewViewMode === PreviewViewMode.DESKTOP}
            dataEid={ generateClickEID('develop.preview.preview_desktop') }
            disabled={viewMode === ViewMode.CODE}
            label={t('builder_preview_button_desktop')}
            showLabelWhenActive={false}
          />
          <IconButton
            icon={<MobilePhoneIcon />}
            onClick={() => setPreviewViewMode(PreviewViewMode.MOBILE)}
            active={previewViewMode === PreviewViewMode.MOBILE}
            dataEid={ generateClickEID('develop.preview.preview_mobile') }
            disabled={viewMode === ViewMode.CODE}
            label={t('builder_preview_button_mobile')}
            showLabelWhenActive={false}
            separator
          />
        </>
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
        disabled={!actualPort || isCheckingApp || isRestarting || isStartingApp}
        label={t('builder_common_open_new_tab')}
        showLabelWhenActive={false}
      />
    </header>
  )
}
