/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getFontList, primaryFontName } from '../getFontList';

describe('primaryFontName', () => {
  it('extracts the first non-generic font name', () => {
    expect(primaryFontName('"Playfair Display", ui-serif, Georgia, serif')).toBe('Playfair Display');
  });

  it('skips vendor-prefixed names', () => {
    expect(primaryFontName('-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif')).toBe('Segoe UI');
  });

  it('skips ui- prefixed keywords', () => {
    expect(primaryFontName('ui-sans-serif, system-ui, Inter, sans-serif')).toBe('Inter');
  });

  it('skips generic families', () => {
    expect(primaryFontName('system-ui, sans-serif, Arial')).toBe('Arial');
  });

  it('returns first entry cleaned when all are generic', () => {
    expect(primaryFontName('sans-serif')).toBe('sans-serif');
  });

  it('handles single unquoted font', () => {
    expect(primaryFontName('Inter')).toBe('Inter');
  });

  it('strips quotes from font names', () => {
    expect(primaryFontName("'Open Sans', sans-serif")).toBe('Open Sans');
  });

  it('handles empty string', () => {
    expect(primaryFontName('')).toBe('');
  });
});

describe('getFontList', () => {
  let originalGetComputedStyle: typeof window.getComputedStyle;

  beforeEach(() => {
    originalGetComputedStyle = window.getComputedStyle;
  });

  afterEach(() => {
    window.getComputedStyle = originalGetComputedStyle;
    document.documentElement.style.cssText = '';
  });

  function mockCSSVars(vars: Record<string, string>) {
    window.getComputedStyle = () => ({
      getPropertyValue: (prop: string) => vars[prop] || '',
    }) as unknown as CSSStyleDeclaration;
  }

  it('returns theme fonts from CSS vars', () => {
    mockCSSVars({
      '--font-heading': '"Playfair Display", serif',
      '--font-sans': 'Inter, sans-serif',
    });

    const { theme, custom } = getFontList();
    expect(theme).toHaveLength(2);
    expect(theme[0]).toEqual({
      label: 'Heading — Playfair Display',
      value: '"Playfair Display", serif',
    });
    expect(theme[1]).toEqual({
      label: 'Body — Inter',
      value: 'Inter, sans-serif',
    });
    expect(custom.length).toBeGreaterThan(0);
  });

  it('deduplicates fonts with same computed value', () => {
    mockCSSVars({
      '--font-heading': 'Inter, sans-serif',
      '--font-sans': 'Inter, sans-serif',
    });

    const { theme } = getFontList();
    expect(theme).toHaveLength(1);
    expect(theme[0].label).toBe('Heading — Inter');
  });

  it('skips empty CSS var values', () => {
    mockCSSVars({
      '--font-heading': '',
      '--font-sans': 'Roboto, sans-serif',
    });

    const { theme } = getFontList();
    expect(theme).toHaveLength(1);
    expect(theme[0].label).toBe('Body — Roboto');
  });

  it('returns empty theme array when no CSS vars set', () => {
    mockCSSVars({});
    const { theme, custom } = getFontList();
    expect(theme).toHaveLength(0);
    expect(custom.length).toBeGreaterThan(0);
  });

  it('uses label alone when primary name matches label', () => {
    mockCSSVars({
      '--font-heading': 'Heading, sans-serif',
      '--font-sans': 'Body, sans-serif',
    });

    const { theme } = getFontList();
    expect(theme[0].label).toBe('Heading');
    expect(theme[1].label).toBe('Body');
  });

  it('excludes custom fonts that duplicate a theme font value', () => {
    mockCSSVars({
      '--font-heading': 'Georgia, serif',
      '--font-sans': 'Inter, sans-serif',
    });

    const { custom } = getFontList();
    expect(custom.find((f) => f.value === 'Georgia, serif')).toBeUndefined();
  });
});
