'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { FormattedMessage } from 'react-intl';
import Button from '@ux/button';
import ChevronDownIcon from '@ux/icon/chevron-down';
import ChevronUpIcon from '@ux/icon/chevron-up';
import Skeleton from '@ux/skeleton';
import text from '@ux/text';

import AppSiteRow from '@/app/manage-plan/components/AppSiteRow';
import UnpublishConfirmationModal from '@/components/layout/UnpublishConfirmationModal';
import { useDomainDisconnectPolling, useMultipleDeploymentStatusPolling } from '@/hooks/useDeploymentStatusPolling';
import { usePublishApp } from '@/hooks/usePublishApp';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { useUnpublishApp } from '@/hooks/useUnpublishApp';
import { DomainStatus, DomainType } from '@/lib/control-plane/types';
import { isPaidPlanForGrants, type PaywallType } from '@/lib/paywall/shared';
import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { getPublishLimit, isPublishedApp } from '@/lib/publish-limit';
import type { SiteInfo } from '@/lib/site-adapters/interfaces/ISiteAdapter';
import { useSitesStore } from '@/stores/useSitesStore';
import { SubscriptionPlan } from '@/types/credits';
import { getPlanDisplayLabelKey } from '@/utils/credits';

interface AppsAndSitesCardProps {
  sites: SiteInfo[];
  isLoading?: boolean;
  subscriptionPlan?: SubscriptionPlan;
  //Legacy AiroPlus entitlement ID
  entitlementId?: string;
  onOpenPaywall?: (source: string, type?: PaywallType, itc?: string) => void;
}

function getCustomDomain(site: SiteInfo): string | null {
  if (!site.domains?.length) {
    return null;
  }

  const customDomain = site.domains.find((d) => d.domainType !== DomainType.PREFIX && d.status === DomainStatus.ACTIVE);
  return customDomain?.fqdn ?? null;
}

/**
 * Get the display URL for a site, preferring custom domain over default published_url.
 * Returns URL with https:// protocol for use in href attributes.
 */
function getDisplayUrl(site: SiteInfo): string | null {
  const customDomain = getCustomDomain(site);
  if (customDomain) {
    return `https://${customDomain}`;
  }
  return site.published_url ?? null;
}

