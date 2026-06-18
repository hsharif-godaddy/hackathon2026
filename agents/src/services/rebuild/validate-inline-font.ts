/**
 * Rebuild guard — best-effort defense-in-depth against hardcoded typography during
 * website rebuild (AIROBUILD-2650 / AIROBUILD-2587 P4).
 *
 * Covers JSX/CSS `fontFamily`, `font-family`, `font` shorthand, `--font-heading` /
 * `--font-sans` overrides, and Tailwind `font-[family]` arbitrary classes (numeric
 * `font-[550]` weight utilities are allowed). JSX variables and obfuscated values
 * are not caught; CSS `font-family` values with template interpolation (${...}) are skipped.
 */
import { Logger } from '../../logging/index.js';
import { loadWorkflowState } from '../../tools/ai-lib-tools/rebuild-page-selector.js';
import { createForWorkspace } from '../../workspace/index.js';

const logger = Logger.create({ component: 'rebuild-inline-font' });

const CSS_KEYWORD_VALUES = new Set(['inherit', 'unset', 'initial', 'revert', 'revert-layer']);

const ALLOWED_FONT_VAR = /^var\(\s*--font-(?:heading|sans)\b[^)]*\)(?:\s*,\s*[-\w\s"',]+)?$/i;

const FONT_FAMILY_JSX = /fontFamily\s*:\s*(['"])([^'"\n]*)\1/g;
const FONT_FAMILY_CSS = /font-family\s*:\s*([^;}\n]+)/gi;
const FONT_SHORTHAND_CSS = /\bfont\s*:\s*([^;}\n]+)/gi;
const FONT_VAR_JSX = /['"](--font-(?:heading|sans))['"]\s*:\s*(['"])([^'"\n]*)\2/g;
const FONT_VAR_CSS = /(--font-(?:heading|sans))\s*:\s*([^;}\n]+)/gi;
const TAILWIND_ARBITRARY_FONT = /\b(?:\w+:)*font-\[[^\]]+\]/g;

/** CSS font shorthand values include a size (16px) and/or quoted family names. */
function looksLikeCssFontShorthand(value: string): boolean {
  return /\d+\.?\d*\s*(px|rem|em|%|pt|vh|vw|ch|ex)\b/i.test(value) || /['"]/.test(value);
}

function normalizeFontValue(value: string): string {
  return value.replace(/\s*!important\s*$/i, '').trim();
}

export function isAllowedRebuildFontValue(value: string): boolean {
  const trimmed = normalizeFontValue(value);
  if (!trimmed) {
    return true;
  }
  if (CSS_KEYWORD_VALUES.has(trimmed.toLowerCase())) {
    return true;
  }
  return ALLOWED_FONT_VAR.test(trimmed);
}

function isAllowedFontShorthand(value: string): boolean {
  const trimmed = normalizeFontValue(value);
  if (!trimmed || CSS_KEYWORD_VALUES.has(trimmed.toLowerCase())) {
    return true;
  }
  return /var\(\s*--font-(?:heading|sans)\b/.test(trimmed);
}

function parseInlineStyleDeclarations(styleString: string): Record<string, string> {
  const styles: Record<string, string> = {};
  for (const declaration of styleString.split(';').filter((decl) => decl.trim())) {
    const colonIndex = declaration.indexOf(':');
    if (colonIndex === -1) {
      continue;
    }
    const property = declaration.slice(0, colonIndex).trim();
    const value = declaration.slice(colonIndex + 1).trim();
    if (property && value) {
      styles[property] = value;
    }
  }
  return styles;
}

function isTailwindArbitraryFontWeightClass(token: string): boolean {
  const inner = token.match(/font-\[([^\]]+)\]/)?.[1]?.trim();
  return inner !== undefined && /^\d+(?:\.\d+)?$/.test(inner);
}

function collectFontPropertyViolation(property: string, value: string): string | null {
  if (value.includes('${')) {
    return null;
  }
  if (property === 'fontFamily' || property === 'font-family') {
    if (!isAllowedRebuildFontValue(value)) {
      return `${property}: ${value.trim()}`;
    }
    return null;
  }

  if (property === '--font-heading' || property === '--font-sans') {
    if (!isAllowedRebuildFontValue(value)) {
      return `${property}: ${value.trim()}`;
    }
    return null;
  }

  if (property === 'font') {
    if (!looksLikeCssFontShorthand(value)) {
      return null;
    }
    if (!isAllowedFontShorthand(value)) {
      return `font: ${value.trim()}`;
    }
    return null;
  }

  return null;
}

function collectViolationsFromParsedStyles(styles: Record<string, string>): string[] {
  const violations: string[] = [];
  for (const [property, value] of Object.entries(styles)) {
    const violation = collectFontPropertyViolation(property, value);
    if (violation) {
      violations.push(violation);
    }
  }
  return violations;
}

function collectViolationsFromStyleString(styleString: string): string[] {
  return collectViolationsFromParsedStyles(parseInlineStyleDeclarations(styleString));
}

function buildForbiddenMessage(violations: string[]): string {
  const examples = [...new Set(violations)].slice(0, 3).join('; ');
  return `FORBIDDEN during website rebuild: Do not hardcode fontFamily on components. Source typography is already applied via CSS variables in globals.css.

Found: ${examples}

Use var(--font-heading) or var(--font-sans) in inline styles, or Tailwind utilities font-sans / font-heading (not font-[...] arbitrary values). Do not call fontTheme during rebuild.`;
}

function logBlocked(details: Record<string, unknown>): void {
  logger.warn('rebuild.inlineFont.blocked', details);
}

function collectViolations(content: string): string[] {
  const violations: string[] = [];

  for (const match of content.matchAll(FONT_FAMILY_JSX)) {
    const value = match[2];
    if (value !== undefined) {
      const violation = collectFontPropertyViolation('fontFamily', value);
      if (violation) {
        violations.push(violation);
      }
    }
  }

  for (const match of content.matchAll(FONT_FAMILY_CSS)) {
    const value = match[1];
    if (value !== undefined) {
      const violation = collectFontPropertyViolation('font-family', value);
      if (violation) {
        violations.push(violation);
      }
    }
  }

  for (const match of content.matchAll(FONT_SHORTHAND_CSS)) {
    const value = match[1];
    if (value !== undefined) {
      const violation = collectFontPropertyViolation('font', value);
      if (violation) {
        violations.push(violation);
      }
    }
  }

  for (const match of content.matchAll(FONT_VAR_JSX)) {
    const property = match[1];
    const value = match[3];
    if (property !== undefined && value !== undefined) {
      const violation = collectFontPropertyViolation(property, value);
      if (violation) {
        violations.push(violation);
      }
    }
  }

  for (const match of content.matchAll(FONT_VAR_CSS)) {
    const property = match[1];
    const value = match[2];
    if (property !== undefined && value !== undefined) {
      const violation = collectFontPropertyViolation(property, value);
      if (violation) {
        violations.push(violation);
      }
    }
  }

  for (const match of content.matchAll(TAILWIND_ARBITRARY_FONT)) {
    if (!isTailwindArbitraryFontWeightClass(match[0])) {
      violations.push(match[0]);
    }
  }

  return violations;
}

export function validateNoHardcodedFonts(
  content: string,
  filePath: string,
  isRebuildFlow: boolean,
): { valid: boolean; error?: string } {
  if (!isRebuildFlow) {
    return { valid: true };
  }

  if (!/\.(tsx|jsx)$/i.test(filePath)) {
    return { valid: true };
  }

  const violations = collectViolations(content);
  if (violations.length === 0) {
    return { valid: true };
  }

  logBlocked({ filePath, violations: violations.slice(0, 3), source: 'text-editor' });

  return {
    valid: false,
    error: buildForbiddenMessage(violations),
  };
}

export function checkRebuildFontEditAllowed(
  property: string,
  value: string,
  isRebuildFlow: boolean | undefined,
  newStyle?: string,
): { allowed: boolean; error?: string } {
  if (!isRebuildFlow) {
    return { allowed: true };
  }

  const violations: string[] = [];

  const propertyViolation = collectFontPropertyViolation(property, value);
  if (propertyViolation) {
    violations.push(propertyViolation);
  }

  if (newStyle) {
    violations.push(...collectViolationsFromStyleString(newStyle));
  }

  if (violations.length === 0) {
    return { allowed: true };
  }

  logBlocked({ property, violations: violations.slice(0, 3), source: 'ast-style-editor' });

  return {
    allowed: false,
    error: violations.some((v) => v.startsWith('fontFamily') || v.startsWith('font-family') || v.startsWith('font:'))
      ? `Hardcoded fontFamily is not allowed during website rebuild. Use var(--font-heading) or var(--font-sans).`
      : buildForbiddenMessage(violations),
  };
}

export async function isAppInRebuildFlow(appId: string): Promise<boolean> {
  const workspace = createForWorkspace(appId, 'preview');
  if (!workspace) {
    return false;
  }

  const state = await loadWorkflowState(workspace.files);
  return state?.status === 'building';
}
