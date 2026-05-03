import { useEffect, useMemo, useRef, useState } from "react";
import Box from "@ux/box";
import Button from "@ux/button";
import Modal from "@ux/modal";
import Skeleton from "@ux/skeleton";
import text from "@ux/text";
import TextInput from "@ux/text-input";

import DomainDNS from "@/app/[market]/develop/components/settings/components/DomainDNS";
import DomainItem from "@/app/[market]/develop/components/settings/components/DomainItem";
import SettingsSection from "@/app/[market]/develop/components/settings/SettingsSection";
import { Status } from "@/app/[market]/develop/components/types";
import { useAppIdFromParams } from "@/app/[market]/develop/components/utils";
import { DomainConflictModal } from '@/app/[market]/develop/components/widgets/DomainConflictModal';
import type { AppDetailsResponse } from '@/hooks/useAppDetails';
import { useAuth } from '@/hooks/useAuth';
import { useCustomerDomainAttach } from '@/hooks/useCustomerDomainAttach';
import { useDomainDnsOwnership } from '@/hooks/useDomainDnsOwnership';
import { useDomainsQuery } from '@/hooks/useDomainsQuery';
import { useDomainTransfer } from '@/hooks/useDomainTransfer';
import { useDomainValidationQuery } from '@/hooks/useDomainValidationQuery';
import {
  type DomainMutationDetails,
  DomainMutationError,
  useModifyDomains
} from '@/hooks/useModifyDomains';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { DomainStatus as ControlPlaneDomainStatus } from '@/lib/control-plane/types';
import { shipAnalyticsLog } from '@/lib/logging';
import { DomainMode, DomainStatus } from '@/lib/mgmt-airo/types';
import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSiteStore } from "@/stores/useSiteStore";
import { isBlockedAiroDomain, isCustomerDomain, sanitizeDomainInput, validateDomain } from '@/utils/domain';
import { getDomainErrorMessage, translateDomainApiError } from '@/utils/domain-validation';
import { getRootDomain } from '@/utils/getRootDomain';
import { generateClickEID } from '@/utils/instrumentation';
import { hasBeenPublished } from '@/utils/site';

/**
 * Get error message from unknown error type
 *
 * @param error - The error object to extract message from
 * @param t - Translation function from useTranslations hook
 * @returns Error message string
 */
function getErrorMessage(error: unknown, t: ReturnType<typeof useTranslations>): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return t('builder_custom_domain_error_fetch_failed')
}

interface DomainAttachProps {
  appDetails: AppDetailsResponse | undefined;
  isAppDetailsFetched: boolean;
}

/**
 * Domain attachment and custom domain management component
 *
 * Handles connecting and managing custom domains for the application,
 * including DNS configuration instructions for pending domains.
 */