export default function AppsAndSitesCard({
  sites,
  isLoading = false,
  subscriptionPlan,
  entitlementId,
  onOpenPaywall,
}: AppsAndSitesCardProps) {
  const t = useTranslations();
  const router = useRouter();
  const { data: isUnpublishEnabled } = useSwitchboard('appbuilder-unpublish');
  const { data: isGrantsEnabled } = useSwitchboard('app-builder-grants');
  const unpublishMutation = useUnpublishApp();
  const publishMutation = usePublishApp();
  const fetchAllSites = useSitesStore((state) => state.fetchAllSites);

  const isLegacyAiroPlus = subscriptionPlan === SubscriptionPlan.Starter && !!entitlementId;
  const effectivePlanForLimits = isLegacyAiroPlus ? SubscriptionPlan.AiroPlus : subscriptionPlan;

  const publishLimit = getPublishLimit(effectivePlanForLimits);
  const planLabelKey = subscriptionPlan ? getPlanDisplayLabelKey(subscriptionPlan) : null;
  const planName = planLabelKey ? t(planLabelKey) : '';
  const isPaidPlan = isPaidPlanForGrants(subscriptionPlan, isGrantsEnabled);

  const canUpgradeForMorePublishes =
    effectivePlanForLimits &&
    effectivePlanForLimits !== SubscriptionPlan.Ultimate &&
    effectivePlanForLimits !== SubscriptionPlan.AiroPlus;

  const publishedCount = useMemo(
    () => sites.filter(isPublishedApp).length,
    [sites]
  );

  const isAtPublishLimit = publishLimit !== null && publishedCount >= publishLimit;

  const [isExpanded, setIsExpanded] = useState(true);
  const [selectedApp, setSelectedApp] = useState<SiteInfo | null>(null);
  const [showUnpublishModal, setShowUnpublishModal] = useState(false);

  const [publishingApps, setPublishingApps] = useState<Set<string>>(new Set());
  const [unpublishingApps, setUnpublishingApps] = useState<Set<string>>(new Set());

  const [disconnectingDomainApps, setDisconnectingDomainApps] = useState<Map<string, string>>(new Map());

  const [deploymentsToTrack, setDeploymentsToTrack] = useState<Map<string, string>>(new Map());

  // Error state per app - stores error message to display below button
  const [appErrors, setAppErrors] = useState<Map<string, string>>(new Map());

  const clearAppError = useCallback((appId: string) => {
    setAppErrors((prev) => {
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
  }, []);

  const setAppError = useCallback((appId: string, error: string) => {
    setAppErrors((prev) => {
      const next = new Map(prev);
      next.set(appId, error);
      return next;
    });
  }, []);

  const domainsToTrack = useMemo(
    () => Array.from(disconnectingDomainApps.entries()).map(([appId, domainFqdn]) => ({
      appId,
      domainFqdn,
    })),
    [disconnectingDomainApps]
  );

  const handleDomainDisconnectComplete = useCallback(async (appId: string) => {
    setDisconnectingDomainApps((prev) => {
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
    await fetchAllSites();
  }, [fetchAllSites]);

  const handleDomainDisconnectTimeout = useCallback((appId: string) => {
    setDisconnectingDomainApps((prev) => {
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
    setAppError(appId, t('builder_unpublish_domain_disconnect_timeout'));
  }, [setAppError, t]);

  useDomainDisconnectPolling({
    domains: domainsToTrack,
    onComplete: handleDomainDisconnectComplete,
    onTimeout: handleDomainDisconnectTimeout,
  });

  const deploymentsToTrackArray = useMemo(
    () => Array.from(deploymentsToTrack.entries()).map(([appId, deploymentId]) => ({
      appId,
      deploymentId,
    })),
    [deploymentsToTrack]
  );

  const handleDeploymentComplete = useCallback(async (appId: string) => {
    setDeploymentsToTrack((prev) => {
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });

    setPublishingApps((prev) => {
      const next = new Set(prev);
      next.delete(appId);
      return next;
    });

    await fetchAllSites();
  }, [fetchAllSites]);

  useMultipleDeploymentStatusPolling({
    deployments: deploymentsToTrackArray,
    onComplete: handleDeploymentComplete,
  });

  const handleUnpublishClick = (site: SiteInfo) => {
    // Clear any previous error when clicking the button
    clearAppError(site.id);
    setSelectedApp(site);
    setShowUnpublishModal(true);
  };

  const handleUnpublishConfirm = (disconnectDomain: boolean) => {
    if (!selectedApp) {return;}

    const appId = selectedApp.id;
    const customDomain = getCustomDomain(selectedApp);

    setUnpublishingApps((prev) => new Set(prev).add(appId));

    unpublishMutation.mutate(
      {
        appId,
        disconnectDomain,
        domainFqdn: disconnectDomain && customDomain ? customDomain : undefined,
      },
      {
        onSuccess: (_result) => {
          setShowUnpublishModal(false);
          setSelectedApp(null);

          // Start polling for domain removal if disconnect was requested
          if (disconnectDomain && customDomain) {
            setDisconnectingDomainApps((prev) => {
              const next = new Map(prev);
              next.set(appId, customDomain);
              return next;
            });
          }
        },
        onSettled: () => {
          setUnpublishingApps((prev) => {
            const next = new Set(prev);
            next.delete(appId);
            return next;
          });
        },
      }
    );
  };

  const handleUnpublishRetry = () => {
    if (selectedApp) {
      const appId = selectedApp.id;

      setUnpublishingApps((prev) => new Set(prev).add(appId));

      unpublishMutation.mutate(
        {
          appId,
          disconnectDomain: false,
        },
        {
          onSuccess: () => {
            setShowUnpublishModal(false);
            setSelectedApp(null);
          },
          onSettled: () => {
            setUnpublishingApps((prev) => {
              const next = new Set(prev);
              next.delete(appId);
              return next;
            });
          },
        }
      );
    }
  };

  const handleCloseModal = () => {
    setShowUnpublishModal(false);
    setSelectedApp(null);
    unpublishMutation.reset();
  };

  const handlePublishClick = async (siteId: string) => {
    // Clear any previous error when clicking the button
    clearAppError(siteId);
    setPublishingApps((prev) => new Set(prev).add(siteId));

    try {
      const result = await publishMutation.mutateAsync({ appId: siteId });

      if (result.result.deployment?.deploymentId) {
        setDeploymentsToTrack((prev) => {
          const next = new Map(prev);
          next.set(siteId, result.result.deployment!.deploymentId);
          return next;
        });
      } else if (result.result.published) {
        await fetchAllSites();
        setPublishingApps((prev) => {
          const next = new Set(prev);
          next.delete(siteId);
          return next;
        });
      } else {
        setPublishingApps((prev) => {
          const next = new Set(prev);
          next.delete(siteId);
          return next;
        });
      }
    } catch (error) {
      setPublishingApps((prev) => {
        const next = new Set(prev);
        next.delete(siteId);
        return next;
      });
      const errorMessage = error instanceof Error && error.message?.trim() ? error.message : t('builder_common_error_generic');
      setAppError(siteId, errorMessage);
    }
  };

  if (isLoading && sites.length === 0) {
    return (
      <div className="flex flex-col md:col-span-2 bg-intents-ux-box-backgroundColor rounded-xl border border-border p-2 sm:p-4">
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full">
          <Skeleton width="16px" height="16px" className="flex-shrink-0" />
          <Skeleton width="120px" height="20px" />
          <Skeleton width="80px" height="16px" />
          <div className="hidden sm:block sm:ml-auto">
            <Skeleton width="60px" height="20px" />
          </div>
        </div>
      </div>
    );
  }

  if (!sites.length) {
    return (
      <div className="flex flex-col md:col-span-2 bg-intents-ux-box-backgroundColor rounded-xl border border-border p-2 sm:p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-baseline gap-2">
            <text.strong
              as="title"
              size={0}
              className="block"
              text={`${t('builder_manageplan_apps_title')} (0)`}
            />
            <text.p as="paragraph" size={-1} className="text-intents-ux-passive-foregroundColor">
              {t('builder_manageplan_apps_published_count', { count: 0 })}
            </text.p>
          </div>
          <Button
            design="inline"
            size="sm"
            onClick={() => router.push('/apps')}
            text={t('builder_manageplan_my_apps')}
          />
        </div>
        {planName && publishLimit !== null && publishLimit > 0 && (
          <text.p as="paragraph" size={-1} className="mb-3 text-intents-ux-passive-foregroundColor">
            <FormattedMessage
              id="builder_manageplan_apps_plan_limit"
              values={{
                planName,
                limit: publishLimit,
                strong: (chunks) => <strong>{chunks}</strong>,
              }}
            />
          </text.p>
        )}
        <text.p
          as="paragraph"
          text={t('builder_manageplan_apps_empty')}
        />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col md:col-span-2 bg-intents-ux-box-backgroundColor rounded-xl border border-border p-2 sm:p-4">
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full">
          <button
            type="button"
            className="flex-shrink-0 cursor-pointer"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
          </button>
          <div className="flex items-baseline gap-2 flex-shrink-0">
            <text.strong
              as="title"
              size={0}
              className="block flex-shrink-0"
              text={`${t('builder_manageplan_apps_title')}`}
            />
            <text.p as="paragraph" size={-1} className="text-intents-ux-passive-foregroundColor flex-shrink-0" emphasis="passive">
              {t('builder_manageplan_apps_published_count', { count: publishedCount })}
            </text.p>
          </div>
          <div className="hidden sm:block sm:ml-auto flex-shrink-0">
            <Button
              design="inline"
              data-partial='componentAiro'
              size="sm"
              onClick={() => router.push('/apps')}
              text={t('builder_manageplan_my_apps')}
            />
          </div>
        </div>

        {isExpanded && (
          <>
            {planName && publishLimit !== null && publishLimit > 0 && (
              <text.p as="paragraph" size={-1} className="mt-2 mb-3 flex-shrink-0 text-intents-ux-passive-foregroundColor">
                {canUpgradeForMorePublishes && onOpenPaywall ? (
                  <FormattedMessage
                    id="builder_manageplan_apps_plan_limit_with_upgrade"
                    values={{
                      planName,
                      limit: publishLimit,
                      upgradeLink: (chunks) => (
                        <Button
                          design="inline"
                          size="sm"
                          data-partial="componentAiro"
                          onClick={() => onOpenPaywall('manage_plan.apps_upgrade', 'upgrade', PAYWALL_ITC.UPGRADE)}
                          text={chunks.toString()}
                        />
                      ),
                      strong: (chunks) => <strong>{chunks}</strong>
                    }}
                  />
                ) : (
                  <FormattedMessage
                    id="builder_manageplan_apps_plan_limit"
                    values={{
                      planName,
                      limit: publishLimit,
                      strong: (chunks) => <strong>{chunks}</strong>,
                    }}
                  />
                )}
              </text.p>
            )}

            <div className="flex flex-col flex-1 min-h-0 overflow-y-auto pr-1 max-h-48">
              {sites.map((site) =>
                <AppSiteRow
                  key={site.id}
                  disabled={publishingApps.has(site.id) || unpublishingApps.has(site.id) || disconnectingDomainApps.has(site.id)}
                  site={site}
                  isPublished={isPublishedApp(site)}
                  publishedUrl={getDisplayUrl(site)}
                  isPublishing={publishingApps.has(site.id)}
                  isUnpublishing={unpublishingApps.has(site.id)}
                  isDisconnectingDomain={disconnectingDomainApps.has(site.id)}
                  isUnpublishEnabled={isUnpublishEnabled ?? false}
                  isPaidPlan={isPaidPlan}
                  isAtPublishLimit={isAtPublishLimit}
                  canUpgrade={canUpgradeForMorePublishes ?? false}
                  error={appErrors.get(site.id)}
                  onPublishClick={handlePublishClick}
                  onUnpublishClick={handleUnpublishClick}
                  onOpenPaywall={onOpenPaywall}
                />
              )}
            </div>
          </>
        )}
      </div>

      {showUnpublishModal && selectedApp && (
        <UnpublishConfirmationModal
          appName={selectedApp.name}
          customDomain={getCustomDomain(selectedApp)}
          publishedUrl={getDisplayUrl(selectedApp)}
          onClose={handleCloseModal}
          onConfirm={handleUnpublishConfirm}
          isLoading={unpublishingApps.has(selectedApp.id)}
          error={unpublishMutation.error}
          onRetry={unpublishMutation.error?.retryable ? handleUnpublishRetry : undefined}
        />
      )}
    </>
  );
}
