/**
 * Rebuild Feature Types
 *
 * Type definitions for the "Rebuild my site" feature
 */

import type { InteractivePattern } from '../services/interactive-pattern-detector.js';

/** User-selected rebuild breadth for an initial rebuild */
export type RebuildScope = 'homepage_only' | 'small' | 'large';

export interface RebuildIntakeChoices {
  scope: RebuildScope;
  stylePreferences: StylePreferences;
}

export interface RebuildScopeEstimate {
  scope: RebuildScope;
  labelKey: string;
  descriptionKey: string;
  expectedMinutesMin: number;
  expectedMinutesMax: number;
  tokenCostMin: number;
  tokenCostMax: number;
  maxPagesToScrape: number;
  maxPagesToBuildUpfront: number;
}

/**
 * Style preferences collected from user
 */
export interface StylePreferences {
  designDirection: 'keep-similar' | 'modernize' | 'simplify' | 'bold';
  /**
   * The customer's free-text design instruction, carried close to verbatim.
   * The four-enum `designDirection` can't encode intent like "ignore the
   * existing structure"; this preserves the actual words so the page prompt can
   * honor them (AIROBUILD-2682). Optional — only the typed/NL rebuild path
   * supplies it (the modal is a button choice). Source is pluggable: the agent
   * tool arg today, a future intake-form free-text field via `resolveDesignIntent`.
   */
  designIntent?: string;
  colorPreference: 'keep-original' | 'suggest-new' | 'custom';
  customColors?: {
    primary?: string;
    secondary?: string;
    accent?: string;
  };
  typographyStyle: 'keep-original' | 'modern' | 'classic' | 'playful';
  layoutApproach: 'responsive' | 'mobile-first' | 'desktop-first';
  /** Bring-over: keep the source logo asset. Default true. */
  keepLogo: boolean;
  /** Bring-over: keep the source content photos (vs. fresh imagery). Default true. */
  keepSourceImages: boolean;
}

/**
 * High-level shape of the source site. Drives whether the rebuild should use
 * a marketing-page layout (header/hero/footer) or a full-viewport app shell.
 */
export type SiteType = 'content' | 'app' | 'commerce' | 'dashboard';

import type { TypographyRole } from './atlas-api.js';

/**
 * A single typography usage record from Atlas — captures the full CSS
 * properties observed for a given role on the source site.
 */
export interface TypographyScaleEntry {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  role: TypographyRole;
}

/**
 * Aggregated contact info extracted from the source site (Atlas SSM).
 * Site-level: same data appears on every page's footer; we persist once on
 * SiteMetadata and surface it where the prompt needs it (Visit Us, footer).
 */
export interface SiteContactInfo {
  phones?: { number: string; type?: string }[];
  emails?: { address: string; type?: string }[];
  addresses?: { formatted: string; street?: string; city?: string; state?: string; zip?: string; country?: string }[];
  hours?: { day: string; open: string; close: string }[];
  social?: { platform: string; url: string; phone?: string; text?: string }[];
}

/**
 * The site's primary favicon as Atlas extracted it. `url` is the source-site
 * URL — resolve it through `resolveFaviconHref` before emitting so it points at
 * the locally-downloaded asset where one exists. See {@link ResolvedFavicon}.
 */
export interface SiteFavicon {
  url: string;
  rel?: string;
  sizes?: string;
  mimeType?: string;
}

/**
 * A favicon whose `href` has already been resolved to an emittable path — a
 * public `/assets/…` path when the asset was downloaded, or the source URL as a
 * hotlink fallback. Distinct from {@link SiteFavicon} only in `url` → `href`.
 */
export interface ResolvedFavicon {
  href: string;
  rel?: string;
  sizes?: string;
  mimeType?: string;
}

/**
 * Overall site metadata
 */
export interface SiteMetadata {
  sourceUrl: string;
  /**
   * Defaults to 'content' when absent (pre-classification manifests). The Site
   * Analyzer classifies this from the homepage screenshot.
   */
  siteType?: SiteType;
  sitePurpose: string;
  targetAudience: string;
  brandVoice: string;
  designStyle: string;
  colorPalette: {
    primary: string[];
    secondary: string[];
    accent: string[];
  };
  typography: {
    headingFonts: string[];
    bodyFonts: string[];
    /** Full typography scale from Atlas — per-role records preserving size, weight,
     * line-height, and letter-spacing. Absent when derived from the SiteAnalyzer/AI fallback path. */
    scale?: TypographyScaleEntry[];
  };
  /** Site-level contact info (phones, emails, addresses, hours, social). Atlas-only. */
  contact?: SiteContactInfo;
  /** Primary site favicon chosen by Atlas. Atlas-only; absent on AI-fallback manifests. */
  favicon?: SiteFavicon;
  /** Logo identification result from Atlas crawler. */
  identifiedLogo?: {
    url: string;
    detectionMethod: 'favicon' | 'header-placement' | 'hero-placement' | 'homepage-link' | 'size-heuristic' | 'text-match';
  };
  /** Footer nav. Site-wide; populated from Atlas navigation.footer when present. */
  footerNavigation?: NavigationItem[];
  scrapedAt: string;
  version: string;
}