export default function DomainAttach({ appDetails, isAppDetailsFetched }: DomainAttachProps) {
  const t = useTranslations();
  const currentAppId = useAppIdFromParams()
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const isDomainTransferEnabled = useSwitchboard('appbuilder-domain-transfer');
  const [customDomain, setCustomDomain] = useState(null);
  const [customDomainError, setCustomDomainError] = useState<string | null>(null);
  const [debouncedDomain, setDebouncedDomain] = useState('');
  const [showAddConfirmation, setShowAddConfirmation] = useState(false);
  const [conflictData, setConflictData] = useState<DomainMutationDetails['conflictDetails'] | null>(null);
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const site = useSiteStore((state) => {
    if (!currentAppId) return null;
    return state.getSite(currentAppId);
  });

  const hasActiveDomainJob = useDevelopPageStore(
    (s) => Boolean(currentAppId && s.domainJobsInProgress?.[currentAppId]),
  );

  // Validate domain when user has entered a value
  const shouldValidate = debouncedDomain.length > 0;
  const { data: validationData, isLoading: isValidatingDomain, isError: hasValidationError } = useDomainValidationQuery(
    currentAppId,
    debouncedDomain,
    {
      mode: DomainMode.CUSTOM,
      enabled: shouldValidate && !isBlockedAiroDomain(sanitizeDomainInput(debouncedDomain)),
      subscriptionId: site?.subscription_id,
      systemId: site?.system_id
    }
  );

  const modifyDomainsMutation = useModifyDomains();
  const { isTransferring, transferError, handleTransferDomain, clearTransferError } = useDomainTransfer({
    modifyDomainsMutation,
    conflictData,
    setConflictData,
    logger,
    shipAnalyticsLog,
    appId: currentAppId,
    analyticsPrefix: 'domain.custom',
    unsupportedOwnerTypeErrorMessage: t('builder_custom_domain_error_add_failed'),
  });

  const {
    data: domains = [],
    isLoading: isLoadingDomains,
    error,
    isFetched: isDomainsFetched,
  } = useDomainsQuery({
    enabled: isAuthenticated && !authLoading,
  });

  // Compute actual loading state - show loading until we've attempted to fetch
  const isLoading = authLoading || isLoadingDomains || (!isDomainsFetched && isAuthenticated);

  const sanitizedInput = customDomain ? sanitizeDomainInput(customDomain) : '';
  const isAiroDomainBlocked = sanitizedInput.length > 0 && isBlockedAiroDomain(sanitizedInput);

  // Handle customer domain attachment with automatic DNS configuration
  // Hook receives appDetails from above query and manages auto-attach flow for GoDaddy domains
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
      // Exclude prefix/project domains
      if (d.domainType === 'prefix') return false;

      // Exclude customer domains (including subdomains of customer domains)
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
    siteId: currentAppId,
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
   * Handle custom domain input change with debouncing
   *
   * Debounces the domain validation to avoid excessive API calls
   * while the user is typing.
   */
  function handleCustomDomainChange(value: string) {
    setCustomDomain(value);

    // Clear error when user starts typing
    if (customDomainError) {
      setCustomDomainError(null);
    }

    // Clear any existing timeout
    if (validationTimeoutRef.current) {
      clearTimeout(validationTimeoutRef.current);
    }

    // Debounce validation by 500ms for responsive UX
    validationTimeoutRef.current = setTimeout(() => {
      setDebouncedDomain(value || '');
    }, 500);
  }

  /**
   * Get validation error message for custom domain
   *
   * Returns error message from domain validation or undefined if valid
   */
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

  /**
   * Handle connecting a domain to the application
   */
  async function handleConnectDomain(domainName: string) {
    if (!currentAppId) return;

    try {
      setCustomDomain(null);
      await modifyDomainsMutation.mutateAsync({
        siteId: currentAppId,
        payload: {
          domainsToCreate: [{ fqdn: domainName, primary: false }],
          createCdn: true,
          isWildcardDomain: true,
        },
      });
      shipAnalyticsLog('domain.custom.connect.success', {
        appId: currentAppId,
        domainName
      });
    } catch (error) {
      if (
        isDomainTransferEnabled &&
        error instanceof DomainMutationError &&
        (
          error.details.nestedCode === 'DOMAIN_IN_USE_BY_OWN_APP' ||
          error.details.nestedCode === 'DOMAIN_ALREADY_IN_USE'
        ) &&
        error.details.conflictDetails
      ) {
        setConflictData(error.details.conflictDetails);
        modifyDomainsMutation.reset();
        return;
      }

      logger.error('domain-attach.connect.failure', {
        message: 'Failed to connect domain',
        appId: currentAppId,
        domainName,
        nestedCode: error instanceof DomainMutationError ? error.details.nestedCode : undefined,
        error: error instanceof Error ? error.message : String(error),
      });
      shipAnalyticsLog('domain.custom.connect.failed', {
        appId: currentAppId,
        domainName,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Handle disconnecting a domain from the application
   */
  async function handleDisconnectDomain(domainName: string) {
    if (!currentAppId) return;

    try {
      await modifyDomainsMutation.mutateAsync({
        siteId: currentAppId,
        payload: {
          domainsToDelete: [{ fqdn: domainName }],
        },
      });
      shipAnalyticsLog('domain.custom.disconnect.success', {
        appId: currentAppId,
        domainName
      });
    } catch (error) {
      logger.error('domain-attach.disconnect.failure', {
        message: 'Failed to disconnect domain',
        appId: currentAppId,
        domainName,
        error: error instanceof Error ? error.message : String(error),
      });
      shipAnalyticsLog('domain.custom.disconnect.failed', {
        appId: currentAppId,
        domainName,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Handle adding custom domain from text input
   */
  async function handleAddCustomDomain() {
    if (!customDomain || !currentAppId) return;

    if (isAiroDomainBlocked) {
      setCustomDomainError(t('builder_domain_error_fqdn_invalid'));
      return;
    }

    // Validate and sanitize the domain
    const validation = validateDomain(customDomain);

    if (!validation.isValid) {
      setCustomDomainError(validation.error || t('builder_custom_domain_error_invalid'));
      return;
    }

    // Clear any previous errors
    setCustomDomainError(null);

    // Use the sanitized domain (with protocol removed)
    const sanitizedDomain = sanitizeDomainInput(customDomain);
    await handleConnectDomain(sanitizedDomain);
    setCustomDomain(null);
    setDebouncedDomain('');
  }

  async function handleConfirmAdd() {
    setShowAddConfirmation(false);
    await handleAddCustomDomain();
  }

  // Get customer domain entries (includes root domains + connected subdomains)
  // Only compute once both queries have fetched
  const customerDomainEntries = (isDomainsFetched && isAppDetailsFetched) ? domains.map((domain) => {
    // Find all connected domains that match this customer domain (exact or subdomain)
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

  // Get custom domains (not prefix domains, not owned by customer)
  // This excludes both exact matches and subdomains of customer domains
  // Only compute once both queries have fetched
  const customDomains = (isDomainsFetched && isAppDetailsFetched && appDetails?.domains) ? appDetails.domains.filter(
    (appDomain) =>
      appDomain.domainType !== 'prefix' &&
      !isCustomerDomain(appDomain.fqdn, domains)
  ) : [];

  // Separate connected vs available domains
  const connectedCustomerDomains = customerDomainEntries.filter(
    entry => entry.connectedDomains.length > 0
  );
  const availableCustomerDomains = customerDomainEntries.filter(
    entry => entry.connectedDomains.length === 0
  );
  const connectedCustomDomains = customDomains.filter(
    d => d.status === DomainStatus.ACTIVE || d.status === DomainStatus.PENDING
  );
  const availableCustomDomains = customDomains.filter(
    d => d.status !== DomainStatus.ACTIVE && d.status !== DomainStatus.PENDING
  );

  // Check if there's already a custom domain in pending or active state
  const hasActiveOrPendingCustomDomain = customDomains.some(
    (d) => d.status === DomainStatus.PENDING || d.status === DomainStatus.ACTIVE
  );

  const hasActiveOrPendingDomain = appDetails?.domains
    ?.filter((d) => d.domainType !== 'prefix')
    ?.some((d) => d.status === DomainStatus.PENDING || d.status === DomainStatus.ACTIVE);

  const isPublished = hasBeenPublished(site);

  const shouldDisableAddingDomain =
    hasActiveOrPendingCustomDomain ||
    hasActiveOrPendingDomain ||
    !isPublished ||
    modifyDomainsMutation.isPending;
  const isDomainDataReady = isDomainsFetched && isAppDetailsFetched;

  const customDomainSectionStatus = useMemo(() => {
    const connectedDomains = appDetails?.domains?.filter((d) => d.domainType !== 'prefix') || [];
    if (connectedDomains.length === 0) return undefined;

    if (hasActiveDomainJob) return Status.PENDING;

    if (connectedDomains.some((d) => d.status === DomainStatus.ACTIVE)) {
      return Status.READY;
    }

    if (
      connectedDomains.some(
        (d) =>
          d.status === ControlPlaneDomainStatus.FAILED ||
          d.status === ControlPlaneDomainStatus.ERROR,
      )
    ) {
      return Status.CRITICAL;
    }

    if (connectedDomains.some((d) => d.status === DomainStatus.PENDING)) {
      return Status.PENDING;
    }

    return undefined;
  }, [appDetails, hasActiveDomainJob]);

  return (
    <SettingsSection
      title={t('builder_custom_domain_title')}
      description={t('builder_custom_domain_description')}
      status={customDomainSectionStatus}
      isCollapsible
    >
      <Box orientation="vertical" gap="sm" className="w-full">
        {hasActiveDomainJob && (
          <text.p className="text-sm italic text-intents-ux-text-secondaryColor">
            {t('builder_domain_connection_timing_info')}
          </text.p>
        )}
        <Box gap="sm">
          {isLoading && (
            <>
              {[1, 2, 3].map((i) => (
                <div
                  key={`skeleton-${i}`}
                  className="bg-intents-ux-box-backgroundColor rounded-lg px-2 py-1"
                >
                  <Skeleton size="md" width="30%" />
                </div>
              ))}
            </>
          )}
          {error && (
            <text.p className="text-intents-ux-text-destructive">
              {getErrorMessage(error, t)}
            </text.p>
          )}
          {!isLoading && !error && domains.length === 0 && (
            <text.p>{t('builder_custom_domain_no_domains')}</text.p>
          )}

          {/* Connected Customer Domains First */}
          {!isLoading && !error && connectedCustomerDomains.map((entry, index) => {
            const domainName = entry.customerDomain.domain || entry.customerDomain.name || '';

            return (
              <Box key={`connected-customer-domain-${index}-${domainName}`} gap="sm">
                {/* Root domain */}
                {(() => {
                  const rootAppDomain = entry.connectedDomains.find((d) => d.fqdn === domainName);
                  return (
                    <DomainItem
                      domain={entry.customerDomain}
                      appDomain={rootAppDomain}
                      siteId={currentAppId}
                      onConnect={handleConnectDomain}
                      onDisconnect={handleDisconnectDomain}
                      isLoading={modifyDomainsMutation.isPending}
                      disableConnect={shouldDisableAddingDomain}
                      mutationError={modifyDomainsMutation.error}
                    />
                  );
                })()}

                {/* Connected subdomains */}
                {entry.connectedDomains
                  .filter((d) => d.fqdn !== domainName)
                  .map((subdomain, subIndex) => (
                    <DomainItem
                      key={`connected-subdomain-${index}-${subIndex}-${subdomain.fqdn}`}
                      domain={{
                        domain: subdomain.fqdn,
                        name: subdomain.fqdn,
                      }}
                      appDomain={subdomain}
                      siteId={currentAppId}
                      onConnect={handleConnectDomain}
                      onDisconnect={handleDisconnectDomain}
                      isLoading={modifyDomainsMutation.isPending}
                      disableConnect={shouldDisableAddingDomain}
                      isCustomDomain={true}
                      mutationError={modifyDomainsMutation.error}
                    />
                  ))}
              </Box>
            );
          })}

          {/* Connected Custom Domains */}
          {!isLoading && !error && connectedCustomDomains.map((appDomain, index) => (
            <DomainItem
              key={`connected-custom-domain-${index}-${appDomain.fqdn}`}
              domain={{
                domain: appDomain.fqdn,
                name: appDomain.fqdn,
              }}
              appDomain={appDomain}
              siteId={currentAppId}
              onConnect={handleConnectDomain}
              onDisconnect={handleDisconnectDomain}
              isLoading={modifyDomainsMutation.isPending}
              disableConnect={shouldDisableAddingDomain}
              isCustomDomain={true}
              mutationError={modifyDomainsMutation.error}
            />
          ))}

          {showDomainDNS && (
            <DomainDNS
              domainDetails={pendingDomainDetails}
            />
          )}

          {/* Available Custom Domains (FAILED/ERROR/INACTIVE states) */}
          {!isLoading && !error && availableCustomDomains.map((appDomain, index) => (
            <DomainItem
              key={`available-custom-domain-${index}-${appDomain.fqdn}`}
              domain={{
                domain: appDomain.fqdn,
                name: appDomain.fqdn,
              }}
              appDomain={appDomain}
              siteId={currentAppId}
              onConnect={handleConnectDomain}
              onDisconnect={handleDisconnectDomain}
              isLoading={modifyDomainsMutation.isPending}
              disableConnect={shouldDisableAddingDomain}
              isCustomDomain={true}
              mutationError={modifyDomainsMutation.error}
            />
          ))}

          {/* Available Customer Domains */}
          {!isLoading && !error && availableCustomerDomains.map((entry, index) => {
            const domainName = entry.customerDomain.domain || entry.customerDomain.name || '';

            return (
              <DomainItem
                key={`available-customer-domain-${index}-${domainName}`}
                domain={entry.customerDomain}
                appDomain={undefined}
                siteId={currentAppId}
                onConnect={handleConnectDomain}
                onDisconnect={handleDisconnectDomain}
                isLoading={modifyDomainsMutation.isPending}
                disableConnect={shouldDisableAddingDomain}
                mutationError={modifyDomainsMutation.error}
              />
            );
          })}

          {/* Buy a New Domain Button */}
          {!isLoading && !error && (
            <Button
              text={t('builder_custom_domain_button_buy')}
              design="primary"
              size="sm"
              data-eid={generateClickEID(`settings.domains.buy_new_domain`)}
              href={`https://www.${getRootDomain()}/domains?itc=${encodeURIComponent(PAYWALL_ITC.ATTACH_DOMAIN)}`}
              external
            />
          )}
        </Box>
      </Box>

      {isDomainDataReady && !hasActiveOrPendingCustomDomain && (
        <>
          {/* Custom Domain Input */}
          <Box
            orientation="vertical"
            blockAlignChildren="start"
            gap="sm"
            inlineAlignChildren="start"
          >
            <text.span as="label" text={t('builder_custom_domain_input_label')} />
            <TextInput
              className="w-full"
              id="custom-domain-slug"
              label={null}
              onChange={handleCustomDomainChange}
              helpMessage={t('builder_custom_domain_input_help')}
              value={customDomain}
              disabled={shouldDisableAddingDomain}
              errorMessage={getValidationErrorMessage()}
            />
          </Box>
          {customDomain && (
            <div>
              <Button
                text={isValidatingDomain || (customDomain !== debouncedDomain)
                  ? t('builder_custom_domain_button_checking')
                  : t('builder_custom_domain_button_add')
                }
                design="primary"
                onClick={() => setShowAddConfirmation(true)}
                disabled={shouldDisableAddingDomain ||
                  customDomain.length === 0 ||
                  isAiroDomainBlocked ||
                  isValidatingDomain ||
                  hasValidationError ||
                  (customDomain !== debouncedDomain) ||
                  (validationData && !validationData.available)
                }
                data-eid={generateClickEID(`settings.domains.add_domain`)}
                className="!hover:bg-transparent"
                size="sm"
              />
            </div>
          )}
        </>
      )}

      {showAddConfirmation && (
        <Modal onClose={() => setShowAddConfirmation(false)} title={t('builder_custom_domain_modal_title')} centered>
          <Box className='text-center max-w-2xl mx-auto' gap='md' inlineAlignChildren='center'>
            <text.span as="paragraph">
              {t('builder_custom_domain_modal_description')}
            </text.span>
            <Box orientation="horizontal" gap="md" className="justify-center">
              <Button
                design="primary"
                onClick={handleConfirmAdd}
                text={t('builder_custom_domain_modal_button_continue')}
                data-eid={generateClickEID(`settings.domains.connect_continue`)}
                size="sm"
              />
              <Button
                design="secondary"
                onClick={() => setShowAddConfirmation(false)}
                text={t('builder_custom_domain_modal_button_cancel')}
                data-eid={generateClickEID(`settings.domains.connect_cancel`)}
                size="sm"
              />
            </Box>
          </Box>
        </Modal>
      )}

      <DomainConflictModal
        isOpen={!!conflictData}
        onClose={() => { setConflictData(null); clearTransferError(); modifyDomainsMutation.reset(); }}
        onConfirm={handleTransferDomain}
        isTransferring={isTransferring}
        domain={conflictData?.domain ?? ''}
        existingAppName={conflictData?.existingAppName}
        existingAppId={conflictData?.existingAppId ?? ''}
        error={transferError}
      />
    </SettingsSection>
  );
}
