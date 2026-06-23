'use client';

import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from '@tanstack/react-query';
import Box from "@ux/box";
import Button from "@ux/button";
import Growl from '@ux/growl';
import CheckmarkIcon from '@ux/icon/checkmark';
import CopyIcon from '@ux/icon/copy';
import WindowNewIcon from '@ux/icon/window-new';
import Skeleton from "@ux/skeleton";
import text from '@ux/text';
import TextInput from "@ux/text-input";

import IconButton from '@/app/[market]/develop/components/IconButton';
import { DomainPanelStatusBadge } from '@/app/[market]/develop/components/settings/DomainPanel/DomainPanelStatusBadge';
import {
  DOMAIN_PANEL_EDIT_BUTTON_CLASS,
  DOMAIN_PANEL_SECTION_DESCRIPTION_CLASS,
  DOMAIN_PANEL_SECTION_TITLE_CLASS,
  DOMAIN_PANEL_SUBTITLE_INPUT_GAP_CLASS,
  DOMAIN_PANEL_TITLE_DESCRIPTION_GAP_CLASS,
  DOMAIN_PANEL_TITLE_STATUS_GAP_CLASS,
} from '@/app/[market]/develop/components/settings/DomainPanel/domainPanelStyles';
import { Status } from "@/app/[market]/develop/components/types";
import { useAppIdFromParams } from "@/app/[market]/develop/components/utils";
import ProjectsActionModal, {
  ProjectsActionModalFooter,
} from '@/app/[market]/projects/components/ProjectsActionModal';
import { useAppNameUpdate } from '@/hooks/useAppName';
import { useBreakpoints } from '@/hooks/useBreakpoints';
import { useDomainValidationQuery } from '@/hooks/useDomainValidationQuery';
import { useTranslations } from '@/hooks/useTranslations';
import { DomainStatus, DomainType } from "@/lib/control-plane/types";
import { shipAnalyticsLog } from '@/lib/logging';
import { DomainMode } from "@/lib/mgmt-airo/types";
import { logger } from "@/lib/request-context";
import { cn } from '@/lib/utils';
import { useSiteStore } from "@/stores/useSiteStore";
import { hasInvalidProjectDomainPrefixBounds, hasInvalidProjectDomainPrefixCharacters, isBlockedAiroDomain, looksLikeCustomDomainPrefix } from '@/utils/domain';
import { getDomainErrorMessage, isProjectPrefixTakenError } from '@/utils/domain-validation';
import { generateClickEID } from '@/utils/instrumentation';
import { hasBeenPublished } from '@/utils/site';

const MIN_PROJECT_DOMAIN_LENGTH = 5;
const PROJECT_DOMAIN_TAKEN_MESSAGE = 'This URL is already in use. Please choose a different one.';
const PROJECT_DOMAIN_NETWORK_ERROR_MESSAGE = 'Something went wrong. Please try again.';
const PROJECT_DOMAIN_INVALID_CHARACTERS_MESSAGE =
  'Only letters, numbers, periods (.), and hyphens (-) are allowed.';
const PROJECT_DOMAIN_INVALID_BOUNDS_MESSAGE =
  'URL must start and end with a letter or number';