/**
 * Page content structure
 */
export interface PageContent {
  url: string;
  slug: string;
  title: string;
  description?: string;
  content: string;
  sanitizedContent: string;
  html?: string; // Raw HTML for asset extraction
  structure: PageStructure;
  metadata: PageMetadata;
  scrapedAt: string;
}

/**
 * Page structure analysis
 */
export interface PageStructure {
  hasHeader: boolean;
  hasFooter: boolean;
  hasSidebar: boolean;
  sections: PageSection[];
  navigation: NavigationItem[];
  /** Interactive patterns detected from raw HTML — surfaced to PagePromptAgent so
   * carousels/sliders/accordions/tabs/video-heroes aren't silently flattened. */
  interactivePatterns?: InteractivePattern[];
  /** Forms extracted by Atlas from the source page — surfaced to PagePromptAgent
   * so newsletter/contact/booking forms get rebuilt as real <form> elements
   * (not visual mockups). Also the comparator for the eval rubric's Forms dimension. */
  forms?: FormHint[];
  /** In-content links to documents (PDFs, etc.) from Atlas page.links — absolute
   * source URLs the develop agent must preserve verbatim in body copy. */
  contentLinks?: ContentLink[];
}

export interface FormFieldHint {
  type: string;
  name?: string;
  label?: string;
  placeholder?: string;
  required: boolean;
  options?: string[];
}

export interface FormHint {
  action?: string;
  method: 'get' | 'post';
  id?: string;
  /** Raw space-separated class string — consumers must tokenize */
  className?: string;
  fields: FormFieldHint[];
  submitButton?: { text: string };
}

/**
 * Structured handoff from rebuild → develop. Code-built from the same inputs
 * PagePromptAgent uses, but contains only the deterministic facts (no LLM
 * judgment). Develop agent reads this directly to avoid reinterpreting facts
 * that were already extracted (asset paths, form schemas, navigation, etc.).
 *
 * The markdown prompt PagePromptAgent emits remains the home for *creative*
 * direction (layout, copy polish). The spec is the home for *facts*.
 *
 * Eval-time symmetric comparison reads from the same shape on both crawls.
 */
export interface PageBuildSpec {
  schemaVersion: 1;
  generatedAt: string;
  page: {
    url: string;
    slug: string;
    title: string;
    isFirstPage: boolean;
    metadata: PageMetadata;
  };
  site: {
    sourceUrl: string;
    siteType: SiteType;
    sitePurpose: string;
    targetAudience: string;
    brandVoice: string;
    designStyle: string;
    colorPalette: SiteMetadata['colorPalette'];
    typography: SiteMetadata['typography'];
    contact?: SiteContactInfo;
    favicon?: ResolvedFavicon;
  };
  navigation: {
    primary: NavigationItem[];
    footer: NavigationItem[];
  };
  detectedPatterns: InteractivePattern[];
  forms: FormHint[];
  contentLinks: ContentLink[];
  /** Page-relevant assets with paths normalized to public form (`/assets/...`). */
  assets: SpecAssetManifest;
  /** Intake-form preferences (fidelity dial inputs once that lands). */
  stylePreferences: StylePreferences;
  pageContent: {
    sanitizedContent: string;
  };
}

/**
 * Page section
 */
export interface PageSection {
  type: 'hero' | 'content' | 'features' | 'testimonials' | 'cta' | 'gallery' | 'other';
  heading?: string;
  content: string;
  images: string[];
  order: number;
}

/**
 * Navigation item
 */
export interface NavigationItem {
  label: string;
  url: string;
  isExternal: boolean;
}

/**
 * In-content link to a document on the source site (PDF, Office file, etc.).
 * `url` is always the absolute source target — never a path-normalized route.
 */
export interface ContentLink {
  label: string;
  url: string;
  isExternal: boolean;
}

/**
 * Page metadata
 */
export interface PageMetadata {
  title: string;
  description?: string;
  keywords?: string[];
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  canonicalUrl?: string;
}

/**
 * Placement signals for an image on the source page — carried from Atlas's
 * per-image SSM extraction. Tells the prompt layer where the image sat
 * relative to page landmarks (header, footer, H1, first section).
 */
export interface ImagePlacement {
  inHeader: boolean;
  inFooter: boolean;
  inFirstSection: boolean;
  nearH1: boolean;
  isFirstInContainer: boolean;
  linkedTo?: string;
  classes?: string[];
  siblingText?: string;
}

/**
 * Asset information
 */
