import type { IconComponent } from '@ux/icon'
import ColorPaletteIcon from '@ux/icon/color-palette'
import MobilePhoneIcon from '@ux/icon/mobile-phone'
import RefreshIcon from '@ux/icon/refresh'
import WandIcon from '@ux/icon/wand'
import WorldIcon from '@ux/icon/world'

/** The five homepage prompt-starter categories (single-select). */
export type StarterCategory = 'new_website' | 'rebuild_site' | 'app' | 'logo' | 'something_else'

/** Highlighted by default (and the effective selection when the user submits without tapping a button). */
export const DEFAULT_STARTER_CATEGORY: StarterCategory = 'new_website'

export interface StarterCategoryConfig {
  id: StarterCategory
  /** i18n key for the button label. */
  labelKey: string
  /** English fallback label. */
  labelDefault: string
  /** UXCore icon (design-system icon set). */
  Icon: IconComponent
}

/**
 * Source of truth for the starter buttons — also drives the click EID widget
 * names (`homepage.starter.<id>`) and the value threaded into the first build.
 */
export const STARTER_CATEGORIES: readonly StarterCategoryConfig[] = [
  { id: 'new_website', labelKey: 'builder_homepage_starter_new_website', labelDefault: 'New Website', Icon: WorldIcon },
  { id: 'rebuild_site', labelKey: 'builder_homepage_starter_rebuild_site', labelDefault: 'Rebuild Site', Icon: RefreshIcon },
  { id: 'app', labelKey: 'builder_homepage_starter_app', labelDefault: 'App', Icon: MobilePhoneIcon },
  { id: 'logo', labelKey: 'builder_homepage_starter_logo', labelDefault: 'Logo', Icon: ColorPaletteIcon },
  { id: 'something_else', labelKey: 'builder_homepage_starter_something_else', labelDefault: 'Something Else', Icon: WandIcon },
]

export interface StarterPlaceholder {
  /** i18n key (create at the i18n portal). */
  id: string
  /** English fallback used until the key is published. */
  defaultMessage: string
}

/**
 * Ghost-type placeholder examples cycled in the prompt box per selected category
 * (copy from Kayla, AIROBUILD-1859). Each is an i18n key + English fallback so the
 * box renders in English until the keys are published, then localizes.
 */
export const STARTER_PLACEHOLDERS: Readonly<Record<StarterCategory, readonly StarterPlaceholder[]>> = {
  new_website: [
    { id: 'builder_homepage_starter_placeholder_new_website_1', defaultMessage: 'I want to build an online store selling my handmade pottery' },
    { id: 'builder_homepage_starter_placeholder_new_website_2', defaultMessage: 'I want to build a portfolio for my freelance writing work' },
    { id: 'builder_homepage_starter_placeholder_new_website_3', defaultMessage: 'I want to build a website to launch my leather goods business so I can apply for art markets' },
    { id: 'builder_homepage_starter_placeholder_new_website_4', defaultMessage: "I want to build a website to promote my coffee shop's menu and tasting classes" },
    { id: 'builder_homepage_starter_placeholder_new_website_5', defaultMessage: 'I want to build a website for my food truck that features our location and schedule' },
  ],
  rebuild_site: [
    { id: 'builder_homepage_starter_placeholder_rebuild_site_1_fixed', defaultMessage: 'I want to redesign my existing site for www.mycompany.com' },
    { id: 'builder_homepage_starter_placeholder_rebuild_site_2', defaultMessage: 'I want to modernize the look of my existing website at www.mybrand.com' },
    { id: 'builder_homepage_starter_placeholder_rebuild_site_3', defaultMessage: 'I want to redesign my existing site for www.myportfolio.com with a cleaner layout' },
  ],
  app: [
    { id: 'builder_homepage_starter_placeholder_app_1', defaultMessage: 'I want to build an app that helps users track their daily habits' },
    { id: 'builder_homepage_starter_placeholder_app_2', defaultMessage: 'I want to build an app that connects local volunteers with community projects' },
    { id: 'builder_homepage_starter_placeholder_app_3', defaultMessage: 'I want to build an app that makes splitting bills easier for groups' },
    { id: 'builder_homepage_starter_placeholder_app_4', defaultMessage: 'I want to build an app that helps people learn new languages through games' },
  ],
  logo: [
    { id: 'builder_homepage_starter_placeholder_logo_1', defaultMessage: 'I want to create a logo for my new tech startup' },
    { id: 'builder_homepage_starter_placeholder_logo_2', defaultMessage: 'I want to create a logo for my coffee brand' },
    { id: 'builder_homepage_starter_placeholder_logo_3', defaultMessage: 'I want to create a logo for my photography business' },
    { id: 'builder_homepage_starter_placeholder_logo_4', defaultMessage: 'I want to create a logo for my fitness coaching service' },
  ],
  something_else: [
    { id: 'builder_homepage_starter_placeholder_something_else_1', defaultMessage: 'I want to build a dashboard to track my fitness goals' },
    { id: 'builder_homepage_starter_placeholder_something_else_2', defaultMessage: "I want to build a tool to help manage my team's tasks" },
    { id: 'builder_homepage_starter_placeholder_something_else_3', defaultMessage: 'I want to build an interactive quiz for my audience' },
  ],
}
