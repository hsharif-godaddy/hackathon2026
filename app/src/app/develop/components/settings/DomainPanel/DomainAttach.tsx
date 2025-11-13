import { useState, useEffect } from "react";
import { useModifyDomains, useAppDetails } from '@/hooks/useDomainOperations';
import { hasBeenPublished } from '@/utils/site';
import { generateClickEID } from '@/utils/instrumentation';
import { useDomainsQuery } from '@/hooks/useDomainsQuery';
import { useDomainAttach } from '@/hooks/useDomainAttach';
import { useAppIdFromParams } from "@/app/develop/components/utils";
import { validateDomain, sanitizeDomainInput, isCustomerDomain } from '@/utils/domain';
import BigCard from "@/components/layout/BigCard";
import { useAuth } from '@/hooks/useAuth';
import { logger } from '@/lib/request-context';
import { Status } from "@/app/develop/components/types";
import { useSiteStore } from "@/stores/useSiteStore";
import TextInput from "@ux/text-input";
import Spinner from "@ux/spinner";
import Button from "@ux/button";
import text from "@ux/text";
import Box from "@ux/box";
import Alert from "@ux/alert";
import DomainItem from "@/app/develop/components/settings/components/DomainItem";
import DomainDNS from "@/app/develop/components/settings/components/DomainDNS";

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
  const [pendingDomain, setPendingDomain] = useState<string | null>(null);
  const [pendingCustomerDomain, setPendingCustomerDomain] = useState<string | null>(null);

  const userInfo = getUserInfo();

  const site = useSiteStore((state) => {
    if (!currentAppId) return null;
    return state.getSite(currentAppId);
  });

  const isSiteLoading = useSiteStore((state) => {
    if (!currentAppId) return false;
    return state.loading[currentAppId] ?? false;
  });

  const modifyDomainsMutation = useModifyDomains();
  const attachDomainMutation = useDomainAttach();

  const {
    data: domains = [],
    isLoading,
    error,
  } = useDomainsQuery({
    enabled: isAuthenticated && !authLoading,
  });

  const {
    data: appDetails,
  } = useAppDetails(currentAppId, {
    enabled: !!currentAppId,
    refetchInterval: (pendingDomain || pendingCustomerDomain) ? 5000 : false,
    includeCdn: true,
  });

  useEffect(() => {
    if (appDetails?.domains) {
      // Find CUSTOM domains (not prefix domains, not customer domains) that are pending
      // We don't show DNS instructions for prefix/project domains or customer GoDaddy domains
      const pending = appDetails.domains.find(
        (d) => {
          // Exclude prefix/project domains
          if (d.domainType === 'prefix') return false;

          // Exclude customer domains (including subdomains of customer domains)
          if (isCustomerDomain(d.fqdn, domains)) return false;

          // Check for pending status
          return (
            d.status === 'pending' ||
            d.cdnStatus === 'pending' ||
            !d.status || // New custom domain without status yet
            (d.status && d.status !== 'active' && d.status !== 'deleting' && !d.anycastIp) // Domain provisioning CDN
          );
        }
      );
      setPendingDomain(pending ? pending.fqdn : null);
    }
  }, [appDetails, domains]);

  // Watch for anycastIp on pending customer domain and call attach API
  useEffect(() => {
    if (!appDetails?.domains || !pendingCustomerDomain || !userInfo?.customerId) return;

    const appDomain = appDetails.domains.find((d) => d.fqdn === pendingCustomerDomain);

    // Only call attach if anycastIp exists AND mutation is not already pending
    if (appDomain?.anycastIp && !attachDomainMutation.isPending) {
      logger.info('domain-attach.anycast-ip.received', {
        message: 'Anycast IP received for customer domain, calling attach API',
        domainName: appDomain.fqdn,
        anycastIp: appDomain.anycastIp,
      });

      attachDomainMutation.mutateAsync({
        domainName: appDomain.fqdn,
        ip: appDomain.anycastIp,
      })
        .then(() => {
          logger.info('domain-attach.attach.success', {
            message: 'Successfully attached customer domain',
            domainName: appDomain.fqdn,
          });
          setPendingCustomerDomain(null);
        })
        .catch((error) => {
          logger.error('domain-attach.attach.failure', {
            message: 'Failed to attach customer domain',
            domainName: appDomain.fqdn,
            error: error instanceof Error ? error.message : String(error),
          });
          // Keep pendingCustomerDomain set to retry on next poll
        });
    }
  }, [appDetails, pendingCustomerDomain, userInfo?.customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Handle connecting a domain to the application
   */
  async function handleConnectDomain(domainName: string) {
    if (!currentAppId) return;

    // Check if this is a customer domain (from GoDaddy domains list)
    // This includes checking if it's a subdomain of a customer domain
    const isOwnedByCustomer = isCustomerDomain(domainName, domains);

    try {
      if (isOwnedByCustomer) {
        // For customer domains (including subdomains), set as pending customer domain to await anycastIp
        logger.info('domain-attach.connect.customer-domain', {
          message: 'Connecting customer domain, will await anycastIp',
          domainName,
          isSubdomain: domainName.split('.').length > 2,
        });
        setPendingCustomerDomain(domainName);
      } else {
        // For non-customer domains, show DNS instructions as usual
        setPendingDomain(domainName);
      }

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
      if (isOwnedByCustomer) {
        setPendingCustomerDomain(null);
      } else {
        setPendingDomain(null);
      }
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
      if (pendingDomain === domainName) {
        setPendingDomain(null);
      }
      if (pendingCustomerDomain === domainName) {
        setPendingCustomerDomain(null);
      }
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
  }

  const pendingDomainDetails = pendingDomain
    ? appDetails?.domains?.find((d) => d.fqdn === pendingDomain)
    : null;

  // Get customer domain entries (includes root domains + connected subdomains)
  const customerDomainEntries = domains.map((domain) => {
    const domainName = domain.domain || domain.name || '';

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
  });

  // Get custom domains (not prefix domains, not owned by customer)
  // This excludes both exact matches and subdomains of customer domains
  const customDomains = appDetails?.domains?.filter(
    (appDomain) =>
      appDomain.domainType !== 'prefix' &&
      !isCustomerDomain(appDomain.fqdn, domains)
  ) || [];

  // Check if there's already a custom domain in pending or active state
  const hasActiveOrPendingCustomDomain = customDomains.some(
    (d) => d.status === 'pending' || d.status === 'active'
  );

  const hasActiveOrPendingDomain = appDetails?.domains?.some(
    (d) => d.cdnStatus === 2 || d.status === 'active'
  );

  const isPublished = hasBeenPublished(site);

  const shouldDisableAddingDomain = hasActiveOrPendingCustomDomain || hasActiveOrPendingDomain || !isPublished || modifyDomainsMutation.isPending;

  const getCustomDomainStatus = () => {
    const connectedDomains = appDetails?.domains?.filter(d => d.domainType !== 'prefix') || [];

    if (connectedDomains.length === 0) return undefined;

    const hasPending = connectedDomains.some(d =>
      d.status === 'pending' || d.cdnStatus === 2
    );

    const hasActive = connectedDomains.some(d =>
      d.status === 'active'
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
          href="https://www.godaddy.com/domains"
          external
        />
      )}
    >
      {!isSiteLoading && !isPublished && (
        <Alert emphasis="warning">
          Custom domains are only available after you publish your site for the first time.
        </Alert>
      )}
      {/* GoDaddy Domains Section */}
      <Box gap="sm">
        {isLoading && <Spinner size="sm" />}
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
        orientation="horizontal"
        blockAlignChildren="spaceBetween"
        gap="sm"
        inlineAlignChildren="center"
      >
        <TextInput
          className="flex-1"
          id="custom-domain-slug"
          label="Or tell us the domain you would like to use for your website and we'll help you connect it."
          onChange={(value) => {
            setCustomDomain(value);
            // Clear error when user starts typing
            if (customDomainError) {
              setCustomDomainError(null);
            }
          }}
          helpMessage="e.g. mydomain.com"
          value={customDomain}
          errorMessage={customDomainError}
          disabled={shouldDisableAddingDomain}
        />
      </Box>
      { customDomain && (
        <div>
          <Button
            text="Add Custom Domain"
            design="primary"
            onClick={handleAddCustomDomain}
            disabled={shouldDisableAddingDomain}
            data-eid={generateClickEID(`settings/domains.custom_domain.add`)}
            className="!hover:bg-transparent"
          />
        </div>
      ) }

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

