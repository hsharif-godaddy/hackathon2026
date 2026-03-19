import clsx from 'clsx'
import Button from '@ux/button'
import Growl from '@ux/growl'
import CodeIcon from '@ux/icon/code'
import EditIcon from '@ux/icon/edit'
import RefreshIcon from '@ux/icon/refresh'
import SidebarCollapseIcon from '@ux/icon/sidebar-collapse'
import SidebarExpandIcon from '@ux/icon/sidebar-expand'
import WebsiteFilledIcon from '@ux/icon/website-filled'
import WindowNewIcon from '@ux/icon/window-new'
import text from "@ux/text";

import IconButton from '@/app/develop/components/IconButton'
import DeviceSelector from '@/app/develop/components/preview/DeviceSelector'
import { ChatTab, SettingsSection, ViewMode } from '@/app/develop/components/types'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import ErrorBoundary from '@/components/ErrorBoundary'
import { FEEDBACK_ID } from '@/components/feedback/utils'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useDomainSearch } from '@/hooks/useDomainSearch'
import { useTranslations } from '@/hooks/useTranslations'
import { shipAnalyticsLog } from '@/lib/logging'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'
import { isAiroSubdomain, resolveSiteFqdn } from '@/utils/domain'
import { generateClickEID, logAiroHQEvent } from '@/utils/instrumentation'
import { hasBeenPublished } from '@/utils/site'

