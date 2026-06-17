import { getS2SToken } from '@airo/ai-lib';

import { Logger } from '../logging/index.js';
import { detectBlogPage, isRebuildHomepage, rebuildUrlToSlug } from '../utils/rebuild-utils.js';
import {
  AtlasCrawlResultSchema,
  AtlasJobStatusResponseSchema,
  AtlasSubmitResponseSchema,
} from '../types/atlas-api.js';
import type { AtlasCrawlResult, AtlasExtractedForm, AtlasPage, AtlasTypographyUsage } from '../types/atlas-api.js';
import {
  WEBSITE_REBUILD_IMPORT_FAILED_USER_MESSAGE,
  createRebuildError,
} from '../types/rebuild.js';
import { mapAtlasDocumentLinks } from './rebuild/document-links.js';
import type {
  FormHint,
  ImagePlacement,
  NavigationItem,
  PageMetadata,
  SiteContactInfo,
  SiteMetadata,
  SitemapData,
  SitemapPage,
  TypographyScaleEntry,
} from '../types/rebuild.js';
import type { ZodSchema } from 'zod';
import type {
  ExtractedAsset,
  PageScrapeResult,
} from '../tools/ai-lib-tools/drivers/website-scraper-driver.js';

const logger = Logger.create({ component: 'atlas-crawler-adapter' });

const MAX_PAGES_DEFAULT = 20;
const POLL_FAST_INTERVAL_MS = 2000;
const POLL_SLOW_INTERVAL_MS = 5000;
const POLL_FAST_PHASE_MS = 30000;
const POLL_MAX_TIMEOUT_MS = 300000;
const SUBMIT_TIMEOUT_MS = 10_000;
const POLL_REQUEST_TIMEOUT_MS = 10_000;
const RESULTS_TIMEOUT_MS = 60_000;
const SCREENSHOT_TIMEOUT_MS = 30_000;
const SCREENSHOT_MAX_BYTES = 10 * 1024 * 1024;
const POLL_AUTH_FAIL_LIMIT = 3;
const POLL_TRANSPORT_FAIL_LIMIT = 10;

interface AtlasCrawlOptions {
  maxPages?: number;
  rootPath?: string;
  concurrency?: number;
  timeout?: number;
}

export interface CrawlCallbacks {
  onHomepageReady?: (homeOutput: AtlasCrawlOutput) => Promise<void>;
}

export function mapAtlasForms(atlasForms: AtlasExtractedForm[] | undefined): FormHint[] {
  if (!atlasForms || atlasForms.length === 0) return [];
  return atlasForms.map(form => {
    const rawMethod = (form.method ?? 'get').toLowerCase();
    // Atlas's Zod schema only validates the top-level crawl-result shape; nested
    // form payloads are unvalidated. Defend against malformed input here so a
    // single bad form doesn't abort the whole adapter mapping.
    const method: 'get' | 'post' = rawMethod === 'post' ? 'post' : 'get';
    const fields = Array.isArray(form.fields) ? form.fields : [];
    return {
      ...(form.action ? { action: form.action } : {}),
      method,
      ...(form.id ? { id: form.id } : {}),
      ...(form.className ? { className: form.className } : {}),
      fields: fields.map(f => ({
        type: f.type,
        ...(f.name ? { name: f.name } : {}),
        ...(f.label ? { label: f.label } : {}),
        ...(f.placeholder ? { placeholder: f.placeholder } : {}),
        required: f.required,
        ...(f.options && f.options.length > 0 ? { options: f.options } : {}),
      })),
      ...(form.submitButton ? { submitButton: { text: form.submitButton.text } } : {}),
    };
  });
}

export interface AtlasCrawlOutput {
  sitemapData: SitemapData;
  pages: PageScrapeResult[];
  assets: ExtractedAsset[];
  designTokenMetadata: Partial<SiteMetadata>;
  navigation: NavigationItem[];
  /** Footer nav extracted from Atlas navigation.footer (site-wide). */
  footerNavigation: NavigationItem[];
  /** Aggregated contact info (phones, emails, addresses, hours, social). */
  contact?: SiteContactInfo;
  /** Primary site favicon chosen by Atlas (rel/sizes/mimeType when known). */
  favicon?: SiteMetadata['favicon'];
  homepageScreenshotBase64?: string;
  /** True when Atlas advertised a screenshot URL, regardless of fetch success. Lets the orchestrator log fetch-failure as a regression. */
  atlasReportedScreenshot: boolean;
  /**
   * When atlasReportedScreenshot is true but homepageScreenshotBase64 is
   * missing, the cause (timeout, http-status, content-length-cap,
   * post-arrayBuffer-cap, or generic transport-error). Lets a single Loki
   * query on `atlas-screenshot-missing` diagnose the regression without
   * cross-referencing the adapter's own warns by URL.
   */
  homepageScreenshotFailureReason?: string;
}

