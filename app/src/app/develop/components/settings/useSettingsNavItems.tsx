'use client';

import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { SettingsSection } from '@/app/develop/components/types';
import SettingsIcon from '@ux/icon/settings';
import LockedIcon from '@ux/icon/locked';
import DatabaseIcon from '@ux/icon/database';
import ClipboardIcon from '@ux/icon/clipboard';
import LinkIcon from '@ux/icon/link';
import RevertIcon from '@ux/icon/revert';
import ContentIcon from '@ux/icon/content';
import HistoryIcon from '@ux/icon/history';
import CommentsIcon from '@ux/icon/comments';
import { ReactNode } from 'react';

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
  const openFeedbackModal = useDevelopPageStore((state) => state.openFeedbackModal);
  const isMobile = useDevelopPageStore((state) => state.isMobile);

  const { data: isProjectEnabled } = useSwitchboard('appbuilder-settings-project');
  const { data: isDomainEnabled } = useSwitchboard('appbuilder-settings-domain');
  const { data: isBackupsEnabled } = useSwitchboard('appbuilder-settings-backups');
  const { data: isSecurityEnabled } = useSwitchboard('appbuilder-settings-security');
  const { data: isDatabaseEnabled } = useSwitchboard('appbuilder-settings-database');
  const { data: isVisualScanEnabled } = useSwitchboard('appbuilder-settings-visualscan');
  const { data: isSecretsEnabled } = useSwitchboard('appbuilder-settings-secrets');
  const { data: isLogsEnabled } = useSwitchboard('appbuilder-settings-logs');
  const { data: isConversationsEnabled } = useSwitchboard('appbuilder-settings-conversations');

  const handleFeedbackClick = () => {
    localStorage.removeItem('airo-feedback-shown:airo#app-builder');
    openFeedbackModal('airo#app-builder');
  };

  return [
    {
      id: SettingsSection.PROJECT,
      label: 'Project Settings',
      icon: <SettingsIcon />,
      disabled: isProjectEnabled !== true,
    },
    {
      id: SettingsSection.DOMAIN,
      label: 'Domain',
      icon: <LinkIcon />,
      disabled: isDomainEnabled !== true,
    },
    {
      id: SettingsSection.BACKUPS,
      label: 'Backups',
      icon: <RevertIcon />,
      disabled: isBackupsEnabled !== true,
    },
    {
      id: SettingsSection.SECURITY,
      label: 'Security',
      icon: <LockedIcon />,
      disabled: isSecurityEnabled !== true,
    },
    {
      id: SettingsSection.DATABASE,
      label: 'Database',
      icon: <DatabaseIcon />,
      disabled: isDatabaseEnabled !== true,
    },
    {
      id: SettingsSection.SECRETS,
      label: 'Secrets',
      icon: <LockedIcon />,
      disabled: isSecretsEnabled !== true,
    },
    ...(isVisualScanEnabled ? [{
      id: SettingsSection.VISUAL_SCAN,
      label: 'Visual Scan',
      icon: <ContentIcon />,
      disabled: isVisualScanEnabled !== true,
    }] : []),
    ...(isLogsEnabled ? [{
      id: SettingsSection.LOGS,
      label: 'Logs',
      icon: <HistoryIcon />,
      disabled: isLogsEnabled !== true,
    }] : []),
    ...(isConversationsEnabled ? [{
      id: SettingsSection.CONVERSATIONS,
      label: 'Conversations',
      icon: <CommentsIcon />,
      disabled: isConversationsEnabled !== true,
    }] : []),
    ...(!isMobile ? [{
      id: SettingsSection.FEEDBACK,
      label: 'Give Feedback',
      icon: <ClipboardIcon />,
      disabled: false,
      onClick: handleFeedbackClick,
    }] : []),
  ];
}
