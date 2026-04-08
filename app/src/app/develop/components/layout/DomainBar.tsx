import { useEffect, useState } from 'react'
import { FormattedMessage } from 'react-intl'
import Button from '@ux/button'
import Growl from '@ux/growl'
import XIcon from '@ux/icon/x'
import text from '@ux/text'

import { ChatTab } from '@/app/develop/components/types'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { useDomainSearch } from '@/hooks/useDomainSearch'
import { useTranslations } from '@/hooks/useTranslations'
import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useSiteStore } from '@/stores/useSiteStore'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'
import { isAiroSubdomain, resolveSiteFqdn } from '@/utils/domain'
import { generateClickEID } from '@/utils/instrumentation'
import { hasBeenPublished } from '@/utils/site'

function toDomainQuery(name: string): string {
  if (!name) return '';
  return name.normalize('NFD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

export default function DomainBar() {
  const t = useTranslations();
  const appId = useAppIdFromParams();
  const { sendMessage } = useWebSocketContext();
  const isStreaming = useIsActivelyStreaming();
  const isLoading = useIsLoading();
  const isProcessing = isStreaming || isLoading;

  const siteFromCache = useSiteStore((state) => (appId ? state.getSite(appId) : null));
  const developSite = useDevelopPageStore((state) => state.site);
  const site = siteFromCache ?? developSite;
  const appName = useDevelopPageStore((state) => state.app?.name);
  const setActiveChatTab = useDevelopPageStore((state) => state.setActiveChatTab);

  const fqdn = resolveSiteFqdn(site);
  const isAiroSubdomainCheck = isAiroSubdomain(fqdn);
  const isPublished = hasBeenPublished(site);

  // Search for a suggested domain from app name, falling back to site record name.
  // Request up to 5 results so the API can return good alternatives
  // even when the exact match (e.g. yourbrand.com) is unavailable.
  const domainQuery = toDomainQuery(appName?.trim() || site?.name?.trim() || '');
  const { data: suggestedDomainData, isError: isDomainSearchError } = useDomainSearch({
    query: domainQuery,
    maxResults: 5,
    enabled: isAiroSubdomainCheck && isPublished && domainQuery.length > 2,
  });
  const suggestedDomain = isDomainSearchError ? null : (suggestedDomainData?.domains?.[0]?.fqdn ?? null);

  // Session-based dismissal state
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    const dismissedKey = 'domainbar_dismissed';
    const wasDismissed = sessionStorage.getItem(dismissedKey) === 'true';
    setIsDismissed(wasDismissed);
  }, []);

  // Don't show DomainBar if custom domain is already connected or no suggestion available or dismissed
  if (!isAiroSubdomainCheck || !suggestedDomain || isDismissed) {
    return null;
  }

  function handleDismiss() {
    const dismissedKey = 'domainbar_dismissed';
    sessionStorage.setItem(dismissedKey, 'true');
    setIsDismissed(true);

    shipAnalyticsLog('domain.suggestion.dismissed', {
      appId,
      suggestedDomain,
    });
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
      await sendMessage({ content: t('builder_custom_domain_suggestion_prompt_domain', { domain: suggestedDomain }) });
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

  return (
    <div
      className="mx-2 px-1 py-0.5 rounded-t-lg leading-none bg-ai text-intents-ux-boxHighContrast-foregroundColor flex items-center justify-between gap-2"
    >
      <text.div size={-1} className="truncate grow text-center">
        <FormattedMessage
          id="builder_custom_domain_suggestion_available_domain"
          values={{
            domain: (
              <Button
                design="inline"
                size="sm"
                text={suggestedDomain}
                onClick={handleSuggestedDomainClick}
                data-eid={generateClickEID('develop.preview.suggested_domain_connect')}
                className="!text-intents-ux-boxHighContrast-foregroundColor"
              />
            ),
            strong: (chunks) => <text.strong>{chunks}</text.strong>,
            passive: (chunks) => <text.span emphasis="passive">{chunks}</text.span>,
          }}
        />
      </text.div>
      <Button
        design="inline"
        size="sm"
        onClick={handleDismiss}
        icon={<XIcon className="!size-2" />}
        data-eid={generateClickEID('develop.preview.domain_bar_dismiss')}
        aria-label="Dismiss domain suggestion"
        className="!text-intents-ux-boxHighContrast-foregroundColor shrink-0"
      />
    </div>
  )
}
