import { useState, useEffect, useRef, useMemo } from "react";
import TextInput from "@ux/text-input";
import Skeleton from "@ux/skeleton";
import Button from "@ux/button";
import Modal from "@ux/modal";
import text from "@ux/text";
import Box from "@ux/box";
import SiblingSet from "@ux/sibling-set";

import { Status } from "@/app/develop/components/types";
import DomainItem from "@/app/develop/components/settings/components/DomainItem";
import DomainDNS from "@/app/develop/components/settings/components/DomainDNS";
import { useAppIdFromParams } from "@/app/develop/components/utils";
import BigCard from "@/components/layout/BigCard";
import { useModifyDomains } from '@/hooks/useModifyDomains';
import { useAppDetails } from '@/hooks/useAppDetails';
import { useDomainValidationQuery } from '@/hooks/useDomainValidationQuery';
import { useDomainsQuery } from '@/hooks/useDomainsQuery';
import { useCustomerDomainAttach } from '@/hooks/useCustomerDomainAttach';
import { useAuth } from '@/hooks/useAuth';
import { DomainMode, DomainStatus, CdnStatus } from '@/lib/mgmt-airo/types';
import { logger } from '@/lib/request-context';
import { useSiteStore } from "@/stores/useSiteStore";
import { getDomainErrorMessage } from '@/utils/domain-validation';
import { hasBeenPublished } from '@/utils/site';
import { generateClickEID } from '@/utils/instrumentation';
import { getRootDomain } from '@/utils/getRootDomain';
import { validateDomain, sanitizeDomainInput, isCustomerDomain } from '@/utils/domain';

/**
 * Get error message from unknown error type
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'Failed to fetch domains'
}

/**
 * Domain attachment and custom domain management component
 *
 * Handles connecting and managing custom domains for the application,
 * including DNS configuration instructions for pending domains.
 */