export interface AssetInfo {
  url: string;
  localPath: string;
  type: 'image' | 'font' | 'icon' | 'other';
  description?: string;
  composition?: string;
  altText?: string;
  usageContext?: string;
  /** Image has heading/brand text burned into its pixels (vision-detected). */
  hasEmbeddedText?: boolean;
  /** Transcription of the embedded text, when {@link hasEmbeddedText} is true. */
  embeddedText?: string | null;
  dimensions?: {
    width: number;
    height: number;
  };
  fileSize?: number;
  sourcePages: string[];
  /** Atlas image placement signals. Absent for non-image assets and legacy scraper. */
  placement?: ImagePlacement;
}

/**
 * Asset reference scoped to PageBuildSpec — paths are public URLs
 * (`/assets/...`), not filesystem locations.
 */
export interface SpecAssetRef extends Omit<AssetInfo, 'localPath'> {
  publicPath: string;
}

export interface SpecAssetManifest extends Omit<AssetManifest, 'assets'> {
  assets: SpecAssetRef[];
}

/**
 * Asset manifest
 */
export interface AssetManifest {
  assets: AssetInfo[];
  totalAssets: number;
  byType: {
    image: number;
    font: number;
    icon: number;
    other: number;
  };
  generatedAt: string;
}

/**
 * Sitemap data
 */
export interface SitemapData {
  pages: SitemapPage[];
  totalPages: number;
  discoveredAt: string;
}

/**
 * Sitemap page entry
 */
export interface SitemapPage {
  url: string;
  slug: string;
  priority?: number;
  changefreq?: string;
  lastmod?: string;
  source: 'sitemap' | 'robots' | 'crawl';
  scraped: boolean;
  isBlog?: boolean;
}

/**
 * Complete source site data structure
 */
export interface SourceSiteData {
  metadata: SiteMetadata;
  sitemap: SitemapData;
  pages: Record<string, PageContent>;
  assets: AssetManifest;
  stylePreferences?: StylePreferences;
}

/**
 * Rebuild workflow state
 */
export interface RebuildWorkflowState {
  appId: string;
  sourceUrl: string;
  rootPath: string; // "/" for normal rebuilds, "/psycholand" for sub-path rebuilds
  status:
    | 'awaiting_intake'
    | 'scraping'
    | 'analyzing'
    | 'style_questions'
    | 'building'
    | 'review'
    | 'complete'
    | 'error';
  scrapingProgress: {
    total: number;
    completed: number;
    currentPage?: string;
  };
  /** True once the scrape pipeline finishes (even when inner pages fail to persist). */
  scrapeSettled?: boolean;
  rebuildScope?: RebuildScope;
  intakeCompleted?: boolean;
  intakeSubmittedAt?: string;
  stylePreferences?: StylePreferences;
  pagesBuilt: string[];
  currentPage: string | null;
  error?: string;
  errorCode?: RebuildErrorCode;
  userMessage?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Page build request
 */
export interface PageBuildRequest {
  appId: string;
  pageSlug: string;
  stylePreferences: StylePreferences;
  includeAssets: boolean;
}

/**
 * Page build result
 */
export interface PageBuildResult {
  success: boolean;
  pageSlug: string;
  prompt: string;
  error?: string;
}

/** Shown to users when rebuild scrape/analysis cannot produce importable site data */
export const WEBSITE_REBUILD_IMPORT_FAILED_USER_MESSAGE =
  "We couldn't import your site, please try again";

export type RebuildErrorCode = 'import_failed';

export class RebuildError extends Error {
  code?: RebuildErrorCode;
  userMessage?: string;
  isUserFacingError: boolean;

  constructor(
    message: string,
    options?: {
      code?: RebuildErrorCode;
      userMessage?: string;
      isUserFacingError?: boolean;
    }
  ) {
    super(message);
    this.name = 'RebuildError';
    this.code = options?.code;
    this.userMessage = options?.userMessage;
    this.isUserFacingError = options?.isUserFacingError ?? false;
  }
}

export function createRebuildError(
  message: string,
  options?: {
    code?: RebuildErrorCode;
    userMessage?: string;
    isUserFacingError?: boolean;
  }
): RebuildError {
  return new RebuildError(message, options);
}

export function asRebuildError(error: unknown): RebuildError {
  if (error instanceof RebuildError) {
    return error;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = typeof error.message === 'string' ? error.message : String(error.message);
    const code = 'code' in error && error.code === 'import_failed' ? error.code : undefined;
    const userMessage =
      'userMessage' in error && typeof error.userMessage === 'string'
        ? error.userMessage
        : undefined;
    const isUserFacingError =
      'isUserFacingError' in error && typeof error.isUserFacingError === 'boolean'
        ? error.isUserFacingError
        : false;

    return new RebuildError(message, {
      code,
      userMessage,
      isUserFacingError
    });
  }

  return new RebuildError(String(error));
}
