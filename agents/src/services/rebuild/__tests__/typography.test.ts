import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GoogleFontEntry } from '@airo/shared/fonts';
import type { SiteMetadata, StylePreferences } from '../../../types/rebuild.js';

const {
  updateCssFontVariablesMock,
  validateFontPairingMock,
  loadGoogleFontsCatalogMock,
  clampWeightsToAvailableMock,
  createForWorkspaceMock,
  memorySetMock,
  appPlanExecuteMock,
  syncBrandTokensCssMock,
  findByIdMock,
} = vi.hoisted(() => ({
  updateCssFontVariablesMock: vi.fn(),
  validateFontPairingMock: vi.fn(),
  loadGoogleFontsCatalogMock: vi.fn(),
  clampWeightsToAvailableMock: vi.fn(),
  createForWorkspaceMock: vi.fn(),
  memorySetMock: vi.fn(),
  appPlanExecuteMock: vi.fn(),
  syncBrandTokensCssMock: vi.fn(),
  findByIdMock: vi.fn(),
}));

vi.mock('@airo/shared/fonts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@airo/shared/fonts')>();
  return {
    ...actual,
    loadGoogleFontsCatalog: (...args: unknown[]) => loadGoogleFontsCatalogMock(...args),
    clampWeightsToAvailable: (...args: unknown[]) => clampWeightsToAvailableMock(...args),
  };
});

vi.mock('../../../tools/ai-lib-tools/font-theme.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../tools/ai-lib-tools/font-theme.js')>();
  return {
    ...actual,
    updateCssFontVariables: (...args: unknown[]) => updateCssFontVariablesMock(...args),
    validateFontPairing: (...args: unknown[]) => validateFontPairingMock(...args),
  };
});

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: (...args: unknown[]) => createForWorkspaceMock(...args),
}));

vi.mock('../../../memory/adapters/index.js', () => ({
  getKvMemoryStore: () => ({ set: memorySetMock }),
}));

vi.mock('../../../tools/app-plan-tool.js', () => ({
  appPlanTool: { execute: (...args: unknown[]) => appPlanExecuteMock(...args) },
}));

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn(function appRepository() {
    return { findById: findByIdMock };
  }),
}));

vi.mock('../../design-system/brand-tokens-css.js', () => ({
  syncBrandTokensCss: (...args: unknown[]) => syncBrandTokensCssMock(...args),
}));

import {
  applyRebuildTypography,
  categoryForGenericFontName,
  findCatalogFont,
  normalizeFontName,
  shouldApplyRebuildTypography,
  themedCatalogFallback,
} from '../typography.js';
import { detectFontCategory } from '../../../tools/ai-lib-tools/font-theme.js';
import { createStubWorkspaceFiles } from '../../../workspace/__tests__/test-workspace-files.js';

const sampleCatalog: GoogleFontEntry[] = [
  { family: 'Cormorant Garamond', category: 'serif', weights: ['400', '600', '700'], tags: [] },
  { family: 'Lora', category: 'serif', weights: ['400', '500', '600', '700'], tags: [] },
  { family: 'Inter', category: 'sans-serif', weights: ['400', '500', '600', '700'], tags: [] },
];

const keepOriginalPrefs: StylePreferences = {
  designDirection: 'keep-similar',
  colorPreference: 'keep-original',
  typographyStyle: 'keep-original',
  layoutApproach: 'responsive',
};

const typography: SiteMetadata['typography'] = {
  headingFonts: ['Cormorant Garamond'],
  bodyFonts: ['Lora'],
};

