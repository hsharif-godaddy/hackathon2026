import { beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.fn();
vi.mock('../../../logging/index.js', () => ({
  Logger: { create: () => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const {
  isValidDesignDirection,
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

describe('stylePreferencesForDirection', () => {
  it('applies a valid direction over the defaults', () => {
    expect(stylePreferencesForDirection('modernize')).toEqual({
      ...DEFAULT_STYLE_PREFERENCES,
      designDirection: 'modernize',
    });
  });

  it('returns keep-similar defaults with no warning when no choice was supplied', () => {
    expect(stylePreferencesForDirection(undefined)).toEqual(DEFAULT_STYLE_PREFERENCES);
    expect(stylePreferencesForDirection()).toEqual(DEFAULT_STYLE_PREFERENCES);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns and falls back when a choice arrived but failed validation', () => {
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
