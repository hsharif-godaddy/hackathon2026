import { useState, useEffect, useRef } from "react";
import { useQuery } from '@tanstack/react-query';
import { DomainType, DomainStatus } from "@/lib/control-plane/types";
import { DomainMode } from "@/lib/mgmt-airo/types";
import { useDomainValidationQuery } from '@/hooks/useDomainValidationQuery';
import { getDomainErrorMessage } from '@/utils/domain-validation';
import SiblingSet from "@ux/sibling-set";
import Skeleton from "@ux/skeleton";
import WindowNewIcon from '@ux/icon/window-new';
import { useAppNameUpdate } from '@/hooks/useAppName';
import { generateClickEID } from '@/utils/instrumentation';
import { useSiteStore } from "@/stores/useSiteStore";
import { useAppIdFromParams } from "@/app/develop/components/utils";
import { logger } from "@/lib/request-context";
import BigCard from "@/components/layout/BigCard";
import TextInput from "@ux/text-input";
import Button from "@ux/button";
import text from "@ux/text";
import Box from "@ux/box";
import { Status } from "@/app/develop/components/types";
import { hasBeenPublished } from '@/utils/site';

export default function ProjectDomain() {
  const currentAppId = useAppIdFromParams();

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
  const { data: validationData, isLoading: isValidatingDomain, isError: hasValidationError } = useDomainValidationQuery(
    currentAppId,
    debouncedDomain,
    {
      mode: DomainMode.PROJECT,
      enabled: shouldValidate,
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
      return await fetchSite(currentAppId, true);
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

      // Stop polling if domain is active
      if (polledPrefixDomain?.status === DomainStatus.ACTIVE) {
        setShouldPoll(false);
        logger.info('app-name.poll.complete', {
          appId: currentAppId,
          prefix: polledPrefixDomain.prefix,
          status: polledPrefixDomain.status,
          fqdn: polledPrefixDomain.fqdn,
        });

        if (polledPrefixDomain.fqdn) {
          setProjectDomainDisplay(polledPrefixDomain.fqdn);
        }
      }
    }
  }, [polledSite, currentAppId, shouldPoll]);

  // Check if the mutation error is a 409 conflict
  const is409Error = updateAppNameMutation.error &&
    (updateAppNameMutation.error as any)?.status === 409;

  /**
   * Determine BigCard status based on validation and mutation state
   *
   * @returns Status enum value for the BigCard component
   */
  const getProjectDomainStatus = () => {
    if (updateAppNameMutation.isPending || shouldPoll || isDomainPending) {
      return Status.PENDING;
    }
    if (updateAppNameMutation.error) {
      return Status.UNAVAILABLE;
    }
    if (currentProjectName === projectDomainValue) {
      return Status.READY;
    }
    return Status.READY;
  };

  /**
   * Get appropriate error message based on error type
   *
   * @returns Error message string or undefined if no error
   */
  const getErrorMessage = () => {
    if (validationData && !validationData.available) {
      return getDomainErrorMessage(validationData.errors);
    }
    if (is409Error) {
      return "This subdomain is unavailable. Please pick a different subdomain";
    }
    if (updateAppNameMutation.error) {
      const errorData = (updateAppNameMutation.error as any)?.response || (updateAppNameMutation.error as any);
      if (errorData.validationErrors && Array.isArray(errorData.validationErrors)) {
        return getDomainErrorMessage(errorData.validationErrors);
      }
      return errorData.error || "Failed to update subdomain. Please try again";
    }
    if (hasValidationError) {
      return "Unable to validate domain. Please try again or pick a different subdomain.";
    }
    return undefined;
  };

  /**
   * Handle app name update submission
   *
   * Validates the new name and submits the mutation request.
   */
  const handleUpdateAppName = async () => {
    if (!currentAppId || currentProjectName === id) {
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
    <BigCard
      title="Project Domain"
      description="Your project is currently accessible via the airoapp.ai subdomain below."
      status={getProjectDomainStatus()}
    >
      <Box orientation="vertical" gap="md" className="w-full" blockAlignChildren="start">
        <Box
          orientation="horizontal"
          gap="sm"
          inlineAlignChildren="end"
          className="w-full"
        >
          {!site ? (
            <Skeleton className="mt-5" size="lg" width="100%" lines={1} />
          ) : (
            <TextInput
              className="flex-1"
              id="project-domain-name"
              label="Name"
              value={currentProjectName}
              onChange={handleInputChange}
              helpMessage="Must be 5 or more characters. Letters, numbers, and hyphens only. Must start and end with a letter or number."
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
             data-eid={generateClickEID(`settings/domains.project_domain.link`)}
             className="!hover:bg-transparent"
             href={getProjectDomainUrl(projectDomainDisplay)}
             external
           >
             <Box
               className="w-auto"
               orientation="horizontal"
               gap="sm"
               inlineAlignChildren="center"
               blockAlignChildren="start"
             >
               <text.p>{projectDomainDisplay}</text.p>
               <WindowNewIcon className="size-4" />
             </Box>
           </Button>
         )}
        </div>
        { showButtons && currentProjectName !== projectDomainValue && (
          <SiblingSet gap="sm" className="mt-4">
            <Button
              disabled={
                currentProjectName.length === 0 ||
                currentProjectName === id ||
                updateAppNameMutation.isPending ||
                isValidatingDomain ||
                hasValidationError || // Validation check failed
                (currentProjectName !== debouncedDomain) || // Validation hasn't completed yet (debounce pending)
                (validationData && !validationData.available) || // Validation failed
                !!updateAppNameMutation.error
              }
              design="primary"
              onClick={handleUpdateAppName}
              data-eid={generateClickEID(`settings/domains.project_domain.update`)}
              className="!hover:bg-transparent"
              text={isValidatingDomain || (currentProjectName !== debouncedDomain) ? "Checking domain…" : "Save Changes"}
            />
            <Button
              disabled={updateAppNameMutation.isPending }
              design="secondary"
              onClick={handleCancel}
              data-eid={generateClickEID(`settings/domains.project_domain.cancel`)}
              className="!hover:bg-transparent"
              text="Cancel"
            />
          </SiblingSet>
        ) }
      </Box>
    </BigCard>
  )
}

