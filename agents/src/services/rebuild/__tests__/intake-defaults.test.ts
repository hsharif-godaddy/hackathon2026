import { beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.fn();
vi.mock('../../../logging/index.js', () => ({
  Logger: { create: () => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const {
  isValidDesignDirection,
  resolveDesignDirection,
  resolveDesignIntent,
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

describe('resolveDesignDirection', () => {
  it('prefers a valid client direction', () => {
    expect(resolveDesignDirection('keep-similar', 'modernize')).toBe('keep-similar');
  });

  it('uses agent tool direction when client direction is missing', () => {
    expect(resolveDesignDirection(undefined, 'modernize')).toBe('modernize');
    expect(resolveDesignDirection(undefined, 'simplify')).toBe('simplify');
    expect(resolveDesignDirection(undefined, 'keep-similar')).toBe('keep-similar');
  });

  it('prefers tool direction over default when client direction is missing', () => {
    expect(resolveDesignDirection(undefined, 'keep-similar')).toBe('keep-similar');
    expect(resolveDesignDirection(undefined, 'bold')).toBe('bold');
  });

  it('infers from client when tool direction is invalid', () => {
    expect(resolveDesignDirection('nonsense', 'keep-similar')).toBe('keep-similar');
    expect(warn).toHaveBeenCalledWith('rebuild.intakeDefaults.invalidDirection', { source: 'client', received: 'nonsense' });
  });

  it('defaults to modernize when nothing else applies', () => {
    expect(resolveDesignDirection()).toBe('modernize');
    expect(resolveDesignDirection(undefined)).toBe('modernize');
    expect(resolveDesignDirection('nonsense')).toBe('modernize');
  });

  it('warns and falls through when tool direction is invalid', () => {
    expect(resolveDesignDirection(undefined, 'moderinze')).toBe('modernize');
    expect(warn).toHaveBeenCalledWith('rebuild.intakeDefaults.invalidDirection', { source: 'tool', received: 'moderinze' });
  });
});

describe('resolveDesignIntent', () => {
  it('prefers the client/intake intent over the tool arg', () => {
    expect(resolveDesignIntent('reimagine from scratch', 'modernize it')).toBe('reimagine from scratch');
  });

  it('uses the tool intent when the client intent is missing', () => {
    expect(resolveDesignIntent(undefined, 'ignore the existing layout')).toBe('ignore the existing layout');
  });

  it('trims surrounding whitespace', () => {
    expect(resolveDesignIntent(undefined, '  fresh and modern  ')).toBe('fresh and modern');
  });

  it('returns undefined for blank, empty, or non-string values', () => {
    expect(resolveDesignIntent(undefined, undefined)).toBeUndefined();
    expect(resolveDesignIntent('', '')).toBeUndefined();
    expect(resolveDesignIntent(undefined, '   ')).toBeUndefined();
    expect(resolveDesignIntent(42, { foo: 'bar' })).toBeUndefined();
  });

  it('falls through to the tool intent when the client intent is blank', () => {
    expect(resolveDesignIntent('   ', 'bold and dramatic')).toBe('bold and dramatic');
  });
});

describe('stylePreferencesForDirection', () => {
  it('applies a valid direction over the defaults', () => {
    expect(stylePreferencesForDirection('keep-similar')).toEqual({
      ...DEFAULT_STYLE_PREFERENCES,
      designDirection: 'keep-similar',
    });
  });

  it('carries a resolved designIntent when one is supplied', () => {
    expect(stylePreferencesForDirection('modernize', undefined, undefined, 'reimagine from first principles')).toEqual({
      ...DEFAULT_STYLE_PREFERENCES,
      designDirection: 'modernize',
      designIntent: 'reimagine from first principles',
    });
  });

  it('omits the designIntent key entirely when no intent is supplied', () => {
    const prefs = stylePreferencesForDirection('modernize');
    expect(prefs).not.toHaveProperty('designIntent');
  });

  it('returns modernize defaults with no warning when no choice was supplied', () => {
    expect(stylePreferencesForDirection(undefined)).toEqual(DEFAULT_STYLE_PREFERENCES);
    expect(stylePreferencesForDirection()).toEqual(DEFAULT_STYLE_PREFERENCES);
    expect(warn).not.toHaveBeenCalled();
  });

  it('applies tool direction when client choice is missing', () => {
    expect(stylePreferencesForDirection(undefined, 'simplify')).toEqual({
      ...DEFAULT_STYLE_PREFERENCES,
      designDirection: 'simplify',
    });
  });

  it('warns via resolveDesignDirection when a choice arrived but failed validation', () => {
    expect(stylePreferencesForDirection('moderinze')).toEqual(DEFAULT_STYLE_PREFERENCES);
    expect(warn).toHaveBeenCalledWith(
      'rebuild.intakeDefaults.invalidDirection',
      { source: 'client', received: 'moderinze' },
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

  it('carries a resolved designIntent into the fallback choices (intake-timeout path)', () => {
    expect(defaultIntakeChoices('modernize', undefined, 'reimagine from scratch')).toEqual({
      scope: 'homepage_only',
      stylePreferences: {
        ...DEFAULT_STYLE_PREFERENCES,
        designDirection: 'modernize',
        designIntent: 'reimagine from scratch',
      },
    });
  });
});
