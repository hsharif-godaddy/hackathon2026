'use client'

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import AddToCartButton from '@site/buttons/lib/AddToCartButton';
import { useMutation, useQuery } from '@tanstack/react-query';
import Alert from '@ux/alert';
import Box from '@ux/box';
import Button from '@ux/button';
import ChevronLeftIcon from '@ux/icon/chevron-left';
import Modal from '@ux/modal';
import Skeleton from '@ux/skeleton';
import Spinner from '@ux/spinner';
import text from '@ux/text';
import TextInput from '@ux/text-input';

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext';
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils';
import { useDomainSearch } from '@/hooks/useDomainSearch';
import { useIscResolver } from '@/hooks/useIscResolver';
import { useOfferEligibility } from '@/hooks/useOfferEligibility';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { appFetch } from '@/lib/gasket-config';
import { markFeedbackRevealMilestone } from '@/lib/initial-build-reveal-storage';
import { shipAnalyticsLog } from '@/lib/logging';
import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { logger } from '@/lib/request-context';
import { useSiteStore } from '@/stores/useSiteStore';
import type { Domain, DomainPurchaseWidgetProps, Product } from '@/types/domain-purchase';
import { getRootDomain } from '@/utils/getRootDomain';
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation';
import { shimReactInternals } from '@/utils/reactCompat';
import {
  buildSearchResultsLogKey,
  domainSelectionContext,
  selectedDomainSelectionContext,
} from './domain-search-analytics';
import DomainSuggestionFeedback from './DomainSuggestionFeedback';

const DynamicCheckout: ComponentType<any> = dynamic(
  async () => {
    shimReactInternals();
    const mod = await import('@px/checkouts');
    return mod.Checkout;
  },
  { ssr: false }
);

/**
 * Domain Purchase Widget
 *
 * Allows users to search for and purchase domains in-app.
 * Uses @site/domain-services for search and @site/buttons for purchase flow.
 *
 * Flow:
 * 1. Widget automatically searches using app name
 * 2. Widget displays available domains with pricing
 * 3. User clicks price button to purchase (uses @site/buttons AddToCartButton)
 * 4. Express checkout flow handles payment
 * 5. On success, sends chat message "I purchased <domain_name>!" and notifies parent via onPurchaseComplete callback
 * 6. In standalone mode (no onPurchaseComplete), shows a "Connect it" CTA that sends a chat message to trigger the attach flow
 */
