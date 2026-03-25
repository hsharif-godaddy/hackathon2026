import { useState } from 'react'
import { FormattedMessage } from 'react-intl'
import Button from '@ux/button'
import Growl from '@ux/growl'
import text from '@ux/text'

import { ChatTab, SettingsSection } from '@/app/develop/components/types'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import AppPublish from '@/components/layout/AppPublish'
import { useAuthContext } from '@/components/providers/AuthProvider'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useDomainSearch } from '@/hooks/useDomainSearch'
import { useTranslations } from '@/hooks/useTranslations'
import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'
import { Popover, PopoverContent, PopoverTrigger } from '@/lib/shadcn/popover'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'
import { isAiroSubdomain, resolveSiteFqdn } from '@/utils/domain'
import { generateClickEID } from '@/utils/instrumentation'
import { hasBeenPublished } from '@/utils/site'

function toDomainQuery(name: string): string {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export default function DomainBar() {
  const t = useTranslations();
  const appId = useAppIdFromParams();
  const { sendMessage } = useWebSocketContext();
  const isStreaming = useIsActivelyStreaming();
  const isLoading = useIsLoading();
  const isProcessing = isStreaming || isLoading;
  const { isAuthenticated, isAuthDisabled, isLoading: isAuthLoading } = useAuthContext();
  const [open, setOpen] = useState(false);

  const site = useDevelopPageStore((state) => state.site);
  const appName = useDevelopPageStore((state) => state.app?.name);
  const setActiveChatTab = useDevelopPageStore((state) => state.setActiveChatTab);
  const { setActiveSettingsSection } = useChatTabs();

  // Only show authenticated UI components when auth is confirmed (not loading) and user is authenticated
  const showAuthenticatedUI = !isAuthLoading && (isAuthenticated || isAuthDisabled);

  const fqdn = resolveSiteFqdn(site);
  const isAiroSubdomainCheck = isAiroSubdomain(fqdn);
  const isPublished = hasBeenPublished(site);

  // Show loading state when site data is not yet available
  const isLoadingDomain = !site || !fqdn;

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

  // Show loading placeholder while domain data is being fetched
  if (isLoadingDomain) {
    return (
      <div
        className="grow mx-3 px-2 py-1 gap-1 flex justify-between items-center border rounded-xl h-full leading-none text-left bg-intents-ux-box-backgroundColor"
      >
        <div className="h-2 w-24 bg-intents-ux-boxLowContrast-backgroundColor rounded animate-pulse" />
      </div>
    );
  }

  async function handleSuggestedDomainClick() {
    if (isProcessing) {
      Growl.addGrowlMessage({
        id: 'domain-suggestion-busy',
        title: t('builder_custom_domain_suggestion_busy_title'),
        children: t('builder_custom_domain_suggestion_busy_description'),
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
      await sendMessage({ content: t('builder_custom_domain_suggestion_prompt') });
    } catch (error) {
      logger.warn('domain_bar.send_message.error', { error: String(error) });
      Growl.addGrowlMessage({
        id: 'domain-suggestion-error',
        title: t('builder_custom_domain_suggestion_error_title'),
        children: t('builder_common_something_went_wrong'),
        emphasis: 'critical',
        lifetime: 5000,
      });
    }
  }

  // Show suggested domain when site is on an airo subdomain and a suggestion is available
  if (isAiroSubdomainCheck && isPublished && suggestedDomain) {
    return (
      <div
        className="grow px-2 gap-1 flex justify-between items-center border rounded-xl h-full leading-none text-left bg-intents-ux-box-backgroundColor"
      >
        <text.span size={-1} className="truncate">
          <FormattedMessage
            id="builder_custom_domain_suggestion_available"
            values={{
              domain: suggestedDomain,
              strong: (chunks) => <text.strong>{chunks}</text.strong>,
              passive: (chunks) => <text.span emphasis="passive">{chunks}</text.span>,
            }}
          />
        </text.span>
        <Button
          design="inline"
          size="sm"
          text={t('builder_domain_button_connect')}
          onClick={handleSuggestedDomainClick}
          data-eid={generateClickEID('develop.preview.suggested_domain_connect')}
          className="shrink-0"
        />
        {showAuthenticatedUI && <AppPublish location="develop.domain_bar" />}
      </div>
    )
  }

  const previewUrl = site?.preview_url;
  const publishedUrl = site?.published_url;
  const hasPublishedUrl = publishedUrl && hasBeenPublished(site);

  // Show menu only if we have both URLs, otherwise direct link
  const hasMultipleUrls = previewUrl && hasPublishedUrl;

  const handleUrlClick = (url: string, type: 'preview' | 'publish') => {
    window.open(url, '_blank', 'noopener,noreferrer');
    setOpen(false);

    shipAnalyticsLog('domain.url.clicked', {
      appId,
      type,
    });
  };

  const handleDomainClick = () => {
    // If only preview URL exists, open it directly
    if (previewUrl && !hasPublishedUrl) {
      handleUrlClick(previewUrl, 'preview');
    }
    // If only published URL exists (edge case), open it directly
    else if (hasPublishedUrl && !previewUrl) {
      handleUrlClick(publishedUrl, 'publish');
    }
    // Otherwise, toggle the menu (handled by Popover)
  };

  return (
    <div
      className="grow pl-1.5 pr-0.5 py-0.5 gap-1 flex justify-between items-center border rounded-xl h-full leading-none text-left bg-intents-ux-box-backgroundColor"
    >
      {(fqdn || site?.name) && (
        hasMultipleUrls ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                className="truncate max-w-100 text-left hover:opacity-70 transition-opacity cursor-pointer"
                data-eid={generateClickEID('develop.domain_bar.domain_menu')}
              >
                <text.span
                  size={-1}
                  emphasis={isAiroSubdomainCheck ? "passive" : null}
                >
                  {fqdn || site?.name}
                </text.span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-[220px] p-1"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <div className="flex flex-col">
                {previewUrl && (
                  <DomainMenuItem
                    label={t('builder_domain_menu_preview')}
                    onClick={() => handleUrlClick(previewUrl, 'preview')}
                    dataEid={generateClickEID('develop.domain_bar.open_preview')}
                  />
                )}
                {hasPublishedUrl && (
                  <DomainMenuItem
                    label={t('builder_domain_menu_published')}
                    onClick={() => handleUrlClick(publishedUrl, 'publish')}
                    dataEid={generateClickEID('develop.domain_bar.open_published')}
                  />
                )}
              </div>
            </PopoverContent>
          </Popover>
        ) : (
          <button
            className="truncate max-w-100 text-left hover:opacity-70 transition-opacity cursor-pointer"
            onClick={handleDomainClick}
            data-eid={generateClickEID('develop.domain_bar.domain_direct')}
          >
            <text.span
              size={-1}
              emphasis={isAiroSubdomainCheck ? "passive" : null}
            >
              {fqdn || site?.name}
            </text.span>
          </button>
        )
      )}
      {isAiroSubdomainCheck && (
        <Button
          design="inline"
          size="sm"
          text={t('builder_custom_domain_button_add')}
          onClick={() => {
            setActiveSettingsSection(SettingsSection.DOMAIN);
            setActiveChatTab(ChatTab.SETTINGS);
          }}
          data-eid={generateClickEID('develop.preview.buy_domain')}
          className="shrink-0"
        />
      )}
      {showAuthenticatedUI && <AppPublish location="develop.domain_bar" />}
    </div>
  )
}

interface DomainMenuItemProps {
  label: string;
  onClick: () => void;
  dataEid?: string;
}

function DomainMenuItem({ label, onClick, dataEid }: DomainMenuItemProps) {
  return (
    <button
      className="flex items-center justify-between w-full px-2 py-1.5 text-left text-sm rounded hover:bg-intents-ux-boxHighContrast-backgroundColor/10 focus:outline-none focus:bg-intents-ux-boxHighContrast-backgroundColor/10"
      onClick={onClick}
      data-eid={dataEid}
    >
      <span>{label}</span>
    </button>
  );
}
