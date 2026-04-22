'use client'

import { useEffect, useMemo, useRef, useState } from 'react';
import { fqdnIsConnectedOrProvisioningOnSite } from '@airo/shared';
import Box from '@ux/box';
import Button from '@ux/button';
import CartIcon from '@ux/icon/cart';
import Skeleton from '@ux/skeleton';
import Spinner from '@ux/spinner';
import Tag from '@ux/tag';
import text from '@ux/text';

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext';
import DomainDNS from '@/app/[market]/develop/components/settings/components/DomainDNS';
import DomainItem from '@/app/[market]/develop/components/settings/components/DomainItem';
import ExternalDomainInput from '@/app/[market]/develop/components/settings/components/ExternalDomainInput';
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils';
import DomainPurchaseWidget from '@/app/[market]/develop/components/widgets/DomainPurchaseWidget';
import { useAuth } from '@/hooks/useAuth';
import { useCustomerDomainAttach } from '@/hooks/useCustomerDomainAttach';
import { useDomainDnsOwnership } from '@/hooks/useDomainDnsOwnership';
import { useDomainPolling } from '@/hooks/useDomainPolling';
import { useDomainsQuery } from '@/hooks/useDomainsQuery';
import { useDomainValidationQuery } from '@/hooks/useDomainValidationQuery';
import { DomainMutationError, useModifyDomains } from '@/hooks/useModifyDomains';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { shipAnalyticsLog } from '@/lib/logging';
import { DomainMode, DomainStatus } from '@/lib/mgmt-airo/types';
import { logger } from '@/lib/request-context';
import { useSiteStore } from '@/stores/useSiteStore';
import { isBlockedAiroDomain, isCustomerDomain, sanitizeDomainInput, validateDomain } from '@/utils/domain';
import { getDomainErrorMessage, translateDomainApiError } from '@/utils/domain-validation';
import { hasBeenPublished } from '@/utils/site';

const DOMAINS_PER_PAGE = 5;

const DOMAIN_ATTACH_WIDGET_CONNECT_INFO_DEFAULT =
    'GoDaddy-hosted domains can get DNS updated automatically; elsewhere you change DNS at your registrar or host. Connecting ties this web address to this published app and detaches it from any other site that was using that domain.';

export interface DomainAttachWidgetProps {
  brandName?: string
  appId?: string
  className?: string
}

/**
 * Domain Attach Widget
 *
 * Displays the user's GoDaddy domains with connect/disconnect options
 * and allows users to add external custom domains with DNS instructions.
 *
 * This is a chat-based version of the DomainPanel settings component.
 *
 * Features:
 * - Shows user's GoDaddy domains with quick connect option
 * - Custom domain input for external domains
 * - DNS instructions for pending external domains
 * - Internal domain detection for automatic DNS configuration
 */
