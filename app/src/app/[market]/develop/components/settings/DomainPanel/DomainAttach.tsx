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
import { DomainDisconnectConfirmationModal } from '@/app/[market]/develop/components/widgets/DomainDisconnectConfirmationModal';
import type { AppDetailsResponse } from '@/hooks/useAppDetails';
import { useAuth } from '@/hooks/useAuth';
import { useCustomerDomainAttach } from '@/hooks/useCustomerDomainAttach';
import { clearDkimOnboardRecord, useDkimAutoOnboard } from '@/hooks/useDkimAutoOnboard';
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
import { appFetch } from '@/lib/gasket-config';
import { shipAnalyticsLog } from '@/lib/logging';
import { DomainMode, DomainStatus } from '@/lib/mgmt-airo/types';
import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSiteStore } from "@/stores/useSiteStore";
import {
  dedupeSiteDomainsByFqdn,
  isBlockedAiroDomain,
  isCustomerDomain,
  normalizeFqdn,
  sanitizeDomainInput,
  validateDomain,
} from '@/utils/domain';
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
  const [customDomain, setCustomDomain] = useState('');
  const [customDomainError, setCustomDomainError] = useState<string | null>(null);
  const [debouncedDomain, setDebouncedDomain] = useState('');
  const [showAddConfirmation, setShowAddConfirmation] = useState(false);
  const [conflictData, setConflictData] = useState<DomainMutationDetails['conflictDetails'] | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<string | null>(null);
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const domainStatusRef = useRef<Map<string, string>>(new Map());
  const trackedAppIdRef = useRef<string | null>(null);

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

  const siteDomains = useMemo(
    () => dedupeSiteDomainsByFqdn(appDetails?.domains ?? []),
    [appDetails?.domains],
  );

  const pendingDomain = useMemo(() => {
    // First, check for customer domain that requires manual DNS setup
    // This covers: external nameservers OR attach API failed
    if (requiresManualDnsSetup && pendingCustomerDomainForAttach) {
      return pendingCustomerDomainForAttach.fqdn;
    }

    if (!siteDomains.length) return null;

    // Then check for custom domains (not customer-owned)
    const pending = siteDomains.find((d) => {
      // Exclude prefix/project domains
      if (d.domainType === 'prefix') return false;

      // Exclude customer domains (including subdomains of customer domains)
      if (isCustomerDomain(d.fqdn, domains)) return false;

      // ERROR/FAILED/INACTIVE are terminal, and no-status means we don't yet know — don't show DNS instructions for either.
      return d.status === DomainStatus.PENDING || d.status === DomainStatus.DELETING;
    });

    return pending ? pending.fqdn : null;
  }, [siteDomains, domains, requiresManualDnsSetup, pendingCustomerDomainForAttach]);

  const pendingDomainDetails = pendingDomain
    ? siteDomains.find((d) => normalizeFqdn(d.fqdn) === normalizeFqdn(pendingDomain))
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

  // Strict gate on the appbuilder-dkim-onboarding switchboard flag for
  // the NEW DKIM-related code paths added in this PR. The pre-existing
  // `useDomainDnsOwnership({ fqdns: pendingDomain })` above stays
  // ungated because it drives manual-DNS-instruction UI for external
  // domains — that's pre-existing DCC functionality, independent of
  // DKIM, and must keep working for every domain-attach regardless
  // of feature-flag state.
  //
  // What IS gated below:
  //   1. Second DCC ownership query keyed on customer-domain-for-DKIM
  //      (added in round 3 to fix the auto-onboard wiring bug)
  //   2. useDkimAutoOnboard — fires the /dkim/onboard POST
  //
  // When the flag is off, neither hook does work: the second query is
  // disabled (no DCC poll for the customer domain) and useDkimAutoOnboard
  // skips its effect.
  const dkimUiEnabled = useSwitchboard('appbuilder-dkim-onboarding') === true;
  const customerDomainForDkim = pendingCustomerDomainForAttach?.fqdn ?? null;
  const { data: customerDomainOwnership } = useDomainDnsOwnership({
    siteId: currentAppId,
    fqdns: customerDomainForDkim ?? '',
    enabled: dkimUiEnabled && !!currentAppId && !!customerDomainForDkim,
  });

  useDkimAutoOnboard({
    appId: currentAppId,
    domain: customerDomainForDkim,
    ownership: customerDomainOwnership ?? null,
    enabled: dkimUiEnabled && !!customerDomainForDkim,
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

  // Track domain status transitions as polling updates arrive.
  // On first render (or app switch), baseline the statuses without firing events —
  // only subsequent changes (pending → active, active → failed, etc.) are emitted.
  useEffect(() => {
    if (!currentAppId) return;

    const nonPrefixDomains = siteDomains.filter(
      (d) => d.domainType !== 'prefix' && d.domainType !== 'customer',
    );

    if (trackedAppIdRef.current !== currentAppId) {
      domainStatusRef.current = new Map(
        nonPrefixDomains.map((d) => [normalizeFqdn(d.fqdn), d.status]),
      );
      trackedAppIdRef.current = currentAppId;
      return;
    }

    for (const domain of nonPrefixDomains) {
      const fqdnKey = normalizeFqdn(domain.fqdn);
      const prevStatus = domainStatusRef.current.get(fqdnKey);
      const currStatus = domain.status;

      if (prevStatus === undefined) {
        domainStatusRef.current.set(fqdnKey, currStatus);
        continue;
      }

      if (prevStatus !== currStatus) {
        shipAnalyticsLog('domain.custom.state_transition', {
          appId: currentAppId,
          domainName: domain.fqdn,
          status: currStatus,
          prevStatus,
        });
        domainStatusRef.current.set(fqdnKey, currStatus);
      }
    }

    const activeFqdns = new Set(nonPrefixDomains.map((d) => normalizeFqdn(d.fqdn)));
    for (const key of domainStatusRef.current.keys()) {
      if (!activeFqdns.has(key)) domainStatusRef.current.delete(key);
    }
  }, [siteDomains, currentAppId]);

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
        const { domainSpecificError } = modifyDomainsMutation.error.details;
        if (domainSpecificError) {
          // If the error domain is rendered in a DomainItem row, it's already displayed
          // there — don't duplicate it in the text input. This covers both disconnect
          // errors and connect-via-menu errors on existing customer domains.
          const renderedDomains = new Set([
            ...domains.map((d) => normalizeFqdn(d.domain || d.name || '')).filter(Boolean),
            ...siteDomains.map((d) => normalizeFqdn(d.fqdn)).filter(Boolean),
          ]);
          if (Object.keys(domainSpecificError).some((fqdn) => renderedDomains.has(fqdn))) {
            return undefined;
          }
        }
        return translateDomainApiError(
          modifyDomainsMutation.error.details.nestedCode ?? modifyDomainsMutation.error.details.code,
          t,
          modifyDomainsMutation.error.details.message,
          modifyDomainsMutation.error.details.tldValue ? { tld: modifyDomainsMutation.error.details.tldValue } : undefined
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
      setCustomDomain('');
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
        shipAnalyticsLog('domain.custom.connect.conflict', {
          appId: currentAppId,
          domainName,
          nestedCode: error.details.nestedCode,
        });
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

  function handleDisconnectDomain(domainName: string) {
    if (!currentAppId) return;
    shipAnalyticsLog('domain.custom.disconnect.confirmation_shown', {
      appId: currentAppId,
      domainName,
    });
    setDisconnectTarget(domainName);
  }

  /**
   * Runs after the user confirms disconnect in the modal. After the upstream
   * detach succeeds, fire a best-effort POST to /api/apps/[id]/dkim/offboard
   * so Vox tears down the per-domain DKIM provisioning. The offboard call is
   * intentionally fire-and-forget:
   *   - Vox /offboard is idempotent (safe to call for never-onboarded
   *     domains), so we don't need to gate on origin/ownership client-side.
   *   - The detach UX must not block on a Vox round-trip — DKIM teardown
   *     is independent of the user-visible "domain disconnected" outcome.
   *   - Failures are surfaced via console (UI side) and BFF logs
   *     (dkim.offboard.error / dkim.deactivate.failed).
   */
  async function executeDisconnectDomain(domainName: string) {
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

      // Clear the DKIM onboard record so re-attaching the domain triggers
      // a fresh onboard call.
      if (currentAppId && domainName) {
        clearDkimOnboardRecord(currentAppId, domainName);
      }

      // Best-effort DKIM teardown — only fires when the feature flag is on.
      // When the flag is off, the route would return {result:'skipped'}
      // anyway, but skipping the call entirely avoids the wasted round-trip.
      // Don't await — detach UX is already committed. Errors logged to
      // browser console; BFF-side logs capture the canonical failure trail.
      if (dkimUiEnabled) void appFetch(`/api/apps/${currentAppId}/dkim/offboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domainName }),
      }).catch((err: unknown) => {

        console.warn('dkim.offboard.client.failed', {
          appId: currentAppId,
          domainName,
          error: err instanceof Error ? err.message : String(err),
        });
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
    } finally {
      setDisconnectTarget(null);
    }
  }

  function handleConfirmDisconnect() {
    if (!disconnectTarget || !currentAppId) return;
    shipAnalyticsLog('domain.custom.disconnect.confirmed', {
      appId: currentAppId,
      domainName: disconnectTarget,
    });
    void executeDisconnectDomain(disconnectTarget);
  }

  function handleCancelDisconnect() {
    if (modifyDomainsMutation.isPending) return;
    if (!disconnectTarget) return;
    if (currentAppId) {
      shipAnalyticsLog('domain.custom.disconnect.cancelled', {
        appId: currentAppId,
        domainName: disconnectTarget,
      });
    }
    setDisconnectTarget(null);
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
    setCustomDomain('');
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
    const connectedDomains = siteDomains.filter(
      (appDomain) =>
        appDomain.domainType !== 'prefix' &&
        isCustomerDomain(appDomain.fqdn, [domain])
    );

    return {
      customerDomain: domain,
      connectedDomains,
    };
  }) : [];

  // Get custom domains (not prefix domains, not owned by customer)
  // This excludes both exact matches and subdomains of customer domains
  // Only compute once both queries have fetched
  const customDomains = (isDomainsFetched && isAppDetailsFetched)
    ? siteDomains.filter(
      (appDomain) =>
        appDomain.domainType !== 'prefix' &&
        !isCustomerDomain(appDomain.fqdn, domains)
    )
    : [];

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

  const hasActiveOrPendingDomain = siteDomains
    .filter((d) => d.domainType !== 'prefix')
    .some((d) => d.status === DomainStatus.PENDING || d.status === DomainStatus.ACTIVE);

  const isPublished = hasBeenPublished(site);

  const shouldDisableAddingDomain =
    hasActiveOrPendingCustomDomain ||
    hasActiveOrPendingDomain ||
    !isPublished ||
    modifyDomainsMutation.isPending;
  const isDomainDataReady = isDomainsFetched && isAppDetailsFetched;

  const customDomainSectionStatus = useMemo(() => {
    const connectedDomains = siteDomains.filter((d) => d.domainType !== 'prefix');
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
  }, [siteDomains, hasActiveDomainJob]);

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
                  const rootAppDomain = entry.connectedDomains.find(
                    (d) => normalizeFqdn(d.fqdn) === normalizeFqdn(domainName),
                  );
                  return (
                    <DomainItem
                      domain={entry.customerDomain}
                      appDomain={rootAppDomain}
                      appId={currentAppId}
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
                  .filter((d) => normalizeFqdn(d.fqdn) !== normalizeFqdn(domainName))
                  .map((subdomain, subIndex) => (
                    <DomainItem
                      key={`connected-subdomain-${index}-${subIndex}-${subdomain.fqdn}`}
                      domain={{
                        domain: subdomain.fqdn,
                        name: subdomain.fqdn,
                      }}
                      appDomain={subdomain}
                      appId={currentAppId}
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
              appId={currentAppId}
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
              appId={currentAppId}
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
                appId={currentAppId}
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
              className="self-start"
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

      <DomainDisconnectConfirmationModal
        isOpen={!!disconnectTarget}
        domain={disconnectTarget ?? ''}
        fallbackUrl={site?.published_url ?? ''}
        onClose={handleCancelDisconnect}
        onConfirm={handleConfirmDisconnect}
        isDisconnecting={modifyDomainsMutation.isPending}
      />
    </SettingsSection>
  );
}