export class AtlasCrawlerAdapter {
  private baseUrl: string;

  constructor() {
    this.baseUrl = this.resolveBaseUrl();
  }

  private async getAuthHeader(): Promise<string> {
    const token = await getS2SToken();
    return `sso-jwt ${token}`;
  }

  /**
   * Parse Atlas JSON and validate against the given schema. Throws a named
   * import_failed RebuildError on shape mismatch OR on malformed JSON so the
   * orchestrator surfaces the right user-facing error (rather than failing
   * later inside the pipeline with a generic message — e.g., a missing jobId
   * would otherwise cause pollUntilComplete to spin on /jobs/undefined for 5
   * minutes; an HTML error page would surface as a bare SyntaxError without
   * the boundary tag).
   */
  private async parseAtlasJson<T>(
    response: Response,
    schema: ZodSchema<T>,
    boundary: string,
  ): Promise<T> {
    let raw: unknown;
    try {
      raw = await response.json();
    } catch (error) {
      const parseError = error instanceof Error ? error.message : String(error);
      logger.error('atlas-crawler-adapter.invalid-response', {
        boundary,
        reason: 'json-parse',
        parseError,
      });
      throw createRebuildError(`Atlas API returned invalid ${boundary} response`, {
        code: 'import_failed',
        userMessage: WEBSITE_REBUILD_IMPORT_FAILED_USER_MESSAGE,
        isUserFacingError: true,
      });
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      logger.error('atlas-crawler-adapter.invalid-response', {
        boundary,
        reason: 'schema-mismatch',
        issues: parsed.error.issues.map(issue => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      });
      throw createRebuildError(`Atlas API returned invalid ${boundary} response`, {
        code: 'import_failed',
        userMessage: WEBSITE_REBUILD_IMPORT_FAILED_USER_MESSAGE,
        isUserFacingError: true,
      });
    }
    return parsed.data;
  }

  async crawlSite(sourceUrl: string, options: AtlasCrawlOptions = {}, callbacks?: CrawlCallbacks): Promise<AtlasCrawlOutput> {
    const maxPages = options.maxPages ?? MAX_PAGES_DEFAULT;
    const startTime = Date.now();

    logger.info('atlas-crawler-adapter.crawl-start', {
      sourceUrl,
      maxPages,
      rootPath: options.rootPath,
      baseUrl: this.baseUrl,
    });

    const jobId = await this.submitCrawlJob(sourceUrl, {
      maxPages,
      maxDepth: 3,
      concurrency: options.concurrency ?? 3,
      timeout: options.timeout ?? 30000,
      useSitemap: true,
      headless: true,
      seedPaths: [options.rootPath ?? '/'],
      output: 'full',
      include: {
        html: true,
        text: true,
        assets: true,
        structuredData: true,
        visual: true,
      },
      screenshot: {
        enabled: true,
        format: 'png',
        fullPage: true,
      },
      downloadAssets: true,
      ssrfProtection: 'strict',
      respectRobotsTxt: true,
    });

    const homepageCallbackFired = await this.pollUntilComplete(jobId, options.rootPath ?? '/', callbacks);

    const result = await this.fetchResults(jobId);

    logger.info('atlas-crawler-adapter.crawl-complete', {
      sourceUrl,
      jobId,
      pagesFound: result.pages.length,
      assetsFound: result.assets.length,
      durationMs: Date.now() - startTime,
      hasSitemap: !!result.structure.sitemap,
      hasVisual: !!result.visual,
    });

    const rootPath = options.rootPath ?? '/';
    const skipScreenshot = homepageCallbackFired;
    return this.mapCrawlResult(result, rootPath, skipScreenshot);
  }

  private async mapCrawlResult(result: AtlasCrawlResult, rootPath: string, skipScreenshot = false): Promise<AtlasCrawlOutput> {
    const sitemapData = this.mapToSitemapData(result, rootPath);
    const pages = this.mapToPageScrapeResults(result);
    const assets = this.mapToExtractedAssets(result);
    const designTokenMetadata = this.mapDesignTokensToMetadata(result);
    const navigation = this.mapNavigation(result, rootPath);
    const footerNavigation = this.mapFooterNavigation(result);
    const contact = this.mapContact(result);
    const favicon = this.mapFavicon(result);
    const atlasReportedScreenshot = !!result.screenshots?.[0]?.url;

    let homepageScreenshotBase64: string | undefined;
    let homepageScreenshotFailureReason: string | undefined;
    if (!skipScreenshot) {
      const screenshotResult = await this.fetchHomepageScreenshot(result);
      homepageScreenshotBase64 = screenshotResult.data;
      homepageScreenshotFailureReason = screenshotResult.failureReason;

      if (homepageScreenshotBase64) {
        const homepagePage = pages.find(p => isRebuildHomepage(p.url, rootPath));
        if (homepagePage) {
          homepagePage.screenshotBase64 = homepageScreenshotBase64;
        }
      }
    }

    return {
      sitemapData,
      pages,
      assets,
      designTokenMetadata,
      navigation,
      footerNavigation,
      contact,
      ...(favicon ? { favicon } : {}),
      homepageScreenshotBase64,
      atlasReportedScreenshot,
      ...(homepageScreenshotFailureReason ? { homepageScreenshotFailureReason } : {}),
    };
  }

  private async submitCrawlJob(url: string, options: Record<string, unknown>): Promise<string> {
    const auth = await this.getAuthHeader();
    const response = await fetch(`${this.baseUrl}/crawl`, {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, options }),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      throw new Error(`Atlas API submit failed (${String(response.status)}): ${errorText}`);
    }

    const data = await this.parseAtlasJson(response, AtlasSubmitResponseSchema, 'submit');

    logger.info('atlas-crawler-adapter.job-submitted', {
      jobId: data.jobId,
      status: data.status,
      url,
    });

    return data.jobId;
  }

