import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkRebuildFontEditAllowed,
  isAllowedRebuildFontValue,
  isAppInRebuildFlow,
  validateNoHardcodedFonts,
} from '../validate-inline-font.js';
import { createStubWorkspaceFiles } from '../../../workspace/__tests__/test-workspace-files.js';

const { loadWorkflowStateMock, createForWorkspaceMock } = vi.hoisted(() => ({
  loadWorkflowStateMock: vi.fn(),
  createForWorkspaceMock: vi.fn(),
}));

vi.mock('../../../tools/ai-lib-tools/rebuild-page-selector.js', () => ({
  loadWorkflowState: (...args: unknown[]) => loadWorkflowStateMock(...args),
}));

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: (...args: unknown[]) => createForWorkspaceMock(...args),
}));

describe('rebuild validate-inline-font', function packageTests() {
  beforeEach(function reset() {
    vi.clearAllMocks();
  });

  describe('#isAllowedRebuildFontValue', function allowedValueTests() {
    it('allows CSS variable references', function cssVar() {
      expect(isAllowedRebuildFontValue('var(--font-heading)')).toBe(true);
      expect(isAllowedRebuildFontValue('var(--font-sans)')).toBe(true);
      expect(isAllowedRebuildFontValue('var(--font-heading), sans-serif')).toBe(true);
      expect(isAllowedRebuildFontValue('var(--font-heading) !important')).toBe(true);
    });

    it('allows CSS keywords and empty values', function keywords() {
      expect(isAllowedRebuildFontValue('inherit')).toBe(true);
      expect(isAllowedRebuildFontValue('unset')).toBe(true);
      expect(isAllowedRebuildFontValue('')).toBe(true);
    });

    it('rejects literal font names and unknown CSS vars', function literal() {
      expect(isAllowedRebuildFontValue('Inter')).toBe(false);
      expect(isAllowedRebuildFontValue('Inter !important')).toBe(false);
      expect(isAllowedRebuildFontValue('"Playfair Display", serif')).toBe(false);
      expect(isAllowedRebuildFontValue('var(--font-body)')).toBe(false);
    });
  });

  describe('#validateNoHardcodedFonts', function validateTests() {
    it('skips validation outside rebuild flow', function nonRebuild() {
      const result = validateNoHardcodedFonts(
        'style={{ fontFamily: "Inter" }}',
        'src/pages/Home.tsx',
        false,
      );
      expect(result.valid).toBe(true);
    });

    it('skips non-component files during rebuild', function nonComponent() {
      const result = validateNoHardcodedFonts(
        'font-family: Inter;',
        'src/styles/globals.css',
        true,
      );
      expect(result.valid).toBe(true);
    });

    it('blocks hardcoded fontFamily during rebuild', function blockFontFamily() {
      const result = validateNoHardcodedFonts(
        '<h1 style={{ fontFamily: "Bebas Neue" }}>Title</h1>',
        'src/pages/Home.tsx',
        true,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('FORBIDDEN during website rebuild');
    });

    it('blocks font-family longhand in tsx during rebuild', function blockFontFamilyCss() {
      const result = validateNoHardcodedFonts(
        'const styles = "font-family: Georgia, serif;"',
        'src/pages/Home.tsx',
        true,
      );
      expect(result.valid).toBe(false);
    });

    it('blocks font shorthand with quoted families during rebuild', function blockFontShorthand() {
      const result = validateNoHardcodedFonts(
        'style={{ font: \'700 16px "Bebas Neue", serif\' }}',
        'src/pages/Home.tsx',
        true,
      );
      expect(result.valid).toBe(false);
    });

    it('ignores TypeScript font object properties during rebuild', function ignoreTsFontField() {
      const result = validateNoHardcodedFonts(
        'interface Props { font: string }\nconst x = { font: theme.body }',
        'src/pages/Home.tsx',
        true,
      );
      expect(result.valid).toBe(true);
    });

    it('allows CSS variable fontFamily during rebuild', function allowVar() {
      const result = validateNoHardcodedFonts(
        '<h1 style={{ fontFamily: "var(--font-heading)" }}>Title</h1>',
        'src/pages/Home.tsx',
        true,
      );
      expect(result.valid).toBe(true);
    });

    it('blocks Tailwind arbitrary font classes during rebuild', function blockArbitrary() {
      const result = validateNoHardcodedFonts(
        '<p className="font-[Inter]">Body</p>',
        'src/components/Hero.tsx',
        true,
      );
      expect(result.valid).toBe(false);
    });

    it('allows Tailwind theme font utilities during rebuild', function allowThemeFont() {
      const result = validateNoHardcodedFonts(
        '<p className="font-sans sm:font-heading">Body</p>',
        'src/components/Hero.tsx',
        true,
      );
      expect(result.valid).toBe(true);
    });

    it('allows Tailwind arbitrary font-weight utilities during rebuild', function allowArbitraryWeight() {
      const result = validateNoHardcodedFonts(
        '<p className="font-[550] sm:font-[700]">Body</p>',
        'src/components/Hero.tsx',
        true,
      );
      expect(result.valid).toBe(true);
    });

    it('skips CSS font-family values with template interpolation', function skipInterpolation() {
      const result = validateNoHardcodedFonts(
        'const css = `font-family: ${theme.font};`',
        'src/pages/Home.tsx',
        true,
      );
      expect(result.valid).toBe(true);
    });

    it('blocks --font-heading overrides with literal values', function blockVarOverride() {
      const result = validateNoHardcodedFonts(
        'style={{ "--font-heading": "Georgia, serif" }}',
        'src/pages/Home.tsx',
        true,
      );
      expect(result.valid).toBe(false);
    });

    it('blocks bare --font-heading CSS custom property in tsx', function blockVarCss() {
      const result = validateNoHardcodedFonts(
        '--font-heading: Georgia, serif;',
        'src/pages/Home.tsx',
        true,
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('#checkRebuildFontEditAllowed', function checkTests() {
    it('blocks ast fontFamily edits during rebuild', function blockAst() {
      const result = checkRebuildFontEditAllowed('fontFamily', 'Inter', true);
      expect(result.allowed).toBe(false);
    });

    it('allows ast fontFamily CSS var edits during rebuild', function allowAst() {
      const result = checkRebuildFontEditAllowed('fontFamily', 'var(--font-heading)', true);
      expect(result.allowed).toBe(true);
    });

    it('allows ast color edits during rebuild', function allowColor() {
      const result = checkRebuildFontEditAllowed('color', '#ff0000', true);
      expect(result.allowed).toBe(true);
    });

    it('blocks unquoted fontFamily in newStyle during rebuild', function blockNewStyle() {
      const result = checkRebuildFontEditAllowed('color', '#000', true, 'fontFamily: Inter');
      expect(result.allowed).toBe(false);
    });

    it('blocks font-family in newStyle during rebuild', function blockNewStyleHyphen() {
      const result = checkRebuildFontEditAllowed('color', '#000', true, 'font-family: Inter');
      expect(result.allowed).toBe(false);
    });
  });

  describe('#isAppInRebuildFlow', function rebuildFlowTests() {
    it('returns true when workflow status is building', async function building() {
      createForWorkspaceMock.mockReturnValue({ files: createStubWorkspaceFiles() });
      loadWorkflowStateMock.mockResolvedValue({ status: 'building' });

      await expect(isAppInRebuildFlow('app1234567')).resolves.toBe(true);
    });

    it('returns false when workflow status is complete', async function complete() {
      createForWorkspaceMock.mockReturnValue({ files: createStubWorkspaceFiles() });
      loadWorkflowStateMock.mockResolvedValue({ status: 'complete' });

      await expect(isAppInRebuildFlow('app1234567')).resolves.toBe(false);
    });

    it('returns false when workspace is unavailable', async function noWorkspace() {
      createForWorkspaceMock.mockReturnValue(null);

      await expect(isAppInRebuildFlow('app1234567')).resolves.toBe(false);
    });
  });
});