export default function DomainPurchaseWidget({
  brandName,
  domain,
  appId: propAppId,
  onPurchaseComplete,
  onCancel,
  className = '',
  conversationId,
  messageId,
}: DomainPurchaseWidgetProps) {
  const t = useTranslations();
  const sendUserMessage = useSendUserMessage();
  const paramAppId = useAppIdFromParams();
  const appId = propAppId || paramAppId;

  // Determine if we came from domain attach (has onCancel callback)
  const isFromDomainAttach = !!onCancel;

  // Get site for fallback name
  const site = useSiteStore((state) => state.getSite(appId || ''));

  // Feature flag check
  const isDomainPurchaseEnabled = useSwitchboard('appbuilder-domain-purchase');
  const isOfferIscEnabled = useSwitchboard('appbuilder-domain-offers-isc');
  const isDomainSuggestionFeedbackEnabled = useSwitchboard('appbuilder-domain-suggestion-feedback');

  // Fetch API key name from server (avoids NEXT_PUBLIC_ exposure)
  const { data: domainConfig } = useQuery({
    queryKey: ['domainConfig'],
    queryFn: async () => {
      const res = await appFetch('/api/domains/config');
      if (!res.ok) return { apiKeyName: '' };
      return res.json() as Promise<{ apiKeyName: string }>;
    },
    staleTime: Infinity,
  });

  // Purchase state
  const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null);
  const [purchaseStatus, setPurchaseStatus] = useState<'idle' | 'purchasing' | 'success' | 'error'>('idle');

  // Checkout state - basketId comes from SAPI response after add to cart
  const [basketId, setBasketId] = useState<string | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutResetGenerations, setCheckoutResetGenerations] = useState<Record<string, number>>({});
  const [showSearchInput, setShowSearchInput] = useState(true);

  const getFallbackSearchQuery = (): string => {
    if (domain?.trim()) return domain.trim();
    if (brandName?.trim()) return brandName.trim();
    if (site?.name?.trim()) return site.name.trim();
    if (site?.initial_prompt?.trim()) {
      const prompt = site.initial_prompt.trim();
      if (prompt.length <= 50) return prompt;
      const truncated = prompt.slice(0, 50);
      const lastSpace = truncated.lastIndexOf(' ');
      return lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated;
    }
    return '';
  };

  const initialSearchQuery = getFallbackSearchQuery();
  const [searchInput, setSearchInput] = useState(initialSearchQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialSearchQuery);
  const searchQuery = submittedQuery.trim();

  const { isc: resolvedIsc } = useIscResolver();
  const { eligible } = useOfferEligibility({ isc: resolvedIsc });
  const activeIsc = isOfferIscEnabled && eligible ? resolvedIsc : null;

  // Fire on each (ISC, widget mount). Failures are non-blocking: cookie
  // absence just means SAPI charges standard pricing — same UX as if no
  // offer were in play. FOS is idempotent on re-mint, so the small number
  // of redundant POSTs from chat tool re-renders is bounded and cheap.
  const { mutate: mintIscSession } = useMutation({
    mutationFn: async (isc: string) => {
      const response = await appFetch('/api/domains/isc-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isc }),
      });
      if (!response.ok) {
        throw Object.assign(new Error(`mint returned ${response.status}`), {
          status: response.status,
        });
      }
    },
    onError: (error: Error & { status?: number }, isc) => {
      logger.warn('domain-offer.mint.failed', {
        isc,
        status: error.status,
        error: error.message,
      });
    },
  });

  useEffect(() => {
    if (!activeIsc) return;
    mintIscSession(activeIsc);
  }, [activeIsc, mintIscSession]);

  // Focus the search input whenever the form becomes visible. Standard
  // search-first UX, and also a workaround for a react-focus-lock leak
  // (used inside @ux/disrupt → @ux/modal) that can leave browser-driven
  // focus events stuck after an agent-triggered widget remount or a
  // modal close. Skipped when focus is already on a non-body element so
  // we don't steal it from the chat textarea or another active input.
  useEffect(() => {
    if (!showSearchInput) return;
    if (typeof window === 'undefined') return;
    if (document.activeElement && document.activeElement !== document.body) return;
    const id = window.requestAnimationFrame(() => {
      document.getElementById('domain-purchase-search')?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [showSearchInput]);

  const {
    data: searchResult,
    isLoading: isSearching,
    error: searchError,
  } = useDomainSearch({
    query: searchQuery,
    siteId: appId,
    maxResults: 6,
    enabled: searchQuery.length >= 2,
    ...(activeIsc ? { isc: activeIsc } : {}),
  });

  const lastResultsLoggedRef = useRef<string | null>(null);
  const searchMeta = searchResult?.meta;
  const resultDomains = searchResult?.domains ?? [];
  const domainsFound = resultDomains.length;
  const resultSetKey = domainsFound > 0 && searchQuery
    ? buildSearchResultsLogKey(searchQuery, resultDomains, searchMeta)
    : null;

  useEffect(() => {
    if (!resultSetKey || !searchMeta) return;
    if (lastResultsLoggedRef.current === resultSetKey) return;
    lastResultsLoggedRef.current = resultSetKey;

    shipAnalyticsLog('domain.search.results', {
      appId,
      conversationId,
      query: searchQuery,
      domainsFound,
      spinsResultCount: searchMeta.spinsResultCount,
      exactMatchCount: searchMeta.exactMatchCount,
      seedsUsed: searchMeta.seedsUsed,
      seedsCount: searchMeta.seedsCount,
      spinsFulfilled: searchMeta.spinsFulfilled,
      spinsRejected: searchMeta.spinsRejected,
    });
  }, [
    appId,
    searchQuery,
    resultSetKey,
    domainsFound,
    searchMeta?.seedsUsed,
    searchMeta?.seedsCount,
    searchMeta?.spinsResultCount,
    searchMeta?.exactMatchCount,
    searchMeta?.spinsFulfilled,
    searchMeta?.spinsRejected,
  ]);

  // CSP impression: the domain purchase widget appeared on screen. Fired
  // once per mount via a ref; the tool renderer only mounts the full
  // interactive widget for the last assistant message, so a mount maps to
  // a genuine on-screen appearance. appId is auto-merged by mergeContext.
  const hasLoggedImpressionRef = useRef(false);
  useEffect(() => {
    if (!isDomainPurchaseEnabled || hasLoggedImpressionRef.current) return;
    hasLoggedImpressionRef.current = true;
    logImpressionEvent('chat.domainPurchase.view', { from_domain_attach: isFromDomainAttach })();
  }, [isDomainPurchaseEnabled, isFromDomainAttach]);

  function runSearch() {
    const q = searchInput.trim();
    if (q.length < 2) return;
    shipAnalyticsLog('domain.purchase.widget.search.triggered', {
      appId,
      conversationId,
      query: q,
      brandName,
    });
    setSubmittedQuery(q);
    setPurchaseStatus('idle');
    setSelectedDomain(null);
  }

  // Get product info for a domain
  const getProduct = useCallback((productId: number): Product | undefined => {
    return searchResult?.products.find(p => p.productId === productId);
  }, [searchResult]);

  /**
   * Handle add to cart success from @site/buttons AddToCartButton
   * Extracts basketId from SAPI response and shows Express Checkout
   */
  function handleAddToCartSuccess(domain: Domain, resultIndex: number) {
    return (response: any) => {
      // Extract basketId from SAPI response - check multiple possible locations
      const newBasketId = response?.basketId || response?.data?.basketId || response?.basket?.id;
      const spinContext = domainSelectionContext(searchResult?.meta, domain, resultIndex);

      logger.info('domain-purchase.add-to-cart-success', {
        appId,
        domain: domain.fqdn,
        basketId: newBasketId,
        cartCount: response?.cartCount,
        responseKeys: Object.keys(response || {}),
        ...spinContext,
      });

      shipAnalyticsLog('domain.purchase.widget.add-to-cart', {
        appId,
        conversationId,
        domain: domain.fqdn,
        basketId: newBasketId,
        ...spinContext,
      });

      if (newBasketId) {
        setShowSearchInput(false);
        setSelectedDomain(domain);
        setBasketId(newBasketId);
        setCheckoutError(null);
        setShowCheckout(true);
      } else {
        logger.error('domain-purchase.add-to-cart-no-basket-id', {
          appId,
          domain: domain.fqdn,
          response: JSON.stringify(response).slice(0, 500),
        });

        // Show error in the widget
        setPurchaseStatus('error');
        setSelectedDomain(domain);
      }
    };
  }

  /**
   * Handle checkout completion - called when payment is successful
   */
  async function handleCheckoutSuccess(order: any) {
    setPurchaseStatus('success');
    setShowCheckout(false);
    setBasketId(null);

    // See handleBackFromCheckout for the data-inert workaround rationale.
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        document.body.removeAttribute('data-inert');
      });
    }

    const purchasedDomain = selectedDomain?.fqdn;
    const spinContext = selectedDomainSelectionContext(
      searchResult?.meta,
      searchResult?.domains,
      selectedDomain,
    );

    if (appId && purchasedDomain) {
      // JTBD event: domain purchase completed successfully.
      markFeedbackRevealMilestone(appId, 'domainPurchase');
    }

    logger.info('domain-purchase.checkout-success', {
      appId,
      domain: purchasedDomain,
      orderId: order?.orderId,
      ...spinContext,
    });

    shipAnalyticsLog('domain.purchase.widget.success', {
      appId,
      conversationId,
      domain: purchasedDomain,
      orderId: order?.orderId,
      ...spinContext,
    });

    // Notify parent component (e.g., DomainAttachWidget which will handle connection)
    if (onPurchaseComplete && purchasedDomain) {
      onPurchaseComplete(purchasedDomain);
      return;
    }

    // Send message to chat about the purchase
    if (purchasedDomain && sendUserMessage) {
      sendUserMessage(`I purchased ${purchasedDomain}!`);
    }
  }

  /**
   * Handle checkout errors - show alert in modal
   */
  function handleCheckoutError(error: { name: string; message?: string; reasonCode?: string }) {
    const purchasedDomain = selectedDomain?.fqdn;

    const spinContext = selectedDomainSelectionContext(
      searchResult?.meta,
      searchResult?.domains,
      selectedDomain,
    );

    logger.error('domain-purchase.checkout-error', {
      appId,
      domain: selectedDomain?.fqdn,
      errorName: error.name,
      reasonCode: error.reasonCode,
      basketId,
      ...spinContext,
    });

    shipAnalyticsLog('domain.purchase.widget.checkout-error', {
      appId,
      conversationId,
      domain: selectedDomain?.fqdn,
      errorName: error.name,
      reasonCode: error.reasonCode,
      ...spinContext,
    });

    // Restore search input defensively — the checkout component may unmount
    // without triggering handleBackFromCheckout, leaving showSearchInput stuck false.
    setShowSearchInput(true);
    setCheckoutError(
      error.message || t('builder_domain_purchase_checkout_error')
    );
  }

  /**
   * Handle add to cart error
   */
  function handleAddToCartError(domain: Domain, resultIndex: number) {
    return (error: any) => {
      setPurchaseStatus('error');
      const spinContext = domainSelectionContext(searchResult?.meta, domain, resultIndex);

      logger.error('domain-purchase.add-to-cart-error', {
        appId,
        domain: domain.fqdn,
        error: error?.message || String(error),
        ...spinContext,
      });

      shipAnalyticsLog('domain.purchase.widget.add-to-cart-error', {
        appId,
        conversationId,
        domain: domain.fqdn,
        error: error?.message || String(error),
        ...spinContext,
      });

      // Error is shown in the widget UI - no need to send chat message
    };
  }

  /**
   * Handle domain unavailable callback
   */
  function handleDomainUnavailable(domain: Domain, resultIndex: number) {
    return () => {
      const spinContext = domainSelectionContext(searchResult?.meta, domain, resultIndex);

      logger.info('domain-purchase.domain-unavailable', {
        appId,
        domain: domain.fqdn,
        ...spinContext,
      });

      shipAnalyticsLog('domain.purchase.widget.unavailable', {
        appId,
        conversationId,
        domain: domain.fqdn,
        ...spinContext,
      });
    };
  }

  /**
   * `@ux/modal` → `@ux/disrupt` mounts react-focus-lock and increments a
   * `data-inert` counter on `document.body`. After the Express Cart
   * (`@px/checkouts`) iframe inside the modal unmounts, the `data-inert`
   * attribute and the focus retention can persist on body, silently
   * killing keyboard interaction with the search input. Force-clear both
   * after a frame so React's unmount path runs first.
   */
  function handleBackFromCheckout() {
    const fqdn = selectedDomain?.fqdn ?? null;
    if (fqdn) {
      setCheckoutResetGenerations((prev) => ({
        ...prev,
        [fqdn]: (prev[fqdn] ?? 0) + 1,
      }));
    }
    setSearchInput(submittedQuery);
    setShowSearchInput(true);
    setShowCheckout(false);
    setSelectedDomain(null);
    setBasketId(null);
    setCheckoutError(null);

    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        document.body.removeAttribute('data-inert');
        const input = document.getElementById('domain-purchase-search');
        if (input instanceof HTMLElement) input.focus();
      });
    }
  }

  /**
   * Handle go back button click (only shown when coming from domain attach)
   */
  function handleGoBack() {
    shipAnalyticsLog('domain.purchase.widget.go_back', {
      appId,
      conversationId,
      brandName,
    });

    if (onCancel) {
      onCancel();
    }
  }

  function handleConnectExistingDomain() {
    logClickEvent('develop.domains.widget_connect_existing')();
    if (sendUserMessage) {
      sendUserMessage('I want to connect a domain I already own', { isActionRequest: true });
    }
  }

  // Don't render if feature flag is disabled
  if (!isDomainPurchaseEnabled) {
    return null;
  }

  const domains = resultDomains;
  const hasResults = domains.length > 0;
  const isEmpty = !isSearching && searchQuery.length >= 2 && !hasResults;
  const needsBrandName = !searchQuery || searchQuery.length < 2;

  return (
    <>
      {/* Checkout Modal */}
      {showCheckout && basketId && (
        <Modal
          onClose={handleBackFromCheckout}
          title={t('builder_domain_purchase_checkout_title')}
          className="domain-purchase-checkout-modal"
        >
          <Box orientation="vertical" gap="md" className="p-4">
            {/* Checkout Error Alert */}
            {checkoutError && (
              <Alert
                emphasis="critical"
                onClose={handleBackFromCheckout}
              >
                {checkoutError}
              </Alert>
            )}

            {/* Express Checkout Component */}
            {!checkoutError && (
              <DynamicCheckout
                id="domain-purchase-checkout"
                appKey="airo-abuilder"
                basketId={basketId}
                checkoutName="ExpressCart"
                loadingSpinner={
                  <Box className="flex items-center justify-center p-8">
                    <Spinner />
                  </Box>
                }
                onPurchaseSuccess={handleCheckoutSuccess}
                onError={handleCheckoutError}
              />
            )}
          </Box>
        </Modal>
      )}

      <Box
        className={`rounded-2xl border border-intents-ux-boxLowContrast-borderColor bg-intents-ux-box-backgroundColor p-4 ${className}`}
        orientation="vertical"
        gap="md"
      >
        {/* Go Back button - above title when coming from domain attach */}
        {isFromDomainAttach && (
          <Button
            className="self-start"
            design="inline"
            size="sm"
            icon={<ChevronLeftIcon />}
            text={t('builder_domain_purchase_go_back')}
            onClick={handleGoBack}
          />
        )}

        {/* Header */}
        <text.strong size={0}>
          {t('builder_domain_purchase_title')}
        </text.strong>

        {/* Search input and button - API runs only on Search click or Enter */}
        {showSearchInput && (
          <form
            className="flex gap-2 items-end"
            onSubmit={(e) => {
              e.preventDefault();
              runSearch();
            }}
          >
            <TextInput
              id="domain-purchase-search"
              label={null}
              placeholder={t('builder_domain_purchase_search_placeholder')}
              value={searchInput}
              onChange={(value: string) => setSearchInput(value)}
              visualSize="sm"
              className="flex-1 min-w-0"
            />
            <Button
              type="submit"
              design="primary"
              size="sm"
              text={t('builder_domain_purchase_search_button')}
              disabled={searchInput.trim().length < 2 || isSearching}
            />
          </form>
        )}

        {/* Description - reserve space during search to avoid layout shift when results load */}
        {searchQuery && (isSearching || hasResults) && (
          <text.p
            size={-1}
            className={`text-intents-ux-text-secondary ${isSearching ? 'invisible' : ''}`}
          >
            {t(
              'builder_domain_purchase_description',
              undefined,
              'Here are the available domains.'
            )}
          </text.p>
        )}

        {/* No Brand Name State */}
        {needsBrandName && (
          <text.p size={-1} className="text-intents-ux-text-secondary">
            {t('builder_domain_purchase_no_brand')}
          </text.p>
        )}

        {/* Loading State - 6 skeletons, same row height as DomainRow (min-h for consistent layout) */}
        {isSearching && (
          <Box orientation="vertical" gap="sm">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={`skeleton-${i}`}
                className="flex items-center justify-between p-2 gap-2 min-h-[2.75rem] rounded-md bg-intents-ux-boxLowContrast-backgroundColor"
              >
                <Skeleton size="md" width="150px" height="1.25rem" />
                <Skeleton size="sm" width="80px" height="1.75rem" />
              </div>
            ))}
          </Box>
        )}

        {/* Search Error */}
        {searchError && (
          <text.p className="text-intents-ux-text-destructive">
            {t('builder_domain_purchase_error_search')}
          </text.p>
        )}

        {/* Empty State */}
        {isEmpty && (
          <text.p size={-1} className="text-intents-ux-text-secondary">
            {t('builder_domain_purchase_no_results')}
          </text.p>
        )}

        {/* Domain List - order from /api/domains/search; exact match row highlighted when isExactMatch */}
        {hasResults && (
          <Box orientation="vertical" gap="sm">
            {domains.slice(0, 6).map((domain, index) => {
              const product = getProduct(domain.productId);
              return (
                <DomainRow
                  key={`domain-${index}-${domain.fqdn}-${checkoutResetGenerations[domain.fqdn] ?? 0}`}
                  domain={domain}
                  product={product}
                  isExactMatch={domain.isExactMatch ?? false}
                  apiKeyName={domainConfig?.apiKeyName}
                  onAddToCartSuccess={handleAddToCartSuccess(domain, index)}
                  onAddToCartError={handleAddToCartError(domain, index)}
                  onUnavailable={handleDomainUnavailable(domain, index)}
                />
              );
            })}
          </Box>
        )}

        {hasResults && isDomainSuggestionFeedbackEnabled && !isSearching && purchaseStatus === 'idle' && (
          <DomainSuggestionFeedback appId={appId || ''} messageId={messageId} conversationId={conversationId} />
        )}

        {hasResults && activeIsc && (
          <text.p
            size={-1}
            className="text-intents-ux-text-secondary"
            data-testid="domain-offer-disclaimer"
          >
            Offer price. Final price subject to eligibility at checkout.
          </text.p>
        )}

        {/* Purchase Success Message */}
        {purchaseStatus === 'success' && selectedDomain && (
          <Box
            className="rounded-lg border bg-intents-ux-success-backgroundColor p-3"
            orientation="vertical"
            gap="sm"
          >
            <text.strong size={-1} className="text-intents-ux-success-textColor">
              {t('builder_domain_purchase_success_title')}
            </text.strong>
            <text.span size={-1} className="text-intents-ux-success-textColor">
              {t('builder_domain_purchase_success_message', { domain: selectedDomain.fqdn })}
            </text.span>
          </Box>
        )}

        {/* Purchase Error Message */}
        {purchaseStatus === 'error' && (
          <Box
            className="rounded-lg border bg-intents-ux-error-backgroundColor p-3"
            orientation="vertical"
            gap="sm"
          >
            <text.strong size={-1} className="text-intents-ux-error-textColor">
              {t('builder_domain_purchase_error_title')}
            </text.strong>
            <text.span size={-1} className="text-intents-ux-error-textColor">
              {t('builder_domain_purchase_error_message')}
            </text.span>
          </Box>
        )}

        {/* Connect existing domain CTA — shown only in standalone (agent-rendered) mode */}
        {!onPurchaseComplete && !!sendUserMessage && (
          <Box
            data-testid="domain-purchase-connect-existing-cta"
            orientation="horizontal"
            gap="sm"
            inlineAlignChildren="center"
            className="pt-2 border-t border-intents-ux-boxLowContrast-borderColor"
          >
            <text.span size={-2} className="text-intents-ux-text-secondary">
              {t('builder_domain_purchase_connect_existing_cta', undefined, 'Already have a domain?')}
            </text.span>
            <Button
              data-testid="domain-purchase-connect-existing-button"
              design="inline"
              size="sm"
              text={t('builder_domain_purchase_connect_existing_button', undefined, 'Connect it')}
              onClick={handleConnectExistingDomain}
            />
          </Box>
        )}
      </Box>
    </>
  );
}