  private async pollUntilComplete(jobId: string, rootPath: string, callbacks?: CrawlCallbacks): Promise<boolean> {
    const startTime = Date.now();
    let pollCount = 0;
    let consecutiveAuthFailures = 0;
    let consecutiveTransportFailures = 0;
    let lastTransportError: string | null = null;
    let homepageHandlerAttempted = false;
    let homepageCallbackFired = false;

    while (Date.now() - startTime < POLL_MAX_TIMEOUT_MS) {
      // Sleep at end-of-iteration so the first poll is immediate; this trims
      // the minimum-latency floor on a fast Atlas response.
      if (pollCount > 0) {
        const elapsed = Date.now() - startTime;
        const interval = elapsed < POLL_FAST_PHASE_MS ? POLL_FAST_INTERVAL_MS : POLL_SLOW_INTERVAL_MS;
        await new Promise(resolve => setTimeout(resolve, interval));
      }
      pollCount++;

      const auth = await this.getAuthHeader();
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/jobs/${jobId}`, {
          headers: { 'Authorization': auth },
          signal: AbortSignal.timeout(POLL_REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        consecutiveTransportFailures++;
        lastTransportError = error instanceof Error ? error.message : String(error);
        logger.warn('atlas-crawler-adapter.poll-network-error', {
          jobId,
          pollCount,
          consecutiveTransportFailures,
          error: lastTransportError,
        });
        if (consecutiveTransportFailures >= POLL_TRANSPORT_FAIL_LIMIT) {
          throw new Error(
            `Atlas API unreachable (${String(consecutiveTransportFailures)} consecutive transport failures). Last error: ${lastTransportError}`
          );
        }
        continue;
      }

      if (!response.ok) {
        consecutiveTransportFailures++;
        lastTransportError = `HTTP ${String(response.status)}`;
        logger.warn('atlas-crawler-adapter.poll-http-error', {
          jobId,
          status: response.status,
          pollCount,
          consecutiveTransportFailures,
        });
        if (response.status === 401 || response.status === 403) {
          consecutiveAuthFailures++;
          if (consecutiveAuthFailures >= POLL_AUTH_FAIL_LIMIT) {
            throw new Error(
              `Atlas API authentication failed (${String(consecutiveAuthFailures)} consecutive ${String(response.status)}s). Verify S2S credentials and ATLAS_API_BASE_URL.`
            );
          }
        }
        if (consecutiveTransportFailures >= POLL_TRANSPORT_FAIL_LIMIT) {
          throw new Error(
            `Atlas API repeatedly failing (${String(consecutiveTransportFailures)} consecutive errors). Last error: ${lastTransportError}`
          );
        }
        continue;
      }
      consecutiveAuthFailures = 0;
      consecutiveTransportFailures = 0;
      lastTransportError = null;

      const job = await this.parseAtlasJson(response, AtlasJobStatusResponseSchema, 'job-status');

      if (job.status === 'completed') {
        logger.info('atlas-crawler-adapter.job-complete', {
          jobId,
          pollCount,
          elapsedMs: Date.now() - startTime,
        });
        return homepageCallbackFired;
      }

      if (job.status === 'homepage_ready' && !homepageHandlerAttempted && callbacks?.onHomepageReady) {
        homepageHandlerAttempted = true;
        let homeOutput: AtlasCrawlOutput;
        try {
          const homeResult = await this.fetchHomeResults(jobId);
          homeOutput = await this.mapCrawlResult(homeResult, rootPath);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn('atlas-crawler-adapter.homepage-ready-fetch-failed', {
            jobId,
            error: message,
          });
          continue;
        }
        logger.info('atlas-crawler-adapter.homepage-ready-callback-start', { jobId, pollCount });
        await callbacks.onHomepageReady(homeOutput);
        homepageCallbackFired = true;
        logger.info('atlas-crawler-adapter.homepage-ready-callback-complete', {
          jobId,
          pollCount,
          elapsedMs: Date.now() - startTime,
        });
      }

      if (job.status === 'failed') {
        throw new Error(`Atlas crawl failed: ${job.error || 'unknown error'}`);
      }

      if (pollCount % 10 === 0) {
        logger.info('atlas-crawler-adapter.poll-progress', {
          jobId,
          status: job.status,
          pollCount,
          elapsedMs: Date.now() - startTime,
        });
      }
    }

    const tail = lastTransportError ? `; last error: ${lastTransportError}` : '';
    throw new Error(`Atlas crawl timed out after ${String(POLL_MAX_TIMEOUT_MS / 1000)}s (jobId: ${jobId})${tail}`);
  }

  private async fetchResults(jobId: string): Promise<AtlasCrawlResult> {
    return this.fetchJobEndpoint(jobId, 'results');
  }

  private async fetchHomeResults(jobId: string): Promise<AtlasCrawlResult> {
    return this.fetchJobEndpoint(jobId, 'home');
  }

  private async fetchJobEndpoint(jobId: string, endpoint: 'results' | 'home'): Promise<AtlasCrawlResult> {
    const auth = await this.getAuthHeader();
    const response = await fetch(`${this.baseUrl}/jobs/${jobId}/${endpoint}`, {
      headers: { 'Authorization': auth },
      signal: AbortSignal.timeout(RESULTS_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      throw new Error(`Atlas API fetch ${endpoint} failed (${String(response.status)}): ${errorText}`);
    }

    const validated = await this.parseAtlasJson(response, AtlasCrawlResultSchema, endpoint);
    const result = validated as unknown as AtlasCrawlResult;

    // Raw by-type breakdown at the Atlas boundary — distinguishes "Atlas handed us N
    // images" from what survives our mapping/bucketing downstream. (Post-#42, /home
    // carries the homepage's full asset set; older builds saw a thin partial.)
    const rawAssetTypeCounts: Record<string, number> = {};
    for (const a of result.assets ?? []) {
      const type = (a as { type?: string }).type ?? 'unknown';
      rawAssetTypeCounts[type] = (rawAssetTypeCounts[type] ?? 0) + 1;
    }
    logger.info(`atlas-crawler-adapter.${endpoint}-raw`, {
      jobId,
      hasScreenshots: !!result.screenshots,
      screenshotsCount: result.screenshots?.length ?? 0,
      assetCount: result.assets?.length ?? 0,
      rawAssetTypeCounts,
      imagesSignalCount: result.images?.length ?? 0,
    });

    return result;
  }

  private async fetchHomepageScreenshot(
    result: AtlasCrawlResult,
  ): Promise<{ data?: string; failureReason?: string }> {
    const screenshotUrl = result.screenshots?.[0]?.url;
    if (!screenshotUrl) return {};

    try {
      const response = await fetch(screenshotUrl, {
        signal: AbortSignal.timeout(SCREENSHOT_TIMEOUT_MS),
      });
      if (!response.ok) {
        logger.warn('atlas-crawler-adapter.screenshot-fetch-failed', {
          url: screenshotUrl,
          status: response.status,
        });
        return { failureReason: `http-${String(response.status)}` };
      }

      // Reject up-front when the server declares the body is too large.
      const contentLengthHeader = response.headers.get('content-length');
      if (contentLengthHeader) {
        const declared = Number(contentLengthHeader);
        if (Number.isFinite(declared) && declared > SCREENSHOT_MAX_BYTES) {
          logger.warn('atlas-crawler-adapter.screenshot-too-large', {
            url: screenshotUrl,
            declaredBytes: declared,
            maxBytes: SCREENSHOT_MAX_BYTES,
          });
          return { failureReason: 'content-length-cap' };
        }
      }

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > SCREENSHOT_MAX_BYTES) {
        logger.warn('atlas-crawler-adapter.screenshot-too-large', {
          url: screenshotUrl,
          bytes: arrayBuffer.byteLength,
          maxBytes: SCREENSHOT_MAX_BYTES,
        });
        return { failureReason: 'post-arrayBuffer-cap' };
      }

      const buffer = Buffer.from(arrayBuffer);
      const base64 = buffer.toString('base64');
      const contentType = response.headers.get('content-type') || 'image/png';
      return { data: `data:${contentType};base64,${base64}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('atlas-crawler-adapter.screenshot-fetch-error', {
        url: screenshotUrl,
        error: message,
      });
      // AbortSignal.timeout fires a TimeoutError; surface it distinctly so
      // a regression query can split timeouts from other transport errors.
      const isTimeout = error instanceof Error && error.name === 'TimeoutError';
      return { failureReason: isTimeout ? 'timeout' : `transport-error: ${message}` };
    }
  }

