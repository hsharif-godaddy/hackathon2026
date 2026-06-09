import { describe, it, expect, vi } from 'vitest';

import { resolveRebuildBuildPagePrompt, type RebuildBuildPageDeps } from '../rebuild-build-page-message.js';

function deps(overrides: Partial<RebuildBuildPageDeps> = {}): RebuildBuildPageDeps {
  return {
    findAppPath: vi.fn().mockReturnValue('/apps/app-1'),
    buildPage: vi.fn().mockResolvedValue({
      prompt: 'SOURCE PAGE PROMPT',
      sourceUrl: 'https://example.com/about',
      pageTitle: 'About',
      imageCount: 3,
    }),
    ...overrides,
  };
}

describe('resolveRebuildBuildPagePrompt', () => {
  it('returns the built page prompt when slug + appId are present', async () => {
    const d = deps();
    const result = await resolveRebuildBuildPagePrompt(
      { metadata: { appId: 'app-1', rebuildBuildPageSlug: 'about' } },
      d,
    );
    expect(result?.prompt).toBe('SOURCE PAGE PROMPT');
    expect(d.buildPage).toHaveBeenCalledWith('/apps/app-1', 'app-1', 'about');
  });

  it('returns undefined when there is no rebuildBuildPageSlug', async () => {
    const d = deps();
    const result = await resolveRebuildBuildPagePrompt({ metadata: { appId: 'app-1' } }, d);
    expect(result).toBeUndefined();
    expect(d.buildPage).not.toHaveBeenCalled();
  });

  it('returns undefined when context/metadata is missing', async () => {
    expect(await resolveRebuildBuildPagePrompt(undefined, deps())).toBeUndefined();
    expect(await resolveRebuildBuildPagePrompt({}, deps())).toBeUndefined();
  });

  it('returns undefined (no build) when appId is missing', async () => {
    const d = deps();
    const result = await resolveRebuildBuildPagePrompt(
      { metadata: { rebuildBuildPageSlug: 'about' } },
      d,
    );
    expect(result).toBeUndefined();
    expect(d.buildPage).not.toHaveBeenCalled();
  });

  it('returns undefined when the app path cannot be resolved', async () => {
    const d = deps({ findAppPath: vi.fn().mockReturnValue(undefined) });
    const result = await resolveRebuildBuildPagePrompt(
      { metadata: { appId: 'missing', rebuildBuildPageSlug: 'about' } },
      d,
    );
    expect(result).toBeUndefined();
    expect(d.buildPage).not.toHaveBeenCalled();
  });

  it('falls back to undefined when buildPage throws (e.g. source missing)', async () => {
    const d = deps({ buildPage: vi.fn().mockRejectedValue(new Error('Page not found: about')) });
    const result = await resolveRebuildBuildPagePrompt(
      { metadata: { appId: 'app-1', rebuildBuildPageSlug: 'about' } },
      d,
    );
    expect(result).toBeUndefined();
  });
});

describe('resolveRebuildBuildPagePrompt confirmation', () => {
  it('returns prompt + confirmation carrying source metadata from the build result', async () => {
    const d = {
      findAppPath: () => '/tmp/app',
      buildPage: async () => ({
        prompt: 'SOURCE PAGE PROMPT',
        // pageTitle is the scraped title (not slug-derived) — it flows through verbatim
        sourceUrl: 'https://example.com/contact-us',
        pageTitle: 'Get in Touch',
        imageCount: 5,
      }),
    };
    const result = await resolveRebuildBuildPagePrompt(
      { metadata: { appId: 'app123', rebuildBuildPageSlug: 'contact-us' } },
      d,
    );
    expect(result).toEqual({
      prompt: 'SOURCE PAGE PROMPT',
      confirmation: {
        pageSlug: 'contact-us',
        pageTitle: 'Get in Touch',
        sourceUrl: 'https://example.com/contact-us',
        imageCount: 5,
      },
    });
  });

  it('returns undefined when the slug is absent', async () => {
    const result = await resolveRebuildBuildPagePrompt({ metadata: { appId: 'app123' } });
    expect(result).toBeUndefined();
  });

  it('returns undefined when the source build throws', async () => {
    const d = {
      findAppPath: () => '/tmp/app',
      buildPage: async () => { throw new Error('source JSON missing'); },
    };
    const result = await resolveRebuildBuildPagePrompt(
      { metadata: { appId: 'app123', rebuildBuildPageSlug: 'about' } },
      d,
    );
    expect(result).toBeUndefined();
  });
});
