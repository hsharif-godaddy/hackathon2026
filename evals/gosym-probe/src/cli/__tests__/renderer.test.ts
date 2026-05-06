import { describe, it, expect } from 'vitest';
import {
  banner,
  startupBanner,
  interpolateHex,
  sectionTitle,
  pressAnyKeyPrompt,
  menuItem,
  divider,
  table,
  masked,
  statusBadge,
  clear,
} from '../renderer.js';


describe('banner', () => {
  it('contains project name', () => {
    expect(banner()).toContain('gosym-probe');
  });

  it('contains tagline', () => {
    expect(banner()).toContain('AAB eval harness');
  });

  it('returns a non-empty string', () => {
    expect(banner().length).toBeGreaterThan(0);
  });

  it('contains probe icon', () => {
    expect(banner()).toContain('\u{1F916}');
  });

  it('places icon before project name', () => {
    const text = (banner());
    const iconIdx = text.indexOf('\u{1F916}');
    const nameIdx = text.indexOf('gosym-probe');
    expect(iconIdx).toBeLessThan(nameIdx);
  });
});

describe('startupBanner', () => {
  it('returns a non-empty string', () => {
    expect(startupBanner().length).toBeGreaterThan(0);
  });

  it('contains multiple lines of ASCII art', () => {
    const lines = startupBanner()
      .split('\n')
      .filter((l) => (l).trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });

  it('fits within 80-column width', () => {
    for (const line of startupBanner().split('\n')) {
      expect((line).length).toBeLessThanOrEqual(80);
    }
  });

  it('contains block-letter characters', () => {
    const text = (startupBanner());
    expect(text).toMatch(/[_|/\\]/);
  });

  it('contains sub-banner text', () => {
    expect((startupBanner())).toContain(
      '(Airo App Builder Client)',
    );
  });

  it('contains sub-banner robot icon', () => {
    expect(startupBanner()).toContain('\u{1F916}');
  });
});

describe('interpolateHex', () => {
  it('returns start color at t=0', () => {
    expect(
      interpolateHex('#7C6AEF', '#4ED4C8', 0),
    ).toBe('#7c6aef');
  });

  it('returns end color at t=1', () => {
    expect(
      interpolateHex('#7C6AEF', '#4ED4C8', 1),
    ).toBe('#4ed4c8');
  });

  it('returns midpoint at t=0.5', () => {
    const mid = interpolateHex('#000000', '#ffffff', 0.5);
    expect(mid).toBe('#808080');
  });

  it('returns valid hex format', () => {
    const result = interpolateHex(
      '#7C6AEF',
      '#4ED4C8',
      0.3,
    );
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('menuItem', () => {
  it('contains the key in brackets', () => {
    expect((menuItem('1', 'Run Evals'))).toContain('[1]');
  });

  it('contains the label', () => {
    expect(menuItem('1', 'Run Evals')).toContain('Run Evals');
  });

  it('handles single-char letter key', () => {
    expect((menuItem('q', 'Quit'))).toContain('[q]');
    expect(menuItem('q', 'Quit')).toContain('Quit');
  });
});

describe('divider', () => {
  it('returns a string', () => {
    expect(typeof divider()).toBe('string');
  });

  it('default width produces 40 visible characters', () => {
    expect((divider())).toHaveLength(40);
  });

  it('respects custom width', () => {
    expect((divider(10))).toHaveLength(10);
    expect((divider(60))).toHaveLength(60);
  });
});

describe('table', () => {
  it('includes all header names', () => {
    const result = table(['Name', 'Type'], []);
    expect(result).toContain('Name');
    expect(result).toContain('Type');
  });

  it('includes row data', () => {
    const result = table(
      ['Name', 'Type'],
      [['build-landing-page', 'scenario']],
    );
    expect(result).toContain('build-landing-page');
    expect(result).toContain('scenario');
  });

  it('handles multiple rows', () => {
    const result = table(
      ['Name'],
      [['row-one'], ['row-two']],
    );
    expect(result).toContain('row-one');
    expect(result).toContain('row-two');
  });

  it('handles empty rows without throwing', () => {
    expect(() => table(['Name', 'Type'], [])).not.toThrow();
  });
});

describe('masked', () => {
  it('does not reveal the original value', () => {
    const secret = 'my-secret-key-123';
    expect(masked(secret)).not.toContain(secret);
  });

  it('uses asterisks for non-empty value', () => {
    const result = masked('secret');
    expect((result)).toMatch(/\*/);
  });

  it('handles empty string without throwing', () => {
    expect(() => masked('')).not.toThrow();
    expect(masked('')).toBeTruthy();
  });

  it('caps asterisk count at 8 for long values', () => {
    const result = (masked('a-very-long-secret-value'));
    expect(result).toHaveLength(8);
  });
});

describe('statusBadge', () => {
  it('contains uppercase status for pass', () => {
    expect(statusBadge('pass')).toContain('PASS');
  });

  it('contains uppercase status for fail', () => {
    expect(statusBadge('fail')).toContain('FAIL');
  });

  it('handles unknown status', () => {
    const result = statusBadge('unknown');
    expect(result).toContain('UNKNOWN');
  });

  it('uppercases lowercase input', () => {
    expect(statusBadge('running')).toContain('RUNNING');
  });

  it('handles skip status', () => {
    expect(statusBadge('skip')).toContain('SKIP');
  });
});

describe('sectionTitle', () => {
  it('contains the original text', () => {
    expect(sectionTitle('Run Evals')).toContain('Run Evals');
  });

  it('preserves text content after stripping ANSI', () => {
    expect((sectionTitle('Config'))).toBe('Config');
  });
});

describe('pressAnyKeyPrompt', () => {
  it('returns a non-empty string', () => {
    expect(pressAnyKeyPrompt().length).toBeGreaterThan(0);
  });

  it('contains readable prompt text', () => {
    expect(
      (pressAnyKeyPrompt()),
    ).toMatch(/press any key/i);
  });
});

describe('clear', () => {
  it('returns an ANSI escape sequence', () => {
    expect(clear()).toContain('\x1B');
  });

  it('returns a non-empty string', () => {
    expect(clear().length).toBeGreaterThan(0);
  });
});