  private resolveBaseUrl(): string {
    const fromEnv = process.env.ATLAS_API_BASE_URL;
    if (!fromEnv) {
      // Matches WebsiteScraperDriver pattern: env should be set in deploy config
      // (mhp-core Nomad job spec for prod/test, dev-runner preflight for local).
      // Fall back to dev URL but log loudly so misconfigured prod is visible.
      logger.warn('atlas-crawler-adapter.base-url-env-missing', {
        envVar: 'ATLAS_API_BASE_URL',
        message: 'ATLAS_API_BASE_URL not set; Set in deploy config.',
      });

      return process.env.NODE_ENV === 'production' ? 'https://atlas.gdcorp.tools' : 'https://atlas.dev-gdcorp.tools';
    }
    return fromEnv;
  }

  // ─── Mapping methods (unchanged from SDK version) ─────────────────────────

  mapToSitemapData(result: AtlasCrawlResult, rootPath: string): SitemapData {
    const hasSitemap = !!result.structure.sitemap;

    const pages: SitemapPage[] = result.pages.map(page => ({
      url: page.url,
      slug: rebuildUrlToSlug(page.url, rootPath),
      priority: undefined,
      changefreq: undefined,
      lastmod: undefined,
      source: hasSitemap ? 'sitemap' as const : 'crawl' as const,
      scraped: true,
      isBlog: detectBlogPage(page.url),
    }));

    return {
      pages,
      totalPages: pages.length,
      discoveredAt: new Date().toISOString(),
    };
  }

