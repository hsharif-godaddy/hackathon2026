/**
 * Static eval (AIROBUILD-2715): the color bring-over lever (applyRebuildColors)
 * must deterministically gate on `colorPreference` and on whether the source
 * palette is non-empty.
 *
 * All assertions are deterministic — no LLM, no provider keys. The behavioral
 * counterpart (colors actually rendered in the final CSS) is verified via E2E.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { applyRebuildColors } from '../services/rebuild/apply-rebuild-colors.js';
import { updateCssColors } from '../tools/css-color-tool.js';
import type { SiteMetadata, StylePreferences } from '../types/rebuild.js';

vi.mock('../tools/css-color-tool.js', () => ({
  generatePalette: vi.fn(() => ({})),
  updateCssColors: vi.fn(async () => undefined),
}));

vi.mock('../workspace/index.js', () => ({
  createForWorkspace: vi.fn(() => ({ files: {} })),
}));

function metadataWith(primary: string[]): Pick<SiteMetadata, 'colorPalette'> {
  return { colorPalette: { primary, secondary: [], accent: [] } } as any;
}

function prefs(colorPreference: StylePreferences['colorPreference']): StylePreferences {
  return {
    designDirection: 'keep-similar',
    colorPreference,
    typographyStyle: 'keep-original',
    layoutApproach: 'responsive',
    keepLogo: true,
    keepSourceImages: true,
  } as StylePreferences;
}

describe('eval dimension: color-match (AIROBUILD-2715)', () => {
  beforeEach(() => {
    vi.mocked(updateCssColors).mockResolvedValue(undefined);
  });

  // colorPreference: 'keep-original' + palette present → colors applied
  it('keep-original with palette → applied: true (lever fires)', async () => {
    const result = await applyRebuildColors('app1', metadataWith(['#3a7bd5']) as SiteMetadata, prefs('keep-original'), true);
    expect(result.applied).toBe(true);
    expect(vi.mocked(updateCssColors)).toHaveBeenCalled();
  });

  // colorPreference: 'suggest-new' → colors NOT applied regardless of palette
  it('suggest-new → applied: false (lever skipped)', async () => {
    const result = await applyRebuildColors('app1', metadataWith(['#3a7bd5']) as SiteMetadata, prefs('suggest-new'), true);
    expect(result.applied).toBe(false);
    expect(vi.mocked(updateCssColors)).not.toHaveBeenCalled();
  });

  // keep-original but empty palette → colors NOT applied (nothing to copy)
  it('keep-original with empty palette → applied: false (no source colors)', async () => {
    const result = await applyRebuildColors('app1', metadataWith([]) as SiteMetadata, prefs('keep-original'), true);
    expect(result.applied).toBe(false);
  });

  // Degraded path: updateCssColors write failure → applied: false (not a hard error)
  it('write failure → applied: false, does not throw', async () => {
    vi.mocked(updateCssColors).mockRejectedValueOnce(new Error('disk full'));
    const result = await applyRebuildColors('app1', metadataWith(['#3a7bd5']) as SiteMetadata, prefs('keep-original'), true);
    expect(result.applied).toBe(false);
  });
});
