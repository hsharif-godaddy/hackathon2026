'use client';

import { ReactNode } from 'react';
import ClipboardIcon from '@ux/icon/clipboard';
import CommentsIcon from '@ux/icon/comments';
import ContentIcon from '@ux/icon/content';
import DatabaseIcon from '@ux/icon/database';
import HistoryIcon from '@ux/icon/history';
import LinkIcon from '@ux/icon/link';
import LockedIcon from '@ux/icon/locked';
import RevertIcon from '@ux/icon/revert';
import SettingsIcon from '@ux/icon/settings';
import SocialIcon from '@ux/icon/social';

import { SettingsSection } from '@/app/develop/components/types';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';

/**
 * Settings navigation item configuration
 */
export interface SettingsNavItem {
  id: SettingsSection;
  label: string;
  icon: ReactNode;
  disabled: boolean;
  onClick?: () => void;
}

/**
 * Hook that provides the settings navigation items with their current state
 * Used by both SettingsPane (desktop sidebar) and SettingsMenu (mobile popover)
 *
 * @returns Array of settings navigation items with current enabled/disabled state
 */
export function useSettingsNavItems(): SettingsNavItem[] {
  const t = useTranslations();
  const openFeedbackModal = useDevelopPageStore((state) => state.openFeedbackModal);
  const isMobile = useDevelopPageStore((state) => state.isMobile);

  const { data: isProjectEnabled } = useSwitchboard('appbuilder-settings-project');
  const { data: isDomainEnabled } = useSwitchboard('appbuilder-settings-domain');
  const { data: isBackupsEnabled } = useSwitchboard('appbuilder-settings-backups');
  const { data: isSecurityEnabled } = useSwitchboard('appbuilder-settings-security');
  const { data: isDatabaseEnabled } = useSwitchboard('appbuilder-settings-database');
  const { data: isVisualScanEnabled } = useSwitchboard('appbuilder-settings-visualscan');
  const { data: isSecretsEnabled } = useSwitchboard('appbuilder-settings-secrets');
  const { data: isSocialEnabled } = useSwitchboard('appbuilder-settings-social');
  const { data: isLogsEnabled } = useSwitchboard('appbuilder-settings-logs');
  const { data: isConversationsEnabled } = useSwitchboard('appbuilder-settings-conversations');

  const handleFeedbackClick = () => {
    localStorage.removeItem('airo-feedback-shown:airo#app-builder');
    openFeedbackModal('airo#app-builder');
  };

  return [
    {
      id: SettingsSection.PROJECT,
      label: t('builder_settings_nav_project'),
      icon: <SettingsIcon />,
      disabled: isProjectEnabled !== true,
    },
    {
      id: SettingsSection.DOMAIN,
      label: t('builder_settings_nav_domain'),
      icon: <LinkIcon />,
      disabled: isDomainEnabled !== true,
    },
    {
      id: SettingsSection.BACKUPS,
      label: t('builder_settings_nav_backups'),
      icon: <RevertIcon />,
      disabled: isBackupsEnabled !== true,
    },
    {
      id: SettingsSection.SECURITY,
      label: t('builder_settings_nav_security'),
      icon: <LockedIcon />,
      disabled: isSecurityEnabled !== true,
    },
    {
      id: SettingsSection.DATABASE,
      label: t('builder_settings_nav_database'),
      icon: <DatabaseIcon />,
      disabled: isDatabaseEnabled !== true,
    },
    {
      id: SettingsSection.SECRETS,
      label: t('builder_settings_nav_secrets'),
      icon: <LockedIcon />,
      disabled: isSecretsEnabled !== true,
    },
    ...(isSocialEnabled ? [{
      id: SettingsSection.SOCIAL,
      label: t('builder_settings_nav_social'),
      icon: <SocialIcon />,
      disabled: isSocialEnabled !== true,
    }] : []),
    ...(isVisualScanEnabled ? [{
      id: SettingsSection.VISUAL_SCAN,
      label: t('builder_settings_nav_visualscan'),
      icon: <ContentIcon />,
      disabled: isVisualScanEnabled !== true,
    }] : []),
    ...(isLogsEnabled ? [{
      id: SettingsSection.LOGS,
      label: t('builder_settings_nav_logs'),
      icon: <HistoryIcon />,
      disabled: isLogsEnabled !== true,
    }] : []),
    ...(isConversationsEnabled ? [{
      id: SettingsSection.CONVERSATIONS,
      label: t('builder_settings_nav_conversations'),
      icon: <CommentsIcon />,
      disabled: isConversationsEnabled !== true,
    }] : []),
    ...(!isMobile ? [{
      id: SettingsSection.FEEDBACK,
      label: t('builder_settings_nav_feedback'),
      icon: <ClipboardIcon />,
      disabled: false,
      onClick: handleFeedbackClick,
    }] : []),
  ];
}
