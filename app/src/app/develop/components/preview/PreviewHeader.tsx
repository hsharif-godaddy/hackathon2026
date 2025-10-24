import clsx from 'clsx'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { generateClickEID } from '@/utils/instrumentation'
import IconButton from '../IconButton'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import ChevronDownIcon from '@ux/icon/chevron-down'
import CodeIcon from '@ux/icon/code'
// TODO: Re-enable database icon when ready
//import DatabaseIcon from '@ux/icon/database'
import DesktopIcon from '@ux/icon/desktop'
import EditIcon from '@ux/icon/edit'
import MobilePhoneIcon from '@ux/icon/mobile-phone'
import RefreshIcon from '@ux/icon/refresh'
import SidebarCollapseIcon from '@ux/icon/sidebar-collapse'
import SidebarExpandIcon from '@ux/icon/sidebar-expand'
import WebsiteFilledIcon from '@ux/icon/website-filled'
import WindowNewIcon from '@ux/icon/window-new'
import { ViewMode, PreviewViewMode } from '../types'

export default function PreviewHeader({ onPreviewRefresh, isMobile = false }) {
  const appId = useAppIdFromParams()

  const {
    viewMode,
    isCheckingApp,
    isStartingApp,
    isRestarting,
    previewViewMode,
    hasUnsavedChanges,
    handleViewModeChange,
    setPreviewViewMode,
    toggleSelectMode,
    isSelectMode,
    isChatPaneCollapsed,
    toggleChatPaneCollapse,
    // TODO: re-enable settings dialog when ready
    //openSettingsDialog,
    site
  } = useDevelopPageStore()

  const { getServerState } = useServerPollingStore()
  const serverState = getServerState(appId)
  const actualPort = serverState?.port
  const serverUrl = serverState?.url

  const DomainButton = () => {
    return (
      <button
        className="grow mx-8 pl-4 flex justify-between items-center border rounded-xl px-2.5 h-full leading-none text-left bg-intents-ux-box-backgroundColor hover:cursor-pointer"
      >
        {site?.name && (
          <>
            <span className="truncate max-w-[200px]">{site.name}</span>
            <ChevronDownIcon />
          </>
        )}
      </button>
    )
  }

  return (
    <header className={clsx(
      "flex items-center w-full gap-1", {
        "pb-3": !isMobile,
        "p-2": isMobile
      }
    )}>
      { !isMobile && (
        <IconButton
          icon={isChatPaneCollapsed ? <SidebarExpandIcon /> : <SidebarCollapseIcon />}
          onClick={toggleChatPaneCollapse}
          separator
        />
      )}
      <IconButton
        icon={<WebsiteFilledIcon />}
        onClick={() => handleViewModeChange(ViewMode.PREVIEW, hasUnsavedChanges)}
        active={viewMode === ViewMode.PREVIEW}
      />
      <IconButton
        icon={<CodeIcon />}
        onClick={() => handleViewModeChange(ViewMode.CODE, hasUnsavedChanges)}
        active={viewMode === ViewMode.CODE}
      />
      {/*
        TODO: re-enable once database settings panel is ready
        <IconButton
          icon={<DatabaseIcon />}
          onClick={() => openSettingsDialog('database')}
          label="Database"
          dataEid={generateClickEID('develop.preview.database')}
          separator
        />
      */}
      <IconButton
        icon={<EditIcon />}
        disabled={viewMode === ViewMode.CODE}
        onClick={toggleSelectMode}
        data-eid={ generateClickEID('develop.preview.selector') }
        active={isSelectMode}
      />

      { (previewViewMode === PreviewViewMode.DESKTOP || viewMode === ViewMode.CODE) && !isMobile && <DomainButton /> }
      { ((previewViewMode === PreviewViewMode.MOBILE && viewMode === ViewMode.PREVIEW) || isMobile) && <div className="flex-1" /> }

      <IconButton
        icon={<RefreshIcon />}
        onClick={onPreviewRefresh}
        dataEid={ generateClickEID('develop.preview.refresh') }
        disabled={viewMode === ViewMode.CODE}
      />

      { !isMobile && (
        <>
          <IconButton
            icon={<DesktopIcon />}
            onClick={() => setPreviewViewMode(PreviewViewMode.DESKTOP)}
            active={previewViewMode === PreviewViewMode.DESKTOP}
            dataEid={ generateClickEID('develop.preview.preview_desktop') }
            disabled={viewMode === ViewMode.CODE}
          />
          <IconButton
            icon={<MobilePhoneIcon />}
            onClick={() => setPreviewViewMode(PreviewViewMode.MOBILE)}
            active={previewViewMode === PreviewViewMode.MOBILE}
            dataEid={ generateClickEID('develop.preview.preview_mobile') }
            disabled={viewMode === ViewMode.CODE}
            separator
          />
        </>
      )}
      <IconButton
        icon={<WindowNewIcon />}
        onClick={() => {
          if (serverUrl) {
            window.open(serverUrl, '_blank')
          } else if (actualPort) {
            window.open(`http://localhost:${actualPort}`, '_blank')
          }
        }}
        dataEid={ generateClickEID('develop.preview.new_tab') }
        disabled={!actualPort || isCheckingApp || isRestarting || isStartingApp}
      />
    </header>
  )
}
