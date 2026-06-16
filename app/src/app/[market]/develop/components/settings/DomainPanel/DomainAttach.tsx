import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { FormattedMessage } from 'react-intl';
import Box from "@ux/box";
import Button from "@ux/button";
import FieldFrame from "@ux/field-frame";
import SearchIcon from "@ux/icon/search";
import Modal from "@ux/modal";
import Pagination from "@ux/pagination";
import Skeleton from "@ux/skeleton";
import Tabs from "@ux/tabs";
import text from "@ux/text";
import TextEntry from "@ux/text-entry";
import TextInput from "@ux/text-input";

import DomainDNS from "@/app/[market]/develop/components/settings/components/DomainDNS";
import DomainItem from "@/app/[market]/develop/components/settings/components/DomainItem";
import SettingsSection from "@/app/[market]/develop/components/settings/SettingsSection";
import { Status } from "@/app/[market]/develop/components/types";
import { useAppIdFromParams } from "@/app/[market]/develop/components/utils";
import { DomainConflictModal } from '@/app/[market]/develop/components/widgets/DomainConflictModal';
import {
  DomainDisconnectConfirmationModal,
  DomainDisconnectSuccessAlert,
} from '@/app/[market]/develop/components/widgets/DomainDisconnectConfirmationModal';
import type { AppDetailsResponse, AppDomain } from '@/hooks/useAppDetails';
import { useAuth } from '@/hooks/useAuth';
import { useCustomerDomainAttach } from '@/hooks/useCustomerDomainAttach';
import { useDkimAutoOnboard } from '@/hooks/useDkimAutoOnboard';
import { useDomainDnsOwnership } from '@/hooks/useDomainDnsOwnership';
import { type Domain, useDomainsQuery } from '@/hooks/useDomainsQuery';
import { useDomainTransfer } from '@/hooks/useDomainTransfer';
import { useDomainValidationQuery } from '@/hooks/useDomainValidationQuery';
import {
  type DomainMutationDetails,
  DomainMutationError,
  type DomainToDelete,
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
import { cn } from '@/lib/utils';
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
import { domainsToDeleteForSwitch as buildDomainsToDeleteForSwitch } from '@/utils/domainAttachSwitch';
import { countDomainListRows, isDomainJobStillInProgress } from '@/utils/domainAttachUi';
import { getRootDomain } from '@/utils/getRootDomain';
import { generateClickEID } from '@/utils/instrumentation';
import { hasBeenPublished } from '@/utils/site';

// The domain list is a compact fixed-height scroll area (~5-6 rows visible);
// it holds up to one page of domains, and we paginate once the count exceeds it.
const DOMAIN_LIST_PER_PAGE = 15;
const DOMAIN_LIST_SCROLL_CLASS = 'overflow-y-auto max-h-[calc(5.5*3.5rem+5*0.5rem)] pe-1';

const DOMAIN_ATTACH_TAB_PANEL_CLASS = 'pt-3';
const DOMAIN_ATTACH_TAB_PANELS_GRID_CLASS = 'grid w-full';
const DOMAIN_ATTACH_TAB_PANEL_CELL_CLASS = 'col-start-1 row-start-1';

function getDomainAttachTabPanelClass(isActive: boolean, extraClass?: string) {
  return cn(
    DOMAIN_ATTACH_TAB_PANEL_CELL_CLASS,
    DOMAIN_ATTACH_TAB_PANEL_CLASS,
    extraClass,
    !isActive && 'pointer-events-none',
  );
}

function getDomainAttachTabPanelStyle(isActive: boolean): CSSProperties | undefined {
  return isActive ? undefined : { visibility: 'hidden' };
}

const DOMAIN_ATTACH_EXTERNAL_TRANSFER_URL = 'https://www.godaddy.com/domains/domain-transfer';

const DOMAIN_ATTACH_TAB = {
  CONNECT: 'connect',
  BUY: 'buy',
  EXTERNAL: 'external',
} as const;

type DomainAttachTab = typeof DOMAIN_ATTACH_TAB[keyof typeof DOMAIN_ATTACH_TAB];

type CustomerDomainEntry = {
  customerDomain: Domain;
  connectedDomains: AppDomain[];
};

// A single paginatable unit in the domain list. A connected customer domain
// (which may include subdomains) counts as one unit.
type DomainListUnit =
  | { kind: 'connectedCustomer'; entry: CustomerDomainEntry }
  | { kind: 'connectedCustom'; appDomain: AppDomain }
  | { kind: 'availableCustom'; appDomain: AppDomain }
  | { kind: 'availableCustomer'; entry: CustomerDomainEntry };

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
  const isDomainConnectEnabled = useSwitchboard('appbuilder-domain-connect');
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const isDomainTransferEnabled = useSwitchboard('appbuilder-domain-transfer');
  const [customDomain, setCustomDomain] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [domainPage, setDomainPage] = useState(1);
  const [customDomainError, setCustomDomainError] = useState<string | null>(null);
  const [debouncedDomain, setDebouncedDomain] = useState('');
  const [showAddConfirmation, setShowAddConfirmation] = useState(false);
  const [showConnectSelectedConfirmation, setShowConnectSelectedConfirmation] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DomainAttachTab>(DOMAIN_ATTACH_TAB.CONNECT);
  const [conflictData, setConflictData] = useState<DomainMutationDetails['conflictDetails'] | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<string | null>(null);
  const [disconnectSuccessMessage, setDisconnectSuccessMessage] = useState<string | null>(null);
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

  const domainJobInProgress = useDevelopPageStore(
    (s) => (currentAppId ? s.domainJobsInProgress?.[currentAppId] : undefined),
  );

  const showConnectionTimingInfo = isDomainJobStillInProgress(
    domainJobInProgress,
    appDetails,
    modifyDomainsMutation.isPending,
    requiresManualDnsSetup,
    pendingCustomerDomainForAttach,
  );

  useEffect(
    function clearStaleDomainJobWhenComplete() {
      if (!isDomainConnectEnabled || !currentAppId || !domainJobInProgress || !isAppDetailsFetched) {
        return;
      }
      if (
        isDomainJobStillInProgress(
          domainJobInProgress,
          appDetails,
          modifyDomainsMutation.isPending,
          requiresManualDnsSetup,
          pendingCustomerDomainForAttach,
        )
      ) {
        return;
      }
      useDevelopPageStore.getState().clearDomainJobInProgress(currentAppId);
    },
    [
      isDomainConnectEnabled,
      currentAppId,
      domainJobInProgress,
      isAppDetailsFetched,
      appDetails,
      modifyDomainsMutation.isPending,
      requiresManualDnsSetup,
      pendingCustomerDomainForAttach,
    ],
  );

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
  function isDomainInUseConflict(error: unknown): boolean {
    return (
      error instanceof DomainMutationError &&
      (
        error.details?.nestedCode === 'DOMAIN_IN_USE_BY_OWN_APP' ||
        error.details?.nestedCode === 'DOMAIN_ALREADY_IN_USE'
      )
    );
  }

  function getMutationErrorMessage(error: unknown): string | undefined {
    if (!(error instanceof DomainMutationError)) {
      return error instanceof Error
        ? error.message
        : t('builder_custom_domain_error_add_failed');
    }

    return translateDomainApiError(
      error.details?.nestedCode ?? error.details?.code,
      t,
      error.details?.message,
      {
        ...(error.details?.conflictingProduct && {
          conflictingProduct: error.details.conflictingProduct,
        }),
        ...(error.details?.tldValue && { tld: error.details.tldValue }),
      },
    );
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
        const { domainSpecificError } = modifyDomainsMutation.error.details;
        if (domainSpecificError) {
          const renderedDomains = new Set([
            ...domains.map((d) => normalizeFqdn(d.domain || d.name || '')).filter(Boolean),
            ...siteDomains.map((d) => normalizeFqdn(d.fqdn)).filter(Boolean),
          ]);
          if (Object.keys(domainSpecificError).some((fqdn) => renderedDomains.has(fqdn))) {
            return undefined;
          }
        }
      }
      return getMutationErrorMessage(modifyDomainsMutation.error);
    }
    if (hasValidationError) {
      return t('builder_custom_domain_error_validation_failed');
    }
    return undefined;
  }

  function getConnectMutationErrorMessage(): string | undefined {
    if (!modifyDomainsMutation.error) return undefined;
    if (isDomainInUseConflict(modifyDomainsMutation.error) && conflictData) {
      return undefined;
    }
    if (isDomainInUseConflict(modifyDomainsMutation.error)) {
      return t(
        'builder_domain_attach_connect_error',
        undefined,
        'Something went wrong connecting your domain. Please try again.',
      );
    }
    return getMutationErrorMessage(modifyDomainsMutation.error);
  }

  function domainsToDeleteForSwitch(targetFqdn: string): DomainToDelete[] {
    return buildDomainsToDeleteForSwitch(
      appDetails?.domains,
      targetFqdn,
      isDomainConnectEnabled,
    );
  }

  /**
   * Handle connecting a domain to the application
   */
  async function handleConnectDomain(domainName: string): Promise<boolean> {
    if (!currentAppId) return false;

    const domainsToDelete = domainsToDeleteForSwitch(domainName);

    try {
      setCustomDomain('');
      await modifyDomainsMutation.mutateAsync({
        siteId: currentAppId,
        payload: {
          domainsToCreate: [{ fqdn: domainName, primary: false }],
          domainsToDelete,
          createCdn: true,
          isWildcardDomain: true,
        },
      });
      shipAnalyticsLog('domain.custom.connect.success', {
        appId: currentAppId,
        domainName
      });
      return true;
    } catch (error) {
      if (
        isDomainTransferEnabled &&
        isDomainInUseConflict(error) &&
        error instanceof DomainMutationError &&
        error.details.conflictDetails
      ) {
        shipAnalyticsLog('domain.custom.connect.conflict', {
          appId: currentAppId,
          domainName,
          nestedCode: error.details.nestedCode,
        });
        setConflictData(error.details.conflictDetails);
        modifyDomainsMutation.reset();
        return false;
      }

      logger.error('domain-attach.connect.failure', {
        message: 'Failed to connect domain',
        appId: currentAppId,
        domainName,
        nestedCode: error instanceof DomainMutationError ? error.details?.nestedCode : undefined,
        error: error instanceof Error ? error.message : String(error),
      });
      shipAnalyticsLog('domain.custom.connect.failed', {
        appId: currentAppId,
        domainName,
        error: error instanceof Error ? error.message : String(error)
      });
      setConflictData(null);
      return false;
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

      setDisconnectSuccessMessage(
        t('builder_domain_disconnect_success', {}, 'Domain has been disconnected')
      );

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

  // Separate connected vs available domains (unfiltered base lists).
  // These drive the row count / Connect-tab visibility, so they must ignore
  // the search query (otherwise searching could hide the whole Connect tab).
  const connectedCustomerDomainsAll = customerDomainEntries.filter(
    entry => entry.connectedDomains.length > 0
  );
  const availableCustomerDomainsAll = customerDomainEntries.filter(
    entry => entry.connectedDomains.length === 0
  );
  const connectedCustomDomainsAll = customDomains.filter(
    d => d.status === DomainStatus.ACTIVE || d.status === DomainStatus.PENDING
  );
  const availableCustomDomainsAll = customDomains.filter(
    d => d.status !== DomainStatus.ACTIVE && d.status !== DomainStatus.PENDING
  );

  // Search-box filter applied to the rendered lists.
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const matchesCustomerEntry = (entry: CustomerDomainEntry) => {
    if (!normalizedSearch) return true;
    const name = (entry.customerDomain.domain || entry.customerDomain.name || '').toLowerCase();
    if (name.includes(normalizedSearch)) return true;
    return entry.connectedDomains.some(
      (d) => d.fqdn?.toLowerCase().includes(normalizedSearch),
    );
  };
  const matchesAppDomain = (appDomain: AppDomain) =>
    !normalizedSearch || Boolean(appDomain.fqdn?.toLowerCase().includes(normalizedSearch));

  // Filtered lists actually rendered in the UI.
  const connectedCustomerDomains = connectedCustomerDomainsAll.filter(matchesCustomerEntry);
  const availableCustomerDomains = availableCustomerDomainsAll.filter(matchesCustomerEntry);
  const connectedCustomDomains = connectedCustomDomainsAll.filter(matchesAppDomain);
  const availableCustomDomains = availableCustomDomainsAll.filter(matchesAppDomain);
  const hasVisibleDomains =
    connectedCustomerDomains.length > 0 ||
    availableCustomerDomains.length > 0 ||
    connectedCustomDomains.length > 0 ||
    availableCustomDomains.length > 0;
  const hasActiveOrPendingCustomDomain = customDomains.some(
    (d) => d.status === DomainStatus.PENDING || d.status === DomainStatus.ACTIVE,
  );
  const hasActiveOrPendingDomain = appDetails?.domains
    ?.filter((d) => d.domainType !== 'prefix')
    ?.some((d) => d.status === DomainStatus.PENDING || d.status === DomainStatus.ACTIVE);

  const isPublished = hasBeenPublished(site);

  const isDomainMutationBusy = !isPublished || modifyDomainsMutation.isPending;
  const isDomainDataReady = isDomainsFetched && isAppDetailsFetched;

  const isSelectedDomainAlreadyConnected = Boolean(
    selectedDomain &&
    appDetails?.domains?.some(
      (d) =>
        d.domainType !== 'prefix' &&
        normalizeFqdn(d.fqdn) === normalizeFqdn(selectedDomain) &&
        (d.status === DomainStatus.ACTIVE || d.status === DomainStatus.PENDING),
    ),
  );

  const isConnectSelectedDisabled =
    !selectedDomain || isDomainMutationBusy || isSelectedDomainAlreadyConnected;

  const connectMutationErrorMessage = getConnectMutationErrorMessage();

  const isExternalDomainChecking = Boolean(
    customDomain && (isValidatingDomain || customDomain !== debouncedDomain),
  );

  const externalDomainButtonText = isExternalDomainChecking
    ? t('builder_custom_domain_button_checking')
    : t('builder_domain_attach_external_button');

  const isExternalDomainButtonDisabled = Boolean(
    isDomainMutationBusy ||
    !customDomain ||
    customDomain.length === 0 ||
    isAiroDomainBlocked ||
    isValidatingDomain ||
    hasValidationError ||
    customDomain !== debouncedDomain ||
    (validationData && !validationData.available),
  );

  function handleTabChange(tabId: string) {
    if (tabId === DOMAIN_ATTACH_TAB.EXTERNAL && selectedDomain) {
      setSelectedDomain(null);
    }
    setActiveTab(tabId as DomainAttachTab);
  }

  function handleConnectSelectedClick() {
    if (!selectedDomain || isConnectSelectedDisabled) {
      return;
    }
    setShowConnectSelectedConfirmation(true);
  }

  async function handleConfirmConnectSelected() {
    if (!selectedDomain) {
      return;
    }
    const success = await handleConnectDomain(selectedDomain);
    if (success) {
      setShowConnectSelectedConfirmation(false);
    }
  }

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

  const domainRowCount = useMemo(
    function computeDomainRowCount() {
      if (isLoading || error) {
        return 0;
      }
      return countDomainListRows(
        connectedCustomerDomainsAll,
        connectedCustomDomainsAll,
        availableCustomDomainsAll,
        availableCustomerDomainsAll,
      );
    },
    [
      isLoading,
      error,
      connectedCustomerDomainsAll,
      connectedCustomDomainsAll,
      availableCustomDomainsAll,
      availableCustomerDomainsAll,
    ],
  );

  // Flatten the four domain groups into a single ordered list of paginatable
  // units (a connected customer domain + its subdomains counts as one unit).
  const domainListUnits = useMemo<DomainListUnit[]>(
    () => [
      ...connectedCustomerDomains.map((entry): DomainListUnit => ({ kind: 'connectedCustomer', entry })),
      ...connectedCustomDomains.map((appDomain): DomainListUnit => ({ kind: 'connectedCustom', appDomain })),
      ...availableCustomDomains.map((appDomain): DomainListUnit => ({ kind: 'availableCustom', appDomain })),
      ...availableCustomerDomains.map((entry): DomainListUnit => ({ kind: 'availableCustomer', entry })),
    ],
    [connectedCustomerDomains, connectedCustomDomains, availableCustomDomains, availableCustomerDomains],
  );

  const totalDomainUnits = domainListUnits.length;
  const showDomainPagination = totalDomainUnits > DOMAIN_LIST_PER_PAGE;
  const domainTotalPages = Math.max(1, Math.ceil(totalDomainUnits / DOMAIN_LIST_PER_PAGE));
  const currentDomainPage = Math.min(Math.max(1, domainPage), domainTotalPages);
  const domainStartIndex = (currentDomainPage - 1) * DOMAIN_LIST_PER_PAGE;
  const visibleDomainUnits = showDomainPagination
    ? domainListUnits.slice(domainStartIndex, domainStartIndex + DOMAIN_LIST_PER_PAGE)
    : domainListUnits;

  // Reset to the first page whenever the search query changes.
  useEffect(
    function resetDomainPageOnSearch() {
      setDomainPage(1);
    },
    [normalizedSearch],
  );

  const hideConnectTab = isDomainDataReady && !error && domainRowCount === 0;

  const effectiveActiveTab =
    hideConnectTab && activeTab === DOMAIN_ATTACH_TAB.CONNECT
      ? DOMAIN_ATTACH_TAB.BUY
      : activeTab;

  useEffect(function syncActiveTabWhenConnectHidden() {
    if (hideConnectTab && activeTab === DOMAIN_ATTACH_TAB.CONNECT) {
      setActiveTab(DOMAIN_ATTACH_TAB.BUY);
    }
  }, [hideConnectTab, activeTab]);

  const domainAttachTabItems = useMemo(
    function buildDomainAttachTabItems() {
      const items = [
        {
          id: DOMAIN_ATTACH_TAB.CONNECT,
          text: t('builder_domain_attach_tab_domains'),
        },
        {
          id: DOMAIN_ATTACH_TAB.BUY,
          text: t('builder_domain_attach_tab_buy'),
        },
        {
          id: DOMAIN_ATTACH_TAB.EXTERNAL,
          text: t('builder_domain_attach_tab_external'),
        },
      ];

      if (hideConnectTab) {
        return items.filter((item) => item.id !== DOMAIN_ATTACH_TAB.CONNECT);
      }

      return items;
    },
    [hideConnectTab, t],
  );

  const buyDomainUrl = `https://www.${getRootDomain()}/domains?itc=${encodeURIComponent(PAYWALL_ITC.ATTACH_DOMAIN)}`;

  function renderDomainUnit(unit: DomainListUnit) {
    if (unit.kind === 'connectedCustomer') {
      const { entry } = unit;
      const domainName = entry.customerDomain.domain || entry.customerDomain.name || '';
      const rootAppDomain = entry.connectedDomains.find(
        (d) => normalizeFqdn(d.fqdn) === normalizeFqdn(domainName),
      );
      return (
        <Box key={`connected-customer-domain-${domainName}`} gap="sm">
          <DomainItem
            domain={entry.customerDomain}
            appDomain={rootAppDomain}
            siteId={currentAppId}
            appId={currentAppId}
            onConnect={handleConnectDomain}
            onDisconnect={handleDisconnectDomain}
            isLoading={modifyDomainsMutation.isPending}
            disableConnect={isDomainMutationBusy}
            radioMode
            isSelected={selectedDomain === domainName}
            onSelect={setSelectedDomain}
            mutationError={modifyDomainsMutation.error}
          />
          {entry.connectedDomains
            .filter((d) => normalizeFqdn(d.fqdn) !== normalizeFqdn(domainName))
            .map((subdomain, subIndex) => (
              <DomainItem
                key={`connected-subdomain-${subIndex}-${subdomain.fqdn}`}
                domain={{ domain: subdomain.fqdn, name: subdomain.fqdn }}
                appDomain={subdomain}
                siteId={currentAppId}
                appId={currentAppId}
                onConnect={handleConnectDomain}
                onDisconnect={handleDisconnectDomain}
                isLoading={modifyDomainsMutation.isPending}
                disableConnect={isDomainMutationBusy}
                isCustomDomain
                radioMode
                isSelected={selectedDomain === subdomain.fqdn}
                onSelect={setSelectedDomain}
                mutationError={modifyDomainsMutation.error}
              />
            ))}
        </Box>
      );
    }

    if (unit.kind === 'connectedCustom' || unit.kind === 'availableCustom') {
      const { appDomain } = unit;
      return (
        <DomainItem
          key={`${unit.kind}-${appDomain.fqdn}`}
          domain={{ domain: appDomain.fqdn, name: appDomain.fqdn }}
          appDomain={appDomain}
          siteId={currentAppId}
          appId={currentAppId}
          onConnect={handleConnectDomain}
          onDisconnect={handleDisconnectDomain}
          isLoading={modifyDomainsMutation.isPending}
          disableConnect={isDomainMutationBusy}
          isCustomDomain
          mutationError={modifyDomainsMutation.error}
        />
      );
    }

    const { entry } = unit;
    const domainName = entry.customerDomain.domain || entry.customerDomain.name || '';
    return (
      <DomainItem
        key={`available-customer-domain-${domainName}`}
        domain={entry.customerDomain}
        appDomain={undefined}
        siteId={currentAppId}
        appId={currentAppId}
        onConnect={handleConnectDomain}
        onDisconnect={handleDisconnectDomain}
        isLoading={modifyDomainsMutation.isPending}
        disableConnect={isDomainMutationBusy}
        radioMode
        isSelected={selectedDomain === domainName}
        onSelect={setSelectedDomain}
        mutationError={modifyDomainsMutation.error}
      />
    );
  }

  function handleDomainPageChange(newOffset: number) {
    setDomainPage(Math.floor(newOffset / DOMAIN_LIST_PER_PAGE) + 1);
  }

  return (
    <SettingsSection
      title={t(isDomainConnectEnabled ? 'builder_domain_attach_main_title' : 'builder_custom_domain_title')}
      description={t(isDomainConnectEnabled ? 'builder_domain_attach_main_description' : 'builder_custom_domain_description')}
      status={customDomainSectionStatus}
      useDomainConnectLayout={isDomainConnectEnabled}
    >
      <Box orientation="vertical" className="w-full">
        {isDomainConnectEnabled ? (
          <>
            <Tabs
              id="domain-attach-tabs"
              design="underline"
              selected={effectiveActiveTab}
              onChange={handleTabChange}
              items={domainAttachTabItems}
              className="w-full"
            />

            <div className={DOMAIN_ATTACH_TAB_PANELS_GRID_CLASS}>
              <Box
                gap="sm"
                className={getDomainAttachTabPanelClass(effectiveActiveTab === DOMAIN_ATTACH_TAB.CONNECT)}
                style={getDomainAttachTabPanelStyle(effectiveActiveTab === DOMAIN_ATTACH_TAB.CONNECT)}
                aria-hidden={effectiveActiveTab !== DOMAIN_ATTACH_TAB.CONNECT}
              >
                {showConnectionTimingInfo && (
                  <text.p className="text-sm italic text-intents-ux-text-secondaryColor">
                    {t('builder_domain_connection_timing_info')}
                  </text.p>
                )}
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
                {connectMutationErrorMessage && (
                  <text.p className="text-intents-ux-text-destructive">
                    {connectMutationErrorMessage}
                  </text.p>
                )}
                {!isLoading && !error && domainRowCount > 1 && (
                  <FieldFrame className="w-[360px] max-w-full focus-within:[outline:5px_auto_-webkit-focus-ring-color] [&_.ux-text-entry-shell]:!outline-none">
                    <TextEntry
                      visualSize="sm"
                      stretch
                      id="domain-search-input"
                      placeholder={t('builder_domain_list_search_placeholder')}
                      aria-label={t('builder_domain_list_search_placeholder')}
                      value={searchQuery}
                      onChange={(value: string) => setSearchQuery(value)}
                    />
                    <div className="flex items-center pe-1">
                      <SearchIcon className="size-[20px] shrink-0 opacity-60" />
                    </div>
                  </FieldFrame>
                )}
                <Box
                  data-testid="domain-attach-list"
                  orientation="vertical"
                  gap="sm"
                  className={cn("min-w-0 overflow-x-hidden", DOMAIN_LIST_SCROLL_CLASS)}
                >
                  {!isLoading && !error && normalizedSearch && !hasVisibleDomains && (
                    <text.p className="text-intents-ux-text-secondaryColor">
                      {t('builder_domain_list_no_results', { query: searchQuery })}
                    </text.p>
                  )}
                  {!isLoading && !error && visibleDomainUnits.map((unit) => renderDomainUnit(unit))}
                </Box>

                {!isLoading && !error && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <Button
                      text={t('builder_domain_button_connect')}
                      design="primary"
                      size="sm"
                      disabled={isConnectSelectedDisabled}
                      onClick={handleConnectSelectedClick}
                      data-eid={generateClickEID(`settings.domains.connect_selected`)}
                    />
                    {showDomainPagination && (
                      <Pagination
                        visualSize="sm"
                        className="!gap-1 [&>.ux-button]:!p-0 [&>.ux-button]:!min-w-0"
                        limit={DOMAIN_LIST_PER_PAGE}
                        offset={domainStartIndex}
                        total={totalDomainUnits}
                        onChange={handleDomainPageChange}
                        atStart={currentDomainPage === 1}
                        atEnd={currentDomainPage === domainTotalPages}
                      />
                    )}
                  </div>
                )}
              </Box>

              <Box
                orientation="vertical"
                gap="sm"
                inlineAlignChildren="start"
                className={getDomainAttachTabPanelClass(effectiveActiveTab === DOMAIN_ATTACH_TAB.BUY)}
                style={getDomainAttachTabPanelStyle(effectiveActiveTab === DOMAIN_ATTACH_TAB.BUY)}
                aria-hidden={effectiveActiveTab !== DOMAIN_ATTACH_TAB.BUY}
              >
                <text.p className="text-intents-ux-text-secondaryColor">
                  {t('builder_domain_attach_buy_description')}
                </text.p>
                <Button
                  text={t('builder_domain_attach_buy_button')}
                  design="secondary"
                  as="external"
                  size="sm"
                  data-eid={generateClickEID(`settings.domains.buy_new_domain`)}
                  href={buyDomainUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              </Box>

              <Box
                orientation="vertical"
                gap="sm"
                inlineAlignChildren="start"
                className={getDomainAttachTabPanelClass(
                  effectiveActiveTab === DOMAIN_ATTACH_TAB.EXTERNAL,
                  'w-full',
                )}
                style={getDomainAttachTabPanelStyle(effectiveActiveTab === DOMAIN_ATTACH_TAB.EXTERNAL)}
                aria-hidden={effectiveActiveTab !== DOMAIN_ATTACH_TAB.EXTERNAL}
              >
                {!isDomainDataReady ? (
                  <>
                    {[1, 2].map((i) => (
                      <div
                        key={`external-skeleton-${i}`}
                        className="bg-intents-ux-box-backgroundColor rounded-lg px-2 py-1 w-full"
                      >
                        <Skeleton size="md" width="60%" />
                      </div>
                    ))}
                  </>
                ) : (
                  <>
                    <text.p className="text-intents-ux-text-secondaryColor">
                      <FormattedMessage
                        id="builder_domain_attach_external_description"
                        values={{
                          link: function transferLink(chunks) {
                            return (
                              <a
                                href={DOMAIN_ATTACH_EXTERNAL_TRANSFER_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline"
                                data-eid={generateClickEID('settings.domains.transfer_to_godaddy')}
                              >
                                {chunks}
                              </a>
                            );
                          },
                        }}
                      />
                    </text.p>
                    <TextInput
                      className="w-full"
                      id="custom-domain-slug"
                      label={null}
                      onChange={handleCustomDomainChange}
                      placeholder={t('builder_custom_domain_input_help')}
                      value={customDomain}
                      disabled={isDomainMutationBusy}
                      errorMessage={getValidationErrorMessage()}
                    />
                    <Button
                      text={externalDomainButtonText}
                      design="primary"
                      onClick={() => setShowAddConfirmation(true)}
                      disabled={isExternalDomainButtonDisabled}
                      data-eid={generateClickEID(`settings.domains.add_domain`)}
                      className="!hover:bg-transparent"
                      size="sm"
                    />
                  </>
                )}
              </Box>
            </div>

            {showDomainDNS && (
              <DomainDNS
                domainDetails={pendingDomainDetails}
              />
            )}
          </>
        ) : (
          <>
            {hasActiveDomainJob && (
              <text.p className="text-sm italic text-intents-ux-text-secondaryColor">
                {t('builder_domain_connection_timing_info')}
              </text.p>
            )}
            {isLoading && (
              <>
                {[1, 2, 3].map((i) => (
                  <div
                    key={`legacy-skeleton-${i}`}
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
            {!isLoading && !error && domainRowCount > 1 && (
              <FieldFrame className="w-[360px] max-w-full focus-within:[outline:5px_auto_-webkit-focus-ring-color] [&_.ux-text-entry-shell]:!outline-none">
                <TextEntry
                  visualSize="sm"
                  stretch
                  id="domain-search-input-legacy"
                  placeholder={t('builder_domain_list_search_placeholder')}
                  aria-label={t('builder_domain_list_search_placeholder')}
                  value={searchQuery}
                  onChange={(value: string) => setSearchQuery(value)}
                />
                <div className="flex items-center pe-1">
                  <SearchIcon className="size-[20px] shrink-0 opacity-60" />
                </div>
              </FieldFrame>
            )}
            <Box data-testid="domain-attach-list" orientation="vertical" gap="sm" className={cn("min-w-0 overflow-x-hidden", DOMAIN_LIST_SCROLL_CLASS)}>
              {!isLoading && !error && normalizedSearch && !hasVisibleDomains && (
                <text.p className="text-intents-ux-text-secondaryColor">
                  {t('builder_domain_list_no_results', { query: searchQuery })}
                </text.p>
              )}
              {!isLoading && !error && connectedCustomerDomains.map((entry, index) => {
                const domainName = entry.customerDomain.domain || entry.customerDomain.name || '';
                return (
                  <Box key={`legacy-connected-customer-domain-${index}-${domainName}`} gap="sm">
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
                          disableConnect={isDomainMutationBusy}
                          mutationError={modifyDomainsMutation.error}
                        />
                      );
                    })()}
                    {entry.connectedDomains
                      .filter((d) => normalizeFqdn(d.fqdn) !== normalizeFqdn(domainName))
                      .map((subdomain, subIndex) => (
                        <DomainItem
                          key={`legacy-connected-subdomain-${index}-${subIndex}-${subdomain.fqdn}`}
                          domain={{ domain: subdomain.fqdn, name: subdomain.fqdn }}
                          appDomain={subdomain}
                          appId={currentAppId}
                          siteId={currentAppId}
                          onConnect={handleConnectDomain}
                          onDisconnect={handleDisconnectDomain}
                          isLoading={modifyDomainsMutation.isPending}
                          disableConnect={isDomainMutationBusy}
                          isCustomDomain={true}
                          mutationError={modifyDomainsMutation.error}
                        />
                      ))}
                  </Box>
                );
              })}
              {!isLoading && !error && connectedCustomDomains.map((appDomain, index) => (
                <DomainItem
                  key={`legacy-connected-custom-domain-${index}-${appDomain.fqdn}`}
                  domain={{ domain: appDomain.fqdn, name: appDomain.fqdn }}
                  appDomain={appDomain}
                  appId={currentAppId}
                  siteId={currentAppId}
                  onConnect={handleConnectDomain}
                  onDisconnect={handleDisconnectDomain}
                  isLoading={modifyDomainsMutation.isPending}
                  disableConnect={isDomainMutationBusy}
                  isCustomDomain={true}
                  mutationError={modifyDomainsMutation.error}
                />
              ))}
              {!isLoading && !error && availableCustomDomains.map((appDomain, index) => (
                <DomainItem
                  key={`legacy-available-custom-domain-${index}-${appDomain.fqdn}`}
                  domain={{ domain: appDomain.fqdn, name: appDomain.fqdn }}
                  appDomain={appDomain}
                  appId={currentAppId}
                  siteId={currentAppId}
                  onConnect={handleConnectDomain}
                  onDisconnect={handleDisconnectDomain}
                  isLoading={modifyDomainsMutation.isPending}
                  disableConnect={isDomainMutationBusy}
                  isCustomDomain={true}
                  mutationError={modifyDomainsMutation.error}
                />
              ))}
              {!isLoading && !error && availableCustomerDomains.map((entry, index) => {
                const domainName = entry.customerDomain.domain || entry.customerDomain.name || '';
                return (
                  <DomainItem
                    key={`legacy-available-customer-domain-${index}-${domainName}`}
                    domain={entry.customerDomain}
                    appDomain={undefined}
                    appId={currentAppId}
                    siteId={currentAppId}
                    onConnect={handleConnectDomain}
                    onDisconnect={handleDisconnectDomain}
                    isLoading={modifyDomainsMutation.isPending}
                    disableConnect={isDomainMutationBusy}
                    mutationError={modifyDomainsMutation.error}
                  />
                );
              })}
            </Box>
            {!isLoading && !error && (
              <Button
                text={t('builder_custom_domain_button_buy')}
                design="primary"
                size="sm"
                data-eid={generateClickEID(`settings.domains.buy_new_domain`)}
                href={buyDomainUrl}
                external
                className="self-start"
              />
            )}
            {isDomainDataReady && !hasActiveOrPendingCustomDomain && (
              <>
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
                    disabled={isDomainMutationBusy}
                    errorMessage={getValidationErrorMessage()}
                  />
                </Box>
                {customDomain && (
                  <div>
                    <Button
                      text={isExternalDomainChecking
                        ? t('builder_custom_domain_button_checking')
                        : t('builder_custom_domain_button_add')
                      }
                      design="primary"
                      onClick={() => setShowAddConfirmation(true)}
                      disabled={isExternalDomainButtonDisabled}
                      data-eid={generateClickEID(`settings.domains.add_domain`)}
                      className="!hover:bg-transparent"
                      size="sm"
                    />
                  </div>
                )}
              </>
            )}
            {showDomainDNS && (
              <DomainDNS
                domainDetails={pendingDomainDetails}
              />
            )}
          </>
        )}
      </Box>

      {showConnectSelectedConfirmation && selectedDomain && (
        <Modal
          onClose={() => !modifyDomainsMutation.isPending && setShowConnectSelectedConfirmation(false)}
          title={t('builder_domain_connect_confirmation_title')}
          centered
        >
          <Box className='text-center max-w-2xl mx-auto' gap='md' inlineAlignChildren='center'>
            <text.span as="paragraph">
              {t('builder_domain_connect_confirmation_description')}
            </text.span>
            <Box orientation="horizontal" gap="md" className="justify-center">
              <Button
                design="primary"
                onClick={() => void handleConfirmConnectSelected()}
                text={
                  modifyDomainsMutation.isPending
                    ? t('builder_domain_attach_connecting')
                    : t('builder_custom_domain_modal_button_continue')
                }
                data-eid={generateClickEID(`settings.domains.connect_continue`)}
                size="sm"
                disabled={modifyDomainsMutation.isPending}
              />
              <Button
                design="secondary"
                onClick={() => setShowConnectSelectedConfirmation(false)}
                text={t('builder_custom_domain_modal_button_cancel')}
                data-eid={generateClickEID(`settings.domains.connect_cancel`)}
                size="sm"
                disabled={modifyDomainsMutation.isPending}
              />
            </Box>
          </Box>
        </Modal>
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
                onClick={() => void handleConfirmAdd()}
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

      <DomainDisconnectSuccessAlert
        message={disconnectSuccessMessage}
        onDismiss={() => setDisconnectSuccessMessage(null)}
      />
    </SettingsSection>
  );
}