/**
 * Domain Row Component - Simple row design matching the screenshot
 * Each row manages its own cart basket independently
 */
interface DomainRowProps {
  domain: Domain;
  product?: Product;
  isExactMatch?: boolean;
  apiKeyName?: string;
  onAddToCartSuccess: (result: any) => void;
  onAddToCartError: (error: any) => void;
  onUnavailable: () => void;
}

function DomainRow({
  domain,
  product,
  isExactMatch = false,
  apiKeyName,
  onAddToCartSuccess,
  onAddToCartError,
  onUnavailable,
}: DomainRowProps) {
  const t = useTranslations();
  const price = product?.priceInfo;
  const priceLabel = domain.priceDisplay || price?.currentPriceDisplay;
  // Show the strikethrough list price only when the product is genuinely on
  // sale and the row uses product-level pricing (not premium/aftermarket
  // pricing carried on the domain itself, which has no list/current split).
  const compareAtPrice =
    !domain.priceDisplay && price?.isOnSale && price.listPriceDisplay !== price.currentPriceDisplay
      ? price.listPriceDisplay
      : null;
  const urlOverride = getRootDomain() || 'godaddy.com';

  const [rowBasketId, setRowBasketId] = useState<string | null>(() => crypto.randomUUID());

  // Wrap success callback to capture and store basketId for this row
  const handleSuccess = (result: any) => {
    const newBasketId = result?.basketId || result?.data?.basketId;
    if (newBasketId && newBasketId !== 'default') {
      setRowBasketId(newBasketId);
    }
    onAddToCartSuccess(result);
  };

  // Language object required by AddToCartButton
  const addToCartLanguage = {
    verifyingAvailability: t('builder_domain_purchase_verifying'),
    domainFailedAvailCheck: t('builder_domain_purchase_unavailable'),
    successText: t('builder_domain_purchase_added'),
    renewalText: '',
    buyButtonText: priceLabel || t('builder_domain_purchase_button'),
  };

  return (
    // `break-all` on the domain prevents long FQDNs from pushing the
    // price/button column off-screen.
    <div
      className={`flex items-center gap-3 p-2 rounded-md ${isExactMatch
        ? 'bg-intents-ux-boxLowContrast-borderColor'
        : 'bg-intents-ux-boxLowContrast-backgroundColor'
        }`}
    >
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <text.span size={0} className="break-all">
          {domain.fqdn}
        </text.span>
        {priceLabel && (
          <div className="flex items-baseline gap-1.5">
            {compareAtPrice && (
              <text.span
                size={-1}
                className="text-intents-ux-text-secondary line-through"
                data-testid="domain-compare-at-price"
              >
                {compareAtPrice}
              </text.span>
            )}
            <text.strong size={-1}>{priceLabel}</text.strong>
          </div>
        )}
      </div>
      <div className="flex-shrink-0 [&_.ux-button]:!py-1 [&_.ux-button]:!px-2">
        {domain._raw && apiKeyName && (
          <AddToCartButton
            language={addToCartLanguage}
            apiKey={apiKeyName}
            eid="airo.domain.purchase."
            plid="1"
            trackingCode={PAYWALL_ITC.DOMAIN_PURCHASE}
            basketId={rowBasketId || undefined}
            domain={domain._raw}
            // TODO: swap to a cart icon once @site/buttons exposes an icon prop.
            buttonText="+"
            buttonDesign="primary"
            successCallback={handleSuccess}
            failureCallback={onAddToCartError}
            unavailableCallback={onUnavailable}
            urlOverride={urlOverride}
          />
        )}
      </div>
    </div>
  );
}