export default function ProjectDomain() {
  const t = useTranslations();
  const { isMdBreakpoint } = useBreakpoints();
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
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [projectDomainDisplay, setProjectDomainDisplay] = useState(
    prefixDomain?.fqdn || site?.published_url || ''
  );
  const [pollSessionId, setPollSessionId] = useState(0);
  const [debouncedDomain, setDebouncedDomain] = useState('');
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const projectDomainInputRef = useRef<HTMLInputElement>(null);
  const saveSuccessGrowlShownRef = useRef(false);
  const fetchSite = useSiteStore((state) => state.fetchSite);

  const shouldValidate =
    debouncedDomain !== projectDomainValue &&
    debouncedDomain.length >= MIN_PROJECT_DOMAIN_LENGTH;
  const isProjectNameBlocked = isBlockedAiroDomain(currentProjectName);
  const isDomainTooShort =
    currentProjectName.length > 0 && currentProjectName.length < MIN_PROJECT_DOMAIN_LENGTH;
  const isCustomDomainLikeInput = looksLikeCustomDomainPrefix(currentProjectName);
  const hasInvalidCharacters = hasInvalidProjectDomainPrefixCharacters(currentProjectName);
  const hasInvalidBounds = hasInvalidProjectDomainPrefixBounds(currentProjectName);
  const { data: validationData, isLoading: isValidatingDomain, isError: hasValidationError } = useDomainValidationQuery(
    currentAppId,
    debouncedDomain,
    {
      mode: DomainMode.PROJECT,
      enabled:
        shouldValidate &&
        !isBlockedAiroDomain(debouncedDomain) &&
        !hasInvalidProjectDomainPrefixCharacters(debouncedDomain) &&
        !hasInvalidProjectDomainPrefixBounds(debouncedDomain) &&
        !looksLikeCustomDomainPrefix(debouncedDomain),
      subscriptionId: site?.subscription_id,
      systemId: site?.system_id
    }
  );

  const isValidationCurrent = currentProjectName === debouncedDomain && !isValidatingDomain;

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

  const displayHostname = useMemo(() => {
    return projectDomainDisplay.replace(/^https?:\/\//, '');
  }, [projectDomainDisplay]);

  const airoSubdomainLabel = useMemo(() => {
    if (!displayHostname) return 'airoapp.ai';
    const parts = displayHostname.split('.');
    if (parts.length >= 2) {
      return parts.slice(-2).join('.');
    }
    return 'airoapp.ai';
  }, [displayHostname]);

  const domainSuffix = `.${airoSubdomainLabel}`;

  useEffect(() => {
    if (projectDomainValue.length > 0) {
      setCurrentProjectName(projectDomainValue);
      setShowButtons(true); // Show buttons when value changes from backend
    }
  }, [projectDomainValue]);

  useEffect(() => {
    if (!isEditing || !site) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      const input = projectDomainInputRef.current;
      if (!input) {
        return;
      }

      input.focus();
      input.select();
    });

    return () => cancelAnimationFrame(frameId);
  }, [isEditing, site]);

  useEffect(() => {
    return () => {
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current);
      }
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
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
        setIsEditing(false);
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

        if (!saveSuccessGrowlShownRef.current) {
          saveSuccessGrowlShownRef.current = true;
          Growl.addGrowlMessage({
            id: 'project-domain-update-success',
            title: t('builder_status_success'),
            children: t(
              'builder_project_domain_save_success',
              undefined,
              'Project domain updated successfully.',
            ),
            emphasis: 'success',
            lifetime: 5000,
          });
        }

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
   * @returns Error message content or undefined if no error
   */
  const getInputErrorContent = (): ReactNode => {
    if (hasInvalidBounds) {
      return t(
        'builder_project_domain_error_invalid_bounds',
        undefined,
        PROJECT_DOMAIN_INVALID_BOUNDS_MESSAGE,
      );
    }
    if (hasInvalidCharacters) {
      return t(
        'builder_project_domain_error_invalid_characters',
        undefined,
        PROJECT_DOMAIN_INVALID_CHARACTERS_MESSAGE,
      );
    }
    if (isDomainTooShort) {
      return t(
        'builder_project_domain_error_min_length',
        undefined,
        'You must enter at least 5 characters.',
      );
    }
    if (isCustomDomainLikeInput) {
      return t(
        'builder_project_domain_error_custom_domain',
        undefined,
        'To add a custom domain visit External Domain section above',
      );
    }
    if (isProjectNameBlocked) {
      return t('builder_domain_error_fqdn_invalid');
    }
    if (isValidationCurrent && validationData && !validationData.available) {
      if (isProjectPrefixTakenError(validationData.errors)) {
        return t(
          'builder_project_domain_error_taken',
          undefined,
          PROJECT_DOMAIN_TAKEN_MESSAGE,
        );
      }
      return getDomainErrorMessage(validationData.errors, t);
    }
    if (is409Error) {
      return t(
        'builder_project_domain_error_taken',
        undefined,
        PROJECT_DOMAIN_TAKEN_MESSAGE,
      );
    }
    if (updateAppNameMutation.error) {
      const errorData = (updateAppNameMutation.error as any)?.response || (updateAppNameMutation.error as any);
      if (errorData.validationErrors && Array.isArray(errorData.validationErrors)) {
        if (isProjectPrefixTakenError(errorData.validationErrors)) {
          return t(
            'builder_project_domain_error_taken',
            undefined,
            PROJECT_DOMAIN_TAKEN_MESSAGE,
          );
        }
        return getDomainErrorMessage(errorData.validationErrors, t);
      }
      return t(
        'builder_project_domain_error_network',
        undefined,
        PROJECT_DOMAIN_NETWORK_ERROR_MESSAGE,
      );
    }
    if (hasValidationError) {
      return t(
        'builder_project_domain_error_network',
        undefined,
        PROJECT_DOMAIN_NETWORK_ERROR_MESSAGE,
      );
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
      saveSuccessGrowlShownRef.current = false;
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
    setIsEditing(false);
  };

  const handleInputChange = (value: string) => {
    const normalized = value.toLowerCase();
    setCurrentProjectName(normalized);
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
      setDebouncedDomain(normalized);
    }, 500);
  };

  const handleCopyUrl = async () => {
    if (!displayHostname) return;

    try {
      await navigator.clipboard.writeText(displayHostname);
      setCopied(true);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (error) {
      logger.warn('project-domain.copy.failed', {
        appId: currentAppId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleOpenUrl = () => {
    const url = getProjectDomainUrl(projectDomainDisplay);
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const isPublished = hasBeenPublished(site);
  const disableProjectDomain = !isPublished;
  const projectDomainStatus = getProjectDomainStatus();
  const isMutationBusy = isDomainPending || shouldPoll || updateAppNameMutation.isPending;
  const canStartEditing = !disableProjectDomain && !isMutationBusy;
  const showInlineEdit = isEditing && isMdBreakpoint;
  const showEditSheet = isEditing && !isMdBreakpoint;

  const handleStartEditing = () => {
    if (!canStartEditing) {
      return;
    }

    setIsEditing(true);
    setShowButtons(true);
    setDebouncedDomain(currentProjectName);
  };

  const handleUrlBarActivate = () => {
    handleStartEditing();
  };

  const handleUrlBarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    handleStartEditing();
  };

  const hasProjectNameChanges = currentProjectName !== projectDomainValue;
  const showDomainAvailable =
    shouldValidate &&
    isValidationCurrent &&
    !isDomainTooShort &&
    !hasInvalidCharacters &&
    !hasInvalidBounds &&
    !isCustomDomainLikeInput &&
    !isProjectNameBlocked &&
    validationData?.available === true;

  const inputErrorMessage = getInputErrorContent();

  const isSaveDisabled =
    !hasProjectNameChanges ||
    currentProjectName.length < MIN_PROJECT_DOMAIN_LENGTH ||
    hasInvalidCharacters ||
    hasInvalidBounds ||
    isCustomDomainLikeInput ||
    currentProjectName === id ||
    isProjectNameBlocked ||
    updateAppNameMutation.isPending ||
    isValidatingDomain ||
    hasValidationError ||
    (currentProjectName !== debouncedDomain) ||
    (validationData && !validationData.available) ||
    !!updateAppNameMutation.error;

  const editActions = (
    <div
      className="flex shrink-0 flex-wrap items-center justify-end gap-2"
      data-testid="project-domain-edit-actions"
    >
      <Button
        disabled={updateAppNameMutation.isPending}
        design="secondary"
        size="sm"
        onClick={handleCancel}
        data-eid={generateClickEID('settings.domains.project_domain_cancel')}
        text={t('builder_project_domain_button_cancel')}
        className="shrink-0"
      />
      <Button
        disabled={isSaveDisabled}
        design="primary"
        size="sm"
        onClick={handleUpdateAppName}
        data-eid={generateClickEID('settings.domains.project_domain_update')}
        text={isValidatingDomain || (currentProjectName !== debouncedDomain)
          ? t('builder_project_domain_button_checking')
          : t('builder_project_domain_save', undefined, 'Save')
        }
        className="shrink-0"
      />
    </div>
  );

  const mobileEditFooter = (
    <div data-testid="project-domain-edit-actions">
      <ProjectsActionModalFooter
        onCancel={handleCancel}
        cancelText={t('builder_project_domain_button_cancel')}
        onConfirm={() => void handleUpdateAppName()}
        confirmText={
          isValidatingDomain || (currentProjectName !== debouncedDomain)
            ? t('builder_project_domain_button_checking')
            : t('builder_project_domain_save', undefined, 'Save')
        }
        confirmDisabled={isSaveDisabled}
        cancelDisabled={updateAppNameMutation.isPending}
        isLoading={updateAppNameMutation.isPending}
        cancelEid={generateClickEID('settings.domains.project_domain_cancel')}
        confirmEid={generateClickEID('settings.domains.project_domain_update')}
      />
    </div>
  );

  const editForm = !site ? (
    <Skeleton className="mt-2.5" size="lg" width="100%" lines={1} />
  ) : (
    <div className="flex w-full flex-col">
      <TextInput
        ref={projectDomainInputRef}
        className="w-full"
        id="project-domain-name"
        label={t('builder_project_domain_label')}
        value={currentProjectName}
        suggestion={`${currentProjectName}${domainSuffix}`}
        onChange={handleInputChange}
        helpMessage={
          !inputErrorMessage && !showDomainAvailable
            ? t(
                'builder_project_domain_help',
                undefined,
                'At least 5 characters. Letters, numbers, and hyphens only. Must start and end with a letter or number',
              )
            : undefined
        }
        errorMessage={inputErrorMessage}
        invalid={!!inputErrorMessage}
        disabled={isMutationBusy || disableProjectDomain}
      />
      {showDomainAvailable && (
        <text.p
          as="caption"
          role="status"
          className="!m-0 text-intents-ux-success-textColor"
        >
          {t('builder_project_domain_available', undefined, 'Domain is available')}
        </text.p>
      )}
    </div>
  );

  return (
    <>
    <Box
      data-testid="project-domain-card"
      orientation="vertical"
      className={cn(
        'flex w-full flex-col rounded-xl border border-intents-ux-boxLowContrast-borderColor',
        DOMAIN_PANEL_SUBTITLE_INPUT_GAP_CLASS,
        'bg-intents-ux-box-backgroundColor p-2 md:p-3',
      )}
    >
      <div className="flex w-full items-start justify-between gap-4">
        <div className={cn('flex min-w-0 flex-1 flex-col', DOMAIN_PANEL_TITLE_DESCRIPTION_GAP_CLASS)}>
          <div className={cn('flex flex-wrap items-center', DOMAIN_PANEL_TITLE_STATUS_GAP_CLASS)}>
            <text.strong
              as="title"
              size={0}
              className={cn('!m-0 text-intents-ux-box-foregroundColor', DOMAIN_PANEL_SECTION_TITLE_CLASS)}
            >
              {t('builder_project_domain_builtin_title', undefined, 'Project Domain')}
            </text.strong>
            <DomainPanelStatusBadge status={projectDomainStatus} />
          </div>

          <text.p
            className={cn('!m-0 !p-0 text-intents-ux-text-secondaryColor', DOMAIN_PANEL_SECTION_DESCRIPTION_CLASS)}
          >
            {t(
              'builder_project_domain_card_description',
              { domain: airoSubdomainLabel },
              'Your project is currently accessible via the {domain} subdomain below',
            )}
          </text.p>
        </div>

        {showInlineEdit ? (
          editActions
        ) : (
          <Button
            design="secondary"
            size="sm"
            text={t('builder_project_domain_edit_url_button', undefined, 'Edit URL')}
            onClick={handleStartEditing}
            disabled={disableProjectDomain || isMutationBusy}
            data-eid={generateClickEID('settings.domains.project_domain_edit')}
            className={DOMAIN_PANEL_EDIT_BUTTON_CLASS}
          />
        )}
      </div>

      {showInlineEdit ? (
        editForm
      ) : (
        <div
          data-testid="project-domain-url-bar"
          className={cn(
            'flex h-[56px] w-full items-center justify-between gap-3 rounded-lg',
            'bg-intents-ux-boxLowContrast-backgroundColor px-2',
          )}
        >
          {!site ? (
            <Skeleton size="md" width="60%" lines={1} />
          ) : (
            <>
              <div
                data-testid="project-domain-url-display"
                role="button"
                tabIndex={canStartEditing ? 0 : -1}
                aria-label={t(
                  'builder_project_domain_url_edit_prompt',
                  undefined,
                  'Click to edit built-in URL',
                )}
                className={cn(
                  'min-w-0 flex-1 truncate text-left',
                  canStartEditing && 'cursor-text',
                )}
                onClick={handleUrlBarActivate}
                onKeyDown={handleUrlBarKeyDown}
              >
                <text.span className="truncate text-intents-ux-text-primaryColor">
                  {displayHostname}
                </text.span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <IconButton
                  icon={<WindowNewIcon className="size-[20px]" />}
                  label={t('builder_project_domain_open_url', undefined, 'Open URL')}
                  onClick={handleOpenUrl}
                  type="button"
                  size="sm"
                  ghost
                  showLabelWhenActive={false}
                  disabled={!displayHostname}
                  dataEid={generateClickEID('settings.domains.project_domain_open')}
                  data-testid="project-domain-open"
                />
                <IconButton
                  icon={copied ? <CheckmarkIcon className="size-[20px]" /> : <CopyIcon className="size-[20px]" />}
                  label={copied
                    ? t('builder_common_copied', undefined, 'Copied')
                    : t('builder_common_copy_clipboard', undefined, 'Copy to clipboard')}
                  onClick={() => void handleCopyUrl()}
                  type="button"
                  size="sm"
                  ghost
                  showLabelWhenActive={false}
                  disabled={!displayHostname}
                  dataEid={generateClickEID('settings.domains.project_domain_copy')}
                  data-testid="project-domain-copy"
                />
              </div>
            </>
          )}
        </div>
      )}
    </Box>

    {showEditSheet && (
      <ProjectsActionModal
        title={t('builder_project_domain_edit_url_button', undefined, 'Edit URL')}
        onClose={handleCancel}
        testId="project-domain-edit-sheet"
        applyAiroTheme={false}
        footer={mobileEditFooter}
      >
        {editForm}
      </ProjectsActionModal>
    )}
    </>
  );
}
