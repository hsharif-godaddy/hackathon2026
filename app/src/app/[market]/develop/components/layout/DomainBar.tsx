import { useEffect, useRef, useState } from 'react'
import { FormattedMessage } from 'react-intl'
// @site/buttons ships no type declarations; postToSapi resolves to `any` (strict: false).
import { postToSapi } from '@site/buttons/lib/services/DomainServices'
import { useQuery } from '@tanstack/react-query'
import Button from '@ux/button'
import Growl from '@ux/growl'
import XIcon from '@ux/icon/x'
import Spinner from '@ux/spinner'
import text from '@ux/text'

import { ChatTab } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import DomainCheckoutModal from '@/app/[market]/develop/components/widgets/DomainCheckoutModal'
import { useChatContext } from '@/contexts/ChatContext'
import { useDomainSearch } from '@/hooks/useDomainSearch'
import { useModifyDomains } from '@/hooks/useModifyDomains'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { DomainStatus, DomainType } from '@/lib/control-plane/types'
import { appFetch } from '@/lib/gasket-config'
import { shipAnalyticsLog } from '@/lib/logging'
import { PAYWALL_ITC } from '@/lib/paywall/shared'
import { logger } from '@/lib/request-context'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useSiteStore } from '@/stores/useSiteStore'
import { type ChatMessage, useIsActivelyStreaming, useIsLoading, useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { isAiroSubdomain, resolveSiteFqdn } from '@/utils/domain'
import { getRootDomain } from '@/utils/getRootDomain'
import { generateClickEID, logClickEvent, logImpressionEvent } from '@/utils/instrumentation'
import { hasBeenPublished } from '@/utils/site'

function toDomainQuery(name: string): string {
  if (!name) return '';
  return name.normalize('NFD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

export default function DomainBar() {
  const t = useTranslations();
  const appId = useAppIdFromParams();
  const { sendMessage } = useChatContext();
  const addCompletedMessage = useStreamingConversationStore((s) => s.addCompletedMessage);
  const isStreaming = useIsActivelyStreaming();
  const isLoading = useIsLoading();
  const isProcessing = isStreaming || isLoading;

  // Inject the acknowledgement locally instead of via sendMessage: an agent turn here would
  // be killed by the attach-triggered redeploy ('server_shutdown' → spurious "Connection lost").
  function appendLocalNotice(content: string) {
    const notice: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date(),
    };
    addCompletedMessage(notice);
  }

  const siteFromCache = useSiteStore((state) => (appId ? state.getSite(appId) : null));
  const developSite = useDevelopPageStore((state) => state.site);
  const site = siteFromCache ?? developSite;
  const appName = useDevelopPageStore((state) => state.app?.name);
  const setActiveChatTab = useDevelopPageStore((state) => state.setActiveChatTab);
  // An attach job is in flight for this app (set after a domain is connected). Used to hide
  // the banner during the window between purchase and the domain becoming the site's domain.
  const attachJobInProgress = useDevelopPageStore(
    (state) => (appId ? state.domainJobsInProgress?.[appId] : undefined),
  );

  const fqdn = resolveSiteFqdn(site);
  const isAiroSubdomainCheck = isAiroSubdomain(fqdn);
  const isPublished = hasBeenPublished(site);

  // mgmt-airo has a single custom-domain slot and 409s ('CUSTOM_DOMAIN_SLOT_OCCUPIED') if we
  // try to attach while any non-prefix domain still holds it — including failed/error/deleting
  // ones that haven't been removed. Only INACTIVE frees the slot, so treat anything else as
  // occupied and hide the bar (don't sell a domain whose auto-attach would fail after payment).
  const hasCustomDomainOccupyingSlot = (site?.domains ?? []).some(
    (d) => d.domainType !== DomainType.PREFIX && d.status !== DomainStatus.INACTIVE,
  );

  // Suggest a domain from the site/app name; request 5 so the API can offer alternatives
  // when the exact match is unavailable.
  const rawName = site?.name?.trim() || appName?.trim() || '';
  const domainQuery = toDomainQuery(rawName);
  const { data: suggestedDomainData, isError: isDomainSearchError } = useDomainSearch({
    query: domainQuery,
    seedPrompt: rawName,
    siteId: appId,
    maxResults: 5,
    enabled: !!appId && isAiroSubdomainCheck && isPublished && domainQuery.length > 2,
  });
  const suggestedDomain = isDomainSearchError ? null : (suggestedDomainData?.domains?.[0]?.fqdn ?? null);

  // Session-based dismissal state
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    const dismissedKey = 'domainbar_dismissed';
    const wasDismissed = sessionStorage.getItem(dismissedKey) === 'true';
    setIsDismissed(wasDismissed);
  }, []);

  // Switchboard-gated: ON → clicking the suggested domain adds it to the cart and opens
  // Express Checkout; OFF → sends a chat prompt for the agent to handle (pre-expedite behavior).
  const isExpedite = useSwitchboard('appbuilder-domain-expedite-purchase') ?? false;

  // API key NAME (resolved server-side) required for add-to-cart. Only the expedite path
  // needs it, so skip the request when the flag is off. Throw on non-OK so a transient
  // failure goes to React Query's error/retry state instead of caching an empty config as
  // fresh data forever (which would block the purchase flow until a full reload).
  const { data: domainConfig, isLoading: isDomainConfigLoading } = useQuery({
    queryKey: ['domainConfig'],
    queryFn: async () => {
      const res = await appFetch('/api/domains/config');
      if (!res.ok) {
        logger.warn('domain_bar.config.fetch_failed', { status: res.status });
        throw new Error(`domains config fetch failed: ${res.status}`);
      }
      return res.json() as Promise<{ apiKeyName: string }>;
    },
    staleTime: Infinity,
    enabled: isExpedite,
  });
  const apiKeyName = domainConfig?.apiKeyName ?? '';

  // Express Checkout modal state — basketId comes from the SAPI add-to-cart response.
  const [basketId, setBasketId] = useState<string | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  // True while the add-to-cart call is in flight (before the checkout modal opens).
  const [isAddingToCart, setIsAddingToCart] = useState(false);

  // Attaches the purchased domain to this site after checkout completes.
  const modifyDomains = useModifyDomains();

  // CSP impression for the checkout modal: fire once per open, reset on close so a reopen re-fires.
  const isCheckoutOpen = showCheckout && Boolean(basketId);
  const checkoutImpressionLoggedRef = useRef(false);
  // Synchronous gate so a fast double-click can't create duplicate baskets before
  // `isAddingToCart`/`disabled` re-render.
  const addToCartInFlightRef = useRef(false);
  useEffect(() => {
    if (!isCheckoutOpen) {
      checkoutImpressionLoggedRef.current = false;
      return;
    }
    if (checkoutImpressionLoggedRef.current) return;
    checkoutImpressionLoggedRef.current = true;
    logImpressionEvent('develop.preview.domain_checkout_modal', { suggested_domain: suggestedDomain ?? '' })();
  }, [isCheckoutOpen, suggestedDomain]);

  // Don't show DomainBar if the custom-domain slot is already occupied, an attach job is in
  // flight, no suggestion is available, or the user dismissed it.
  if (
    !isAiroSubdomainCheck ||
    !suggestedDomain ||
    isDismissed ||
    attachJobInProgress ||
    hasCustomDomainOccupyingSlot
  ) {
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

    // Treatment (flag ON): add to cart + open Express Checkout directly (no agent round-trip).
    if (isExpedite) {
      if (!apiKeyName) {
        // Config not ready/unavailable — block with a busy growl while it loads, error otherwise.
        Growl.addGrowlMessage(
          isDomainConfigLoading
            ? {
              id: 'domain-suggestion-busy',
              title: t('builder_custom_domain_suggestion_busy_title'),
              children: t('builder_custom_domain_suggestion_busy_description'),
              emphasis: 'info',
              lifetime: 4000,
            }
            : {
              id: 'domain-suggestion-error',
              title: t('builder_custom_domain_suggestion_error_title'),
              children: t('builder_common_something_went_wrong'),
              emphasis: 'critical',
              lifetime: 5000,
            },
        );
        return;
      }
      await addSuggestedDomainToCart();
      return;
    }

    // Control (flag OFF): send a chat prompt for the agent to handle.
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

  async function addSuggestedDomainToCart() {
    if (addToCartInFlightRef.current) return;
    addToCartInFlightRef.current = true;
    setIsAddingToCart(true);
    try {
      // postToSapi takes the fqdn string directly (not the raw API object) and
      // returns the SAPI basket. urlOverride selects the SAPI environment.
      const result: any = await postToSapi(
        {
          fqdn: suggestedDomain,
          apiKey: apiKeyName,
          plid: '1',
          itemTrackingCode: PAYWALL_ITC.DOMAIN_EXPEDITE_PURCHASE,
          basketId: crypto.randomUUID(),
        },
        getRootDomain() ?? 'godaddy.com',
      );

      const newBasketId: string | undefined = result?.basketId ?? result?.data?.basketId;
      const added = !!newBasketId && (typeof result?.cartCount !== 'number' || result.cartCount > 0);
      if (!added) {
        throw new Error('add-to-cart returned no basket');
      }

      shipAnalyticsLog('domain.suggestion.added-to-cart', {
        appId,
        suggestedDomain,
        basketId: newBasketId,
      });

      setBasketId(newBasketId);
      setShowCheckout(true);
      setActiveChatTab(ChatTab.CHAT);
      // Untranslated, matching existing synthetic acks (e.g. DomainPurchaseWidget's "I purchased ...").
      appendLocalNotice(`Heads up: I'm buying ${suggestedDomain} in the checkout window — it will be connected to the site automatically once purchased, so no action or follow-up is needed from you.`);
    } catch (error) {
      logger.warn('domain_bar.add_to_cart.error', { suggestedDomain, error: String(error) });
      Growl.addGrowlMessage({
        id: 'domain-suggestion-error',
        title: t('builder_custom_domain_suggestion_error_title'),
        children: t('builder_common_something_went_wrong'),
        emphasis: 'critical',
        lifetime: 5000,
      });
    } finally {
      setIsAddingToCart(false);
      addToCartInFlightRef.current = false;
    }
  }

  function handleCheckoutClose() {
    setShowCheckout(false);
    setBasketId(null);
  }

  async function handleCheckoutComplete(order: any) {
    logClickEvent('develop.preview.domain_checkout_complete', {
      suggested_domain: suggestedDomain ?? '',
      ...(order?.orderId && { order_id: String(order.orderId) }),
    })();
    shipAnalyticsLog('domain.suggestion.checkout-success', {
      appId,
      suggestedDomain,
      orderId: order?.orderId,
    });
    setShowCheckout(false);
    setBasketId(null);

    // Auto-attach the purchased domain; useModifyDomains.onSuccess starts the attach-job polling.
    if (appId && suggestedDomain) {
      try {
        await modifyDomains.mutateAsync({
          siteId: appId,
          payload: { domainsToCreate: [{ fqdn: suggestedDomain, primary: false }], createCdn: true },
        });
        shipAnalyticsLog('domain.suggestion.attach-started', { appId, suggestedDomain });
        appendLocalNotice(`Done: ${suggestedDomain} is purchased and is already being connected to the site automatically. No action needed — please don't start a domain connect or purchase flow.`);
      } catch (error) {
        logger.error('domain_bar.attach.error', { suggestedDomain, error: String(error) });
        Growl.addGrowlMessage({
          id: 'domain-suggestion-attach-error',
          title: t('builder_custom_domain_suggestion_error_title'),
          children: t('builder_common_something_went_wrong'),
          emphasis: 'critical',
          lifetime: 5000,
        });
      }
    }
    // No manual hide: the onSuccess attach job flips `attachJobInProgress` (hiding the banner),
    // and once the domain is active `isAiroSubdomain` keeps it hidden.
  }

  function handleCheckoutError(error: { name: string; message?: string; reasonCode?: string }) {
    logger.error('domain_bar.checkout.error', {
      suggestedDomain,
      errorName: error?.name,
      reasonCode: error?.reasonCode,
    });
    Growl.addGrowlMessage({
      id: 'domain-suggestion-checkout-error',
      title: t('builder_custom_domain_suggestion_error_title'),
      children: t('builder_common_something_went_wrong'),
      emphasis: 'critical',
      lifetime: 5000,
    });
    setShowCheckout(false);
    setBasketId(null);
  }

  return (
    <>
      {showCheckout && basketId && (
        <DomainCheckoutModal
          basketId={basketId}
          title={t('builder_domain_purchase_checkout_title')}
          onPurchaseSuccess={handleCheckoutComplete}
          onError={handleCheckoutError}
          onClose={handleCheckoutClose}
        />
      )}
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
                disabled={isAddingToCart}
                data-eid={generateClickEID('develop.preview.suggested_domain_connect')}
                className="!text-intents-ux-boxHighContrast-foregroundColor"
              />
            ),
            strong: (chunks) => <text.strong>{chunks}</text.strong>,
            passive: (chunks) => <text.span emphasis="passive">{chunks}</text.span>,
          }}
        />
      </text.div>
      {isAddingToCart && (
        <Spinner size="sm" className="shrink-0" aria-label="Adding domain to cart" />
      )}
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
    </>
  )
}
