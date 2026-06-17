/**
 * Atlas Crawling API — Response Types
 *
 * Minimal type definitions for the fields we consume from the Atlas REST API.
 * These are a subset of the full CrawlResult IR defined in @wsb/atlas.
 */

import { z } from 'zod';

export type TypographyRole = 'heading' | 'body' | 'navigation' | 'button' | 'input';

export interface AtlasJobResponse {
  jobId: string;
  url: string;
  status: string;
  options?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

// Runtime-validated subset of the submit response. We only consume jobId here;
// status is a status hint we log but don't branch on. A missing jobId is the
// only thing that's actually catastrophic — without it pollUntilComplete polls
// /jobs/undefined for the full 5-min budget. Validate the minimum so we fail
// fast at submit instead.
export const AtlasSubmitResponseSchema = z.object({
  jobId: z.string().min(1),
  status: z.string().optional(),
});

// Runtime-validated subset of the poll/job response. The poll loop only
// branches on 'completed' and 'failed' (string equality); any other value is
// treated as in-progress. We don't pin a closed enum here because atlas may
// introduce new intermediate states (e.g. 'homepage_ready') and we shouldn't
// fail validation just because we don't recognize a progress label.
export const AtlasJobStatusResponseSchema = z.object({
  status: z.string().min(1),
  error: z.string().optional(),
});

// Runtime-validated subset of the results response. baseUrl is required by
// mapNavigation; pages/assets are iterated; structure.sitemap is read in
// mapToSitemapData and the crawl-complete log. structure must be validated as
// an object (not z.unknown(), which permits null/undefined) so result.structure
// .sitemap can't TypeError later. Other top-level fields (state, visual,
// navigation, contact, images, screenshots) are validated where they're
// consumed via the existing static type — they're optional and not accessed
// without an undefined check.
export const AtlasCrawlResultSchema = z.object({
  baseUrl: z.string(),
  pages: z.array(z.unknown()),
  assets: z.array(z.unknown()),
  structure: z.object({ sitemap: z.unknown().nullable() }).passthrough(),
}).passthrough();

export interface AtlasPage {
  url: string;
  path: string;
  crawledAt: string;
  statusCode: number;
  depth: number;
  title: string;
  html?: string;
  text?: string;
  metadata: {
    title: string;
    description: string;
    ogTitle?: string;
    ogDescription?: string;
    ogImage?: string;
    canonical?: string;
    keywords?: string[];
  };
  links: AtlasLink[];
  assets?: AtlasAssetRef[];
  /** Per-page visual extraction — populated when adapter requests `include.visual: true`.
   * We model only the fields we consume; Atlas may emit more (sections, backgrounds, etc.). */
  visual?: {
    forms?: AtlasExtractedForm[];
  };
}

export interface AtlasExtractedForm {
  action?: string;
  method?: string;
  id?: string;
  className?: string;
  fields: {
    tag: string;
    type: string;
    name?: string;
    placeholder?: string;
    label?: string;
    required: boolean;
    options?: string[];
  }[];
  submitButton?: {
    text: string;
    type: string;
  };
}

export interface AtlasLink {
  url: string;
  text: string;
  isInternal: boolean;
  rel?: string;
}

export interface AtlasAssetRef {
  url: string;
  type: string;
}

export interface AtlasManifestAsset {
  url: string;
  type: string;
  referencedBy: string[];
  /** Favicon-only metadata — populated by Atlas only when type === 'favicon'. */
  rel?: string;
  sizes?: string;
  mimeType?: string;
}

/**
 * Atlas's chosen primary favicon plus all favicon-typed candidates.
 * Mirrors the producer's `FaviconPick` (atlas PR #46). Selection is done
 * Atlas-side; the consumer only reads `primary`.
 */
export interface AtlasFaviconPick {
  url: string;
  rel?: string;
  sizes?: string;
  mimeType?: string;
  /** true => synthesized /favicon.ico (no <link> in DOM, unverified). */
  implicit?: boolean;
}

export interface AtlasImage {
  url: string;
  alt?: string;
  width?: number;
  height?: number;
  sourceUrl: string;
  element: string;
  inHeader: boolean;
  inFooter: boolean;
  inFirstSection: boolean;
  nearH1: boolean;
  isFirstInContainer: boolean;
  linkedTo?: string;
  classes?: string[];
  ancestorClasses?: string;
  siblingText?: string;
}

export interface AtlasColorUsage {
  value: string;
  property: 'color' | 'backgroundColor' | 'borderColor';
  elements: string[];
  frequency: number;
}

export interface AtlasTypographyUsage {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  elements: string[];
  role: TypographyRole;
}

export interface AtlasNavItem {
  text: string;
  url: string;
  children?: AtlasNavItem[];
}

export interface AtlasCrawlResult {
  baseUrl: string;
  startedAt: string;
  completedAt: string;
  duration: number;
  pages: AtlasPage[];
  assets: AtlasManifestAsset[];
  /** Favicon metadata + chosen primary. Atlas-only; absent on pre-deploy/cached payloads. */
  favicon?: {
    primary: AtlasFaviconPick | null;
    candidates: AtlasManifestAsset[];
  };
  state: {
    visited: string[];
    failed: { url: string; error: string; attempts: number }[];
    redirects: { from: string; to: string; status: number }[];
    skipped: { url: string; reason: string }[];
  };
  structure: {
    sitemap: { urls: string[]; sitemapsProcessed: number; errors: string[] } | null;
    hierarchy: unknown;
  };
  platform?: { platform: string; confidence: string; signals: string[] };
  navigation?: { primary?: AtlasNavItem[]; footer?: AtlasNavItem[] };
  contact?: {
    phones?: { number: string; type?: string }[];
    emails?: { address: string; type?: string }[];
    addresses?: {
      formatted: string;
      street?: string;
      city?: string;
      state?: string;
      zip?: string;
      country?: string;
    }[];
    hours?: { day: string; open: string; close: string }[];
    social?: { platform: string; url: string; phone?: string; text?: string }[];
  };
  images?: AtlasImage[];
  visual?: {
    designTokens: {
      colors: AtlasColorUsage[];
      typography: AtlasTypographyUsage[];
      spacing: unknown[];
      borders: { radius: unknown[] };
      shadows: unknown[];
    };
  };
  screenshots?: { path: string; url?: string; format: string; size: number; viewport: { width: number; height: number } }[];
  downloads?: { url: string; localPath: string; size: number; contentType: string }[];
  warnings?: { url: string; extractor: string; error: string; timestamp: string }[];
}
