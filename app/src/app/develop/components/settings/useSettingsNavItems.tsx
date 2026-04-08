'use client';

import { ReactNode } from 'react';
import CalendarIcon from '@ux/icon/calendar';
import ContentIcon from '@ux/icon/content';
import ClipboardIcon from '@ux/icon/copy';
import DatabaseIcon from '@ux/icon/database';
import LinkIcon from '@ux/icon/link';
import LockedIcon from '@ux/icon/locked';
import RevertIcon from '@ux/icon/revert';
import SettingsIcon from '@ux/icon/settings';
import ShareIcon from '@ux/icon/share';
import SocialIcon from '@ux/icon/social';

import { SettingsSection } from '@/app/develop/components/types';
import { FEEDBACK_ID } from '@/components/feedback/utils';
import { SwitchboardAuthError, useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';

const isAuthError = (error: Error | null) => error instanceof SwitchboardAuthError;

/**
 * Settings navigation item configuration
 */
export interface SettingsNavItem {
  id: SettingsSection;
  label: string;
  icon: ReactNode;
  disabled: boolean;
  needsAuth?: boolean;
  onClick?: () => void;
}

/**
 * Hook that provides the settings navigation items with their current state
 * Used by SettingsMenu popover
 *
 * @param enabled - Whether to fetch feature flags (defer until menu is visible)
 * @returns Array of settings navigation items with current enabled/disabled state
 */
export function useSettingsNavItems(enabled: boolean = true): SettingsNavItem[] {
  const t = useTranslations();
  const openFeedbackModal = useDevelopPageStore((state) => state.openFeedbackModal);

  const project = useSwitchboard('appbuilder-settings-project', { enabled });
  const domain = useSwitchboard('appbuilder-settings-domain', { enabled });
  const backups = useSwitchboard('appbuilder-settings-backups', { enabled });
  const security = useSwitchboard('appbuilder-settings-security', { enabled });
  const shareLinks = useSwitchboard('appbuilder-share-links', { enabled });
  const visualScan = useSwitchboard('appbuilder-settings-visualscan', { enabled });
  const secrets = useSwitchboard('appbuilder-settings-secrets', { enabled });
  const social = useSwitchboard('appbuilder-settings-social', { enabled });
  const marketing = useSwitchboard('appbuilder-settings-marketing', { enabled });

  const handleFeedbackClick = () => {
    localStorage.removeItem(`airo-feedback-shown:${FEEDBACK_ID}`);
    openFeedbackModal(FEEDBACK_ID, 'Settings');
  };

  return [
    {
      id: SettingsSection.PROJECT,
      label: t('builder_settings_nav_project'),
      icon: <SettingsIcon />,
      disabled: !isAuthError(project.error) && project.data !== true,
      needsAuth: isAuthError(project.error),
    },
    {
      id: SettingsSection.DOMAIN,
      label: t('builder_settings_nav_domain'),
      icon: <LinkIcon />,
      disabled: !isAuthError(domain.error) && domain.data !== true,
      needsAuth: isAuthError(domain.error),
    },
    {
      id: SettingsSection.BACKUPS,
      label: t('builder_settings_nav_backups'),
      icon: <RevertIcon />,
      disabled: !isAuthError(backups.error) && backups.data !== true,
      needsAuth: isAuthError(backups.error),
    },
    {
      id: SettingsSection.SECURITY,
      label: t('builder_settings_nav_security'),
      icon: <LockedIcon />,
      disabled: !isAuthError(security.error) && security.data !== true,
      needsAuth: isAuthError(security.error),
    },
    ...(shareLinks.data || isAuthError(shareLinks.error) ? [{
      id: SettingsSection.SHARE,
      label: t('builder_settings_nav_share'),
      icon: <ShareIcon />,
      disabled: false,
      needsAuth: isAuthError(shareLinks.error),
    }] : []),
    {
      id: SettingsSection.DATABASE,
      label: t('builder_settings_nav_database'),
      icon: <DatabaseIcon />,
      disabled: false,
    },
    {
      id: SettingsSection.SECRETS,
      label: t('builder_settings_nav_secrets'),
      icon: <LockedIcon />,
      disabled: !isAuthError(secrets.error) && secrets.data !== true,
      needsAuth: isAuthError(secrets.error),
    },
    ...(social.data || isAuthError(social.error) ? [{
      id: SettingsSection.SOCIAL,
      label: t('builder_settings_nav_social'),
      icon: <SocialIcon />,
      disabled: false,
      needsAuth: isAuthError(social.error),
    }] : []),
    ...(visualScan.data || isAuthError(visualScan.error) ? [{
      id: SettingsSection.VISUAL_SCAN,
      label: t('builder_settings_nav_visualscan'),
      icon: <ContentIcon />,
      disabled: false,
      needsAuth: isAuthError(visualScan.error),
    }] : []),
    ...(marketing.data || isAuthError(marketing.error) ? [{
      id: SettingsSection.MARKETING,
      label: t('builder_settings_nav_marketing'),
      icon: <CalendarIcon />,
      disabled: false,
      needsAuth: isAuthError(marketing.error),
    }] : []),
    {
      id: SettingsSection.FEEDBACK,
      label: t('builder_settings_nav_feedback'),
      icon: <ClipboardIcon />,
      disabled: false,
      onClick: handleFeedbackClick,
    },
  ];
}