export default function DomainAttach() {
  const currentAppId = useAppIdFromParams()
  const { isAuthenticated, isLoading: authLoading, getUserInfo } = useAuth();
  const [customDomain, setCustomDomain] = useState(null);
  const [customDomainError, setCustomDomainError] = useState<string | null>(null);
  const [debouncedDomain, setDebouncedDomain] = useState('');
  const [showAddConfirmation, setShowAddConfirmation] = useState(false);
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const userInfo = getUserInfo();

  const site = useSiteStore((state) => {
    if (!currentAppId) return null;
    return state.getSite(currentAppId);
  });

  // Validate domain when user has entered a value
  const shouldValidate = debouncedDomain.length > 0;
  const { data: validationData, isLoading: isValidatingDomain, isError: hasValidationError } = useDomainValidationQuery(
    currentAppId,
    debouncedDomain,
    {
      mode: DomainMode.CUSTOM,
      enabled: shouldValidate,
      subscriptionId: site?.subscription_id,
      systemId: site?.system_id
    }
  );

  const modifyDomainsMutation = useModifyDomains();

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

  // Get app details for displaying domain list
  // Poll while any domain (customer or custom) is pending activation
  // This single polling instance handles both customer and custom domains
  const { data: appDetails, isFetched: isAppDetailsFetched } = useAppDetails(currentAppId, {
    enabled: !!currentAppId,
    refetchInterval: (data) => {
      const hasPendingDomain = data?.domains?.some(d => {
        if (d.domainType === 'prefix') return false;
        
        return (
          d.status === DomainStatus.PENDING ||
          d.cdnStatus === CdnStatus.INIT ||
          d.cdnStatus === CdnStatus.PENDING ||
          !d.status ||
          (d.status !== DomainStatus.ACTIVE && d.status !== DomainStatus.DELETING && !d.anycastIp)
        );
      });
      
      return hasPendingDomain ? 5000 : false;
    },
    includeCdn: true,
  });

  // Handle customer domain attachment with automatic DNS configuration
  // Hook receives appDetails from above query and manages auto-attach flow for GoDaddy domains
  useCustomerDomainAttach(appDetails, domains);

  /**
   * Find CUSTOM domains (not prefix domains, not customer domains) that are pending
   * 
   * We don't show DNS instructions for prefix/project domains or customer GoDaddy domains.
   */
  const pendingDomain = useMemo(() => {
    if (!appDetails?.domains) return null;

    const pending = appDetails.domains.find((d) => {
      // Exclude prefix/project domains
      if (d.domainType === 'prefix') return false;

      // Exclude customer domains (including subdomains of customer domains)
      if (isCustomerDomain(d.fqdn, domains)) return false;

      // Check for pending status
      return (
        d.status === DomainStatus.PENDING ||
        d.cdnStatus === CdnStatus.PENDING ||
        !d.status || // New custom domain without status yet
        (d.status && d.status !== DomainStatus.ACTIVE && d.status !== DomainStatus.DELETING && !d.anycastIp) // Domain provisioning CDN
      );
    });

    return pending ? pending.fqdn : null;
  }, [appDetails, domains]);

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
    if (validationData && !validationData.available) {
      return getDomainErrorMessage(validationData.errors);
    }
    if (modifyDomainsMutation.error) {
      const errorData = (modifyDomainsMutation.error as any)?.response || (modifyDomainsMutation.error as any);
      if (errorData.validationErrors && Array.isArray(errorData.validationErrors)) {
        return getDomainErrorMessage(errorData.validationErrors);
      }
      return errorData.error || "Failed to add custom domain. Please try again";
    }
    if (hasValidationError) {
      return "Unable to validate domain. Please try again or pick a different domain.";
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
        },
      });
    } catch (error) {
      logger.error('domain-attach.connect.failure', {
        message: 'Failed to connect domain',
        domainName,
        error: error instanceof Error ? error.message : String(error),
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
    } catch (error) {
      logger.error('domain-attach.disconnect.failure', {
        message: 'Failed to disconnect domain',
        domainName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle adding custom domain from text input
   */
  async function handleAddCustomDomain() {
    if (!customDomain || !currentAppId) return;

    // Validate and sanitize the domain
    const validation = validateDomain(customDomain);

    if (!validation.isValid) {
      setCustomDomainError(validation.error || 'Invalid domain');
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

  const pendingDomainDetails = pendingDomain
    ? appDetails?.domains?.find((d) => d.fqdn === pendingDomain)
    : null;

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

  // Check if there's already a custom domain in pending or active state
  const hasActiveOrPendingCustomDomain = customDomains.some(
    (d) => d.status === DomainStatus.PENDING || d.status === DomainStatus.ACTIVE
  );

  const hasActiveOrPendingDomain = appDetails?.domains
    ?.filter((d) => d.domainType !== 'prefix')
    ?.some((d) => d.cdnStatus === CdnStatus.PENDING || d.status === DomainStatus.ACTIVE);

  const isPublished = hasBeenPublished(site);

  const shouldDisableAddingDomain =
              hasActiveOrPendingCustomDomain ||
              hasActiveOrPendingDomain ||
              !isPublished || 
              modifyDomainsMutation.isPending;

  const getCustomDomainStatus = () => {
    const connectedDomains = appDetails?.domains?.filter(d => d.domainType !== 'prefix') || [];

    if (connectedDomains.length === 0) return undefined;

    const hasPending = connectedDomains.some(d =>
      d.status === DomainStatus.PENDING || d.cdnStatus === CdnStatus.PENDING
    );

    const hasActive = connectedDomains.some(d =>
      d.status === DomainStatus.ACTIVE
    );

    if (hasPending) return Status.PENDING;
    if (hasActive) return Status.READY;
    return undefined;
  };

  return (
    <BigCard
      title="Custom Domain"
      description="You can also allow visitors to access your project with your own custom domain, or by purchasing a new one or connecting one you own."
      status={getCustomDomainStatus()}
      button={(
        <Button
          text="Buy a New Domain"
          design="primary"
          data-eid={generateClickEID(`settings/domains.custom_domain.buy_new_domain`)}
          href={`https://www.${getRootDomain()}.com/domains`}
          external
        />
      )}
    >
      {/* GoDaddy Domains Section */}
      <Box gap="sm">
        {isLoading && (
          <>
            {[1, 2, 3].map((i) => (
              <div
                key={`skeleton-${i}`}
                className="bg-intents-ux-box-backgroundColor rounded-lg px-4 py-2 flex gap-2"
              >
                <Skeleton rounding="full" size="sm"/>
                <Skeleton size="md" width="30%" />
              </div>
            ))}
          </>
        )}
        {error && (
          <text.p className="text-intents-ux-text-destructive">
            {getErrorMessage(error)}
          </text.p>
        )}
        {!isLoading && !error && domains.length === 0 && (
          <text.p>No domains found.</text.p>
        )}
        {!isLoading && !error && customerDomainEntries.map((entry, index) => {
          const domainName = entry.customerDomain.domain || entry.customerDomain.name || '';

          return (
            <Box key={`customer-domain-${index}-${domainName}`} gap="sm">
              {/* Root domain */}
              {(() => {
                const rootAppDomain = entry.connectedDomains.find((d) => d.fqdn === domainName);
                return (
                  <DomainItem
                    domain={entry.customerDomain}
                    appDomain={rootAppDomain}
                    onConnect={handleConnectDomain}
                    onDisconnect={handleDisconnectDomain}
                    isLoading={modifyDomainsMutation.isPending}
                    disableConnect={shouldDisableAddingDomain}
                  />
                );
              })()}

              {/* Connected subdomains */}
              {entry.connectedDomains
                .filter((d) => d.fqdn !== domainName) // Exclude the root domain itself
                .map((subdomain, subIndex) => (
                  <DomainItem
                    key={`subdomain-${index}-${subIndex}-${subdomain.fqdn}`}
                    domain={{
                      domain: subdomain.fqdn,
                      name: subdomain.fqdn,
                    }}
                    appDomain={subdomain}
                    onConnect={handleConnectDomain}
                    onDisconnect={handleDisconnectDomain}
                    isLoading={modifyDomainsMutation.isPending}
                    disableConnect={shouldDisableAddingDomain}
                    isCustomDomain={true}
                  />
                ))}
            </Box>
          );
        })}
      </Box>

      {/* Custom Domain Input */}
      <Box
        orientation="vertical"
        blockAlignChildren="start"
        gap="sm"
        inlineAlignChildren="start"
      >
        <TextInput
          className="w-full"
          id="custom-domain-slug"
          label="Or tell us the domain you would like to use for your website and we'll help you connect it."
          onChange={handleCustomDomainChange}
          helpMessage="e.g. mydomain.com"
          value={customDomain}
          disabled={shouldDisableAddingDomain}
          errorMessage={getValidationErrorMessage()}
        />
      </Box>
      { customDomain && (
        <div>
          <Button
            text={isValidatingDomain || (customDomain !== debouncedDomain) ? "Checking domain…" : "Add Custom Domain"}
            design="primary"
            onClick={() => setShowAddConfirmation(true)}
            disabled={shouldDisableAddingDomain ||
              customDomain.length === 0 ||
              isValidatingDomain ||
              hasValidationError || // Validation check failed
              (customDomain !== debouncedDomain) || // Validation hasn't completed yet (debounce pending)
              (validationData && !validationData.available) // Validation failed
            }
            data-eid={generateClickEID(`settings/domains.custom_domain.add`)}
            className="!hover:bg-transparent"
          />
        </div>
      ) }

        {showAddConfirmation && (
          <Modal onClose={() => setShowAddConfirmation(false)} title='Are you sure you want to add this domain?' centered>
            <Box className='text-center max-w-2xl mx-auto' gap='md' inlineAlignChildren='center'>
               <text.span as="paragraph">
                If your domain is hosted at GoDaddy, we&rsquo;ll update the DNS automatically. If it&rsquo;s hosted elsewhere, you&rsquo;ll need to update the DNS manually. Connecting this domain to this site will disconnect it from any site it&rsquo;s currently attached to.
               </text.span>
             <SiblingSet gap="md" className="justify-center">
               <Button
                 design="primary"
                 onClick={handleConfirmAdd}
                 text="Yes, Continue"
                 data-eid={generateClickEID(`settings/domains.connect_confirm.continue`)}
               />
               <Button
                 design="secondary"
                 onClick={() => setShowAddConfirmation(false)}
                 text="Cancel"
                 data-eid={generateClickEID(`settings/domains.connect_confirm.cancel`)}
               />
             </SiblingSet>
           </Box>
          </Modal>
        )}

      {/* Custom Domains Added Section */}
      {customDomains.length > 0 && (
        <Box gap="sm">
          {customDomains.map((appDomain, index) => (
            <DomainItem
              key={`custom-domain-${index}-${appDomain.fqdn}`}
              domain={{
                domain: appDomain.fqdn,
                name: appDomain.fqdn,
              }}
              appDomain={appDomain}
              onConnect={handleConnectDomain}
              onDisconnect={handleDisconnectDomain}
              isLoading={modifyDomainsMutation.isPending}
              disableConnect={shouldDisableAddingDomain}
              isCustomDomain={true}
            />
          ))}
        </Box>
      )}

      {pendingDomainDetails && (
        <DomainDNS domainDetails={pendingDomainDetails} />
      )}
    </BigCard>
  );
}

