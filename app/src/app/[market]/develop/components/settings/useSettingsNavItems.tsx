'use client';

import { ReactNode } from 'react';
import CalendarIcon from '@ux/icon/calendar';
import CodeIcon from '@ux/icon/code';
import ContentIcon from '@ux/icon/content';
import ClipboardIcon from '@ux/icon/copy';
import DatabaseIcon from '@ux/icon/database';
import LockedIcon from '@ux/icon/locked';
import MegaphoneIcon from '@ux/icon/megaphone';
import RevertIcon from '@ux/icon/revert';
import SettingsIcon from '@ux/icon/settings';
import SocialIcon from '@ux/icon/social';
import WorldIcon from '@ux/icon/world';

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
  testId?: string;
  /**
   * When set, renders an inline spinner + this label beneath the item to signal a
   * background task owned by that section is in progress (e.g. the security scan).
   */
  loadingLabel?: string;
}

/**
 * Hook that provides the settings navigation items with their current state.
 * Used by SettingsMenu popover.
 */
export function useSettingsNavItems(): SettingsNavItem[] {
  const t = useTranslations();
  const openFeedbackModal = useDevelopPageStore((state) => state.openFeedbackModal);
  const isMobile = useDevelopPageStore((state) => state.isMobile);
  const isSecurityScanRunning = useDevelopPageStore(
    (state) => !!(state.currentAppId && state.publishStates[state.currentAppId]?.isSecurityAnalysisRunning)
  );

  const project = useSwitchboard('appbuilder-settings-project');
  const domain = useSwitchboard('appbuilder-settings-domain');
  const backups = useSwitchboard('appbuilder-settings-backups');
  const security = useSwitchboard('appbuilder-settings-security');
  const visualScan = useSwitchboard('appbuilder-settings-visualscan');
  const secrets = useSwitchboard('appbuilder-settings-secrets');
  const social = useSwitchboard('appbuilder-settings-social');
  const marketing = useSwitchboard('appbuilder-settings-marketing');
  const displayAds = useSwitchboard('appbuilder-settings-display-ads');
  const githubSync = useSwitchboard('appbuilder-github-sync');
  const campaigns = useSwitchboard('appbuilder-marketing-campaigns');
  const isTopLevelDomainEnabled = useSwitchboard('appbuilder-domain-top-level');
  // Show on mobile (no header tab there), or on desktop when the tab flag is off or unresolved —
  // fail open so users aren't locked out while Switchboard loads or if the flag is missing.
  const showDomainSettingsItem = isMobile || !isTopLevelDomainEnabled;
  // NOTE: the team / "Users" management UI was moved out of Settings into the
  // develop-header "Share access" popover (see ShareAccess.tsx). It is no longer
  // a Settings nav item — gating for it now lives in that component.

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
    ...(showDomainSettingsItem ? [{
      id: SettingsSection.DOMAIN,
      label: t('builder_domain_title'),
      icon: <WorldIcon />,
      disabled: domain !== true,
    }] : []),
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
      loadingLabel: isSecurityScanRunning ? t('builder_security_scan_running_status') : undefined,
    },
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
    ...(displayAds ? [{
      id: SettingsSection.DISPLAY_ADS,
      label: t('builder_settings_nav_display_ads'),
      icon: <ContentIcon />,
      disabled: false,
    }] : []),
    ...(githubSync ? [{
      id: SettingsSection.GITHUB,
      label: t('builder_settings_nav_github'),
      icon: <CodeIcon />,
      disabled: false,
    }] : []),
    ...(campaigns ? [{
      id: SettingsSection.CAMPAIGNS,
      label: t('builder_campaigns_title', undefined, 'Marketing Campaigns'),
      icon: <MegaphoneIcon />,
      disabled: false,
    }] : []),
    {
      id: SettingsSection.FEEDBACK,
      label: t('builder_settings_nav_feedback'),
      icon: <ClipboardIcon />,
      disabled: false,
      onClick: handleFeedbackClick,
      testId: 'settings-feedback-item',
    },
  ];
}
