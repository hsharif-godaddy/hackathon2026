import { describe, it, expect } from 'vitest';
import { matchMenuOption, type MenuOption } from '../ui.js';

const noop = async () => {};

const OPTIONS: MenuOption[] = [
  { key: '1', label: 'Run Evals', handler: noop },
  { key: '2', label: 'List Scenarios', handler: noop },
  { key: 'h', label: 'Help', handler: noop },
  { key: 'q', label: 'Quit', handler: noop },
];

describe('matchMenuOption', () => {
  it('returns matching option for numeric key', () => {
    expect(matchMenuOption('1', OPTIONS)?.label).toBe('Run Evals');
  });

  it('returns matching option for letter key', () => {
    expect(matchMenuOption('q', OPTIONS)?.label).toBe('Quit');
  });

  it('is case-insensitive for letter keys', () => {
    expect(matchMenuOption('H', OPTIONS)?.label).toBe('Help');
    expect(matchMenuOption('Q', OPTIONS)?.label).toBe('Quit');
  });

  it('returns undefined for unrecognized key', () => {
    expect(matchMenuOption('x', OPTIONS)).toBeUndefined();
  });

  it('returns undefined for empty options array', () => {
    expect(matchMenuOption('1', [])).toBeUndefined();
  });

  it('returns first match when multiple options share a key', () => {
    const dupes: MenuOption[] = [
      { key: '1', label: 'First', handler: noop },
      { key: '1', label: 'Second', handler: noop },
    ];
    expect(matchMenuOption('1', dupes)?.label).toBe('First');
  });

  it('handles special characters like Ctrl+C code', () => {
    const opts: MenuOption[] = [
      { key: '\u0003', label: 'Interrupt', handler: noop },
    ];
    expect(matchMenuOption('\u0003', opts)?.label).toBe('Interrupt');
  });
});
