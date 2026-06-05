import { describe, it, expect, vi } from 'vitest';

import { resolveRebuildBuildPagePrompt, type RebuildBuildPageDeps } from '../rebuild-build-page-message.js';

function deps(overrides: Partial<RebuildBuildPageDeps> = {}): RebuildBuildPageDeps {
  return {
    findAppPath: vi.fn().mockReturnValue('/apps/app-1'),
    buildPage: vi.fn().mockResolvedValue('SOURCE PAGE PROMPT'),
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
    expect(result).toBe('SOURCE PAGE PROMPT');
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
