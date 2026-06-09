'use client';

import { useEffect, useRef, useState } from "react";
import { useQuery } from '@tanstack/react-query';
import Box from "@ux/box";
import Button from "@ux/button";
import Skeleton from "@ux/skeleton";
import TextInput from "@ux/text-input";

import SettingsSection from "@/app/[market]/develop/components/settings/SettingsSection";
import { Status } from "@/app/[market]/develop/components/types";
import { useAppIdFromParams } from "@/app/[market]/develop/components/utils";
import { useAppNameUpdate } from '@/hooks/useAppName';
import { useDomainValidationQuery } from '@/hooks/useDomainValidationQuery';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { DomainStatus, DomainType } from "@/lib/control-plane/types";
import { shipAnalyticsLog } from '@/lib/logging';
import { DomainMode } from "@/lib/mgmt-airo/types";
import { logger } from "@/lib/request-context";
import { useSiteStore } from "@/stores/useSiteStore";
import { isBlockedAiroDomain } from '@/utils/domain';
import { getDomainErrorMessage } from '@/utils/domain-validation';
import { generateClickEID } from '@/utils/instrumentation';
import { hasBeenPublished } from '@/utils/site';

export default function ProjectDomain() {
  const t = useTranslations();
  const currentAppId = useAppIdFromParams();
  const isDomainConnectEnabled = useSwitchboard('appbuilder-domain-connect');

  const site = useSiteStore((state) => {
    if (!currentAppId) return null;
    return state.getSite(currentAppId);
  });

  const { id } = site || {};

  // Get prefix domain from site.domains where domainType is PREFIX and status is ACTIVE or PENDING
  const prefixDomain = site?.domains?.find(
    d => d.domainType === DomainType.PREFIX && (d.status === DomainStatus.ACTIVE || d.status === DomainStatus.PENDING)
  );

  const projectDomainValue = prefixDomain?.prefix || currentAppId;

  const [currentProjectName, setCurrentProjectName] = useState(currentAppId);
  const [shouldPoll, setShouldPoll] = useState(false);
  const [showButtons, setShowButtons] = useState(true);
  const [projectDomainDisplay, setProjectDomainDisplay] = useState(
    prefixDomain?.fqdn || site?.published_url || ''
  );
  const [pollSessionId, setPollSessionId] = useState(0);
  const [debouncedDomain, setDebouncedDomain] = useState('');
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fetchSite = useSiteStore((state) => state.fetchSite);

  const shouldValidate = debouncedDomain !== projectDomainValue && debouncedDomain.length > 0;
  const isProjectNameBlocked = isBlockedAiroDomain(currentProjectName);
  const { data: validationData, isLoading: isValidatingDomain, isError: hasValidationError } = useDomainValidationQuery(
    currentAppId,
    debouncedDomain,
    {
      mode: DomainMode.PROJECT,
      enabled: shouldValidate && !isBlockedAiroDomain(debouncedDomain),
      subscriptionId: site?.subscription_id,
      systemId: site?.system_id
    }
  );

  /**
   * Get the full URL for the project domain, ensuring protocol is included
   *
   * @param domain - The domain string which may or may not include protocol
   * @returns Full URL with https:// protocol
   */
  const getProjectDomainUrl = (domain: string) => {
    if (!domain) return '';
    // Check if domain already has a protocol
    if (domain.startsWith('http://') || domain.startsWith('https://')) {
      return domain;
    }
    // Add https:// protocol if not present
    return `https://${domain}`;
  };

  useEffect(() => {
    if (projectDomainValue.length > 0) {
      setCurrentProjectName(projectDomainValue);
      setShowButtons(true); // Show buttons when value changes from backend
    }
  }, [projectDomainValue]);

  useEffect(() => {
    return () => {
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const newDisplay = prefixDomain?.fqdn || site?.published_url || '';
    if (newDisplay && newDisplay !== projectDomainDisplay) {
      setProjectDomainDisplay(newDisplay);
    }
  }, [prefixDomain?.fqdn, projectDomainDisplay, site?.published_url]);

  const updateAppNameMutation = useAppNameUpdate();

  const isDomainPending = prefixDomain?.status === DomainStatus.PENDING;

  // Include pollSessionId in queryKey to force new query when starting a new poll session
  const { data: polledSite } = useQuery({
    queryKey: ['site-poll', currentAppId, pollSessionId],
    queryFn: async () => {
      if (!currentAppId) return null;
      return await fetchSite(currentAppId, true, true);
    },
    enabled: shouldPoll && !!currentAppId,
    refetchInterval: 2000, // Poll every 2 seconds
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (polledSite && shouldPoll) {
      const polledPrefixDomain = polledSite.domains?.find(
        d => d.domainType === DomainType.PREFIX
      );

      // Stop polling if domain is active or failed
      if (polledPrefixDomain?.status === DomainStatus.ACTIVE) {
        setShouldPoll(false);
        logger.info('app-name.poll.complete', {
          appId: currentAppId,
          prefix: polledPrefixDomain.prefix,
          status: polledPrefixDomain.status,
          fqdn: polledPrefixDomain.fqdn,
        });

        shipAnalyticsLog('domain.project.update.success', {
          appId: currentAppId,
          newPrefix: polledPrefixDomain.prefix,
          fqdn: polledPrefixDomain.fqdn
        });

        if (polledPrefixDomain.fqdn) {
          setProjectDomainDisplay(polledPrefixDomain.fqdn);
        }
      } else if (polledPrefixDomain?.status === DomainStatus.FAILED) {
        setShouldPoll(false);
        logger.error('app-name.poll.failed', {
          appId: currentAppId,
          prefix: polledPrefixDomain.prefix,
          status: polledPrefixDomain.status,
        });

        shipAnalyticsLog('domain.project.update.failed', {
          appId: currentAppId,
          newPrefix: polledPrefixDomain.prefix,
          reason: 'polling-detected-failure'
        });
      }
    }
  }, [polledSite, currentAppId, shouldPoll]);

  // Check if the mutation error is a 409 conflict
  const is409Error = updateAppNameMutation.error &&
    (updateAppNameMutation.error as any)?.status === 409;

  /**
   * Determine SettingsSection status based on validation and mutation state
   *
   * @returns Status enum value for the SettingsSection component
   */
  const getProjectDomainStatus = () => {
    if (updateAppNameMutation.isPending || shouldPoll || isDomainPending) {
      return Status.PENDING;
    }
    if (updateAppNameMutation.error) {
      return Status.UNAVAILABLE;
    }
    return Status.READY;
  };

  /**
   * Get appropriate error message based on error type
   *
   * @returns Error message string or undefined if no error
   */
  const getErrorMessage = () => {
    if (isProjectNameBlocked) {
      return t('builder_domain_error_fqdn_invalid');
    }
    if (validationData && !validationData.available) {
      return getDomainErrorMessage(validationData.errors, t);
    }
    if (is409Error) {
      return t('builder_project_domain_error_unavailable');
    }
    if (updateAppNameMutation.error) {
      const errorData = (updateAppNameMutation.error as any)?.response || (updateAppNameMutation.error as any);
      if (errorData.validationErrors && Array.isArray(errorData.validationErrors)) {
        return getDomainErrorMessage(errorData.validationErrors, t);
      }
      return errorData.error || t('builder_project_domain_error_update_failed');
    }
    if (hasValidationError) {
      return t('builder_project_domain_error_validation_failed');
    }
    return undefined;
  };

  /**
   * Handle app name update submission
   *
   * Validates the new name and submits the mutation request.
   */
  const handleUpdateAppName = async () => {
    if (!currentAppId || currentProjectName === id || isProjectNameBlocked) {
      return;
    }

    setShowButtons(false);

    try {
      await updateAppNameMutation.mutateAsync({
        appId: currentAppId,
        newName: currentProjectName,
      });

      // Start polling for domain status after successful mutation
      setPollSessionId(prev => prev + 1);
      setShouldPoll(true);
      logger.info('app-name.poll.start', {
        appId: currentAppId,
        newName: currentProjectName,
      });
    } catch (error) {
      logger.error('app-name.update.error', {
        appId: currentAppId,
        newName: currentProjectName,
        error: error.message,
      });
      shipAnalyticsLog('domain.project.update.failed', {
        appId: currentAppId,
        newPrefix: currentProjectName,
        error: error instanceof Error ? error.message : String(error)
      });
      setShowButtons(true);
    }
  };

  const handleCancel = () => {
    setCurrentProjectName(projectDomainValue);
    updateAppNameMutation.reset();
    setShowButtons(false);
    setDebouncedDomain('');
  };

  const handleInputChange = (value: string) => {
    // force all prefix input to only allow lowercase.
    setCurrentProjectName(value.toLowerCase());
    setShowButtons(true);

    // Clear mutation error when user starts typing
    if (updateAppNameMutation.error) {
      updateAppNameMutation.reset();
    }

    // Clear any existing timeout
    if (validationTimeoutRef.current) {
      clearTimeout(validationTimeoutRef.current);
    }

    // Debounce validation check (500ms delay for responsive UX)
    validationTimeoutRef.current = setTimeout(() => {
      setDebouncedDomain(value);
    }, 500);
  };

  const isPublished = hasBeenPublished(site);
  const disableProjectDomain = !isPublished;

  return (
    <SettingsSection
      title={t('builder_project_domain_title')}
      description={t('builder_project_domain_description')}
      status={getProjectDomainStatus()}
      isCollapsible={!isDomainConnectEnabled}
      useDomainConnectLayout={isDomainConnectEnabled}
    >
      <Box orientation="vertical" gap="md" className="w-full" blockAlignChildren="start">
        <Box
          orientation="horizontal"
          gap="sm"
          inlineAlignChildren="end"
          className="w-full"
        >
          {!site ? (
            <Skeleton className="mt-2.5" size="lg" width="100%" lines={1} />
          ) : (
            <TextInput
              className="flex-1"
              id="project-domain-name"
              label={t('builder_project_domain_label')}
              value={currentProjectName}
              onChange={handleInputChange}
              helpMessage={t('builder_project_domain_help')}
              errorMessage={getErrorMessage()}
              disabled={isDomainPending || shouldPoll || updateAppNameMutation.isPending || disableProjectDomain}
            />
          )}
        </Box>
        <div>
          {!site ? (
            <div className="w-[15em] lg:w-[25em]">
              <Skeleton size="md" width="100%" lines={1} />
            </div>
          ) : (
            <Button
              design="inline"
              text={projectDomainDisplay}
              data-eid={generateClickEID(`settings.domains.project_domain_link`)}
              className="!hover:bg-transparent"
              href={getProjectDomainUrl(projectDomainDisplay)}
              as="external"
              external
            />
         )}
        </div>
        { showButtons && currentProjectName !== projectDomainValue && (
          <Box orientation="horizontal" gap="sm" className="mt-2">
            <Button
              disabled={
                currentProjectName.length === 0 ||
                currentProjectName === id ||
                isProjectNameBlocked ||
                updateAppNameMutation.isPending ||
                isValidatingDomain ||
                hasValidationError || // Validation check failed
                (currentProjectName !== debouncedDomain) || // Validation hasn't completed yet (debounce pending)
                (validationData && !validationData.available) || // Validation failed
                !!updateAppNameMutation.error
              }
              design="primary"
              onClick={handleUpdateAppName}
              data-eid={generateClickEID(`settings.domains.project_domain_update`)}
              className="!hover:bg-transparent"
              text={isValidatingDomain || (currentProjectName !== debouncedDomain)
                ? t('builder_project_domain_button_checking')
                : t('builder_project_domain_button_save')
            }
            />
            <Button
              disabled={updateAppNameMutation.isPending }
              design="secondary"
              onClick={handleCancel}
              data-eid={generateClickEID(`settings.domains.project_domain_cancel`)}
              className="!hover:bg-transparent"
              text={t('builder_project_domain_button_cancel')}
            />
          </Box>
        ) }
      </Box>
    </SettingsSection>
  )
}