export default function DomainAttachWidget({
  brandName,
  appId: propAppId,
  className = ''
}: DomainAttachWidgetProps) {
  const t = useTranslations();
  const sendUserMessage = useSendUserMessage();
  const paramAppId = useAppIdFromParams();
  const appId = propAppId || paramAppId;
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  // Feature flag check
  const { data: isDomainAttachEnabled, isLoading: isLoadingFlag } = useSwitchboard('appbuilder-domain-attach');
  const { data: isDomainPurchaseEnabled } = useSwitchboard('appbuilder-domain-purchase');

  // Custom domain input state
  const [customDomain, setCustomDomain] = useState<string | null>(null);
  const [customDomainError, setCustomDomainError] = useState<string | null>(null);
  const [debouncedDomain, setDebouncedDomain] = useState('');
  const [showCustomDomainConfirmation, setShowCustomDomainConfirmation] = useState(false);
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Domain purchase widget state
  const [showPurchaseWidget, setShowPurchaseWidget] = useState(false);
  const [purchasedDomain, setPurchasedDomain] = useState<string | null>(null);

  // Pagination for domain list
  const [visibleDomainCount, setVisibleDomainCount] = useState(5);

  // Confirmation state for attaching owned domain (Case 1)
  const [showOwnedDomainConfirmation, setShowOwnedDomainConfirmation] = useState(false);
  const [matchedOwnedDomain, setMatchedOwnedDomain] = useState<string | null>(null);

  const site = useSiteStore((state) => appId ? state.getSite(appId) : null);

  const sanitizedInput = customDomain ? sanitizeDomainInput(customDomain) : '';
  const isAiroDomainBlocked = sanitizedInput.length > 0 && isBlockedAiroDomain(sanitizedInput);

  // Validate domain when user has entered a value
  const shouldValidate = debouncedDomain.length > 0;
  const { data: validationData, isLoading: isValidatingDomain, isError: hasValidationError } = useDomainValidationQuery(
    appId,
    debouncedDomain,
    {
      mode: DomainMode.CUSTOM,
      enabled: shouldValidate && !isBlockedAiroDomain(sanitizeDomainInput(debouncedDomain)),
      subscriptionId: site?.subscription_id,
      systemId: site?.system_id
    }
  )

  const modifyDomainsMutation = useModifyDomains();

  const {
    data: domains = [],
    isLoading: isLoadingDomains,
    error: domainsError,
    isFetched: isDomainsFetched,
  } = useDomainsQuery({
    enabled: isAuthenticated && !authLoading,
  });

  // Compute actual loading state
  const isLoading = authLoading || isLoadingDomains || (!isDomainsFetched && isAuthenticated);

  // Poll while any domain is in a transitional state (pending, deleting, no status yet)
  const { data: appDetails, isFetched: isAppDetailsFetched } = useDomainPolling(appId);

  // Handle customer domain attachment with automatic DNS configuration
  const {
    pendingCustomerDomain: pendingCustomerDomainForAttach,
    requiresManualDnsSetup,
  } = useCustomerDomainAttach(appDetails, domains);

  const pendingDomain = useMemo(() => {
    if (!appDetails?.domains) return null;

    // First, check for customer domain that requires manual DNS setup
    // This covers: external nameservers OR attach API failed
    if (requiresManualDnsSetup && pendingCustomerDomainForAttach) {
      return pendingCustomerDomainForAttach.fqdn;
    }

    // Then check for custom domains (not customer-owned)
    const pending = appDetails.domains.find((d) => {
      if (d.domainType === 'prefix') return false;
      if (isCustomerDomain(d.fqdn, domains)) return false;
      // ERROR/FAILED/INACTIVE are terminal, and no-status means we don't yet know — don't show DNS instructions for either.
      return d.status === DomainStatus.PENDING || d.status === DomainStatus.DELETING;
    });

    return pending ? pending.fqdn : null;
  }, [appDetails, domains, requiresManualDnsSetup, pendingCustomerDomainForAttach]);

  const pendingDomainDetails = pendingDomain
    ? appDetails?.domains?.find((d) => d.fqdn === pendingDomain)
    : null;

  const domainDnsOwnershipEnabled = !!pendingDomain && !!pendingDomainDetails;
  const {
    data: domainDnsOwnershipData,
    isLoading: isDomainDnsOwnershipLoading,
    isError: isDomainDnsOwnershipError,
  } = useDomainDnsOwnership({
    siteId: appId,
    fqdns: pendingDomain ?? '',
    enabled: domainDnsOwnershipEnabled,
  });

  const hideDomainDnsUntilOwnershipResolved =
    domainDnsOwnershipEnabled &&
    isDomainDnsOwnershipLoading &&
    !domainDnsOwnershipData &&
    !isDomainDnsOwnershipError;

  // Prefer last successful ownership data when present (refetch errors can coexist
  // with cached data). Assume external only when there is no data yet and the query errored.
  const treatAsExternal = !domainDnsOwnershipData
    ? isDomainDnsOwnershipError
    : domainDnsOwnershipData.isGdDomain !== true;

  const showDomainDNS =
    !!pendingDomainDetails &&
    !hideDomainDnsUntilOwnershipResolved &&
    treatAsExternal;

  // Cleanup validation timeout on unmount
  useEffect(() => {
    return () => {
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current);
      }
    };
  }, []);

  /**
   * Check if brandName is a domain format (contains TLD)
   */
  function isDomainFormat(name: string): boolean {
    return /\.[a-z]{2,}$/i.test(name);
  }

  /**
   * Reconstruct full domain from brandName
   * brandName can be:
   * - Full domain: "example.com" -> "example.com"
   * - Domain without TLD: "example" -> try common TLDs
   */
  function reconstructDomain(name: string, ownedDomains: any[]): string | null {
    if (isDomainFormat(name)) {
      return name;
    }

    // Try to match with owned domains by checking if any owned domain starts with brandName
    const matchedDomain = ownedDomains.find(d => {
      const domainName = d.name || d.internationalDisplayName || '';
      return domainName.startsWith(`${name}.`) || domainName === name;
    });

    if (matchedDomain) {
      return matchedDomain.domain || matchedDomain.name;
    }

    return null;
  }

  /**
   * Determine widget mode based on brandName and owned domains
   * Case 1 (Happy): brandName matches owned domain -> Show confirmation
   * Case 2 (Neutral): No brandName or not a domain -> Show full widget
   * Case 3 (Sad): brandName is domain but doesn't match owned -> Pre-fill external input
   */
  useEffect(() => {
    if (!isDomainsFetched || !brandName || showOwnedDomainConfirmation || matchedOwnedDomain || customDomain) {
      return;
    }

    if (appId && !isAppDetailsFetched) {
      return;
    }

    const trimmedBrandName = brandName.trim();
    if (!trimmedBrandName) return;

    const fullDomain = reconstructDomain(trimmedBrandName, domains);

    if (fullDomain && isCustomerDomain(fullDomain, domains)) {
      if (fqdnIsConnectedOrProvisioningOnSite(appDetails?.domains, fullDomain)) {
        shipAnalyticsLog('domain.attach.widget.case1.skip_already_on_app', {
          appId,
          brandName,
          matchedDomain: fullDomain
        });
        return;
      }
      setMatchedOwnedDomain(fullDomain);
      setShowOwnedDomainConfirmation(true);

      shipAnalyticsLog('domain.attach.widget.case1.matched_owned', {
        appId,
        brandName,
        matchedDomain: fullDomain
      });
    } else if (isDomainFormat(trimmedBrandName)) {
      if (fqdnIsConnectedOrProvisioningOnSite(appDetails?.domains, trimmedBrandName)) {
        shipAnalyticsLog('domain.attach.widget.case3.skip_already_on_app', {
          appId,
          brandName,
          domain: trimmedBrandName
        });
        return;
      }
      setCustomDomain(trimmedBrandName);
      setDebouncedDomain(trimmedBrandName);

      shipAnalyticsLog('domain.attach.widget.case3.prefill_external', {
        appId,
        brandName,
        domain: trimmedBrandName
      });
    }
    // Case 2: brandName is not a domain or empty -> Show full widget (default behavior)

  }, [appDetails?.domains, appId, brandName, customDomain, domains, isAppDetailsFetched, isDomainsFetched, matchedOwnedDomain, showOwnedDomainConfirmation]);

  function handleCustomDomainChange(value: string) {
    setCustomDomain(value);

    if (customDomainError) {
      setCustomDomainError(null);
    }

    if (validationTimeoutRef.current) {
      clearTimeout(validationTimeoutRef.current);
    }

    validationTimeoutRef.current = setTimeout(() => {
      setDebouncedDomain(value || '');
    }, 500);
  }

  function getValidationErrorMessage(): string | undefined {
    if (isAiroDomainBlocked) {
      return t('builder_domain_error_fqdn_invalid');
    }
    if (validationData && !validationData.available) {
      return getDomainErrorMessage(validationData.errors, t);
    }
    if (modifyDomainsMutation.error) {
      if (modifyDomainsMutation.error instanceof DomainMutationError) {
        return translateDomainApiError(
          modifyDomainsMutation.error.details.code,
          t,
          modifyDomainsMutation.error.details.message
        );
      }
      return modifyDomainsMutation.error instanceof Error
        ? modifyDomainsMutation.error.message
        : t('builder_custom_domain_error_add_failed');
    }
    if (hasValidationError) {
      return t('builder_custom_domain_error_validation_failed');
    }
    return undefined;
  }

  async function handleConnectDomain(domainName: string) {
    if (!appId) return;

    const isGoDaddyDomain = isCustomerDomain(domainName, domains);

    try {
      setCustomDomain(null);

      await modifyDomainsMutation.mutateAsync({
        siteId: appId,
        payload: {
          domainsToCreate: [{ fqdn: domainName, primary: false }],
          createCdn: true,
          isWildcardDomain: true,
        },
      });
      shipAnalyticsLog('domain.attach.widget.connect.success', {
        appId,
        domainName,
        isGoDaddyDomain
      });

      if (sendUserMessage) {
        if (isGoDaddyDomain) {
          sendUserMessage(`Connected ${domainName} (GoDaddy domain - DNS will be auto-configured)`, { isActionRequest: true });
        } else {
          sendUserMessage(`Connected ${domainName} (external domain - DNS configuration required)`, { isActionRequest: true });
        }
      }
    } catch (error) {
      logger.error('domain-attach-widget.connect.failure', {
        message: 'Failed to connect domain',
        domainName,
        isGoDaddyDomain,
        error: error instanceof Error ? error.message : String(error),
      });
      shipAnalyticsLog('domain.attach.widget.connect.failed', {
        appId,
        domainName,
        isGoDaddyDomain,
        error: error instanceof Error ? error.message : String(error)
      });

      if (sendUserMessage) {
        sendUserMessage(`Failed to connect ${domainName}. Please try again.`, { isActionRequest: true });
      }
    }
  }

  async function handleDisconnectDomain(domainName: string) {
    if (!appId) return;

    try {
      await modifyDomainsMutation.mutateAsync({
        siteId: appId,
        payload: {
          domainsToDelete: [{ fqdn: domainName }],
        },
      });
      shipAnalyticsLog('domain.attach.widget.disconnect.success', {
        appId,
        domainName
      });

      if (sendUserMessage) {
        sendUserMessage(`I've disconnected ${domainName} from this project.`, { isActionRequest: true });
      }
    } catch (error) {
      logger.error('domain-attach-widget.disconnect.failure', {
        message: 'Failed to disconnect domain',
        domainName,
        error: error instanceof Error ? error.message : String(error),
      });
      shipAnalyticsLog('domain.attach.widget.disconnect.failed', {
        appId,
        domainName,
        error: error instanceof Error ? error.message : String(error)
      });

      if (sendUserMessage) {
        sendUserMessage(`Failed to disconnect ${domainName}. Please try again.`, { isActionRequest: true });
      }
    }
  }

  function handleAddCustomDomain() {
    if (!customDomain || !appId) return;

    if (isAiroDomainBlocked) {
      setCustomDomainError(t('builder_domain_error_fqdn_invalid'));
      return;
    }

    const validation = validateDomain(customDomain);

    if (!validation.isValid) {
      setCustomDomainError(validation.error || t('builder_custom_domain_error_invalid'));
      return;
    }

    setCustomDomainError(null);
    setShowCustomDomainConfirmation(true);
  }

  async function handleConfirmAddCustomDomain() {
    if (!customDomain || !appId) return;

    setShowCustomDomainConfirmation(false);

    shipAnalyticsLog('domain.attach.widget.custom.submitted', {
      appId,
      domain: sanitizeDomainInput(customDomain),
      brandName,
    });

    await handleConnectDomain(sanitizeDomainInput(customDomain));
    setCustomDomain(null);
    setDebouncedDomain('');
  }

  function handleCancelAddCustomDomain() {
    setShowCustomDomainConfirmation(false);
  }

  function handleCancelPurchase() {
    setShowPurchaseWidget(false);

    shipAnalyticsLog('domain.attach.widget.purchase.cancelled', {
      appId,
      brandName,
    });
  }

  function handlePurchaseComplete(domain: string) {
    setPurchasedDomain(domain);
    setShowPurchaseWidget(false);
    setCustomDomain(domain);

    shipAnalyticsLog('domain.attach.widget.purchase.completed', {
      appId,
      brandName,
      domain,
    });
  }

  function handleOpenPurchase() {
    setShowPurchaseWidget(true);

    shipAnalyticsLog('domain.attach.widget.purchase.opened', {
      appId,
      brandName,
    });
  }

  async function handleConfirmOwnedDomainAttach() {
    if (!matchedOwnedDomain) return;

    setShowOwnedDomainConfirmation(false);

    shipAnalyticsLog('domain.attach.widget.owned.confirmed', {
      appId,
      domain: matchedOwnedDomain,
      brandName,
    });

    await handleConnectDomain(matchedOwnedDomain);
  }

  function handleCancelOwnedDomainAttach() {
    setShowOwnedDomainConfirmation(false);
    setMatchedOwnedDomain(null);

    shipAnalyticsLog('domain.attach.widget.owned.cancelled', {
      appId,
      domain: matchedOwnedDomain,
      brandName,
    });
  }

  // Get customer domain entries (includes root domains + connected subdomains)
  const customerDomainEntries = (isDomainsFetched && isAppDetailsFetched) ? domains.map((domain) => {
    const connectedDomains = appDetails?.domains?.filter(
      (appDomain) =>
        appDomain.domainType !== 'prefix' &&
        isCustomerDomain(appDomain.fqdn, [domain])
    ) || [];

    return {
      customerDomain: domain,
      connectedDomains,
    };
  }) : [];

  // Get custom domains (not prefix, not owned by customer)
  const customDomains = (isDomainsFetched && isAppDetailsFetched && appDetails?.domains) ? appDetails.domains.filter(
    (appDomain) =>
      appDomain.domainType !== 'prefix' &&
      !isCustomerDomain(appDomain.fqdn, domains)
  ) : [];

  // Check if there's already a domain being added or active
  const hasActiveOrPendingCustomDomain = customDomains.some(
    (d) => d.status === DomainStatus.PENDING || d.status === DomainStatus.ACTIVE
  );

  const hasActiveOrPendingDomain = appDetails?.domains
    ?.filter((d) => d.domainType !== 'prefix')
    ?.some((d) => d.status === DomainStatus.PENDING || d.status === DomainStatus.ACTIVE);

  const isPublished = hasBeenPublished(site);

  // In local dev (no subscription_id), allow domain operations without requiring publish
  const isLocalDev = site && !site.subscription_id;
  const requiresPublish = !isLocalDev && !isPublished;

  const shouldDisableAddingDomain =
    hasActiveOrPendingCustomDomain ||
    hasActiveOrPendingDomain ||
    requiresPublish ||
    modifyDomainsMutation.isPending;

  // Don't render if feature flag is disabled or still loading
  if (isLoadingFlag || !isDomainAttachEnabled) {
    return null;
  }

  // Show Domain Purchase Widget as a full replacement when opened
  if (showPurchaseWidget) {
    return (
      <DomainPurchaseWidget
        brandName={brandName}
        appId={appId}
        onPurchaseComplete={handlePurchaseComplete}
        onCancel={handleCancelPurchase}
        className={className}
      />
    );
  }

  // Case 1: Show owned domain confirmation if brandName matches owned domain
  if (showOwnedDomainConfirmation && matchedOwnedDomain) {
    return (
      <Box
        className={`rounded-lg border border-intents-ux-boxLowContrast-borderColor bg-intents-ux-box-backgroundColor p-4 ${className}`}
        orientation="vertical"
        gap="md"
      >
        <text.h4>
          {t('builder_domain_attach_confirm_title')}
        </text.h4>

        <text.p size={0}>
          {t('builder_domain_attach_confirm_message', { domain: matchedOwnedDomain })}
        </text.p>

        <Box orientation="horizontal" gap="sm">
          <Button
            design="primary"
            size="md"
            text={t('builder_domain_attach_confirm_attach')}
            onClick={handleConfirmOwnedDomainAttach}
            disabled={modifyDomainsMutation.isPending}
          />
          <Button
            design="secondary"
            size="md"
            text={t('builder_common_cancel')}
            onClick={handleCancelOwnedDomainAttach}
            disabled={modifyDomainsMutation.isPending}
          />
        </Box>

        {modifyDomainsMutation.isPending && (
          <Box orientation="horizontal" gap="sm" inlineAlignChildren="center">
            <Spinner size="sm" />
            <text.span size={-1} className="text-intents-ux-text-secondary">
              {t('builder_domain_attach_connecting')}
            </text.span>
          </Box>
        )}
      </Box>
    );
  }

  const hasGoDaddyDomains = !isLoading && !domainsError && customerDomainEntries.length > 0;

  return (
    <Box
      className={`rounded-lg border border-intents-ux-boxLowContrast-borderColor bg-intents-ux-box-backgroundColor p-4 ${className}`}
      orientation="vertical"
      gap="md"
    >
      <Box orientation="vertical" gap="sm">
        <text.span size={-1} className="text-intents-ux-text-secondary">
          {t('builder_domain_attach_widget_description')}
        </text.span>
        <text.span size={-1} className="text-intents-ux-text-secondary">
          {t(
            'builder_domain_attach_widget_connect_info',
            undefined,
            DOMAIN_ATTACH_WIDGET_CONNECT_INFO_DEFAULT
          )}
        </text.span>
      </Box>

      {/* Section 1: Your GoDaddy Domains */}
      <Box className="rounded-md bg-intents-ux-boxLowContrast-backgroundColor p-3" orientation="vertical" gap="sm">
        <text.h4>
          {t('builder_domain_attach_godaddy_title')}
        </text.h4>

        {isLoading && (
          <Box gap="sm">
            {[1, 2, 3].map((i) => (
              <div
                key={`skeleton-${i}`}
                className="bg-intents-ux-box-backgroundColor rounded-lg px-2 py-1 flex gap-1"
              >
                <Skeleton rounding="full" size="sm" />
                <Skeleton size="md" width="30%" />
              </div>
            ))}
          </Box>
        )}

        {domainsError && (
          <text.p emphasis="critical">
            {t('builder_custom_domain_error_fetch_failed')}
          </text.p>
        )}
        {/* Empty state with purchase CTA */}
        {!isLoading && !domainsError && !hasGoDaddyDomains && (
          <>
            <text.span size={-1} className="text-intents-ux-text-secondary">
              {t('builder_custom_domain_no_domains')}
            </text.span>
            {isDomainPurchaseEnabled && (
              <Button
                design="primary"
                size="sm"
                onClick={handleOpenPurchase}
                text={t('builder_domain_purchase_button')}
              >
                <CartIcon className="w-4 h-4 mr-1" />
              </Button>
            )}
          </>
        )}

        {/* Domain list */}
        {hasGoDaddyDomains && customerDomainEntries.slice(0, visibleDomainCount).map((entry, index) => {
          const domainName = entry.customerDomain.domain || entry.customerDomain.name || '';

          return (
            <Box
              key={`customer-domain-${index}-${domainName}`}
              className="rounded-md bg-intents-ux-box-backgroundColor p-2"
              gap="sm"
            >
              {(() => {
                const rootAppDomain = entry.connectedDomains.find((d) => d.fqdn === domainName);
                return (
                  <DomainItem
                    domain={entry.customerDomain}
                    appDomain={rootAppDomain}
                    siteId={appId}
                    onConnect={handleConnectDomain}
                    onDisconnect={handleDisconnectDomain}
                    isLoading={modifyDomainsMutation.isPending}
                    disableConnect={shouldDisableAddingDomain}
                    mutationError={modifyDomainsMutation.error}
                  />
                )
              })()}

              {entry.connectedDomains
                .filter((d) => d.fqdn !== domainName)
                .map((subdomain, subIndex) => (
                  <DomainItem
                    key={`subdomain-${index}-${subIndex}-${subdomain.fqdn}`}
                    domain={{
                      domain: subdomain.fqdn,
                      name: subdomain.fqdn,
                    }}
                    appDomain={subdomain}
                    siteId={appId}
                    onConnect={handleConnectDomain}
                    onDisconnect={handleDisconnectDomain}
                    isLoading={modifyDomainsMutation.isPending}
                    disableConnect={shouldDisableAddingDomain}
                    isCustomDomain={true}
                    mutationError={modifyDomainsMutation.error}
                  />
                ))}
            </Box>
          )
        })}

        {hasGoDaddyDomains && customerDomainEntries.length > visibleDomainCount && (
          <Button
            design="tertiary"
            size="sm"
            text={t(
              'builder_domain_attach_show_more',
              { remaining: customerDomainEntries.length - visibleDomainCount }
            )}
            onClick={() => setVisibleDomainCount(prev => prev + DOMAINS_PER_PAGE)}
          />
        )}
        {/* Recently purchased domain tag */}
        {purchasedDomain && (
          <Tag emphasis="success">
            {t('builder_domain_purchase_recently', { domain: purchasedDomain })}
          </Tag>
        )}
      </Box>

      {/* Section 2: Connect External Domain */}
      <Box className="rounded-md bg-intents-ux-boxLowContrast-backgroundColor p-3" orientation="vertical" gap="sm">
        <text.h4>
          {t('builder_domain_attach_external_title')}
        </text.h4>

        {!showCustomDomainConfirmation && (
          <ExternalDomainInput
            value={customDomain}
            onChange={handleCustomDomainChange}
            disabled={shouldDisableAddingDomain}
            errorMessage={
              isAiroDomainBlocked || (customDomain === debouncedDomain && !isValidatingDomain)
                ? getValidationErrorMessage()
                : undefined
            }
            isValidating={isValidatingDomain}
            isValidationComplete={customDomain === debouncedDomain}
            isAvailable={!hasValidationError && validationData?.available !== false && !isAiroDomainBlocked}
            onAdd={handleAddCustomDomain}
          />
        )}

        {showCustomDomainConfirmation && (
          <Box
            className="rounded-md bg-intents-ux-box-backgroundColor p-3"
            orientation="vertical"
            gap="sm"
          >
            <text.strong size={-1}>
              {t('builder_domain_connect_confirmation_title')}
            </text.strong>
            <text.span size={-1}>
              {t('builder_domain_connect_confirmation_description')}
            </text.span>
            <Box orientation="horizontal" gap="sm">
              <Button
                design="primary"
                size="sm"
                text={t('builder_custom_domain_modal_button_continue')}
                onClick={handleConfirmAddCustomDomain}
              />
              <Button
                design="secondary"
                size="sm"
                text={t('builder_custom_domain_modal_button_cancel')}
                onClick={handleCancelAddCustomDomain}
              />
            </Box>
          </Box>
        )}
      </Box>

      {/* Custom Domains Added Section */}
      {customDomains.length > 0 && (
        <Box gap="sm">
          <text.strong size={-1}>
            {t('builder_domain_attach_custom_domains')}
          </text.strong>
          {customDomains.map((appDomain, index) => (
            <DomainItem
              key={`custom-domain-${index}-${appDomain.fqdn}`}
              domain={{
                domain: appDomain.fqdn,
                name: appDomain.fqdn,
              }}
              appDomain={appDomain}
              siteId={appId}
              onConnect={handleConnectDomain}
              onDisconnect={handleDisconnectDomain}
              isLoading={modifyDomainsMutation.isPending}
              disableConnect={shouldDisableAddingDomain}
              isCustomDomain={true}
              mutationError={modifyDomainsMutation.error}
            />
          ))}
        </Box>
      )}

      {/* DNS Instructions for Pending External Domain */}
      {showDomainDNS && (
        <Box gap="sm">
          <text.strong size={-1}>
            {t('builder_domain_attach_dns_title')}
          </text.strong>
          <DomainDNS domainDetails={pendingDomainDetails} />
        </Box>
      )}

      {/* Purchase option - only shown when user HAS domains (otherwise shown in empty state) */}
      {isDomainPurchaseEnabled && hasGoDaddyDomains && (
        <Box orientation="horizontal" gap="sm" inlineAlignChildren="center" className="pt-2 border-t border-intents-ux-boxLowContrast-borderColor">
          <text.span size={-2} className="text-intents-ux-text-secondary">
            {t('builder_domain_purchase_cta')}
          </text.span>
          <Button
            design="tertiary"
            size="sm"
            onClick={handleOpenPurchase}
            text={t('builder_domain_purchase_button')}
          >
            <CartIcon className="w-4 h-4 mr-1" />
          </Button>
        </Box>
      )}
    </Box>
  )
}
