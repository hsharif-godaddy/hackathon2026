/**
 * Rebuild Feature Types
 * 
 * Type definitions for the "Rebuild my site" feature
 */

/**
 * Style preferences collected from user
 */
export interface StylePreferences {
  designDirection: 'keep-similar' | 'modernize' | 'simplify' | 'bold';
  colorPreference: 'keep-original' | 'suggest-new' | 'custom';
  customColors?: {
    primary?: string;
    secondary?: string;
    accent?: string;
  };
  typographyStyle: 'keep-original' | 'modern' | 'classic' | 'playful';
  layoutApproach: 'responsive' | 'mobile-first' | 'desktop-first';
}

/**
 * High-level shape of the source site. Drives whether the rebuild should use
 * a marketing-page layout (header/hero/footer) or a full-viewport app shell.
 */
export type SiteType = 'content' | 'app' | 'commerce' | 'dashboard';

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
  };
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
 * Page metadata
 */
export interface PageMetadata {
  title: string;
  description?: string;
  keywords?: string[];
  ogImage?: string;
  canonicalUrl?: string;
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
  dimensions?: {
    width: number;
    height: number;
  };
  fileSize?: number;
  sourcePages: string[];
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
  status: 'scraping' | 'analyzing' | 'style_questions' | 'building' | 'review' | 'complete' | 'error';
  scrapingProgress: {
    total: number;
    completed: number;
    currentPage?: string;
  };
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
