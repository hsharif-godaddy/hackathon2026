'use client'

import type { ComponentType, SVGProps } from 'react'
import CalendarIcon from '@ux/icon/calendar'
import CodeIcon from '@ux/icon/code'
import ColorPaletteIcon from '@ux/icon/color-palette'
import ContentIcon from '@ux/icon/content'
import ConversationsIcon from '@ux/icon/conversations'
import DatabaseIcon from '@ux/icon/database'
import GraphIcon from '@ux/icon/graph'
import ImageIcon from '@ux/icon/image'
import LockedIcon from '@ux/icon/locked'
import MegaphoneIcon from '@ux/icon/megaphone'
import PageIcon from '@ux/icon/page'
import RevertIcon from '@ux/icon/revert'
import SettingsIcon from '@ux/icon/settings'
import ShieldIcon from '@ux/icon/shield'
import SocialIcon from '@ux/icon/social'
import UserLockedIcon from '@ux/icon/user-locked'
import WebsiteFilledIcon from '@ux/icon/website-filled'
import WorldIcon from '@ux/icon/world'

import { SettingsSection, ViewMode } from '@/app/[market]/develop/components/types'
import GitHubIcon from '@/components/icons/GitHubIcon'

export type CanvasIconComponent = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>

export enum CanvasId {
  Preview = 'preview',
  Code = 'code',
  Brand = 'brand',
  Domain = 'domain',
  Inbox = 'inbox',
  SettingsProject = 'settings.project',
  SettingsBackups = 'settings.backups',
  SettingsSecurity = 'settings.security',
  SettingsDatabase = 'settings.database',
  SettingsSecrets = 'settings.secrets',
  SettingsSocial = 'settings.social',
  SettingsVisualScan = 'settings.visualScan',
  SettingsAnalytics = 'settings.analytics',
  SettingsMarketing = 'settings.marketing',
  SettingsCampaigns = 'settings.campaigns',
  SettingsGitHub = 'settings.github',
  SettingsSso = 'settings.sso',
  Media = 'media',
  Docs = 'docs',
}

export interface CanvasActivation {
  viewMode?: ViewMode
  settingsSection?: SettingsSection
}

export interface CanvasDescriptor {
  id: CanvasId
  labelKey: string
  fallbackLabel: string
  Icon: CanvasIconComponent
  /** Whether the user can dismiss this tab. Preview is always pinned. */
  dismissible: boolean
  /** Whether the tab opens by default for new sessions. */
  defaultOpen: boolean
  /** Default ordering position relative to other defaultOpen tabs. */
  defaultOrder?: number
  /** What store state to set when this canvas activates. */
  activation: CanvasActivation
  /** Switchboard flag that must be true to make this canvas selectable. */
  switchboardFlag?: string
}

