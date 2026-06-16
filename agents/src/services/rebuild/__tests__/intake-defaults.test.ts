import { beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.fn();
vi.mock('../../../logging/index.js', () => ({
  Logger: { create: () => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const {
  inferDesignDirectionFromMessage,
  isValidDesignDirection,
  resolveDesignDirection,
  stylePreferencesForDirection,
  defaultIntakeChoices,
  DEFAULT_STYLE_PREFERENCES,
} = await import('../intake-defaults.js');

beforeEach(() => warn.mockClear());

describe('isValidDesignDirection', () => {
  it('accepts all four real directions', () => {
    for (const d of ['keep-similar', 'modernize', 'simplify', 'bold']) {
      expect(isValidDesignDirection(d)).toBe(true);
    }
  });

  it('rejects junk and empty', () => {
    for (const d of ['nonsense', '', null, undefined, 42]) {
      expect(isValidDesignDirection(d)).toBe(false);
    }
  });
});

describe('inferDesignDirectionFromMessage', () => {
  it('detects modernize intent in free text', () => {
    expect(inferDesignDirectionFromMessage('rebuild and modernize my site: https://example.com')).toBe('modernize');
    expect(inferDesignDirectionFromMessage('Reimagine my website with a fresh design')).toBe('modernize');
    expect(inferDesignDirectionFromMessage('rebuild with an updated design')).toBe('modernize');
    expect(inferDesignDirectionFromMessage('refresh the design of my homepage')).toBe('modernize');
    expect(inferDesignDirectionFromMessage('rebuild with a fresh modern layout')).toBe('modernize');
  });

  it('detects keep-similar intent in free text', () => {
    expect(inferDesignDirectionFromMessage('rebuild my site, keep a similar look')).toBe('keep-similar');
    expect(inferDesignDirectionFromMessage('rebuild my site, keep similar layout')).toBe('keep-similar');
    expect(inferDesignDirectionFromMessage('same overall look as today')).toBe('keep-similar');
    expect(inferDesignDirectionFromMessage('clone my current site faithfully')).toBe('keep-similar');
    expect(inferDesignDirectionFromMessage('keep it as-is')).toBe('keep-similar');
    expect(inferDesignDirectionFromMessage('rebuild as a copycat of my site')).toBe('keep-similar');
    expect(inferDesignDirectionFromMessage('mirror my existing homepage')).toBe('keep-similar');
    expect(inferDesignDirectionFromMessage('reproduce the source layout')).toBe('keep-similar');
  });

  it('prefers clone when both clone and modernize keywords appear', () => {
    expect(inferDesignDirectionFromMessage('modernize but keep a similar look')).toBe('keep-similar');
  });

  it('treats negated modernize language as keep-similar', () => {
    expect(inferDesignDirectionFromMessage("I don't want a redesign, keep it as-is")).toBe('keep-similar');
    expect(inferDesignDirectionFromMessage('do not modernize my site')).toBe('keep-similar');
    expect(inferDesignDirectionFromMessage('not a redesign please')).toBe('keep-similar');
    expect(inferDesignDirectionFromMessage("don't want to redesign my site")).toBe('keep-similar');
    expect(inferDesignDirectionFromMessage('not interested in a redesign')).toBe('keep-similar');
  });

  it('treats negated clone language as modernize', () => {
    expect(inferDesignDirectionFromMessage("don't keep it as-is")).toBe('modernize');
    expect(inferDesignDirectionFromMessage('not the same look')).toBe('modernize');
    expect(inferDesignDirectionFromMessage("don't keep similar to the original")).toBe('modernize');
  });

  it('does not infer clone from incidental faithfully or bare as-is tokens', () => {
    expect(inferDesignDirectionFromMessage('translate faithfully from the source copy')).toBeUndefined();
    expect(inferDesignDirectionFromMessage('rebuild asis token in url path')).toBeUndefined();
  });

  it('does not infer modernize from unrelated refresh phrases', () => {
    expect(inferDesignDirectionFromMessage('refresh the content on my homepage')).toBeUndefined();
    expect(inferDesignDirectionFromMessage('refreshing the blog posts')).toBeUndefined();
  });

  it('returns undefined for ambiguous prompts and non-string inputs', () => {
    expect(inferDesignDirectionFromMessage('rebuild my site https://example.com')).toBeUndefined();
    expect(inferDesignDirectionFromMessage('')).toBeUndefined();
    expect(inferDesignDirectionFromMessage('   ')).toBeUndefined();
    expect(inferDesignDirectionFromMessage(null)).toBeUndefined();
    expect(inferDesignDirectionFromMessage(undefined)).toBeUndefined();
  });
});

describe('resolveDesignDirection', () => {
  it('prefers a valid client direction', () => {
    expect(resolveDesignDirection('keep-similar', 'modernize my site')).toBe('keep-similar');
  });

  it('falls back to prompt keywords when client direction is missing', () => {
    expect(resolveDesignDirection(undefined, 'rebuild and modernize')).toBe('modernize');
    expect(resolveDesignDirection(undefined, 'keep my current look')).toBe('keep-similar');
  });

  it('infers from message when client direction is invalid', () => {
    expect(resolveDesignDirection('nonsense', 'keep a similar look')).toBe('keep-similar');
    expect(warn).toHaveBeenCalledWith('rebuild.intakeDefaults.invalidDirection', { received: 'nonsense' });
  });

  it('defaults to modernize when nothing else applies', () => {
    expect(resolveDesignDirection(undefined)).toBe('modernize');
    expect(resolveDesignDirection('nonsense')).toBe('modernize');
  });

  it('warns when client direction is invalid', () => {
    resolveDesignDirection('moderinze');
    expect(warn).toHaveBeenCalledWith('rebuild.intakeDefaults.invalidDirection', { received: 'moderinze' });
  });
});

describe('stylePreferencesForDirection', () => {
  it('applies a valid direction over the defaults', () => {
    expect(stylePreferencesForDirection('keep-similar')).toEqual({
      ...DEFAULT_STYLE_PREFERENCES,
      designDirection: 'keep-similar',
    });
  });

  it('returns modernize defaults with no warning when no choice was supplied', () => {
    expect(stylePreferencesForDirection(undefined)).toEqual(DEFAULT_STYLE_PREFERENCES);
    expect(stylePreferencesForDirection()).toEqual(DEFAULT_STYLE_PREFERENCES);
    expect(stylePreferencesForDirection(undefined, '   ')).toEqual(DEFAULT_STYLE_PREFERENCES);
    expect(warn).not.toHaveBeenCalled();
  });

  it('infers direction from user message when client choice is missing', () => {
    expect(stylePreferencesForDirection(undefined, 'rebuild and modernize my site')).toEqual({
      ...DEFAULT_STYLE_PREFERENCES,
      designDirection: 'modernize',
    });
  });

  it('warns via resolveDesignDirection when a choice arrived but failed validation', () => {
    expect(stylePreferencesForDirection('moderinze')).toEqual(DEFAULT_STYLE_PREFERENCES);
    expect(warn).toHaveBeenCalledWith(
      'rebuild.intakeDefaults.invalidDirection',
      { received: 'moderinze' },
    );
  });
});

describe('defaultIntakeChoices', () => {
  it('carries the direction into homepage-scoped choices', () => {
    expect(defaultIntakeChoices('bold')).toEqual({
      scope: 'homepage_only',
      stylePreferences: { ...DEFAULT_STYLE_PREFERENCES, designDirection: 'bold' },
    });
  });
});