  private mapToPageScrapeResults(result: AtlasCrawlResult): PageScrapeResult[] {
    return result.pages.map(page => {
      const forms = mapAtlasForms(page.visual?.forms);
      const contentLinks = mapAtlasDocumentLinks(page.links, page.url);
      const metadata = this.mapPageMetadata(page);
      return {
        url: page.url,
        success: page.statusCode >= 200 && page.statusCode < 400,
        sanitizedContent: page.text ?? '',
        html: page.html,
        ...(forms.length > 0 ? { forms } : {}),
        ...(contentLinks.length > 0 ? { contentLinks } : {}),
        ...(metadata ? { metadata } : {}),
      };
    });
  }

  private mapPageMetadata(page: AtlasPage): PageMetadata | undefined {
    const m = page.metadata;
    if (!m) return undefined;

    const out: PageMetadata = { title: m.title };
    if (m.description) out.description = m.description;
    if (m.ogTitle) out.ogTitle = m.ogTitle;
    if (m.ogDescription) out.ogDescription = m.ogDescription;
    if (m.ogImage) out.ogImage = m.ogImage;
    if (m.canonical) out.canonicalUrl = m.canonical;
    if (m.keywords && m.keywords.length > 0) out.keywords = m.keywords;

    const hasContent = out.title || Object.keys(out).length > 1;
    return hasContent ? out : undefined;
  }

