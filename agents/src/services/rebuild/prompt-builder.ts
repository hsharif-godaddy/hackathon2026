/**
 * Build a single page's rebuild prompt and (Atlas-only) the structured
 * PageBuildSpec handoff. Wraps the PagePromptAgent invocation and the
 * deterministic spec construction together — both consume the same inputs
 * (per-page asset analysis, screenshot, source-site data).
 *
 * No workflow-state mutation: callers are responsible for marking the page
 * as built and persisting the workflow state. This service is read-only
 * with respect to anything outside the spec file it writes.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PagePromptAgent } from '../../agents/page-prompt-agent.js';
import { shouldPreserveDesign } from '../../agents/page-prompt/style-instructions.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { Logger } from '../../logging/index.js';
import {
  type AssetManifest,
  type PageBuildSpec,
  type PageContent,
  type RebuildWorkflowState,
  type SiteMetadata,
  type SourceSiteData,
  type SpecAssetManifest,
  type StylePreferences,
} from '../../types/rebuild.js';
import { normalizeAssetPath } from '../../utils/asset-paths.js';
import { resolvePageTitle } from '../../utils/rebuild-utils.js';
import { resizeForVision } from '../../utils/image-resize.js';
import { AssetProcessingService } from '../AssetProcessingService.js';
import type { PagePersistenceService } from './page-persistence.js';

const logger = Logger.create({ component: 'rebuild-orchestration-service' });
const appRepo = new AppRepository();

export interface BuildPageResult {
  prompt: string;
  specPath?: string;
  specPatternCount: number;
  specFormCount: number;
  sourceUrl: string;
  pageTitle: string;
  imageCount: number;
}

export class RebuildPromptBuilder {
  constructor(
    private readonly appPath: string,
    private readonly sourceSiteDir: string,
    private readonly persistence: PagePersistenceService,
    private readonly useAtlas: boolean,
  ) {}

  /**
   * Build the markdown prompt for `pageSlug` and (Atlas-only) emit the
   * structured spec. Returns the prompt + spec metadata; the orchestrator
   * is responsible for marking the page as built and persisting state.
   */
  async buildPage(appId: string, pageSlug: string, state: RebuildWorkflowState): Promise<BuildPageResult> {
    // Caller (RebuildOrchestrationService.buildPage) emits the
    // `rebuild-orchestration.build-page` lifecycle marker before invoking us,
    // so a missing workflow-state.json still surfaces in Loki.
    const sourceSiteData = await this.persistence.loadSourceSiteData();

    if (!state.stylePreferences) {
      throw new Error('Style preferences not set');
    }

    const pageContent = sourceSiteData.pages[pageSlug];
    if (!pageContent) {
      // DIAGNOSTIC (AIROBUILD-2104): distinguish slug-mismatch / load-failure
      // (sitemap says scraped but JSON absent from pages) from a never-crawled
      // page. The selector only offers scraped:true pages, so reaching here with
      // scraped:true is the "invented content" path — the tool throws and the
      // develop agent falls back to fabricating.
      const sitemapEntry = sourceSiteData.sitemap.pages.find(p => p.slug === pageSlug);
      logger.error('rebuild-orchestration.build-page.source-missing', {
        appId,
        pageSlug,
        availablePageKeys: Object.keys(sourceSiteData.pages),
        sitemapEntry: sitemapEntry
          ? { slug: sitemapEntry.slug, url: sitemapEntry.url, scraped: sitemapEntry.scraped }
          : null,
        sitemapSlugs: sourceSiteData.sitemap.pages.map(p => ({ slug: p.slug, scraped: p.scraped })),
      });
      throw new Error(`Page not found: ${pageSlug}`);
    }

    // DIAGNOSTIC (AIROBUILD-2104): catch the "present but empty" mode — if the
    // source content is blank, the prompt agent has nothing to ground on and
    // invents, even though no error is thrown.
    const contentLength = pageContent.content?.length ?? 0;
    const sanitizedContentLength = pageContent.sanitizedContent?.length ?? 0;
    // Fully-empty source is the "present but blank" fabrication mode — the agent
    // has nothing to ground on and invents. Surface it at warn, not info.
    const emptySource = contentLength === 0 && sanitizedContentLength === 0;
    logger[emptySource ? 'warn' : 'info']('rebuild-orchestration.build-page.source-loaded', {
      appId,
      pageSlug,
      url: pageContent.url,
      contentLength,
      sanitizedContentLength,
      ...(emptySource ? { emptySource: true } : {}),
    });

    // First page (homepage) gets full setup instructions; later pages skip
    // project setup, colors, fonts, header/footer.
    const isFirstPage = state.pagesBuilt.length === 0;

    logger.info('rebuild-orchestration.generating-prompt', {
      appId,
      pageSlug,
      isFirstPage,
      pagesBuiltCount: state.pagesBuilt.length,
    });

    const pageAssetManifest = await this.analyzePageAssets(appId, pageSlug, pageContent, sourceSiteData);
    const screenshotBase64 = isFirstPage ? await this.loadHomepageScreenshot(appId, pageSlug) : undefined;

    const prompt = await this.runPagePromptAgent(
      appId,
      sourceSiteData.metadata,
      pageContent,
      state.stylePreferences,
      pageAssetManifest,
      isFirstPage,
      screenshotBase64,
    );

    // Structured handoff seam: emit a code-built spec for develop-agent
    // consumption. Atlas-only — legacy scraper doesn't produce the form/pattern
    // signals the spec promises, so we'd be shipping a half-empty handoff.
    // Write the spec BEFORE the orchestrator records the page as built; if
    // writeFile throws, a retry treats this as the homepage (isFirstPage check)
    // instead of a half-built inner page.
    let specPath: string | undefined;
    let specPatternCount = 0;
    let specFormCount = 0;
    if (this.useAtlas) {
      const spec = buildPageSpec(pageSlug, pageContent, sourceSiteData.metadata, state.stylePreferences, pageAssetManifest, isFirstPage);
      specPath = path.join(this.sourceSiteDir, `${pageSlug}-spec.json`);
      await writeFile(specPath, JSON.stringify(spec, null, 2), 'utf-8');
      specPatternCount = spec.detectedPatterns.length;
      specFormCount = spec.forms.length;
    }

    return {
      prompt,
      specPath,
      specPatternCount,
      specFormCount,
      sourceUrl: pageContent.url,
      pageTitle: resolvePageTitle(pageContent.title, pageSlug),
      imageCount: pageAssetManifest.byType.image,
    };
  }

  private async analyzePageAssets(
    appId: string,
    pageSlug: string,
    pageContent: PageContent,
    sourceSiteData: SourceSiteData,
  ): Promise<AssetManifest> {
    logger.info('rebuild-orchestration.analyzing-page-assets', {
      appId,
      pageSlug,
      pageUrl: pageContent.url,
    });

    const assetService = new AssetProcessingService(this.appPath);
    const { pageAssets, analyzedImageCount } = await assetService.analyzePageAssets(
      pageContent.url,
      sourceSiteData.assets,
    );

    const imageAssets = pageAssets.filter(a => a.type === 'image');
    logger.info('rebuild-orchestration.page-assets-analyzed', {
      appId,
      pageSlug,
      pageUrl: pageContent.url,
      pageAssetCount: pageAssets.length,
      analyzedImageCount,
      // What the build prompt actually hands the agent for this page: source images with
      // their public /assets/ paths. If these are present but the rebuilt page uses Getty
      // slots, the agent ignored them (fidelity), not a delivery gap.
      imageAssetCount: imageAssets.length,
      imageAssetSample: imageAssets.slice(0, 6).map(a => normalizeAssetPath(a.localPath)),
    });

    return {
      assets: pageAssets,
      totalAssets: pageAssets.length,
      byType: {
        image: pageAssets.filter(a => a.type === 'image').length,
        font: pageAssets.filter(a => a.type === 'font').length,
        icon: pageAssets.filter(a => a.type === 'icon').length,
        other: pageAssets.filter(a => a.type === 'other').length,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  private async loadHomepageScreenshot(appId: string, pageSlug: string): Promise<string | undefined> {
    const screenshotPath = path.join(this.sourceSiteDir, 'screenshots', 'homepage.png');
    try {
      const raw = await readFile(screenshotPath);
      const { buffer: resized, mimeType } = await resizeForVision(raw, 'image/png');
      return `data:${mimeType};base64,${resized.toString('base64')}`;
    } catch {
      logger.info('rebuild-orchestration.homepage-screenshot-not-found', { appId, pageSlug });
      return undefined;
    }
  }

  private async runPagePromptAgent(
    appId: string,
    siteMetadata: SiteMetadata,
    pageContent: PageContent,
    stylePreferences: StylePreferences,
    pageAssetManifest: AssetManifest,
    isFirstPage: boolean,
    screenshotBase64: string | undefined,
  ): Promise<string> {
    // "keep-similar" is a faithful clone — gate the system prompt onto the
    // preserve fragment (no redesign/section-adding brief). Derived from the
    // same predicate the user-prompt design block keys off, so the two stay
    // in sync.
    const preserveDesign = shouldPreserveDesign(stylePreferences);
    const app = appRepo.findById(appId);
    const executionContext = {
      metadata: {
        appId,
        isRebuildFlow: true,
        ...(app?.subscriptionId && { subscriptionId: app.subscriptionId }),
        ...(app?.customerId && { customerId: app.customerId }),
      },
    };
    const promptAgent = new PagePromptAgent({ isFirstPage, useAtlasCrawler: this.useAtlas, preserveDesign });
    await promptAgent.initialize();
    try {
      return await promptAgent.generate(
        siteMetadata,
        pageContent,
        stylePreferences,
        pageAssetManifest,
        isFirstPage,
        screenshotBase64,
        executionContext,
      );
    } finally {
      await promptAgent.cleanup();
    }
  }
}

/**
 * Code-built structured handoff from rebuild → develop. No LLM judgment;
 * pure projection of the PagePromptAgent inputs into a typed schema.
 *
 * Asset paths are normalized to public paths (/assets/...) so spec
 * consumers can use them directly without re-deriving from on-disk
 * locations.
 */
export function buildPageSpec(
  pageSlug: string,
  pageContent: PageContent,
  siteMetadata: SiteMetadata,
  stylePreferences: StylePreferences,
  pageAssetManifest: AssetManifest,
  isFirstPage: boolean,
): PageBuildSpec {
  const normalizedAssets: SpecAssetManifest = {
    ...pageAssetManifest,
    assets: pageAssetManifest.assets.map(({ localPath, ...rest }) => ({
      ...rest,
      publicPath: normalizeAssetPath(localPath),
    })),
  };

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    page: {
      url: pageContent.url,
      slug: pageSlug,
      title: pageContent.title,
      isFirstPage,
      metadata: pageContent.metadata,
    },
    site: {
      sourceUrl: siteMetadata.sourceUrl,
      siteType: siteMetadata.siteType ?? 'content',
      sitePurpose: siteMetadata.sitePurpose,
      targetAudience: siteMetadata.targetAudience,
      brandVoice: siteMetadata.brandVoice,
      designStyle: siteMetadata.designStyle,
      colorPalette: siteMetadata.colorPalette,
      typography: siteMetadata.typography,
      ...(siteMetadata.contact ? { contact: siteMetadata.contact } : {}),
    },
    navigation: {
      primary: pageContent.structure.navigation,
      footer: siteMetadata.footerNavigation ?? [],
    },
    detectedPatterns: pageContent.structure.interactivePatterns ?? [],
    forms: pageContent.structure.forms ?? [],
    contentLinks: pageContent.structure.contentLinks ?? [],
    assets: normalizedAssets,
    stylePreferences,
    pageContent: {
      sanitizedContent: pageContent.sanitizedContent,
    },
  };
}
