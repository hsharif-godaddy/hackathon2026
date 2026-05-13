/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Import functions dynamically to allow module reset
let setTranslations: (translations: Record<string, string>) => void;
let t: (key: string, fallback: string) => string;

describe('translations', () => {
  beforeEach(async () => {
    // Reset module state and re-import before each test
    vi.resetModules();
    const module = await import('../translations');
    setTranslations = module.setTranslations;
    t = module.t;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setTranslations', () => {
    it('populates translations from parent window', () => {
      const testTranslations = {
        devtools_image_replace: 'Remplacer',
        devtools_edit_with_ai: 'Modifier avec l\'IA',
      };

      setTranslations(testTranslations);

      expect(t('devtools_image_replace', 'Replace')).toBe('Remplacer');
      expect(t('devtools_edit_with_ai', 'Edit with AI')).toBe('Modifier avec l\'IA');
    });

    it('merges new translations with existing ones', () => {
      setTranslations({ key1: 'value1' });
      setTranslations({ key2: 'value2' });

      expect(t('key1', 'fallback1')).toBe('value1');
      expect(t('key2', 'fallback2')).toBe('value2');
    });

    it('overwrites existing translation keys', () => {
      setTranslations({ key1: 'first' });
      setTranslations({ key1: 'second' });

      expect(t('key1', 'fallback')).toBe('second');
    });
  });

  describe('t', () => {
    it('returns translated value when key exists', () => {
      setTranslations({ test_key: 'translated' });
      expect(t('test_key', 'fallback')).toBe('translated');
    });

    it('returns fallback when key does not exist', () => {
      expect(t('missing_key', 'fallback value')).toBe('fallback value');
    });

    it('returns fallback for empty string translations', () => {
      setTranslations({ empty_key: '' });
      expect(t('empty_key', 'fallback')).toBe('fallback');
    });

    it('handles special characters in translation values', () => {
      setTranslations({
        special: 'L\'aperçu est "prêt"',
        html: '<strong>Bold</strong>',
      });
      expect(t('special', 'fallback')).toBe('L\'aperçu est "prêt"');
      expect(t('html', 'fallback')).toBe('<strong>Bold</strong>');
    });

    it('uses fallback when no translations have been loaded', () => {
      expect(t('any_key', 'fallback text')).toBe('fallback text');
    });
  });
});