  mapToExtractedAssets(result: AtlasCrawlResult): ExtractedAsset[] {
    // Build signal lookup from result.images — carries alt text, dimensions,
    // and placement signals that ManifestAsset doesn't have.
    const imageSignalMap = new Map<string, {
      altText?: string;
      dimensions?: { width: number; height: number };
      placement: ImagePlacement;
    }>();
    if (result.images) {
      for (const img of result.images) {
        if (imageSignalMap.has(img.url)) continue;
        const placement: ImagePlacement = {
          inHeader: img.inHeader,
          inFooter: img.inFooter,
          inFirstSection: img.inFirstSection,
          nearH1: img.nearH1,
          isFirstInContainer: img.isFirstInContainer,
          ...(img.linkedTo ? { linkedTo: img.linkedTo } : {}),
          ...(img.classes && img.classes.length > 0 ? { classes: img.classes } : {}),
          ...(img.siblingText ? { siblingText: img.siblingText } : {}),
        };
        const dimensions = img.width && img.height ? { width: img.width, height: img.height } : undefined;
        imageSignalMap.set(img.url, {
          ...(img.alt ? { altText: img.alt } : {}),
          ...(dimensions ? { dimensions } : {}),
          placement,
        });
      }
    }

    const assets: ExtractedAsset[] = [];
    const tracked = new Set<string>();
    // De-dupe unknown-type warns within a single crawl: a page with 50 assets
    // of an unrecognized atlas type would otherwise produce 50 identical Loki
    // entries.
    const warnedAssetTypes = new Set<string>();

    for (const manifestAsset of result.assets) {
      const type = this.mapAssetType(manifestAsset.type, warnedAssetTypes);
      if (type === null) continue;

      // Expand into one ExtractedAsset per referrer page. Atlas's referencedBy
      // is the authoritative list of pages that reference each asset (network-
      // observed during Puppeteer render — more complete than HTML parsing
      // could give us). The previous adapter took only referencedBy[0] and
      // dropped the rest, which caused logos shared across pages to be
      // misattributed to whichever page Atlas crawled first.
      // AssetProcessingService dedupes by URL when building the manifest, so
      // expanding doesn't cause double downloads.
      const referrers = manifestAsset.referencedBy.length > 0
        ? manifestAsset.referencedBy
        : [result.baseUrl];

      const signals = imageSignalMap.get(manifestAsset.url);

      for (const sourceUrl of referrers) {
        assets.push({
          url: manifestAsset.url,
          type,
          sourceUrl,
          ...(signals?.altText ? { altText: signals.altText } : {}),
          ...(signals?.dimensions ? { dimensions: signals.dimensions } : {}),
          ...(type === 'image' && signals ? { placement: signals.placement } : {}),
        });
      }
      tracked.add(manifestAsset.url);
    }

    // Add image-only assets that aren't in the manifest (inline backgrounds,
    // etc. that Atlas's SSM image extraction sees but doesn't manifest).
    if (result.images) {
      for (const img of result.images) {
        if (tracked.has(img.url)) continue;
        tracked.add(img.url);
        const signals = imageSignalMap.get(img.url);
        assets.push({
          url: img.url,
          type: 'image',
          sourceUrl: img.sourceUrl,
          ...(signals?.altText ? { altText: signals.altText } : {}),
          ...(signals?.dimensions ? { dimensions: signals.dimensions } : {}),
          ...(signals ? { placement: signals.placement } : {}),
        });
      }
    }

    return assets;
  }

  mapDesignTokensToMetadata(result: AtlasCrawlResult): Partial<SiteMetadata> {
    const visual = result.visual;
    if (!visual?.designTokens) return {};

    const { colors, typography } = visual.designTokens;

    const colorPalette = this.extractColorPalette(colors);
    const typographyData = this.extractTypography(typography);

    const metadata: Partial<SiteMetadata> = {};

    if (colorPalette.primary.length > 0 || colorPalette.secondary.length > 0 || colorPalette.accent.length > 0) {
      metadata.colorPalette = colorPalette;
    }

    if (typographyData.headingFonts.length > 0 || typographyData.bodyFonts.length > 0 || (typographyData.scale?.length ?? 0) > 0) {
      metadata.typography = typographyData;
    }

    return metadata;
  }

  mapNavigation(result: AtlasCrawlResult, rootPath: string = '/'): NavigationItem[] {
    const baseOrigin = this.tryParseOrigin(result.baseUrl);
    const nav = result.navigation?.primary ?? [];

    const items: NavigationItem[] = [];
    const seenUrls = new Set<string>();

    if (nav.length > 0) {
      // Atlas-extracted primary nav. Same-origin URLs become path-only so the
      // rebuilt site owns them; external URLs are kept as absolute.
      for (const item of nav) {
        const normalized = this.normalizeNavUrl(item.url, baseOrigin);
        if (!normalized || seenUrls.has(normalized.url)) continue;
        seenUrls.add(normalized.url);
        items.push({ label: item.text, url: normalized.url, isExternal: normalized.isExternal });
      }
    } else {
      // Fallback when Atlas didn't surface a primary nav — derive from homepage links.
      const homepage = result.pages.find(p => isRebuildHomepage(p.url, rootPath));
      if (homepage?.links) {
        for (const link of homepage.links) {
          if (!link.isInternal) continue;
          if (!link.text || link.text.length > 50) continue;
          if (!this.isNavTarget(link.url)) continue;
          const path = this.extractPath(link.url, result.baseUrl);
          if (!path || seenUrls.has(path)) continue;
          seenUrls.add(path);
          items.push({ label: link.text.trim(), url: path, isExternal: false });
        }
      }
    }

    return items.slice(0, 20);
  }

