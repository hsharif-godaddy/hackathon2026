import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RebuildOrchestrationService } from '../RebuildOrchestrationService.js';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../logging/index.js', () => ({
  Logger: {
    create: () => mockLogger,
  },
}));

describe('RebuildOrchestrationService upfront build', () => {
  let appDir: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    appDir = await mkdtemp(path.join(tmpdir(), 'rebuild-upfront-'));
  });

  afterEach(async () => {
    await rm(appDir, { recursive: true, force: true });
  });

  async function writeWorkflow(scope: 'homepage_only' | 'small' | 'large') {
    const sourceSiteDir = path.join(appDir, '.source-site');
    await mkdir(sourceSiteDir, { recursive: true });
    await writeFile(
      path.join(sourceSiteDir, 'workflow-state.json'),
      JSON.stringify({
        appId: 'app-123',
        sourceUrl: 'https://example.com',
        rootPath: '/',
        status: 'building',
        rebuildScope: scope,
        intakeCompleted: true,
        scrapingProgress: { total: 3, completed: 3 },
        pagesBuilt: [],
        currentPage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      'utf-8',
    );
    await writeFile(
      path.join(sourceSiteDir, 'sitemap.json'),
      JSON.stringify({
        pages: [
          { url: 'https://example.com/about', slug: 'about', scraped: true, source: 'crawl' },
          { url: 'https://example.com/', slug: 'homepage', scraped: true, source: 'crawl' },
          { url: 'https://example.com/contact', slug: 'contact', scraped: true, source: 'crawl' },
        ],
        totalPages: 3,
        discoveredAt: new Date().toISOString(),
      }),
      'utf-8',
    );
  }

  it('getUpfrontBuildSlugs orders homepage first and caps by small scope', async () => {
    await writeWorkflow('small');
    const service = new RebuildOrchestrationService(appDir);
    await expect(service.getUpfrontBuildSlugs('app-123')).resolves.toEqual([
      'homepage',
      'about',
      'contact',
    ]);
  });

  it('getUpfrontBuildSlugs returns only homepage for homepage_only scope', async () => {
    await writeWorkflow('homepage_only');
    const service = new RebuildOrchestrationService(appDir);
    await expect(service.getUpfrontBuildSlugs('app-123')).resolves.toEqual(['homepage']);
  });

  it('buildUpfrontPagePrompts generates only the homepage prompt', async () => {
    await writeWorkflow('small');
    const service = new RebuildOrchestrationService(appDir);
    const buildPage = vi.spyOn(service, 'buildPage').mockResolvedValue('prompt');

    await expect(service.buildUpfrontPagePrompts('app-123')).resolves.toEqual({
      slugs: ['homepage', 'about', 'contact'],
      homepagePrompt: 'prompt',
    });
    expect(buildPage).toHaveBeenCalledTimes(1);
    expect(buildPage).toHaveBeenCalledWith('app-123', 'homepage');
  });

  it('getUpfrontBuildSlugs logs parse failure separately from missing sitemap', async () => {
    await writeWorkflow('small');
    const sourceSiteDir = path.join(appDir, '.source-site');
    await writeFile(path.join(sourceSiteDir, 'sitemap.json'), '{invalid', 'utf-8');
    const service = new RebuildOrchestrationService(appDir);

    await expect(service.getUpfrontBuildSlugs('app-123')).resolves.toEqual(['homepage']);
    expect(mockLogger.error).toHaveBeenCalledWith(
      'rebuild-orchestration.upfront-slugs-sitemap-parse-failed',
      expect.objectContaining({ appId: 'app-123' }),
    );
  });

  it('buildUpfrontPagePrompts warns when homepage prompt stays empty', async () => {
    await writeWorkflow('small');
    const service = new RebuildOrchestrationService(appDir);
    vi.spyOn(service, 'buildPage').mockResolvedValue('');

    await service.buildUpfrontPagePrompts('app-123');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'rebuild-orchestration.upfront-build-empty-homepage-prompt',
      expect.objectContaining({ appId: 'app-123' }),
    );
  });
});