describe('rebuild-typography', function packageTests() {
  beforeEach(function reset() {
    vi.clearAllMocks();
    loadGoogleFontsCatalogMock.mockResolvedValue(sampleCatalog);
    clampWeightsToAvailableMock.mockImplementation(async (_family: string, weights: string[]) => weights);
    validateFontPairingMock.mockResolvedValue({ valid: true, networkError: false });
    updateCssFontVariablesMock.mockResolvedValue({ success: true, message: 'ok' });
    createForWorkspaceMock.mockReturnValue({ files: createStubWorkspaceFiles({ readText: vi.fn().mockResolvedValue('') }) });
    memorySetMock.mockResolvedValue({ success: true });
    appPlanExecuteMock.mockResolvedValue({ success: true });
    syncBrandTokensCssMock.mockResolvedValue(undefined);
    findByIdMock.mockReturnValue({ customerId: 'cust-1' });
  });

  describe('#shouldApplyRebuildTypography', function shouldApplyTests() {
    it('returns true for first-page keep-original with fonts', function firstPageKeepOriginal() {
      expect(shouldApplyRebuildTypography(true, keepOriginalPrefs, typography)).toBe(true);
    });

    it('returns false for inner pages', function innerPage() {
      expect(shouldApplyRebuildTypography(false, keepOriginalPrefs, typography)).toBe(false);
    });

    it('returns false when typography style is not keep-original', function modernStyle() {
      expect(
        shouldApplyRebuildTypography(true, { ...keepOriginalPrefs, typographyStyle: 'modern' }, typography),
      ).toBe(false);
    });

    it('returns false when heading and body font arrays are empty', function emptyFontArrays() {
      expect(
        shouldApplyRebuildTypography(true, keepOriginalPrefs, { headingFonts: [], bodyFonts: [] }),
      ).toBe(false);
    });
  });

  describe('#normalizeFontName', function normalizeTests() {
    it('strips wrapping quotes', function stripsQuotes() {
      expect(normalizeFontName('"Cormorant Garamond"')).toBe('Cormorant Garamond');
    });

    it('strips control characters', function stripsControlChars() {
      expect(normalizeFontName('Inter\u0007')).toBe('Inter');
    });
  });

  describe('#categoryForGenericFontName', function genericCategoryTests() {
    it('maps bare serif keyword to serif category', function bareSerif() {
      expect(categoryForGenericFontName('serif')).toBe('serif');
    });

    it('maps bare sans-serif keyword to sans-serif category', function bareSansSerif() {
      expect(categoryForGenericFontName('sans-serif')).toBe('sans-serif');
    });
  });

  describe('#detectFontCategory', function detectCategoryTests() {
    it('does not classify bare serif keyword as serif', function bareSerifMisclassified() {
      expect(detectFontCategory('serif')).toBe('sans-serif');
    });
  });

  describe('#findCatalogFont', function findCatalogTests() {
    it('exact-matches Google Font families', function exactMatch() {
      const result = findCatalogFont('Cormorant Garamond', sampleCatalog);
      expect(result.entry.family).toBe('Cormorant Garamond');
      expect(result.substituted).toBe(false);
    });

    it('substitutes generic serif with Lora using generic category map', function genericSerif() {
      const result = findCatalogFont('serif', sampleCatalog);
      expect(result.entry.family).toBe('Lora');
      expect(result.substituted).toBe(true);
    });

    it('substitutes generic sans-serif with Inter', function genericSansSerif() {
      const result = findCatalogFont('sans-serif', sampleCatalog);
      expect(result.entry.family).toBe('Inter');
      expect(result.substituted).toBe(true);
    });

    it('partial-matches shorter names to catalog families', function partialMatch() {
      const result = findCatalogFont('Cormorant', sampleCatalog);
      expect(result.entry.family).toBe('Cormorant Garamond');
      expect(result.substituted).toBe(true);
    });

    it('exact-matches generic-named catalog entries before category fallback', function genericNameExactMatch() {
      const catalogWithGeorgia: GoogleFontEntry[] = [
        ...sampleCatalog,
        { family: 'Georgia', category: 'serif', weights: ['400', '700'], tags: [] },
      ];
      const result = findCatalogFont('Georgia', catalogWithGeorgia);
      expect(result.entry.family).toBe('Georgia');
      expect(result.substituted).toBe(false);
    });
  });

  describe('#themedCatalogFallback', function themedFallbackTests() {
    it('returns undefined for serif when Lora is absent from the catalog', function serifWithoutLora() {
      const catalogWithoutLora: GoogleFontEntry[] = [
        { family: 'Cormorant Garamond', category: 'serif', weights: ['400', '600'], tags: [] },
        { family: 'Inter', category: 'sans-serif', weights: ['400', '500'], tags: [] },
      ];
      expect(themedCatalogFallback(catalogWithoutLora, 'serif')).toBeUndefined();
    });

    it('returns undefined for sans-serif when Inter is absent from the catalog', function sansSerifWithoutInter() {
      const catalogWithoutInter: GoogleFontEntry[] = [
        { family: 'Lora', category: 'serif', weights: ['400', '600'], tags: [] },
        { family: 'Roboto', category: 'sans-serif', weights: ['400', '500'], tags: [] },
      ];
      expect(themedCatalogFallback(catalogWithoutInter, 'sans-serif')).toBeUndefined();
    });

    it('uses first category match when themed fallback is unavailable', function categoryMatchWhenThemedMissing() {
      const catalogWithoutLora: GoogleFontEntry[] = [
        { family: 'Cormorant Garamond', category: 'serif', weights: ['400', '600'], tags: [] },
        { family: 'Inter', category: 'sans-serif', weights: ['400', '500'], tags: [] },
      ];
      const result = findCatalogFont('serif', catalogWithoutLora);
      expect(result.entry.family).toBe('Cormorant Garamond');
      expect(result.substituted).toBe(true);
    });
  });

  describe('#applyRebuildTypography', function applyTests() {
    it('writes CSS variables and persists typography on first-page rebuild', async function appliesFonts() {
      const result = await applyRebuildTypography('app1234567', typography, keepOriginalPrefs, true);

      expect(result.applied).toBe(true);
      if (!result.applied) throw new Error('expected applied');
      expect(result.headerFont).toBe('Cormorant Garamond');
      expect(result.bodyFont).toBe('Lora');
      expect(updateCssFontVariablesMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: 'Cormorant Garamond' }),
        expect.objectContaining({ name: 'Lora' }),
      );
      expect(memorySetMock).toHaveBeenCalled();
      expect(appPlanExecuteMock).toHaveBeenCalled();
      expect(syncBrandTokensCssMock).toHaveBeenCalledWith('app1234567', 'cust-1', expect.anything());
    });

    it('logs substitution when generic font names are resolved', async function substitutesGeneric() {
      const result = await applyRebuildTypography(
        'app1234567',
        { headingFonts: ['serif'], bodyFonts: ['sans-serif'] },
        keepOriginalPrefs,
        true,
      );

      expect(result.applied).toBe(true);
      if (!result.applied) throw new Error('expected applied');
      expect(result.substitutions?.length).toBe(2);
      expect(result.headerFont).toBe('Lora');
      expect(result.bodyFont).toBe('Inter');
    });

    it('skips when not first page', async function skipsInnerPage() {
      const result = await applyRebuildTypography('app1234567', typography, keepOriginalPrefs, false);
      expect(result).toEqual({ applied: false, reason: 'not_applicable' });
      expect(updateCssFontVariablesMock).not.toHaveBeenCalled();
    });

    it('returns no_fonts_detected when names are blank after normalization', async function noFontsDetected() {
      const result = await applyRebuildTypography(
        'app1234567',
        { headingFonts: ['   '], bodyFonts: [''] },
        keepOriginalPrefs,
        true,
      );

      expect(result).toEqual({ applied: false, reason: 'no_fonts_detected' });
      expect(updateCssFontVariablesMock).not.toHaveBeenCalled();
    });

    it('returns workspace_unavailable when preview workspace is missing', async function workspaceUnavailable() {
      createForWorkspaceMock.mockReturnValue(null);

      const result = await applyRebuildTypography('app1234567', typography, keepOriginalPrefs, true);

      expect(result).toEqual({ applied: false, reason: 'workspace_unavailable' });
      expect(updateCssFontVariablesMock).not.toHaveBeenCalled();
    });

    it('returns catalog_load_failed when catalog load throws', async function catalogLoadFailed() {
      loadGoogleFontsCatalogMock.mockRejectedValue(new Error('network down'));

      const result = await applyRebuildTypography('app1234567', typography, keepOriginalPrefs, true);

      expect(result).toEqual({ applied: false, reason: 'catalog_load_failed' });
      expect(updateCssFontVariablesMock).not.toHaveBeenCalled();
    });

    it('returns catalog_load_failed when catalog is empty', async function catalogEmpty() {
      loadGoogleFontsCatalogMock.mockResolvedValue([]);

      const result = await applyRebuildTypography('app1234567', typography, keepOriginalPrefs, true);

      expect(result).toEqual({ applied: false, reason: 'catalog_load_failed' });
      expect(updateCssFontVariablesMock).not.toHaveBeenCalled();
    });

    it('returns validation_failed when pairing is invalid', async function validationFailed() {
      validateFontPairingMock.mockResolvedValue({ valid: false, networkError: false });

      const result = await applyRebuildTypography('app1234567', typography, keepOriginalPrefs, true);

      expect(result.applied).toBe(false);
      if (result.applied) throw new Error('expected not applied');
      expect(result.reason).toBe('validation_failed');
      expect(result.headerFont).toBe('Cormorant Garamond');
      expect(result.bodyFont).toBe('Lora');
      expect(updateCssFontVariablesMock).not.toHaveBeenCalled();
    });

    it('proceeds when validation hits a network error', async function validationNetworkFailOpen() {
      validateFontPairingMock.mockResolvedValue({ valid: false, networkError: true });

      const result = await applyRebuildTypography('app1234567', typography, keepOriginalPrefs, true);

      expect(result.applied).toBe(true);
      expect(updateCssFontVariablesMock).toHaveBeenCalled();
    });

    it('returns css_update_failed when CSS write fails', async function cssUpdateFailed() {
      updateCssFontVariablesMock.mockResolvedValue({ success: false, message: 'missing globals.css' });

      const result = await applyRebuildTypography('app1234567', typography, keepOriginalPrefs, true);

      expect(result).toEqual({ applied: false, reason: 'css_update_failed' });
      expect(memorySetMock).not.toHaveBeenCalled();
    });

    it('still applies when memory and app plan persistence fail', async function persistenceFailureTolerance() {
      memorySetMock.mockRejectedValue(new Error('memory down'));
      appPlanExecuteMock.mockRejectedValue(new Error('plan down'));

      const result = await applyRebuildTypography('app1234567', typography, keepOriginalPrefs, true);

      expect(result.applied).toBe(true);
      if (!result.applied) throw new Error('expected applied');
      expect(updateCssFontVariablesMock).toHaveBeenCalled();
    });

    it('still applies when brand token sync fails', async function brandTokensSyncFailureTolerance() {
      syncBrandTokensCssMock.mockRejectedValue(new Error('sync down'));

      const result = await applyRebuildTypography('app1234567', typography, keepOriginalPrefs, true);

      expect(result.applied).toBe(true);
      if (!result.applied) throw new Error('expected applied');
      expect(updateCssFontVariablesMock).toHaveBeenCalled();
    });
  });
});