  mapFooterNavigation(result: AtlasCrawlResult): NavigationItem[] {
    const footer = result.navigation?.footer;
    if (!footer || footer.length === 0) return [];

    const baseOrigin = this.tryParseOrigin(result.baseUrl);
    const items: NavigationItem[] = [];
    const seen = new Set<string>();

    for (const item of footer) {
      const normalized = this.normalizeNavUrl(item.url, baseOrigin);
      if (!normalized || seen.has(normalized.url)) continue;
      seen.add(normalized.url);
      items.push({ label: item.text, url: normalized.url, isExternal: normalized.isExternal });
    }

    return items.slice(0, 30);
  }

  mapContact(result: AtlasCrawlResult): SiteContactInfo | undefined {
    const c = result.contact;
    if (!c) return undefined;

    const out: SiteContactInfo = {};
    if (c.phones?.length) out.phones = c.phones.map(p => ({ number: p.number, type: p.type }));
    if (c.emails?.length) out.emails = c.emails.map(e => ({ address: e.address, type: e.type }));
    if (c.addresses?.length) {
      out.addresses = c.addresses.map(a => ({
        formatted: a.formatted,
        street: a.street,
        city: a.city,
        state: a.state,
        zip: a.zip,
        country: a.country,
      }));
    }
    if (c.hours?.length) out.hours = c.hours.map(h => ({ day: h.day, open: h.open, close: h.close }));
    if (c.social?.length) {
      // Dedupe by URL; keep the first {platform} we see for a given URL.
      // WhatsApp dedupes by phone instead: the same number can appear under
      // multiple URL forms (wa.me anchor + whatsapp:// button), which would
      // otherwise each render a separate click-to-chat CTA in the prompt.
      const seenUrls = new Set<string>();
      const seenWhatsAppPhones = new Set<string>();
      const filtered: { platform: string; url: string; phone?: string; text?: string }[] = [];
      for (const s of c.social) {
        if (s.platform?.toLowerCase() === 'whatsapp' && s.phone) {
          if (seenWhatsAppPhones.has(s.phone)) continue;
          seenWhatsAppPhones.add(s.phone);
        } else {
          if (seenUrls.has(s.url)) continue;
          seenUrls.add(s.url);
        }
        filtered.push({
          platform: s.platform,
          url: s.url,
          ...(s.phone ? { phone: s.phone } : {}),
          ...(s.text ? { text: s.text } : {}),
        });
      }
      if (filtered.length > 0) out.social = filtered;
    }

    return Object.keys(out).length > 0 ? out : undefined;
  }

  mapFavicon(result: AtlasCrawlResult): SiteMetadata['favicon'] | undefined {
    const primary = result.favicon?.primary;
    if (!primary?.url) return undefined;
    // Drop `implicit` — the rebuilt <head> doesn't need to distinguish a
    // synthesized /favicon.ico from a DOM <link>.
    return {
      url: primary.url,
      ...(primary.rel ? { rel: primary.rel } : {}),
      ...(primary.sizes ? { sizes: primary.sizes } : {}),
      ...(primary.mimeType ? { mimeType: primary.mimeType } : {}),
    };
  }

  private tryParseOrigin(baseUrl: string): string | null {
    try {
      return new URL(baseUrl).origin;
    } catch {
      return null;
    }
  }

  /**
   * Returns false for hashes, mailto:, tel:, javascript: — not site nav targets.
   */
  private isNavTarget(url: string): boolean {
    if (!url) return false;
    const trimmed = url.trim();
    if (!trimmed || trimmed === '#' || trimmed.startsWith('#')) return false;
    // eslint-disable-next-line no-script-url
    if (trimmed.startsWith('mailto:') || trimmed.startsWith('tel:') || trimmed.startsWith('javascript:')) return false;
    return true;
  }

