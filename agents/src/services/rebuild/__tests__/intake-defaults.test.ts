import { beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.fn();
vi.mock('../../../logging/index.js', () => ({
  Logger: { create: () => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const {
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
});
