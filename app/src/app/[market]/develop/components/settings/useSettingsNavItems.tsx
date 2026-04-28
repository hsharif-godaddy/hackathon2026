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

import { SettingsSection } from '@/app/[market]/develop/components/types';
import { FEEDBACK_ID } from '@/components/feedback/utils';
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
 * Hook that provides the settings navigation items with their current state.
 * Used by SettingsMenu popover.
 */
export function useSettingsNavItems(): SettingsNavItem[] {
  const t = useTranslations();
  const openFeedbackModal = useDevelopPageStore((state) => state.openFeedbackModal);

  const project = useSwitchboard('appbuilder-settings-project');
  const domain = useSwitchboard('appbuilder-settings-domain');
  const backups = useSwitchboard('appbuilder-settings-backups');
  const security = useSwitchboard('appbuilder-settings-security');
  const shareLinks = useSwitchboard('appbuilder-share-links');
  const visualScan = useSwitchboard('appbuilder-settings-visualscan');
  const secrets = useSwitchboard('appbuilder-settings-secrets');
  const social = useSwitchboard('appbuilder-settings-social');
  const marketing = useSwitchboard('appbuilder-settings-marketing');

  const handleFeedbackClick = () => {
    localStorage.removeItem(`airo-feedback-shown:${FEEDBACK_ID}`);
    openFeedbackModal(FEEDBACK_ID, 'Settings');
  };

  return [
    {
      id: SettingsSection.PROJECT,
      label: t('builder_settings_nav_project'),
      icon: <SettingsIcon />,
      disabled: project !== true,
    },
    {
      id: SettingsSection.DOMAIN,
      label: t('builder_settings_nav_domain'),
      icon: <LinkIcon />,
      disabled: domain !== true,
    },
    {
      id: SettingsSection.BACKUPS,
      label: t('builder_settings_nav_backups'),
      icon: <RevertIcon />,
      disabled: backups !== true,
    },
    {
      id: SettingsSection.SECURITY,
      label: t('builder_settings_nav_security'),
      icon: <LockedIcon />,
      disabled: security !== true,
    },
    ...(shareLinks ? [{
      id: SettingsSection.SHARE,
      label: t('builder_settings_nav_share'),
      icon: <ShareIcon />,
      disabled: false,
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
      disabled: secrets !== true,
    },
    ...(social ? [{
      id: SettingsSection.SOCIAL,
      label: t('builder_settings_nav_social'),
      icon: <SocialIcon />,
      disabled: false,
    }] : []),
    ...(visualScan ? [{
      id: SettingsSection.VISUAL_SCAN,
      label: t('builder_settings_nav_visualscan'),
      icon: <ContentIcon />,
      disabled: false,
    }] : []),
    ...(marketing ? [{
      id: SettingsSection.MARKETING,
      label: t('builder_settings_nav_marketing'),
      icon: <CalendarIcon />,
      disabled: false,
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