  /**
   * Normalize a nav URL: same-origin links become path-only (so the rebuilt
   * site owns them), external links stay absolute. Returns null for hashes,
   * mailto:, tel:, etc., which are not site nav targets.
   */
  private normalizeNavUrl(url: string, baseOrigin: string | null): { url: string; isExternal: boolean } | null {
    if (!this.isNavTarget(url)) return null;
    const trimmed = url.trim();

    if (trimmed.startsWith('/')) {
      return { url: trimmed, isExternal: false };
    }

    try {
      const parsed = new URL(trimmed);
      if (baseOrigin && parsed.origin === baseOrigin) {
        const path = parsed.pathname.replace(/\/$/, '') || '/';
        const search = parsed.search;
        return { url: `${path}${search}`, isExternal: false };
      }
      return { url: trimmed, isExternal: true };
    } catch {
      return null;
    }
  }

  private extractPath(url: string, baseUrl: string): string | null {
    try {
      const parsed = new URL(url, baseUrl);
      const pathname = parsed.pathname.replace(/\/$/, '') || '/';
      if (pathname === '/') return null;
      return pathname;
    } catch {
      return url.startsWith('/') ? url : null;
    }
  }

  private extractColorPalette(colors: Array<{ value: string; property: string; frequency: number }>): SiteMetadata['colorPalette'] {
    if (colors.length === 0) {
      return { primary: [], secondary: [], accent: [] };
    }

    const bgColors = colors
      .filter(c => c.property === 'backgroundColor')
      .sort((a, b) => b.frequency - a.frequency)
      .map(c => c.value)
      .filter(v => !this.isNeutralColor(v));

    const textColors = colors
      .filter(c => c.property === 'color')
      .sort((a, b) => b.frequency - a.frequency)
      .map(c => c.value)
      .filter(v => !this.isNeutralColor(v));

    const borderColors = colors
      .filter(c => c.property === 'borderColor')
      .sort((a, b) => b.frequency - a.frequency)
      .map(c => c.value)
      .filter(v => !this.isNeutralColor(v));

    const primary = this.dedupe(bgColors.slice(0, 3));
    const secondary = this.dedupe(bgColors.slice(3, 6));
    const accent = this.dedupe([...textColors.slice(0, 2), ...borderColors.slice(0, 1)]);

    return { primary, secondary, accent };
  }

  private extractTypography(typography: AtlasTypographyUsage[]): SiteMetadata['typography'] {
    if (typography.length === 0) {
      return { headingFonts: [], bodyFonts: [] };
    }

    const headingFonts = this.dedupe(
      typography
        .filter(t => t.role === 'heading')
        .map(t => this.cleanFontFamily(t.fontFamily))
    );

    const bodyFonts = this.dedupe(
      typography
        .filter(t => t.role === 'body')
        .map(t => this.cleanFontFamily(t.fontFamily))
    );

    // Intentionally undeduped — each entry is one observed (role, size, weight, …) tuple
    const scale: TypographyScaleEntry[] = typography.map(t => ({
      fontFamily: this.cleanFontFamily(t.fontFamily),
      fontSize: t.fontSize,
      fontWeight: t.fontWeight,
      lineHeight: t.lineHeight,
      letterSpacing: t.letterSpacing,
      role: t.role,
    }));

    return { headingFonts, bodyFonts, scale };
  }



  private mapAssetType(
    atlasType: string,
    warnedTypes?: Set<string>,
  ): 'image' | 'font' | 'icon' | 'other' | null {
    switch (atlasType) {
      case 'image': return 'image';
      case 'font': return 'font';
      case 'favicon': return 'icon';
      case 'css':
      case 'script':
        return null;
      default:
        // Surface unrecognized atlas types so taxonomy drift is visible. The
        // caller passes a per-crawl Set so we log each unknown type at most
        // once per crawl instead of once per asset.
        if (!warnedTypes || !warnedTypes.has(atlasType)) {
          logger.warn('atlas-crawler-adapter.unknown-asset-type', { atlasType });
          warnedTypes?.add(atlasType);
        }
        return 'other';
    }
  }

  private isNeutralColor(value: string): boolean {
    const neutral = ['transparent', 'inherit', 'currentcolor', 'initial', 'unset'];
    const lower = value.toLowerCase().trim();
    if (neutral.includes(lower)) return true;

    if (lower === '#fff' || lower === '#ffffff' || lower === '#000' || lower === '#000000') return true;
    if (lower === 'rgb(255, 255, 255)' || lower === 'rgb(0, 0, 0)') return true;
    if (lower === 'rgba(0, 0, 0, 0)') return true;

    return false;
  }

  private cleanFontFamily(raw: string): string {
    const first = raw.split(',')[0] ?? raw;
    return first.trim().replace(/^["']|["']$/g, '');
  }

  private dedupe(arr: string[]): string[] {
    return [...new Set(arr)];
  }
}