function toDomainQuery(name: string): string {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Isolated component so useDomainSearch errors are caught by ErrorBoundary
// without crashing the entire PreviewHeader.
function DomainBar() {
  const t = useTranslations();
  const appId = useAppIdFromParams();
  const { sendMessage } = useWebSocketContext();
  const isStreaming = useIsActivelyStreaming();
  const isLoading = useIsLoading();
  const isProcessing = isStreaming || isLoading;

  const site = useDevelopPageStore((state) => state.site);
  const appName = useDevelopPageStore((state) => state.app?.name);
  const setActiveChatTab = useDevelopPageStore((state) => state.setActiveChatTab);
  const { setActiveSettingsSection } = useChatTabs();

  const fqdn = resolveSiteFqdn(site);
  const isAiroSubdomainCheck = isAiroSubdomain(fqdn);
  const isPublished = hasBeenPublished(site);

  // Search for a suggested domain based on the app name.
  // Request up to 5 results so the API can return good alternatives
  // even when the exact match (e.g. yourbrand.com) is unavailable.
  const domainQuery = appName ? toDomainQuery(appName) : '';
  const { data: suggestedDomainData, isError: isDomainSearchError } = useDomainSearch({
    query: domainQuery,
    maxResults: 5,
    enabled: isAiroSubdomainCheck && isPublished && domainQuery.length > 2,
  });
  const suggestedDomain = isDomainSearchError ? null : (suggestedDomainData?.domains?.[0]?.fqdn ?? null);

  async function handleSuggestedDomainClick() {
    if (isProcessing) {
      Growl.addGrowlMessage({
        id: 'domain-suggestion-busy',
        title: t('builder_custom_domain_suggestion_busy_title', undefined, 'Chat in progress'),
        children: t('builder_custom_domain_suggestion_busy_description', undefined, 'Please wait for the current response to finish, then try again.'),
        emphasis: 'info',
        lifetime: 4000,
      });
      return;
    }

    shipAnalyticsLog('domain.suggestion.clicked', {
      appId,
      suggestedDomain,
    });

    setActiveChatTab(ChatTab.CHAT);

    try {
      // Not including the domain name in the prompt as it's not needed for the domain purchase
      await sendMessage(t('builder_custom_domain_suggestion_prompt', undefined, "I'd like to purchase the domain for my website. Can you help me get started?"));
    } catch {
      Growl.addGrowlMessage({
        id: 'domain-suggestion-error',
        title: t('builder_custom_domain_suggestion_error_title', undefined, 'Unable to send message'),
        children: t('builder_custom_domain_suggestion_error_description', undefined, 'Something went wrong. Please try again.'),
        emphasis: 'critical',
        lifetime: 5000,
      });
    }
  }

  // Show suggested domain when site is on an airo subdomain and a suggestion is available
  if (isAiroSubdomainCheck && isPublished && suggestedDomain) {
    return (
      <div
        className="grow mx-3 px-2 gap-1 flex justify-between items-center border rounded-xl h-full leading-none text-left bg-intents-ux-box-backgroundColor"
      >
        <text.span size={-1} className="truncate">
          <text.strong>{suggestedDomain}</text.strong>
          {' '}
          <text.span emphasis="passive">
            {t('builder_custom_domain_suggestion_available', undefined, 'is available!')}
          </text.span>
        </text.span>
        <Button
          design="inline"
          size="sm"
          text={t('builder_custom_domain_suggestion_connect', undefined, 'Connect Domain')}
          onClick={handleSuggestedDomainClick}
          data-eid={generateClickEID('develop.preview.suggested_domain_connect')}
          className="shrink-0"
        />
      </div>
    )
  }

  return (
    <div
      className="grow mx-3 px-2 gap-1 flex justify-between items-center border rounded-xl h-full leading-none text-left bg-intents-ux-box-backgroundColor"
    >
      {(fqdn || site?.name) && (
        <text.span
          size={-1}
          emphasis={isAiroSubdomainCheck ? "passive" : null}
          className="truncate max-w-100"
        >
          {fqdn || site?.name}
        </text.span>
      )}
      {isAiroSubdomainCheck && (
        <Button
          design="inline"
          size="sm"
          text={t('builder_custom_domain_button_add')}
          onClick={() => setActiveSettingsSection(SettingsSection.DOMAIN)}
          data-eid={generateClickEID('develop.preview.buy_domain')}
          className="shrink-0"
        />
      )}
    </div>
  )
}

export default function PreviewHeader({ onPreviewRefresh, isMobile = false }) {
  const t = useTranslations();
  const appId = useAppIdFromParams()

  const viewMode = useDevelopPageStore((state) => state.viewMode)
  const isRestarting = useDevelopPageStore((state) => state.isRestarting)
  const hasUnsavedChanges = useDevelopPageStore((state) => state.hasUnsavedChanges)
  const isSelectMode = useDevelopPageStore((state) => state.isSelectMode)
  const isChatPaneCollapsed = useDevelopPageStore((state) => state.isChatPaneCollapsed)
  const isVersionHistoryOpen = useDevelopPageStore((state) => state.isVersionHistoryOpen)
  const handleViewModeChange = useDevelopPageStore((state) => state.handleViewModeChange)
  const setIsSelectMode = useDevelopPageStore((state) => state.setIsSelectMode)
  const toggleSelectMode = useDevelopPageStore((state) => state.toggleSelectMode)
  const toggleChatPaneCollapse = useDevelopPageStore((state) => state.toggleChatPaneCollapse)
  const openFeedbackModal = useDevelopPageStore((state) => state.openFeedbackModal)
  const getServerState = useServerPollingStore((state) => state.getServerState)
  const serverState = getServerState(appId)
  const actualPort = serverState?.port
  const serverUrl = serverState?.url

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
          data-eid={generateClickEID(`develop.preview.chat_pane_${isChatPaneCollapsed ? 'expand' : 'collapse'}`)}
        />
      )}

      <IconButton
        icon={<WebsiteFilledIcon />}
        onClick={() => handleViewModeChange(ViewMode.PREVIEW, hasUnsavedChanges)}
        data-eid={generateClickEID('develop.preview.iframe')}
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
        data-eid={generateClickEID('develop.preview.code_editor')}
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
          data-eid={generateClickEID('develop.preview.select_mode')}
          active={isSelectMode}
          label={t('builder_preview_button_select')}
          showLabelWhenActive={false}
          id="tour-select-mode-button"
        />
      )}

      {!isMobile && (
        <ErrorBoundary fallback={null}>
          <DomainBar />
        </ErrorBoundary>
      )}
      {isMobile && <div className="grow" />}

      <IconButton
        icon={<RefreshIcon />}
        onClick={onPreviewRefresh}
        dataEid={generateClickEID('develop.preview.refresh')}
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
          openFeedbackModal(FEEDBACK_ID)
        }}
        dataEid={generateClickEID('develop.preview.new_tab')}
        disabled={!actualPort || isRestarting}
        label={t('builder_common_open_new_tab')}
        showLabelWhenActive={false}
        className="flex-shrink-0"
      />
    </header>
  )
}