export const CANVAS_REGISTRY: Record<CanvasId, CanvasDescriptor> = {
  [CanvasId.Preview]: {
    id: CanvasId.Preview,
    labelKey: 'builder_canvas_website',
    fallbackLabel: 'Preview',
    Icon: WebsiteFilledIcon,
    dismissible: false,
    defaultOpen: true,
    defaultOrder: 0,
    activation: { viewMode: ViewMode.PREVIEW },
  },
  [CanvasId.SettingsProject]: {
    id: CanvasId.SettingsProject,
    labelKey: 'builder_settings_nav_project',
    fallbackLabel: 'Project',
    Icon: SettingsIcon,
    dismissible: true,
    defaultOpen: false,
    activation: { settingsSection: SettingsSection.PROJECT },
    switchboardFlag: 'appbuilder-settings-project',
  },
  [CanvasId.SettingsAnalytics]: {
    id: CanvasId.SettingsAnalytics,
    labelKey: 'builder_settings_nav_analytics',
    fallbackLabel: 'Analytics',
    Icon: GraphIcon,
    dismissible: true,
    defaultOpen: false,
    activation: { settingsSection: SettingsSection.ANALYTICS },
    switchboardFlag: 'appbuilder-analytics',
  },
  [CanvasId.Brand]: {
    id: CanvasId.Brand,
    labelKey: 'builder_canvas_brand',
    fallbackLabel: 'Brand',
    Icon: ColorPaletteIcon,
    dismissible: true,
    defaultOpen: true,
    defaultOrder: 1,
    activation: { viewMode: ViewMode.BRAND },
  },
  [CanvasId.SettingsBackups]: {
    id: CanvasId.SettingsBackups,
    labelKey: 'builder_settings_nav_backups',
    fallbackLabel: 'Backups',
    Icon: RevertIcon,
    dismissible: true,
    defaultOpen: false,
    activation: { settingsSection: SettingsSection.BACKUPS },
    switchboardFlag: 'appbuilder-settings-backups',
  },
  [CanvasId.Code]: {
    id: CanvasId.Code,
    labelKey: 'builder_preview_button_code',
    fallbackLabel: 'Code',
    Icon: CodeIcon,
    dismissible: true,
    defaultOpen: false,
    activation: { viewMode: ViewMode.CODE },
  },
  [CanvasId.SettingsDatabase]: {
    id: CanvasId.SettingsDatabase,
    labelKey: 'builder_settings_nav_database',
    fallbackLabel: 'Database',
    Icon: DatabaseIcon,
    dismissible: true,
    defaultOpen: false,
    activation: { settingsSection: SettingsSection.DATABASE },
  },
  [CanvasId.Domain]: {
    id: CanvasId.Domain,
    labelKey: 'builder_domain_title',
    fallbackLabel: 'Domain',
    Icon: WorldIcon,
    dismissible: true,
    defaultOpen: true,
    defaultOrder: 2,
    activation: { viewMode: ViewMode.DOMAIN },
    switchboardFlag: 'appbuilder-domain-top-level',
  },
  [CanvasId.SettingsGitHub]: {
    id: CanvasId.SettingsGitHub,
    labelKey: 'builder_settings_nav_github',
    fallbackLabel: 'GitHub',
    Icon: GitHubIcon,
    dismissible: true,
    defaultOpen: false,
    activation: { settingsSection: SettingsSection.GITHUB },
    switchboardFlag: 'appbuilder-github-sync',
  },
  [CanvasId.Inbox]: {
    id: CanvasId.Inbox,
    labelKey: 'builder_preview_button_inbox',
    fallbackLabel: 'Inbox',
    Icon: ConversationsIcon,
    dismissible: true,
    defaultOpen: false,
    activation: { viewMode: ViewMode.INBOX },
    switchboardFlag: 'app-builder-inbox-button',
  },
  [CanvasId.Media]: {
    id: CanvasId.Media,
    labelKey: 'builder_chat_toolbar_button_media',
    fallbackLabel: 'Media',
    Icon: ImageIcon,
    dismissible: true,
    defaultOpen: false,
    activation: { viewMode: ViewMode.MEDIA },
    switchboardFlag: 'appbuilder-media-library',
  },
  [CanvasId.SettingsSecrets]: {
    id: CanvasId.SettingsSecrets,
    labelKey: 'builder_settings_nav_secrets',
    fallbackLabel: 'Secrets',
    Icon: LockedIcon,
    dismissible: true,
    defaultOpen: false,
    activation: { settingsSection: SettingsSection.SECRETS },
    switchboardFlag: 'appbuilder-settings-secrets',
  },
  [CanvasId.SettingsSecurity]: {
    id: CanvasId.SettingsSecurity,
    labelKey: 'builder_settings_nav_security',
    fallbackLabel: 'Security',
    Icon: ShieldIcon,
    dismissible: true,
    defaultOpen: false,
    activation: { settingsSection: SettingsSection.SECURITY },
    switchboardFlag: 'appbuilder-settings-security',
  },
  [CanvasId.SettingsSocial]: {
    id: CanvasId.SettingsSocial,
    labelKey: 'builder_settings_nav_social',
    fallbackLabel: 'Social',
    Icon: SocialIcon,
    dismissible: true,
    defaultOpen: false,
    activation: { settingsSection: SettingsSection.SOCIAL },
    switchboardFlag: 'appbuilder-settings-social',
  },
  [CanvasId.SettingsSso]: {
    id: CanvasId.SettingsSso,
    labelKey: 'builder_settings_nav_sso',
    fallbackLabel: 'SSO',
    Icon: UserLockedIcon,
    dismissible: true,
    defaultOpen: false,
    activation: { settingsSection: SettingsSection.SSO },
  },
  [CanvasId.SettingsVisualScan]: {
    id: CanvasId.SettingsVisualScan,
    labelKey: 'builder_settings_nav_visualscan',
    fallbackLabel: 'Visual scan',
    Icon: ContentIcon,
    dismissible: true,
    defaultOpen: false,
    activation: { settingsSection: SettingsSection.VISUAL_SCAN },
    switchboardFlag: 'appbuilder-settings-visualscan',
  },
  [CanvasId.SettingsMarketing]: {
    id: CanvasId.SettingsMarketing,
    labelKey: 'builder_settings_nav_marketing',
    fallbackLabel: 'Marketing',
    Icon: CalendarIcon,
    dismissible: true,
    defaultOpen: false,
    activation: { settingsSection: SettingsSection.MARKETING },
    switchboardFlag: 'appbuilder-settings-marketing',
  },
  [CanvasId.SettingsCampaigns]: {
    id: CanvasId.SettingsCampaigns,
    labelKey: 'builder_settings_nav_campaigns',
    fallbackLabel: 'Campaigns',
    Icon: MegaphoneIcon,
    dismissible: true,
    defaultOpen: false,
    activation: { settingsSection: SettingsSection.CAMPAIGNS },
    switchboardFlag: 'appbuilder-marketing-campaigns',
  },
  [CanvasId.Docs]: {
    id: CanvasId.Docs,
    labelKey: 'builder_canvas_docs',
    fallbackLabel: 'Docs',
    Icon: PageIcon,
    dismissible: true,
    defaultOpen: false,
    activation: { viewMode: ViewMode.DOCS },
  },
}

export const DEFAULT_OPEN_CANVAS_IDS: readonly CanvasId[] = Object.values(CANVAS_REGISTRY)
  .filter((c) => c.defaultOpen)
  .sort((a, b) => (a.defaultOrder ?? Infinity) - (b.defaultOrder ?? Infinity))
  .map((c) => c.id)

export const PINNED_CANVAS_ID: CanvasId = CanvasId.Preview

/** Order of selectable canvases in the canvas dropdown / mobile sheet (excludes the pinned Preview). */
export const CANVAS_MENU_ORDER: readonly CanvasId[] = [
  CanvasId.SettingsProject,
  CanvasId.SettingsAnalytics,
  CanvasId.SettingsBackups,
  CanvasId.Brand,
  CanvasId.SettingsCampaigns,
  CanvasId.Code,
  CanvasId.Docs,
  CanvasId.Domain,
  CanvasId.SettingsDatabase,
  CanvasId.SettingsGitHub,
  CanvasId.Inbox,
  CanvasId.SettingsMarketing,
  CanvasId.SettingsSecrets,
  CanvasId.SettingsSecurity,
  CanvasId.SettingsSocial,
  CanvasId.SettingsSso,
  CanvasId.SettingsVisualScan,
]

export const COMMANDER_CANVAS_TABS_FLAG = 'appbuilder-commander-canvas-tabs'

export const CANVAS_OVERFLOW_THRESHOLD = 4
