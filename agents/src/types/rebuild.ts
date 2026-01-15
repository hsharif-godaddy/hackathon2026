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
 * Overall site metadata
 */
export interface SiteMetadata {
  sourceUrl: string;
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
